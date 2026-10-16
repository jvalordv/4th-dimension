#!/usr/bin/env python3
"""Rebuild an old anime music video shot for shot from a Blu-ray source.

The old AMV is used only as a map: where each of its shots lives in the film
and how long it lasts. The output contains nothing but Blu-ray frames and the
song you supply.

Subcommands, in the order you run them:

  fingerprint   decode a video into tiny grayscale frames (.npz)
  cuts          find the shot boundaries of the old AMV
  match         locate every AMV shot in the Blu-ray; writes an EDL and a
                review sheet of side-by-side frames
  audio-offset  find where the song starts inside the old AMV
  render        cut the Blu-ray along the EDL and mux the song

Needs Python 3.9+, numpy, and ffmpeg/ffprobe on PATH (or --ffmpeg DIR).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import sys
from fractions import Fraction

import numpy as np

# Fingerprint frames are this small. Enough to tell shots apart, small enough
# that a whole film fits in memory and a search over it takes milliseconds.
FEAT_W, FEAT_H = 32, 18
FEAT_D = FEAT_W * FEAT_H

# A frame whose pixel standard deviation is below this is "flat" (black,
# white, a solid colour). Flat frames carry no shape and never match.
FLAT_STD = 4.0

FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")


def set_ffmpeg_dir(d: str | None) -> None:
    global FFMPEG, FFPROBE
    if d:
        exe = ".exe" if os.name == "nt" else ""
        FFMPEG = os.path.join(d, "ffmpeg" + exe)
        FFPROBE = os.path.join(d, "ffprobe" + exe)


def run(args: list[str], **kw) -> subprocess.CompletedProcess:
    res = subprocess.run(args, capture_output=True, text=True, errors="replace", **kw)
    if res.returncode != 0:
        sys.stderr.write(res.stderr[-4000:])
        raise SystemExit(f"command failed ({res.returncode}): {' '.join(args[:3])} ...")
    return res


def log(msg: str) -> None:
    print(msg, flush=True)


# --------------------------------------------------------------------------
# Probing and decoding
# --------------------------------------------------------------------------

class Info:
    def __init__(self, path: str):
        res = run([FFPROBE, "-v", "error", "-print_format", "json",
                   "-show_streams", "-show_format", path])
        data = json.loads(res.stdout)
        streams = data.get("streams", [])
        video = [s for s in streams if s.get("codec_type") == "video"]
        if not video:
            raise SystemExit(f"no video stream in {path}")
        v = video[0]
        fps = Fraction(v.get("r_frame_rate") or "0")
        if fps == 0:
            fps = Fraction(v.get("avg_frame_rate") or "0")
        if fps == 0:
            raise SystemExit(f"cannot determine frame rate of {path}")
        self.path = path
        self.fps = fps
        self.width = int(v["width"])
        self.height = int(v["height"])
        self.duration = float(data.get("format", {}).get("duration") or 0)
        self.has_audio = any(s.get("codec_type") == "audio" for s in streams)


def detect_crop(path: str, limit: int = 24) -> str | None:
    """Picture area as crop=W:H:X:Y, the median box over all keyframes.

    A per-frame box is measured on every keyframe and the median of each
    edge is taken, so a few full-frame flashes or black frames cannot move
    it; a union would be defeated by a single white frame.
    """
    args = [FFMPEG, "-hide_banner", "-nostats", "-skip_frame", "nokey", "-i", path,
            "-vf", f"cropdetect=limit={limit}:round=2:reset=1", "-an", "-f", "null", "-"]
    res = subprocess.run(args, capture_output=True, text=True, errors="replace")
    boxes = [tuple(int(t) for t in m) for m in
             re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", res.stderr)]
    boxes = [(w, h, x, y) for w, h, x, y in boxes if w > 0 and h > 0]
    if not boxes:
        return None
    b = np.array(boxes, dtype=np.int64)
    x1, y1 = np.median(b[:, 2]), np.median(b[:, 3])
    x2, y2 = np.median(b[:, 2] + b[:, 0]), np.median(b[:, 3] + b[:, 1])
    x1, y1 = int(round(x1 / 2)) * 2, int(round(y1 / 2)) * 2
    w, h = int((x2 - x1) // 2) * 2, int((y2 - y1) // 2) * 2
    if w <= 0 or h <= 0:
        return None
    return f"{w}:{h}:{x1}:{y1}"


def decode_gray(path: str, vf: list[str]) -> np.ndarray:
    """Run ffmpeg with a filter chain ending in tiny gray frames; return [N,H,W]."""
    chain = vf + [f"scale={FEAT_W}:{FEAT_H}:flags=area", "format=gray"]
    args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-nostats", "-i", path,
            "-vf", ",".join(chain), "-an", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    data, err = proc.communicate()
    if proc.returncode != 0:
        sys.stderr.write(err.decode(errors="replace")[-4000:])
        raise SystemExit("ffmpeg decode failed")
    n = len(data) // FEAT_D
    return np.frombuffer(data[: n * FEAT_D], dtype=np.uint8).reshape(n, FEAT_H, FEAT_W)


def fps_str(fps: Fraction) -> str:
    return f"{fps.numerator}/{fps.denominator}"


def cmd_fingerprint(a: argparse.Namespace) -> None:
    info = Info(a.video)
    fps = Fraction(a.fps) if a.fps else info.fps
    vf = []
    crop = None
    if a.crop == "auto":
        crop = detect_crop(a.video)
        if crop:
            w, h, _, _ = (int(t) for t in crop.split(":"))
            if w * h < 0.4 * info.width * info.height:
                log(f"  crop {crop} looks too small for {info.width}x{info.height}; ignoring")
                crop = None
    elif a.crop != "none":
        crop = a.crop
    if crop:
        vf.append(f"crop={crop}")
    vf.append(f"fps={fps_str(fps)}")
    log(f"fingerprint {a.video}\n  {info.width}x{info.height} @ {float(fps):.3f} fps, "
        f"{info.duration:.1f} s, crop={crop or 'none'}")
    frames = decode_gray(a.video, vf)
    np.savez_compressed(a.out, frames=frames, fps_num=fps.numerator, fps_den=fps.denominator,
                        crop=crop or "", path=os.path.abspath(a.video),
                        width=info.width, height=info.height)
    log(f"  {len(frames)} frames -> {a.out}")


class Fingerprint:
    def __init__(self, path: str):
        z = np.load(path, allow_pickle=False)
        self.frames: np.ndarray = z["frames"]
        self.fps = Fraction(int(z["fps_num"]), int(z["fps_den"]))
        self.crop = str(z["crop"])
        self.video = str(z["path"])
        self.width = int(z["width"])
        self.height = int(z["height"])
        self.feat, self.flat = normalize(self.frames)
        self.mean = self.frames.reshape(len(self.frames), -1).mean(axis=1)

    @property
    def n(self) -> int:
        return len(self.frames)


def normalize(frames: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Zero-mean, unit-norm feature per frame; flat frames become the zero vector.

    Cosine similarity between such features ignores brightness and contrast,
    which differ a lot between a 2001 DVD rip and a Blu-ray.
    """
    x = frames.reshape(len(frames), -1).astype(np.float32)
    x -= x.mean(axis=1, keepdims=True)
    norm = np.linalg.norm(x, axis=1, keepdims=True)
    flat = norm[:, 0] < FLAT_STD * np.sqrt(FEAT_D)
    x /= np.maximum(norm, 1e-6)
    x[flat] = 0
    return x, flat


