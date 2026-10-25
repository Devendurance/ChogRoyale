# Visual overhaul v3 slice 2.1 review

Defender identity correction and arena polish. Fixture presentation evidence only, from the temporary qa-v2 harness and recorded local-engine snapshots. It isn't a live two-login match, a phone test or a performance test.

- `bulwark-comparison.png`: original card 21, the larger original art, the slice 2 model, the 2.1 model, then both on the tower aiming down.
- `guardian-comparison.png`: the same format for card 07. The last two tiles are the gameplay back view aiming up.
- `bulwark-front-identity.png`, `guardian-front-identity.png`: 2.1 front identity renders. `guardian-back-gameplay.png`: the 2.1 back-facing tower pose.
- `mounts-assembled.png`: lane-red, king-red, lane-blue and king-blue assembled (base, socket, aim pose, rim).
- `after/`: both seats at 390x844 and 1366x768, full page and board only. `evidence.json` has the scene probe: zero errors, zero failed loads, red mounts on aim-south at the top, blue mounts on aim-north at the bottom.
- `before-after-390-seat0.png`, `before-after-390-seat1.png`, `before-after-1366-seat0.png`: slice 2 on the left, 2.1 on the right.
- `seat0-vs-seat1-390.png`, `seat0-vs-seat1-1366.png`: both player seats after the change.
- `fallback-v002/`: v003 manifest forced to 404. v002 loads, and the only errors are the two intentional 404s.
- `prev-slice2/`: the slice 2 masters and scripts kept for comparison.
- `compare.cjs`, `capture.cjs`: rebuild the sheets and captures. Captures need the qa-v2 harness copied into `src/app/dev/battle/qa-v2/page.tsx` while `next dev` runs. Delete it afterwards.

Low-cost loop used while iterating: `PREVIEW=1 blender -b --factory-startup --python scripts/build_mounts.py -- <out> [bulwark|guardian]` renders the defender alone at 16 samples, and `LOWQ=1` renders mounts or arena layers at 16 samples (arena at 50 percent). Partial mount rebuilds by role merge into `_mounts-record.json`.
