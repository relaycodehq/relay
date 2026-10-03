// Renders previews/promo/teaser to video, one seeked frame at a time, so the
// motion is smooth no matter how slow a frame is to paint. Needs the dev
// server on :5177 and ffmpeg.
//
//   node scripts/record-teaser.mjs                   # 1080p60 → test-results/teaser/relay-teaser.mp4
//   node scripts/record-teaser.mjs --scale 2         # 4K
//   node scripts/record-teaser.mjs --stills 4,12.5   # PNGs of single moments
//   node scripts/record-teaser.mjs --from 20 --to 30 # a slice, for checking
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const url = option(
  "url",
  "http://127.0.0.1:5177/previews/promo/teaser/?capture",
);
const scale = Number(option("scale", "1"));
const fps = Number(option("fps", "60"));
const stills = option("stills");
const out = resolve(
  option(
    "out",
    stills
      ? "test-results/teaser-stills"
      : "test-results/teaser/relay-teaser.mp4",
  ),
);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: scale,
});
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(url);
await page.waitForFunction(() => window.teaser);
await page.evaluate(() => window.teaser.ready);
// Let the diff's syntax workers warm up before the first frame.
await page.evaluate(() => window.teaser.seek(22_000));
await page.waitForTimeout(1500);

if (stills) {
  mkdirSync(out, { recursive: true });
  for (const s of stills.split(",").map(Number)) {
    // Play the second before it, so entry animations have run.
    for (let t = Math.max(0, s * 1000 - 1000); t <= s * 1000; t += 1000 / 60)
      await page.evaluate((t) => window.teaser.seek(t), t);
    await page.waitForTimeout(250);
    const path = `${out}/t${String(s).padStart(5, "0")}.png`;
    await page.screenshot({ path });
    console.log(path);
  }
  await browser.close();
  process.exit(0);
}

const duration = await page.evaluate(() => window.teaser.duration);
const from = Number(option("from", "0")) * 1000;
const to = Math.min(
  duration,
  Number(option("to", String(duration / 1000))) * 1000,
);
const frames = Math.round(((to - from) / 1000) * fps);

mkdirSync(dirname(out), { recursive: true });
const ffmpeg = spawn(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps),
    "-c:v",
    "mjpeg",
    "-i",
    "-",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    scale > 1 ? "18" : "16",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);

const started = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.teaser.seek(t), from + (i * 1000) / fps);
  const jpeg = await page.screenshot({ type: "jpeg", quality: 95 });
  if (!ffmpeg.stdin.write(jpeg))
    await new Promise((r) => ffmpeg.stdin.once("drain", r));
  if (i % fps === 0) {
    const rate = (i + 1) / ((Date.now() - started) / 1000);
    console.log(
      `frame ${i}/${frames} · ${rate.toFixed(1)} fps · ~${Math.round((frames - i) / rate)}s left`,
    );
  }
}
ffmpeg.stdin.end();
await new Promise((r) => ffmpeg.on("close", r));
await browser.close();
console.log(out);