# --------------------------------------------------------------------------
# Shot boundaries of the AMV
# --------------------------------------------------------------------------

def frame_distance(fp: Fingerprint) -> np.ndarray:
    """Distance between consecutive frames: 1 - cosine, plus a brightness term.

    Two flat frames compare by brightness alone; a flat frame against a
    textured one is a full cut (a flash or a cut to black).
    """
    x, flat, mean = fp.feat, fp.flat, fp.mean
    cos = (x[1:] * x[:-1]).sum(axis=1)
    both_flat = flat[1:] & flat[:-1]
    cos[both_flat] = 1.0
    lum = np.abs(mean[1:] - mean[:-1]) / 128.0
    return (1.0 - cos) + lum


def find_cuts(fp: Fingerprint, thresh: float, rel: float, window: int = 8) -> list[int]:
    """Frame indices i such that a shot starts at frame i."""
    d = frame_distance(fp)
    n = len(d)
    cuts = []
    for i in range(n):
        if d[i] > thresh:
            cuts.append(i + 1)
            continue
        if d[i] > thresh / 2:
            lo, hi = max(0, i - window), min(n, i + window + 1)
            neigh = np.concatenate([d[lo:i], d[i + 1:hi]])
            if len(neigh) and d[i] > rel * max(np.median(neigh), 0.005):
                cuts.append(i + 1)
    return cuts


