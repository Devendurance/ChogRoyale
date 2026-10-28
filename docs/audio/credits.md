# Battle audio credits and rights

Audio asset inventory: `v001`, prepared 2026-10-28.

## Production music

- `spooky-halloween.mp3` is the trimmed, four-second wrap-crossfaded and level-matched browser derivative of **Misterbates - Spooky Halloween**. It is a true cyclic loop and starts at the source's 4.0 s musical boundary.
- Source: [Freesound 677436](https://freesound.org/people/MusicByMisterbates/sounds/677436/).
- License: CC0, as stated on the source page. Production path: `/assets/audio/v001/music/spooky-halloween.mp3`.
- The source master is preserved outside the repository at `C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027/masters/track-a-misterbates.mp3`.

## Battle music

- `battle-loop.mp3` is the wrapped and crossfaded production derivative of **Mrthenoronha - Village game theme loop**.
- Source: [Freesound 520710](https://freesound.org/people/Mrthenoronha/sounds/520710/).
- Original source metadata: CC BY-NC 4.0. The project owner asserts purchased usage rights for the supplied processed file and explicitly authorized production integration. That purchase documentation is not stored in this repository, so this record does not claim CC0 or independently verify the purchase.
- Production path: `/assets/audio/v001/music/battle-loop.mp3`.
- Verified browser derivative SHA-256: `5BC878DD9C4B809CAA500DA01BF33848BC1FC280E5C5047A2FDCF4FE97B8B24C`.
- The source master and an identical external copy of the derivative are preserved at `C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027/masters/track-b-mrthenoronha.wav` and `C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027/derived/battle-loop.mp3`.

## SFX

The 16 short UI SFX files under `/assets/audio/v001/sfx` use the shared keys `primary`, `secondary`, `navigation`, `card-select`, `card-drag`, `placement`, `success`, `error`, `friend-request`, `notification`, `invite`, `ready`, `upgrade`, `reward`, `confirm` and `reveal`. They are original deterministic local procedural renders from `tools/audio/generate-procedural-sfx.cjs`. The configured ElevenLabs account resolved to the Free tier, so commercial entitlement was not verified and no ElevenLabs output was generated. No ElevenLabs output or generator claim is made, and no API call occurs at runtime. Existing authoritative battle cues remain on their Web Audio implementation and are not replaced by this UI pack.

The source references, rights state, production paths and cue mapping are also represented in `src/lib/audio/audio-assets.ts` and `docs/audio/audio-manifest.json`.
