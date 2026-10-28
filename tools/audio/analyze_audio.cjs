#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require("node:child_process");

const file = process.argv[2];
if (!file) {
  console.error("usage: node tools/audio/analyze_audio.cjs <file>");
  process.exit(2);
}

const probe = JSON.parse(execFileSync("ffprobe", [
  "-v", "error", "-show_streams", "-show_format", "-of", "json", file,
], { encoding: "utf8" }));
const stream = probe.streams.find((candidate) => candidate.codec_type === "audio");
if (!stream) throw new Error("No audio stream found");

const sampleRate = Number(stream.sample_rate);
const sourceChannels = Number(stream.channels);
const decodedChannels = 2;
const pcm = execFileSync("ffmpeg", [
  "-v", "error", "-i", file, "-f", "s16le", "-ac", String(decodedChannels), "-ar", String(sampleRate), "pipe:1",
], { maxBuffer: 64 * 1024 * 1024 });
const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
const frameCount = Math.floor(samples.length / decodedChannels);

function value(frame, channel = 0) {
  return samples[frame * decodedChannels + channel] / 32768;
}

function segmentStats(startFrame, endFrame) {
  const start = Math.max(0, Math.min(frameCount, Math.floor(startFrame)));
  const end = Math.max(start + 1, Math.min(frameCount, Math.floor(endFrame)));
  let sum = 0;
  let samplePeak = 0;
  const channelPeaks = Array.from({ length: decodedChannels }, () => 0);
  let truePeak = 0;
  let crossings = 0;
  let previous = value(start);
  for (let frame = start; frame < end; frame++) {
    const left = value(frame, 0);
    const right = value(frame, 1);
    const sample = (left + right) * 0.5;
    sum += sample * sample;
    samplePeak = Math.max(samplePeak, Math.abs(left), Math.abs(right));
    channelPeaks[0] = Math.max(channelPeaks[0], Math.abs(left));
    channelPeaks[1] = Math.max(channelPeaks[1], Math.abs(right));
    // Four-point linear oversampling catches the common intersample peak
    // without masking left/right differences behind a mono sum.
    for (let channel = 0; channel < decodedChannels; channel++) {
      const current = value(frame, channel);
      const next = value(Math.min(end - 1, frame + 1), channel);
      for (let sub = 1; sub < 4; sub++) truePeak = Math.max(truePeak, Math.abs(current + (next - current) * sub / 4));
    }
    if (frame > start && ((sample >= 0) !== (previous >= 0))) crossings++;
    previous = sample;
  }
  const count = end - start;
  return {
    start_s: start / sampleRate,
    end_s: end / sampleRate,
    rms: Math.sqrt(sum / count),
    rms_dbfs: 20 * Math.log10(Math.max(1e-12, Math.sqrt(sum / count))),
    sample_peak_dbfs: 20 * Math.log10(Math.max(1e-12, samplePeak)),
    channel_sample_peak_dbfs: channelPeaks.map((peak) => 20 * Math.log10(Math.max(1e-12, peak))),
    true_peak_est_dbfs: 20 * Math.log10(Math.max(1e-12, truePeak)),
    zero_crossings_per_s: crossings / (count / sampleRate),
  };
}

function correlation(aStart, bStart, length) {
  let aa = 0;
  let bb = 0;
  let ab = 0;
  for (let i = 0; i < length; i++) {
    const a = value(aStart + i);
    const b = value(bStart + i);
    aa += a * a;
    bb += b * b;
    ab += a * b;
  }
  return ab / Math.sqrt(Math.max(1e-12, aa * bb));
}

function boundaryDelta(length) {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const a = value(i);
    const b = value(frameCount - length + i);
    const delta = Math.abs(a - b);
    sum += delta * delta;
    peak = Math.max(peak, delta);
  }
  return { rms: Math.sqrt(sum / length), peak };
}

function edgeDiscontinuity() {
  return {
    left: value(0, 0) - value(frameCount - 1, 0),
    right: value(0, 1) - value(frameCount - 1, 1),
    max_abs: Math.max(
      Math.abs(value(0, 0) - value(frameCount - 1, 0)),
      Math.abs(value(0, 1) - value(frameCount - 1, 1)),
    ),
  };
}

function rmsAt(frame) {
  return segmentStats(frame, Math.min(frameCount, frame + Math.floor(sampleRate * 0.05))).rms;
}

const windowFrames = Math.floor(sampleRate * 0.5);
const tailWindowFrames = Math.floor(sampleRate * 0.25);
const candidates = [];
for (let offset = 0; offset <= Math.min(sampleRate * 2, frameCount - windowFrames); offset += Math.floor(sampleRate * 0.1)) {
  const endStart = frameCount - windowFrames - offset;
  candidates.push({ offset_s: offset / sampleRate, correlation_500ms: correlation(0, endStart, windowFrames), end_start_s: endStart / sampleRate });
}
candidates.sort((a, b) => b.correlation_500ms - a.correlation_500ms);

const boundaryCandidates = [];
const step = Math.floor(sampleRate * 0.25);
for (let frame = step; frame < frameCount - step; frame += step) {
  const before = rmsAt(frame - step);
  const after = rmsAt(frame);
  const around = rmsAt(frame - Math.floor(step / 2));
  const novelty = Math.abs(after - before) / Math.max(1e-6, around);
  if (novelty > 0.12) boundaryCandidates.push({ time_s: frame / sampleRate, novelty });
}
boundaryCandidates.sort((a, b) => b.novelty - a.novelty);

const duration = frameCount / sampleRate;
console.log(JSON.stringify({
  file,
  codec: stream.codec_name,
  sample_rate: sampleRate,
  source_channels: sourceChannels,
  decoded_channels: decodedChannels,
  duration_s: duration,
  frames: frameCount,
  first_500ms: segmentStats(0, windowFrames),
  last_500ms: segmentStats(frameCount - windowFrames, frameCount),
  last_250ms: segmentStats(frameCount - tailWindowFrames, frameCount),
  seam_correlation_500ms: correlation(0, frameCount - windowFrames, windowFrames),
  seam_correlation_100ms: correlation(0, frameCount - Math.floor(sampleRate * 0.1), Math.floor(sampleRate * 0.1)),
  boundary_delta_100ms: boundaryDelta(Math.floor(sampleRate * 0.1)),
  edge_discontinuity: edgeDiscontinuity(),
  loop_candidates: candidates.slice(0, 5),
  energy_boundaries: boundaryCandidates.slice(0, 12),
}, null, 2));