def cmd_cuts(a: argparse.Namespace) -> None:
    fp = Fingerprint(a.fingerprint)
    cuts = find_cuts(fp, a.thresh, a.rel)
    bounds = [0] + cuts + [fp.n]
    shots = [[s, e] for s, e in zip(bounds[:-1], bounds[1:]) if e > s]
    out = {"video": fp.video, "fps": fps_str(fp.fps), "frames": fp.n, "shots": shots}
    with open(a.out, "w") as f:
        json.dump(out, f, indent=1)
    lens = np.array([e - s for s, e in shots]) / float(fp.fps)
    log(f"{len(shots)} shots in {fp.video}\n  shortest {lens.min():.2f} s, median "
        f"{np.median(lens):.2f} s, longest {lens.max():.2f} s -> {a.out}")


# --------------------------------------------------------------------------
# Matching AMV shots to the source
# --------------------------------------------------------------------------

class Located:
    __slots__ = ("start", "speed", "score", "ambiguity", "sims")

    def __init__(self, start, speed, score, ambiguity, sims):
        self.start, self.speed, self.score = start, speed, score
        self.ambiguity, self.sims = ambiguity, sims


def src_offsets(k: np.ndarray, fa: Fraction, fs: Fraction, speed: float) -> np.ndarray:
    """Source frame offset for AMV frame offset k, at the given speed."""
    return np.round(k.astype(np.float64) / float(fa) * float(fs) * abs(speed)).astype(np.int64)


def locate(amv: Fingerprint, a: int, b: int, src: Fingerprint,
           speeds: tuple[float, ...], samples: int = 12) -> Located | None:
    """Find where AMV frames [a, b) come from in the source.

    Sample a few AMV frames, compare each against every source frame, then
    slide the sampled frames as a rigid sequence over the source and take
    the start with the best mean similarity. Checking the frames as a
    sequence rejects single frames that happen to look alike.
    """
    L = b - a
    if L >= 4:
        idx = np.unique(np.linspace(a + 1, b - 2, min(L - 2, samples)).round().astype(int))
    else:
        idx = np.arange(a, b)
    idx = idx[~amv.flat[idx]]
    if len(idx) == 0:
        return None
    Q = amv.feat[idx]                      # K x D
    S = src.feat @ Q.T                     # N x K
    N = src.n
    best = None
    for speed in speeds:
        off = src_offsets(idx - a, amv.fps, src.fps, speed)
        span = src_offsets(np.array([L - 1]), amv.fps, src.fps, speed)[0]
        if speed < 0:
            off = span - off
        if span >= N:
            continue
        nvalid = N - span
        score = np.zeros(nvalid, dtype=np.float32)
        for k, o in enumerate(off):
            score += S[o:o + nvalid, k]
        score /= len(off)
        s = int(np.argmax(score))
        top = float(score[s])
        # Second-best peak outside the neighbourhood of the best one.
        guard = int(span + float(src.fps))
        masked = score.copy()
        masked[max(0, s - guard):s + guard + 1] = -1
        second = float(masked.max()) if nvalid > 2 * guard + 1 else -1.0
        if best is None or top > best.score:
            best = Located(s, speed, top, second / top if top > 0 else 1.0, None)
    if best is None:
        return None
    # Similarity of every AMV frame in the shot along the chosen alignment.
    k = np.arange(L)
    off = src_offsets(k, amv.fps, src.fps, best.speed)
    span = src_offsets(np.array([L - 1]), amv.fps, src.fps, best.speed)[0]
    if best.speed < 0:
        off = span - off
    sidx = np.clip(best.start + off, 0, N - 1)
    best.sims = (amv.feat[a:b] * src.feat[sidx]).sum(axis=1)
    return best


