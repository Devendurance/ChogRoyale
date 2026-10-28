import { promises as fs } from "node:fs";
import path from "node:path";

const AUDIO_PATH = path.resolve(process.cwd(), ".audio-dev", "battle-loop.mp3");

function missing(): Response {
  return new Response(null, { status: 404 });
}

export async function GET(request: Request): Promise<Response> {
  // Track B is CC BY-NC and must never be served by a production build.
  if (process.env.NODE_ENV === "production") return missing();

  let file: Buffer;
  try {
    file = await fs.readFile(AUDIO_PATH);
  } catch {
    return missing();
  }

  const headers = new Headers({
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  const range = request.headers.get("range");
  if (!range) {
    headers.set("Content-Length", String(file.byteLength));
    return new Response(new Uint8Array(file), { status: 200, headers });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.byteLength}` } });
  const suffixLength = match[1] ? null : Number(match[2]);
  const start = suffixLength === null ? Number(match[1]) : Math.max(0, file.byteLength - suffixLength);
  const requestedEnd = suffixLength === null ? (match[2] ? Number(match[2]) : file.byteLength - 1) : file.byteLength - 1;
  const end = Math.min(file.byteLength - 1, requestedEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= file.byteLength) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.byteLength}` } });
  }
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${file.byteLength}`);
  return new Response(new Uint8Array(file.subarray(start, end + 1)), { status: 206, headers });
}
