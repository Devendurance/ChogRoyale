#!/usr/bin/env node

/** Rebuilds the licensed music derivatives without touching either master. */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function arg(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const trackA = arg("--track-a");
const trackB = arg("--track-b");
const repo = path.resolve(arg("--repo") ?? path.resolve(__dirname, "../.."));
const evidence = path.resolve(arg("--evidence") ?? "C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027");
if (!trackA || !trackB) {
  console.error("usage: node tools/audio/process-music.cjs --track-a <mp3> --track-b <wav> [--repo <root>] [--evidence <dir>]");
  process.exit(2);
}

const productionMusic = path.join(repo, "public/assets/audio/v001/music/spooky-halloween.mp3");
const devMusic = path.join(repo, ".audio-dev/battle-loop.mp3");
const evidenceMusic = path.join(evidence, "derived/battle-loop.mp3");
fs.mkdirSync(path.dirname(productionMusic), { recursive: true });
fs.mkdirSync(path.dirname(devMusic), { recursive: true });
fs.mkdirSync(path.dirname(evidenceMusic), { recursive: true });

execFileSync("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error", "-i", trackA,
  "-filter_complex", "[0]atrim=end=53.55,asetpts=PTS-STARTPTS,asplit=2[x][y];[x]atrim=start=4,asetpts=PTS-STARTPTS[a];[y]atrim=0:4,asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=4:c1=0:c2=0,volume=-1.4dB,asetpts=PTS-STARTPTS",
  "-c:a", "libmp3lame", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-map_metadata", "-1", productionMusic,
]);

const loopFilter = "[0]atrim=start=1.5,asetpts=PTS-STARTPTS[a];[0]atrim=0:1.5,asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=1.5:c1=0:c2=0,volume=-6dB,asetpts=PTS-STARTPTS";
const ffmpegArgs = [
  "-y", "-hide_banner", "-loglevel", "error", "-i", trackB,
  "-filter_complex", loopFilter, "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-map_metadata", "-1",
];
execFileSync("ffmpeg", [...ffmpegArgs, evidenceMusic]);
fs.copyFileSync(evidenceMusic, devMusic);
console.log(JSON.stringify({ productionMusic, devMusic, evidenceMusic, developmentOnly: true }, null, 2));
