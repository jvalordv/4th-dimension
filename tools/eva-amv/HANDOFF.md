# Handoff: Evangelion / RATM AMV remake

Read this first. You are a Claude Code session running on the owner's
Windows PC. The previous session ran in the cloud and could not reach the
owner's drives; it built and tested the tool, and nothing has yet been run
on the real footage. Your job is to run it and hand back a finished video.
Do not ask questions; make reasonable choices and report at the end.

## What the owner wants

A remake of the 2001 fan video "Asuka's Last Stand" (pirers; Evangelion
footage cut to Rage Against the Machine, "Sleep Now in the Fire",
https://vimeo.com/866843358) using only the 1080p Blu-ray of *The End of
Evangelion* and a clean copy of the song. Same cuts, same timing, new
pixels and new audio.

## What exists

- `tools/eva-amv/amv.py`: the whole pipeline (fingerprint, cuts, match,
  audio-offset, render). numpy + ffmpeg only.
- `tools/eva-amv/README.md`: usage and how to fix the EDL.
- `tools/eva-amv/RUN.md`: step-by-step brief for this run.
- `tools/eva-amv/selftest.py`: synthetic end-to-end test; it passes
  (every shot found within 0.3 frames, audio offset exact, render matches
  frame for frame). Not needed for the real run.

Repo: https://github.com/jvalordv/4th-dimension, branch
`claude/laughing-tesla-4nfk6n`. The rest of the repo is an unrelated 4D
visualizer; ignore it.

## Inputs on this PC

- Film: the `.mp4` in
  `B:\Downloads\Neon Genesis Evangelion The End Of Evangelion (1997) [BLURAY] [1080p] [BluRay] [5.1] [YTS.MX]`
  (confirmed present by an earlier local session).
- Song: the owner says they have it as a file, but `B:\amv` was empty when
  last checked. Search by name ("sleep now") in `B:\amv`, the Music and
  Downloads folders, then `B:\` with bounded searches. If not found, use
  `yt-dlp -x --audio-format flac https://www.youtube.com/watch?v=kl4wkIPiTcY`
  and say so in the report.
- Old AMV (timing map only): `yt-dlp https://vimeo.com/866843358 -o old_amv.mp4`.

## Steps

Follow `tools/eva-amv/RUN.md`. In short, from `B:\amv`:

```
pip install numpy yt-dlp
python <repo>\tools\eva-amv\amv.py fingerprint "<film>" film.npz
python <repo>\tools\eva-amv\amv.py fingerprint old_amv.mp4 old_amv.npz
python <repo>\tools\eva-amv\amv.py cuts old_amv.npz cuts.json
python <repo>\tools\eva-amv\amv.py match old_amv.npz film.npz cuts.json edl.json
python <repo>\tools\eva-amv\amv.py audio-offset old_amv.mp4 "<song>"
python <repo>\tools\eva-amv\amv.py render edl.json remake.mp4 --song "<song>" --offset <printed>
```

ffmpeg must be on PATH, or pass `--ffmpeg <bin dir>` to every call.
The film fingerprint is the slow step (one full decode, 5-15 min).

## Known gotchas from the earlier attempts

- Auto permission mode denied every shell call ("classifier unavailable").
  Launch with `claude.cmd --dangerously-skip-permissions` or
  `--permission-mode acceptEdits`; typing the flag as a message does nothing.
- The blue legacy PowerShell console mangles pastes. Windows Terminal is fine.
- `match` defaults to speed 1. If many shots are unmatched, rerun with
  `--speeds 1,-1,0.5,2`.
- Unmatched shots render black by default so they are visible in the output.
- Fades and dissolves are not reproduced, only hard cuts and flashes.

## Done looks like

`B:\amv\remake.mp4` exists and plays, with the song in sync. Report its
duration, the ok / check / unmatched / extended shot counts, the audio
offset and drift, and open `B:\amv\review\review.html` so the owner can
eyeball any `check` or `unmatched` rows.
