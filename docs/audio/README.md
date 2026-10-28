# Chog Royale audio

The `/app` layout owns one persistent Web Audio controller. Music, interface effects and the existing battle engine share its master output and limiter. Settings live in `chog.audio.v2`; an existing battle mute or zero-volume preference migrates to silence for the new music too.

## Track configuration

`src/lib/audio/audio-assets.ts` contains the track and cue mappings. Track A is the production lobby loop. Ready rooms keep that track, actual matches select Track B, and results keep the current track while reducing its gain. Returning to a lobby resumes Track A. Hidden pages stop music sources and preserve their offsets.

Track B is CC BY-NC 4.0 and remains development-only. Its production path is `null`, the production endpoint returns 404, and `.audio-dev/` is ignored and excluded from server traces. A future commercially cleared replacement can be configured in the asset map without replacing the audio controller. Keep the manifest and credits consistent with any replacement.

To restore the owner's local development soundtrack, copy the prepared derivative from `C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027/derived/battle-loop.mp3` into `.audio-dev/battle-loop.mp3`. That local copy is deliberately absent from Git.

## Asset production

- `tools/audio/process-music.cjs` prepares the two supplied music masters with wrap crossfades and level adjustments. It needs FFmpeg and explicit `--track-a` and `--track-b` source paths.
- `tools/audio/generate-procedural-sfx.cjs` renders the 16 original interface cues locally. The configured ElevenLabs subscription reported Free tier, so no ElevenLabs audio was generated.
- `tools/audio/analyze_audio.cjs` measures decoded audio boundaries and levels. FFmpeg `ebur128=peak=true` measurements in the quality report are the loudness and true-peak reference.

There are no generator calls or credentials in the browser. Missing interface files retain a small procedural playback fallback. The original authoritative battle effects remain in `battle-audio.ts`.

## Review evidence

- [Acceptance, browser checks and limitations](acceptance.md)
- [Sources and licenses](credits.md)
- [Asset manifest](audio-manifest.json)
- [Measurements and loop boundaries](quality-report.md)
- [Interaction mappings](ui-mappings.md)

The source masters, audition reel and browser evidence are preserved outside the repository under `C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027`.
