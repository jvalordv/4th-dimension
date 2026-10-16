#!/usr/bin/env python3
"""End-to-end check of amv.py on synthetic footage.

Builds a fake "film" from ffmpeg test sources, cuts a fake 2001-style AMV from
it (4:3 letterbox, 29.97 fps, low bitrate, brightness shifted, a white flash,
a fade to black, the song's intro trimmed), then runs the whole pipeline and
checks that every shot is found at the right place, the audio offset is
right, and the rendered video matches the fake AMV frame for frame.

    python selftest.py [workdir]
"""
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import amv  # noqa: E402

FILM_FPS = "24000/1001"
AMV_FPS = "30000/1001"

# (film start, duration) in seconds, in AMV order. Includes a repeat of an
# earlier region and two neighbours that are contiguous in the film.
SEGMENTS = [(5.0, 2.0), (40.3, 1.5), (71.0, 3.0), (12.25, 0.8), (55.5, 2.5),
            (58.0, 1.2), (30.0, 4.0), (5.5, 1.0)]
FLASH_AFTER = 3          # one white frame after this segment
INTRO_TRIM = 1.5         # the AMV drops this much of the song's start


def sh(args):
    res = subprocess.run(args, capture_output=True, text=True, errors="replace")
    if res.returncode != 0:
        sys.stderr.write(res.stderr[-3000:])
        raise SystemExit("ffmpeg failed while building test footage")


def build(work):
    film = os.path.join(work, "film.mp4")
    song = os.path.join(work, "song.flac")
    old = os.path.join(work, "old_amv.mp4")
    if not os.path.exists(film):
        # 100 s film: three "scenes" with different sources, 1.85:1 picture
        # letterboxed in a 16:9 frame like a Blu-ray.
        fc = (f"mandelbrot=s=960x520:r={FILM_FPS}:end_scale=0.00001,trim=duration=35,setpts=PTS-STARTPTS[a];"
              f"testsrc2=s=960x520:r={FILM_FPS},trim=duration=35,setpts=PTS-STARTPTS[b];"
              f"life=s=960x520:r={FILM_FPS}:ratio=0.1:mold=10,trim=duration=30,setpts=PTS-STARTPTS[c];"
              f"[a][b][c]concat=n=3:v=1:a=0,pad=960:540:0:10,format=yuv420p[v]")
        sh(["ffmpeg", "-y", "-loglevel", "error", "-filter_complex", fc, "-map", "[v]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", film])
    if not os.path.exists(song):
        total = sum(d for _, d in SEGMENTS) + INTRO_TRIM + 2
        sh(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
            "-i", f"anoisesrc=color=pink:seed=7:r=44100:a=0.4,lowpass=f=4000,"
                  f"volume='0.3+0.7*abs(sin(2*PI*t/2.3))':eval=frame,atrim=duration={total}",
            "-c:a", "flac", song])
    if not os.path.exists(old):
        parts = []
        labels = []
        for i, (start, dur) in enumerate(SEGMENTS):
            parts.append(f"[0:v]trim=start={start}:duration={dur},setpts=PTS-STARTPTS[s{i}]")
            labels.append(f"[s{i}]")
            if i == FLASH_AFTER:
                parts.append(f"color=c=white:s=960x540:r={FILM_FPS}:d=0.1[fl]")
                labels.append("[fl]")
        parts.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0,"
                     f"fps={AMV_FPS},scale=640:360,pad=640:480:0:60,"
                     f"eq=brightness=0.06:contrast=1.15:saturation=0.8,"
                     f"fade=t=out:st={sum(d for _, d in SEGMENTS) - 0.6}:d=0.6[v]")
        sh(["ffmpeg", "-y", "-loglevel", "error", "-i", film, "-ss", str(INTRO_TRIM), "-i", song,
            "-filter_complex", ";".join(parts), "-map", "[v]", "-map", "1:a", "-shortest",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "96k", old])
    return film, song, old