def split_point(loc: Located, amv: Fingerprint, a: int, b: int) -> int | None:
    """Index inside [a, b) where the alignment stops fitting, if it does.

    A shot the cut detector missed shows up as a run of poorly matching
    frames after a well matching start. Flat frames are ignored.
    """
    L = b - a
    if L < 6:
        return None
    sims = loc.sims.copy()
    sims[amv.flat[a:b]] = 1.0
    low = sims < max(0.35, 0.55 * loc.score)
    need = max(3, L // 10)
    run = 0
    for j in range(L):
        run = run + 1 if low[j] else 0
        if run == need:
            start = j - need + 1
            return a + start if start >= 2 else None
    return None


def match_shot(amv: Fingerprint, a: int, b: int, src: Fingerprint, speeds, depth: int = 0) -> list[dict]:
    fa = float(amv.fps)
    flat_frac = amv.flat[a:b].mean()
    if flat_frac > 0.9:
        return [{"amv_in": a / fa, "amv_out": b / fa, "type": "flat",
                 "level": int(round(amv.mean[a:b].mean())), "status": "ok"}]
    loc = locate(amv, a, b, src, speeds)
    if loc is None:
        return [{"amv_in": a / fa, "amv_out": b / fa, "type": "flat", "level": 0,
                 "status": "unmatched"}]
    if depth < 4:
        j = split_point(loc, amv, a, b)
        if j is not None and b - j >= 2:
            return match_shot(amv, a, j, src, speeds, depth + 1) + \
                   match_shot(amv, j, b, src, speeds, depth + 1)
    fs = float(src.fps)
    dur = (b - a) / fa
    src_dur = dur * abs(loc.speed)
    return [{"amv_in": a / fa, "amv_out": b / fa, "type": "source",
             "src_in": loc.start / fs, "src_out": loc.start / fs + src_dur,
             "speed": loc.speed, "score": round(loc.score, 3),
             "ambiguity": round(loc.ambiguity, 3)}]


def finish_statuses(shots: list[dict], ok: float, low: float) -> None:
    for s in shots:
        if s["type"] != "source":
            continue
        if s["score"] >= ok:
            s["status"] = "ok"
        elif s["score"] >= low:
            s["status"] = "check"
        else:
            s["status"] = "unmatched"


def merge_contiguous(shots: list[dict], fs: float) -> list[dict]:
    """Join neighbours that continue the same source footage (a false cut)."""
    out: list[dict] = []
    for s in shots:
        p = out[-1] if out else None
        if (p and p["type"] == "source" and s["type"] == "source"
                and p["status"] == "ok" and s["status"] == "ok"
                and p["speed"] == s["speed"]
                and abs(s["src_in"] - p["src_out"]) <= 2.0 / fs):
            p["amv_out"] = s["amv_out"]
            p["src_out"] = p["src_in"] + (p["amv_out"] - p["amv_in"]) * abs(p["speed"])
            p["score"] = min(p["score"], s["score"])
            p["ambiguity"] = max(p["ambiguity"], s["ambiguity"])
            continue
        out.append(dict(s))
    return out


def extend_over_gaps(shots: list[dict], max_gap: float) -> None:
    """Short unmatched shots (dissolves, blends) continue the previous shot."""
    for i, s in enumerate(shots):
        if s["status"] != "unmatched" or s["amv_out"] - s["amv_in"] > max_gap or i == 0:
            continue
        p = shots[i - 1]
        if p["type"] != "source":
            continue
        dur = s["amv_out"] - s["amv_in"]
        s.clear()
        s.update({"amv_in": p["amv_out"], "amv_out": p["amv_out"] + dur, "type": "source",
                  "src_in": p["src_out"], "src_out": p["src_out"] + dur * abs(p["speed"]),
                  "speed": p["speed"], "score": 0.0, "ambiguity": 1.0, "status": "extended"})


def cmd_match(a: argparse.Namespace) -> None:
    amv = Fingerprint(a.amv_fingerprint)
    src = Fingerprint(a.source_fingerprint)
    with open(a.cuts) as f:
        cuts = json.load(f)
    speeds = tuple(float(x) for x in a.speeds.split(","))
    log(f"match {len(cuts['shots'])} AMV shots against {src.n} source frames")
    shots: list[dict] = []
    for i, (s, e) in enumerate(cuts["shots"]):
        shots.extend(match_shot(amv, s, e, src, speeds))
        if (i + 1) % 25 == 0:
            log(f"  {i + 1}/{len(cuts['shots'])}")
    finish_statuses(shots, a.ok, a.low)
    shots = merge_contiguous(shots, float(src.fps))
    extend_over_gaps(shots, a.max_gap)
    for i, s in enumerate(shots):
        s["id"] = i
        for k in ("amv_in", "amv_out", "src_in", "src_out"):
            if k in s:
                s[k] = round(s[k], 4)
    edl = {"amv": amv.video, "amv_fps": fps_str(amv.fps),
           "source": src.video, "source_fps": fps_str(src.fps),
           "duration": shots[-1]["amv_out"] if shots else 0.0, "shots": shots}
    with open(a.out, "w") as f:
        json.dump(edl, f, indent=1)
    counts = {}
    for s in shots:
        counts[s["status"]] = counts.get(s["status"], 0) + 1
    log(f"  {len(shots)} shots -> {a.out}\n  " +
        ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())))
    if a.review != "none":
        review_dir = a.review or os.path.join(os.path.dirname(os.path.abspath(a.out)), "review")
        write_review(edl, review_dir, a.jobs)


