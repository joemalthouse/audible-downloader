import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");

const files = [
  "index.html",
  "auth",
  "styles.css",
  "app.js",
  "_headers",
  "wrangler.toml",
  "vendor/ffmpeg/ffmpeg/dist/esm",
  "vendor/ffmpeg/core/dist/esm/ffmpeg-core.js",
  "vendor/ffmpeg/core/dist/esm/ffmpeg-core.wasm.gz",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of files) {
  const source = join(root, file);
  const target = join(dist, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

const wasm = await stat(join(dist, "vendor/ffmpeg/core/dist/esm/ffmpeg-core.wasm.gz"));
const maxPagesAssetBytes = 25 * 1024 * 1024;
if (wasm.size > maxPagesAssetBytes) {
  throw new Error(`ffmpeg-core.wasm.gz is ${wasm.size} bytes, above Cloudflare Pages 25 MiB asset limit`);
}

console.log(`Cloudflare dist ready: ${dist}`);
console.log(`ffmpeg-core.wasm.gz: ${(wasm.size / 1024 / 1024).toFixed(1)} MiB`);