def main():
    work = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "_selftest")
    os.makedirs(work, exist_ok=True)
    film, song, old = build(work)
    fp_film, fp_amv = os.path.join(work, "film.npz"), os.path.join(work, "old_amv.npz")
    cuts, edl, out = (os.path.join(work, n) for n in ("cuts.json", "edl.json", "remake.mp4"))

    amv.main(["fingerprint", film, fp_film])
    amv.main(["fingerprint", old, fp_amv])
    amv.main(["cuts", fp_amv, cuts])
    amv.main(["match", fp_amv, fp_film, cuts, edl, "--review", os.path.join(work, "review")])

    with open(edl) as f:
        shots = json.load(f)["shots"]
    film_fps = 24000 / 1001
    failures = []
    # Expected EDL: the segments, with the flash as a flat shot, and the
    # contiguous pair (55.5, 2.5) + (58.0, 1.2) merged into one.
    expected = []
    for i, (start, dur) in enumerate(SEGMENTS):
        if expected and expected[-1][0] != "flash" and abs(expected[-1][0] + expected[-1][1] - start) < 0.01:
            expected[-1] = (expected[-1][0], expected[-1][1] + dur)
        else:
            expected.append((start, dur))
        if i == FLASH_AFTER:
            expected.append(("flash", 0.1))
    got = [s for s in shots if not (s["type"] == "flat" and s["status"] == "ok" and s["level"] < 20
                                    and s["amv_out"] - s["amv_in"] < 0.7)]  # drop the fade-out tail
    # The fade-out produces a few short shots at the end; allow a trailing
    # extended/flat remainder by comparing only the leading expected count.
    if len(got) < len(expected):
        failures.append(f"expected at least {len(expected)} shots, got {len(got)}: "
                        + json.dumps(got, indent=1))
    else:
        for e, s in zip(expected, got):
            if e[0] == "flash":
                if not (s["type"] == "flat" and s["level"] > 200):
                    failures.append(f"flash not reproduced: {s}")
                continue
            if s["type"] != "source":
                failures.append(f"shot {s['id']} should be source footage: {s}")
                continue
            err = abs(s["src_in"] - e[0]) * film_fps
            if err > 1.5:
                failures.append(f"shot {s['id']} src_in {s['src_in']:.3f} vs expected {e[0]} ({err:.1f} frames off)")
            dur = s["amv_out"] - s["amv_in"]
            last = e is expected[-1]
            # The fade to black at the end turns the tail of the last shot flat.
            if abs(dur - e[1]) > 0.15 and not (last and e[1] - 0.6 <= dur <= e[1] + 0.15):
                failures.append(f"shot {s['id']} duration {s['amv_out'] - s['amv_in']:.3f} vs expected {e[1]}")
            if s["status"] not in ("ok", "extended"):
                failures.append(f"shot {s['id']} status {s['status']} score {s.get('score')}")

    r = amv.find_offset(old, song)
    print("audio offset:", r)
    if abs(r["offset"] + INTRO_TRIM) > 0.02:
        failures.append(f"audio offset {r['offset']} vs expected {-INTRO_TRIM}")

    amv.main(["render", edl, out, "--song", song, "--offset", str(r["offset"]),
              "--size", "960x540", "--preset", "veryfast", "--crf", "18"])

    # Frame-for-frame comparison of the remake against the fake AMV.
    fp_out = os.path.join(work, "remake.npz")
    amv.main(["fingerprint", out, fp_out, "--fps", AMV_FPS])
    a = amv.Fingerprint(fp_amv)
    b = amv.Fingerprint(fp_out)
    n = min(a.n, b.n)
    if abs(a.n - b.n) > 2:
        failures.append(f"frame count {b.n} vs AMV {a.n}")
    sims = (a.feat[:n] * b.feat[:n]).sum(axis=1)
    textured = ~(a.flat[:n] | b.flat[:n])
    bad = np.where(textured & (sims < 0.8))[0]
    print(f"rendered frames: {b.n}, AMV frames: {a.n}, textured frames below 0.8 similarity: {len(bad)}")
    if len(bad) > max(3, n // 50):
        failures.append(f"{len(bad)} frames differ from the AMV: {bad[:20].tolist()}")
    dur = amv.Info(out).duration
    if not amv.Info(out).has_audio:
        failures.append("remake has no audio")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print(f"\nselftest passed: {len(got)} shots, remake {dur:.2f} s -> {out}")


if __name__ == "__main__":
    main()