# --------------------------------------------------------------------------
# Review sheet
# --------------------------------------------------------------------------

def grab_frame(video: str, t: float, out: str) -> None:
    if os.path.exists(out):
        return
    run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{max(t, 0):.4f}",
         "-i", video, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", out])


def write_review(edl: dict, out_dir: str, jobs: int) -> None:
    os.makedirs(out_dir, exist_ok=True)
    tasks = []
    for s in edl["shots"]:
        mid = (s["amv_in"] + s["amv_out"]) / 2
        tasks.append((edl["amv"], mid, os.path.join(out_dir, f"shot{s['id']:03d}_amv.jpg")))
        if s["type"] == "source":
            smid = (s["src_in"] + s["src_out"]) / 2
            tasks.append((edl["source"], smid, os.path.join(out_dir, f"shot{s['id']:03d}_src.jpg")))
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as ex:
        list(ex.map(lambda t: grab_frame(*t), tasks))
    rows = []
    for s in edl["shots"]:
        sid = s["id"]
        if s["type"] == "source":
            src_cell = (f'<img src="shot{sid:03d}_src.jpg"><br>{fmt_t(s["src_in"])} - '
                        f'{fmt_t(s["src_out"])}<br>score {s["score"]:.2f}, ambiguity '
                        f'{s["ambiguity"]:.2f}, speed {s["speed"]:g}')
        else:
            src_cell = f'flat, level {s.get("level", 0)}'
        rows.append(f'<tr class="{s["status"]}"><td>{sid}<br>{s["status"]}</td>'
                    f'<td><img src="shot{sid:03d}_amv.jpg"><br>{fmt_t(s["amv_in"])} - '
                    f'{fmt_t(s["amv_out"])} ({s["amv_out"] - s["amv_in"]:.2f} s)</td>'
                    f'<td>{src_cell}</td></tr>')
    html = f"""<!doctype html><meta charset="utf-8"><title>AMV match review</title>
<style>
body{{background:#111;color:#ddd;font:14px system-ui,sans-serif;margin:16px}}
table{{border-collapse:collapse}} td{{padding:6px 10px;border-bottom:1px solid #333;vertical-align:top}}
img{{display:block;max-width:360px}} tr.check td:first-child{{color:#fc0}}
tr.unmatched td:first-child{{color:#f44}} tr.extended td:first-child{{color:#8af}}
</style>
<h1>{os.path.basename(edl["amv"])} vs {os.path.basename(edl["source"])}</h1>
<p>Left: the old AMV. Right: the Blu-ray frame the EDL will use. Fix src_in in the EDL for any row that is wrong.</p>
<table><tr><th>shot</th><th>AMV</th><th>source</th></tr>{"".join(rows)}</table>"""
    with open(os.path.join(out_dir, "review.html"), "w", encoding="utf-8") as f:
        f.write(html)
    log(f"  review sheet -> {os.path.join(out_dir, 'review.html')}")


