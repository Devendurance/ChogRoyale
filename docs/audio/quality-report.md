# Audio quality and boundary report

Prepared 2026-10-27 with `ffprobe`, FFmpeg `ebur128`, and `tools/audio/analyze_audio.cjs`. Analysis decodes every file as stereo at 44.1 kHz, then reports RMS as a mono presentation measure plus the maximum sample and four-times linear intersample peak per channel. No source bytes were modified.

## Source audit

| source | duration | loudness | boundary finding |
| --- | ---: | ---: | --- |
| Misterbates source MP3 | 56.489138 s | -14.4 LUFS, LRA 7.3 LU | silence starts at 53.536893 s and lasts to the end |
| Mrthenoronha source WAV | 34.909093 s | -10.0 LUFS, LRA 1.8 LU | no silence; raw 100 ms edge discontinuity 0.06570 sample units |

Track A's 2.952245 s near-zero tail is trimmed at 53.55 s, then the source is rotated to its 4.0 s musical boundary and wrap-crossfaded over 4.0 s. The resulting file is a true 49.55 s cyclic loop, -16.1 LUFS, with an `ebur128=peak=true` true peak of -2.4 dBFS and an edge discontinuity of 0.00128 sample units. The source master remains unchanged. `ebur128` is the loudness and true-peak authority for final release checks.

Track B is treated as a real loop candidate, not copied directly. A 1.5 s rotation and linear wrap crossfade removes the opening phrase from the end boundary and produces a 33.409093 s loop. The owner-supplied production MP3 is -16.1 LUFS, 192 kbps, 44.1 kHz stereo, has an `ebur128=peak=true` true peak of -4.6 dBFS, and its raw edge discontinuity falls to 0.00562 sample units. The shipped derivative is SHA-256 `5BC878DD9C4B809CAA500DA01BF33848BC1FC280E5C5047A2FDCF4FE97B8B24C`.

## Production SFX

All 16 files are mono 44.1 kHz MP3 at 96 kbps. The first column is the measured browser duration after encoding. The peak column is FFmpeg `ebur128=peak=true` true peak. All remain below -4.4 dBFS.

| cue | duration | RMS | peak |
| --- | ---: | ---: | ---: |
| primary | 0.120 s | -21.0 dBFS | -8.5 dBFS |
| secondary | 0.080 s | -24.5 dBFS | -14.1 dBFS |
| navigation | 0.100 s | -22.9 dBFS | -12.7 dBFS |
| card-select | 0.140 s | -21.0 dBFS | -8.5 dBFS |
| card-drag | 0.120 s | -23.3 dBFS | -10.1 dBFS |
| placement | 0.220 s | -19.9 dBFS | -4.4 dBFS |
| success | 0.420 s | -21.7 dBFS | -10.8 dBFS |
| error | 0.200 s | -20.8 dBFS | -7.8 dBFS |
| friend-request | 0.250 s | -22.6 dBFS | -9.0 dBFS |
| notification | 0.220 s | -22.9 dBFS | -10.0 dBFS |
| invite | 0.300 s | -21.7 dBFS | -8.2 dBFS |
| ready | 0.250 s | -22.2 dBFS | -8.3 dBFS |
| upgrade | 1.000 s | -19.5 dBFS | -8.2 dBFS |
| reward | 0.480 s | -23.1 dBFS | -8.7 dBFS |
| confirm | 0.160 s | -22.3 dBFS | -10.1 dBFS |
| reveal | 0.360 s | -21.6 dBFS | -7.5 dBFS |

Whole-file `ebur128=peak=true` results are below. FFmpeg's integrated loudness gate returns its `-70.0 LUFS` floor for clips shorter than the gating window. Those rows are marked as gate-floor measurements, not as a claim that the short cue is actually -70 LUFS.

| cue | whole-file integrated loudness | true peak |
| --- | ---: | ---: |
| primary | -70.0 LUFS, gate floor | -8.5 dBFS |
| secondary | -70.0 LUFS, gate floor | -14.1 dBFS |
| navigation | -70.0 LUFS, gate floor | -12.7 dBFS |
| card-select | -70.0 LUFS, gate floor | -8.5 dBFS |
| card-drag | -70.0 LUFS, gate floor | -10.1 dBFS |
| placement | -70.0 LUFS, gate floor | -4.4 dBFS |
| success | -18.7 LUFS | -10.8 dBFS |
| error | -70.0 LUFS, gate floor | -7.8 dBFS |
| friend-request | -70.0 LUFS, gate floor | -9.0 dBFS |
| notification | -70.0 LUFS, gate floor | -10.0 dBFS |
| invite | -70.0 LUFS, gate floor | -8.2 dBFS |
| ready | -70.0 LUFS, gate floor | -8.3 dBFS |
| upgrade | -17.0 LUFS | -8.2 dBFS |
| reward | -19.3 LUFS | -8.7 dBFS |
| confirm | -70.0 LUFS, gate floor | -10.1 dBFS |
| reveal | -70.0 LUFS, gate floor | -7.5 dBFS |

## Independent release QA

- Whole-file derived-track measurements: Track A `-16.1 LUFS`, `-2.4 dBFS` true peak. Track B `-16.1 LUFS`, `-4.6 dBFS` true peak.
- PCM seam comparison uses aligned 250 ms first/last windows against the mean of the adjacent 250 ms windows. Track A's raw seam RMS changed from `0.11120` on the 53.55 s trimmed source to `0.12510` on the derived loop, a `12.5%` increase. Its seam-to-adjacent ratio improved from `1.615x` to `0.852x`, so the crossfade made the boundary less exceptional relative to nearby musical material even though the raw difference did not decrease. Track B's raw seam RMS improved from `0.33261` to `0.18051`, a `45.7%` reduction. Its seam-to-adjacent ratio moved from `0.864x` to `1.042x`, so the absolute seam improved while the local adjacent-window comparison did not.
- All 18 production runtime paths checked from the manifest and UI cue inventory exist, including `/assets/audio/v001/music/battle-loop.mp3`.
- The original WAV remains outside `public/`. The shipped MP3 is the owner-supplied processed derivative recorded in the manifest and credits.
- External audition reel: `C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027/qa/ui-sfx-audition.mp3`. Cue order is in `ui-sfx-audition-order.txt`. Compact evidence, hashes and path checks are in `final-audio-evidence.json`.

This is objective file QA only. The audition reel is a convenient review aid, not subjective approval. Physical-device loudness, authenticated two-player delivery and production trace inspection remain separate acceptance steps.
