#!/usr/bin/env node

/**
 * Builds the original, deterministic fallback SFX set used when a licensed
 * external generator is unavailable. No network or API key is read here.
 * WAV intermediates stay in the external audio evidence folder. Browser files
 * are small mono MP3s under public/assets/audio/v001/sfx.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const outDir = path.resolve(process.argv[2] ?? path.join(root, "public/assets/audio/v001/sfx"));
const wavDir = path.resolve(process.argv[3] ?? "C:/Users/USER/Documents/ChogRoyale-Assets/audio-overhaul-20261027/generated/sfx-wav");
const sampleRate = 44100;

const CUES = [
  { id: "primary", duration: 0.12, voices: [[620, 760, 0.09, 0.18]], noise: 0.04 },
  { id: "secondary", duration: 0.08, voices: [[480, 540, 0.06, 0.12]] },
  { id: "navigation", duration: 0.10, voices: [[580, 620, 0.08, 0.14]] },
  { id: "card-select", duration: 0.14, voices: [[560, 700, 0.10, 0.18]], noise: 0.05 },
  { id: "card-drag", duration: 0.12, voices: [[480, 600, 0.09, 0.13], [960, 1200, 0.08, 0.04]], noise: 0.03 },
  { id: "placement", duration: 0.22, voices: [[420, 760, 0.16, 0.16], [130, 90, 0.14, 0.08]], noise: 0.10 },
  { id: "success", duration: 0.42, voices: [[520, 700, 0.15, 0.14], [700, 920, 0.20, 0.12], [920, 1240, 0.30, 0.10]], delays: [0, 0.12, 0.25], noise: 0.02 },
  { id: "error", duration: 0.20, voices: [[180, 120, 0.16, 0.16]], noise: 0.08 },
  { id: "friend-request", duration: 0.25, voices: [[450, 720, 0.18, 0.14], [900, 1080, 0.12, 0.06]], noise: 0.02 },
  { id: "notification", duration: 0.22, voices: [[720, 980, 0.16, 0.14], [1440, 1600, 0.10, 0.04]], noise: 0.02 },
  { id: "invite", duration: 0.30, voices: [[430, 860, 0.22, 0.15], [860, 1120, 0.18, 0.06]], noise: 0.03 },
  { id: "ready", duration: 0.25, voices: [[330, 660, 0.18, 0.14], [660, 990, 0.14, 0.07]], noise: 0.03 },
  { id: "upgrade", duration: 1.00, voices: [[500, 1000, 0.82, 0.14], [1000, 1500, 0.50, 0.05]], noise: 0.04 },
  { id: "reward", duration: 0.48, voices: [[620, 930, 0.28, 0.14], [930, 1240, 0.22, 0.07]], noise: 0.02 },
  { id: "confirm", duration: 0.16, voices: [[540, 820, 0.11, 0.16]], noise: 0.03 },
  { id: "reveal", duration: 0.36, voices: [[400, 680, 0.26, 0.15], [800, 1040, 0.20, 0.06]], noise: 0.05 },
];

function envelope(t, duration) {
  const attack = Math.min(0.018, duration * 0.14);
  const release = Math.min(0.16, duration * 0.42);
  if (t < attack) return t / attack;
  if (t > duration - release) return Math.max(0, (duration - t) / release);
  return 1;
}

function oscillator(start, end, t, duration) {
  const progress = Math.min(1, Math.max(0, t / duration));
  const frequency = start + (end - start) * progress;
  return Math.sin(2 * Math.PI * frequency * t);
}

function writeWav(file, samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buffer);
}

function makeCue(cue, index) {
  const total = Math.ceil(cue.duration * sampleRate);
  const samples = new Float32Array(total);
  let seed = (0x9e3779b9 ^ (index * 0x45d9f3b)) >>> 0;
  const random = () => {
    seed = (Math.imul(seed ^ (seed >>> 16), 2246822519) + 3266489917) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    let value = 0;
    cue.voices.forEach((voice, voiceIndex) => {
      const delay = cue.delays?.[voiceIndex] ?? (voiceIndex > 0 ? 0.015 : 0);
      if (t < delay || t - delay > voice[2]) return;
      const local = t - delay;
      const tone = oscillator(voice[0], voice[1], local, voice[2]);
      const overtone = Math.sin(2 * Math.PI * (voice[0] * 2.01) * local) * 0.16;
      value += (tone + overtone) * voice[3] * envelope(local, voice[2]);
    });
    if (cue.noise) value += random() * cue.noise * envelope(t, cue.duration);
    samples[i] = value;
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? Math.min(0.82 / peak, 1.5) : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(wavDir, { recursive: true });
for (const [index, cue] of CUES.entries()) {
  const wav = path.join(wavDir, `${cue.id}.wav`);
  const mp3 = path.join(outDir, `${cue.id}.mp3`);
  writeWav(wav, makeCue(cue, index));
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-b:a", "96k", "-ar", "44100", "-ac", "1", "-map_metadata", "-1", mp3]);
}
console.log(JSON.stringify({ generated: CUES.length, outDir, wavDir, ids: CUES.map(({ id }) => id) }, null, 2));