def fmt_t(t: float) -> str:
    m, s = divmod(t, 60)
    h, m = divmod(int(m), 60)
    return f"{h}:{m:02d}:{s:06.3f}" if h else f"{m}:{s:06.3f}"


# --------------------------------------------------------------------------
# Audio offset
# --------------------------------------------------------------------------

def read_audio(path: str, sr: int) -> np.ndarray:
    args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", path, "-vn",
            "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    data, err = proc.communicate()
    if proc.returncode != 0:
        sys.stderr.write(err.decode(errors="replace")[-4000:])
        raise SystemExit("ffmpeg audio decode failed")
    return np.frombuffer(data, dtype=np.float32).astype(np.float64)


def xcorr_offset(a: np.ndarray, s: np.ndarray, sr: int) -> tuple[float, float]:
    """Time in `a` at which sample 0 of `s` plays, and the peak's z-score."""
    a = a - a.mean()
    s = s - s.mean()
    n = 1 << (len(a) + len(s) - 1).bit_length()
    c = np.fft.irfft(np.fft.rfft(a, n) * np.conj(np.fft.rfft(s, n)), n)
    k = int(np.argmax(c))
    z = (c[k] - c.mean()) / (c.std() + 1e-12)
    if k > n // 2:
        k -= n
    return k / sr, float(z)


def find_offset(amv_path: str, song_path: str, sr: int = 8000) -> dict:
    a = read_audio(amv_path, sr)
    s = read_audio(song_path, sr)
    offset, z = xcorr_offset(a, s, sr)
    # Estimate again from the first and last third of the AMV. If the two
    # disagree, the AMV plays the song at a different speed.
    third = len(a) // 3
    o1, _ = xcorr_offset(a[:third], s, sr)
    o2, _ = xcorr_offset(a[2 * third:], s, sr)
    o2 += 2 * third / sr
    drift = o2 - o1
    return {"offset": round(offset, 4), "peak_z": round(z, 1), "drift": round(drift, 4),
            "amv_audio_duration": round(len(a) / sr, 3), "song_duration": round(len(s) / sr, 3)}


def cmd_audio_offset(a: argparse.Namespace) -> None:
    r = find_offset(a.amv, a.song)
    log(json.dumps(r, indent=1))
    if r["peak_z"] < 8:
        log("  weak correlation peak: is this the same recording of the song?")
    if abs(r["drift"]) > 0.05:
        log(f"  the AMV plays the song {'slower' if r['drift'] > 0 else 'faster'} than your file "
            f"(drift {r['drift']:+.3f} s); pass --speed-check to render, or expect sync to wander")
    if r["offset"] < 0:
        log(f"  the AMV starts {-r['offset']:.3f} s into the song")
    else:
        log(f"  the song starts {r['offset']:.3f} s into the AMV")
    if a.out:
        with open(a.out, "w") as f:
            json.dump(r, f, indent=1)


# --------------------------------------------------------------------------
# Render
# --------------------------------------------------------------------------

def shot_key(s: dict, size: str, fps: str) -> str:
    rel = {k: s.get(k) for k in ("type", "src_in", "src_out", "speed", "level", "amv_in", "amv_out")}
    return hashlib.sha1(json.dumps([rel, size, fps], sort_keys=True).encode()).hexdigest()[:10]


