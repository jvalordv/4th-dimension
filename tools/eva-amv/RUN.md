# Instructions for a Claude Code session running on the owner's Windows PC

Goal: remake the 2001 AMV "Asuka's Last Stand" (Evangelion / Rage Against
the Machine, Sleep Now in the Fire) from the Blu-ray and a clean copy of the
song, using `amv.py` in this folder. Do everything without asking questions;
report only at the end.

Working folder: `B:\amv`. Do all work there.

1. Tools. Make sure `python`, `numpy`, `ffmpeg`/`ffprobe` and `yt-dlp` work.
   Install what is missing (`pip install numpy yt-dlp`; ffmpeg via
   `winget install Gyan.FFmpeg` or a static build unpacked under `B:\amv\ffmpeg`,
   then pass `--ffmpeg <bin dir>` to every `amv.py` call).

2. Inputs.
   - Film: the `.mp4` inside
     `B:\Downloads\Neon Genesis Evangelion The End Of Evangelion (1997) [BLURAY] [1080p] [BluRay] [5.1] [YTS.MX]`.
   - Old AMV, for timing only: `yt-dlp https://vimeo.com/866843358 -o B:\amv\old_amv.mp4`.
   - Song: look for an audio file whose name contains "sleep now" in
     `B:\amv`, then the user's Music and Downloads folders, then `B:\`
     (bounded searches, not a full disk walk). If none is found, take the
     audio from the official video instead:
     `yt-dlp -x --audio-format flac https://www.youtube.com/watch?v=kl4wkIPiTcY -o B:\amv\song.%(ext)s`
     and say in the final report that the song came from YouTube.

3. Pipeline, from `B:\amv`, with `A = <repo>\tools\eva-amv\amv.py`:
   ```
   python A fingerprint "<film>" film.npz
   python A fingerprint old_amv.mp4 old_amv.npz
   python A cuts old_amv.npz cuts.json
   python A match old_amv.npz film.npz cuts.json edl.json
   python A audio-offset old_amv.mp4 "<song>"
   python A render edl.json remake.mp4 --song "<song>" --offset <offset printed above>
   ```
   If `match` reports more than a quarter of shots as unmatched, rerun it
   with `--speeds 1,-1,0.5,2`. If `audio-offset` warns of drift above 0.1 s,
   still render, and mention the drift in the report.

4. Report: the path of `remake.mp4`, its duration, the count of ok / check /
   unmatched / extended shots, the path of `review\review.html`, and the
   audio offset and drift. Then open `review\review.html` in the browser.
