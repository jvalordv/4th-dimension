# eva-amv: rebuild a 2001 AMV from the Blu-ray

Remakes *Asuka's Last Stand* (pirers, 2001; Evangelion / Rage Against the
Machine, "Sleep Now in the Fire") shot for shot from the 1080p Blu-ray of
*The End of Evangelion* and your own copy of the song. The old video is only
a map: each of its shots is located in the film by image search and
replaced with the Blu-ray frames at the same place and length. The output
contains nothing but Blu-ray frames and your audio file.

Everything is one script, `amv.py`, driven by ffmpeg. `selftest.py` builds
synthetic footage and checks the whole chain frame for frame.

## Requirements (Windows)

- Python 3.9+ with numpy: `pip install numpy`
- ffmpeg and ffprobe on PATH (`winget install Gyan.FFmpeg`), or pass
  `--ffmpeg "C:\path\to\ffmpeg\bin"` on every command.
- The old AMV as a file. `yt-dlp https://vimeo.com/866843358 -o old_amv.mp4`
  fetches it. It is the map; its quality does not matter.
- The Blu-ray rip and the song file.

## Run

PowerShell, from a working folder on B:. Adjust the three paths.

```powershell
$amv  = "B:\amv\old_amv.mp4"
$film = "B:\Downloads\Neon Genesis Evangelion The End Of Evangelion (1997) [BLURAY] [1080p] [BluRay] [5.1] [YTS.MX]\<the .mp4 inside>"
$song = "B:\amv\Sleep Now in the Fire.flac"
cd B:\amv

python amv.py fingerprint $film film.npz          # ~5-10 min, decodes the whole film once
python amv.py fingerprint $amv  old_amv.npz
python amv.py cuts old_amv.npz cuts.json
python amv.py match old_amv.npz film.npz cuts.json edl.json
python amv.py audio-offset $amv $song
python amv.py render edl.json remake.mp4 --song $song --offset <value printed above>
```

`match` prints how many shots are `ok`, `check`, `unmatched` or `extended`
and writes `review\review.html`: every shot with the old frame on the left
and the Blu-ray frame the EDL will use on the right. Open it, fix what is
wrong (see below), and run `render` again. Segments are cached, so a
re-render after editing a few shots only recuts those.

The default output is 1920x1080 at the film's frame rate, x264 CRF 16 with
the animation tune, AAC 320k. `--audio flac` with a `.mkv` output keeps the
song lossless. `--crf 14 --preset veryslow` for a final pass.

## Fixing the EDL

`edl.json` is plain text. Times are seconds. Each shot is one of:

```json
{"id": 12, "amv_in": 31.03, "amv_out": 33.5, "type": "source",
 "src_in": 4012.21, "src_out": 4014.68, "speed": 1.0, "score": 0.81,
 "ambiguity": 0.4, "status": "ok"}
{"id": 13, "amv_in": 33.5, "amv_out": 33.53, "type": "flat", "level": 255, "status": "ok"}
```

- `score` is the mean image similarity along the shot (1 = identical).
  `ambiguity` is how close the runner-up location came; near 1 means the
  same footage appears more than once in the film, or the shot is static.
- To move a shot, change `src_in`; `src_out` is recomputed from the AMV
  length and speed at render time, so you can leave it.
- `status: unmatched` shots render black by default (`--fallback guess`
  renders the best guess instead). Shots that are not from *The End of
  Evangelion* (TV series footage, title cards) will land here. Fingerprint
  that source too and match against it, or set `src_in` by hand.
- Short unmatched shots (dissolve or blend frames, up to `--max-gap` 0.5 s)
  are treated as a continuation of the previous shot (`status: extended`).
- Fades and dissolves are not reproduced, only hard cuts and flat frames
  (flashes, black). Add them in an editor afterwards if you want them.
- If the AMV uses slow motion or reversed footage, run `match` with
  `--speeds 1,-1,0.5,2`.
- If `cuts` splits too eagerly (many 1-3 frame shots that are not flashes),
  raise `--thresh`; contiguous pieces are merged anyway. If it misses cuts,
  the matcher splits a shot where the alignment stops fitting, but lower
  `--thresh` if the review sheet shows shots that start right and end wrong.

## Audio

`audio-offset` cross-correlates the AMV's soundtrack with your file and
prints where the song's first sample falls in the AMV timeline. Negative
means the AMV starts partway into the song. It also estimates drift between
the start and end of the AMV; a non-zero drift means the old video plays the
song at a different speed (common for PAL or re-encoded sources), and the
remake will keep the song at your file's speed, so cuts drift late or early
by that amount over the run.

## Self-test

```
python selftest.py
```

Builds a 100 s synthetic "film", cuts a letterboxed 4:3, 29.97 fps, low
bitrate, brightness-shifted "AMV" from it with a white flash, a fade and a
trimmed song intro, runs the full pipeline, and checks that every shot is
found within 1.5 frames, the audio offset within 20 ms, and the remake
matches the AMV frame for frame. Takes about two minutes the first time
(building the footage) and twenty seconds after.