def segment_cmd(s: dict, source: str, out: str, w: int, h: int, fps: Fraction) -> list[str]:
    n = int(round((s["amv_out"] - s["amv_in"]) * float(fps)))
    n = max(n, 1)
    fit = (f"fps={fps_str(fps)},scale={w}:{h}:force_original_aspect_ratio=decrease,"
           f"pad={w}:{h}:-1:-1,setsar=1,format=yuv420p")
    enc = ["-c:v", "libx264", "-preset", "ultrafast", "-qp", "0"]
    if s["type"] == "flat":
        lvl = int(s.get("level", 0))
        col = f"0x{lvl:02x}{lvl:02x}{lvl:02x}"
        return [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                "-i", f"color=c={col}:s={w}x{h}:r={fps_str(fps)}", "-frames:v", str(n),
                "-vf", "format=yuv420p", *enc, out]
    speed = float(s.get("speed", 1.0))
    src_dur = s["src_out"] - s["src_in"]
    # Seek a quarter frame early so the frame at src_in is the first kept.
    seek = max(0.0, s["src_in"] - 0.25 / float(fps))
    vf = []
    if speed < 0:
        vf.append("reverse")
    if abs(speed) != 1.0:
        vf.append(f"setpts=PTS/{abs(speed)}")
    vf.append(fit)
    return [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{seek:.5f}",
            "-i", source, "-t", f"{src_dur + 0.5 / float(fps):.5f}", "-an",
            "-vf", ",".join(vf), "-frames:v", str(n), *enc, out]


def cmd_render(a: argparse.Namespace) -> None:
    with open(a.edl) as f:
        edl = json.load(f)
    source = a.source or edl["source"]
    if not os.path.exists(source):
        raise SystemExit(f"source video not found: {source} (pass --source)")
    fps = Fraction(a.fps) if a.fps else Fraction(edl["source_fps"])
    w, h = (int(t) for t in a.size.lower().split("x"))
    shots = [s for s in edl["shots"] if s["amv_out"] > s["amv_in"]]
    if a.fallback == "black":
        for s in shots:
            if s["status"] == "unmatched":
                s["type"], s["level"] = "flat", 0
    seg_dir = a.segments or os.path.splitext(a.out)[0] + "_segments"
    os.makedirs(seg_dir, exist_ok=True)
    jobs = []
    seg_files = []
    for s in shots:
        seg = os.path.join(seg_dir, f"seg{s['id']:03d}_{shot_key(s, a.size, fps_str(fps))}.mp4")
        seg_files.append(seg)
        if not (os.path.exists(seg) and os.path.getsize(seg) > 0):
            jobs.append(segment_cmd(s, source, seg, w, h, fps))
    log(f"render {len(shots)} shots ({len(jobs)} to cut, {len(shots) - len(jobs)} cached)")
    if a.dry_run:
        for j in jobs:
            print(subprocess.list2cmdline(j))
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as ex:
        list(ex.map(run, jobs))
    concat = os.path.join(seg_dir, "concat.txt")
    with open(concat, "w", encoding="utf-8") as f:
        for seg in seg_files:
            f.write("file '" + os.path.abspath(seg).replace("\\", "/").replace("'", r"'\''") + "'\n")
    total = sum(s["amv_out"] - s["amv_in"] for s in shots)
    args = [FFMPEG, "-hide_banner", "-loglevel", "warning", "-stats", "-y",
            "-f", "concat", "-safe", "0", "-i", concat]
    if a.song:
        args += ["-i", a.song]
        off = a.offset
        if off >= 0:
            afilter = f"[1:a]adelay={int(round(off * 1000))}:all=1[a]"
        else:
            afilter = f"[1:a]atrim=start={-off:.4f},asetpts=PTS-STARTPTS[a]"
        args += ["-filter_complex", afilter, "-map", "0:v", "-map", "[a]"]
        if a.audio == "copy":
            args += ["-c:a", "copy"]
        elif a.audio == "flac":
            args += ["-c:a", "flac"]
        else:
            args += ["-c:a", "aac", "-b:a", "320k"]
    else:
        args += ["-map", "0:v"]
    args += ["-c:v", "libx264", "-preset", a.preset, "-crf", str(a.crf), "-tune", "animation",
             "-pix_fmt", "yuv420p", "-r", fps_str(fps), "-t", f"{total:.4f}"]
    if a.out.lower().endswith(".mp4"):
        args += ["-movflags", "+faststart"]
    args.append(a.out)
    log("encode final")
    res = subprocess.run(args)
    if res.returncode != 0:
        raise SystemExit("final encode failed")
    log(f"  -> {a.out} ({total:.2f} s)")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ffmpeg", help="directory containing ffmpeg and ffprobe")
    sub = p.add_subparsers(dest="cmd", required=True)

    q = sub.add_parser("fingerprint", help="decode a video into tiny gray frames")
    q.add_argument("video")
    q.add_argument("out", help="output .npz")
    q.add_argument("--crop", default="auto", help="auto (default), none, or W:H:X:Y")
    q.add_argument("--fps", help="override frame rate, e.g. 24000/1001")
    q.set_defaults(fn=cmd_fingerprint)

    q = sub.add_parser("cuts", help="find shot boundaries in an AMV fingerprint")
    q.add_argument("fingerprint")
    q.add_argument("out", help="output cuts.json")
    q.add_argument("--thresh", type=float, default=0.35, help="hard cut threshold (default 0.35)")
    q.add_argument("--rel", type=float, default=4.0, help="cut if this many times the local median")
    q.set_defaults(fn=cmd_cuts)

    q = sub.add_parser("match", help="locate AMV shots in the source; write EDL and review sheet")
    q.add_argument("amv_fingerprint")
    q.add_argument("source_fingerprint")
    q.add_argument("cuts")
    q.add_argument("out", help="output edl.json")
    q.add_argument("--speeds", default="1", help="comma list; negative = reversed (e.g. 1,-1,0.5,2)")
    q.add_argument("--ok", type=float, default=0.60, help="score at or above this is ok")
    q.add_argument("--low", type=float, default=0.45, help="score below this is unmatched")
    q.add_argument("--max-gap", type=float, default=0.5,
                   help="unmatched shots up to this long continue the previous shot")
    q.add_argument("--review", default=None, help="review directory (default next to EDL); 'none' to skip")
    q.add_argument("--jobs", type=int, default=4)
    q.set_defaults(fn=cmd_match)

    q = sub.add_parser("audio-offset", help="find where the song starts inside the AMV")
    q.add_argument("amv")
    q.add_argument("song")
    q.add_argument("--out", help="write the result as json")
    q.set_defaults(fn=cmd_audio_offset)

    q = sub.add_parser("render", help="cut the source along the EDL and mux the song")
    q.add_argument("edl")
    q.add_argument("out", help="output video (.mp4 or .mkv)")
    q.add_argument("--song", help="audio file to mux")
    q.add_argument("--offset", type=float, default=0.0,
                   help="offset from audio-offset: time in the video where the song's start lands")
    q.add_argument("--source", help="override the source video path stored in the EDL")
    q.add_argument("--size", default="1920x1080")
    q.add_argument("--fps", help="output frame rate (default: source rate)")
    q.add_argument("--crf", type=int, default=16)
    q.add_argument("--preset", default="slow")
    q.add_argument("--audio", default="aac", choices=["aac", "flac", "copy"])
    q.add_argument("--fallback", default="black", choices=["black", "guess"],
                   help="what to show for unmatched shots: black, or the best guess")
    q.add_argument("--segments", help="directory for intermediate lossless segments")
    q.add_argument("--jobs", type=int, default=max(2, (os.cpu_count() or 4) // 2))
    q.add_argument("--dry-run", action="store_true")
    q.set_defaults(fn=cmd_render)

    a = p.parse_args(argv)
    set_ffmpeg_dir(a.ffmpeg)
    a.fn(a)


if __name__ == "__main__":
    main()
