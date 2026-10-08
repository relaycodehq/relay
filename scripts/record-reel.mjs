// Renders previews/promo/reel to an mp4, frame by frame, with its own score.
//
//   node scripts/record-reel.mjs [--out reel.mp4] [--fps 60] [--blur 3] [--from 0] [--to 72]
//                                [--width 1920] [--density 2] [--url http://127.0.0.1:5177]
//
// The page draws any moment on request (window.reel.seek), so a slow frame
// costs time, not smoothness. --blur takes that many samples across the first
// half of each frame's time and averages them: a 180° shutter. Needs the dev
// server running and ffmpeg. Don't edit the film's files while it runs: Vite
// reloads the page under the recorder.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const out = option("out", "reel.mp4");
const fps = Number(option("fps", 60));
const width = Number(option("width", 1920));
const height = Math.round((width * 9) / 16);
// Ribbon edges are drawn at this many times the frame, then scaled down.
const density = Number(option("density", 2));
const blur = Number(option("blur", 1));
const base = option("url", "http://127.0.0.1:5177");

// Headless Chromium falls back to software GL without these; Metal is ~5x faster.
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
page.on("pageerror", (error) => console.error("page:", error.message));
await page.goto(`${base}/previews/promo/reel/?record&density=${density}`);
await page.waitForFunction(() => !!window.reel);
// Straight to the DevTools protocol: its fast PNG path is three times quicker
// than page.screenshot().
const devtools = await page.context().newCDPSession(page);

const duration = await page.evaluate(() => window.reel.duration);
const from = Number(option("from", 0));
const to = Math.min(duration, Number(option("to", duration)));
const frames = Math.round((to - from) * fps);

const work = mkdtempSync(join(tmpdir(), "reel-"));
const scorePath = join(work, "score.wav");
writeFileSync(
  scorePath,
  Buffer.from(await page.evaluate(() => window.reel.score()), "base64"),
);

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-framerate",
    String(fps * blur),
    "-c:v",
    "png",
    "-i",
    "-",
    "-ss",
    String(from),
    "-t",
    String(to - from),
    "-i",
    scorePath,
    ...(blur > 1
      ? [
          "-vf",
          `tmix=frames=${blur},select='eq(mod(n\\,${blur})\\,${blur - 1})',setpts=PTS-STARTPTS`,
          "-r",
          String(fps),
        ]
      : []),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "15",
    "-pix_fmt",
    "yuv420p",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-movflags",
    "+faststart",
    "-shortest",
    out,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const closed = new Promise((resolve, reject) => {
  ffmpeg.on("close", (code) =>
    code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve(),
  );
});

const started = Date.now();
for (let i = 0; i < frames; i++) {
  for (let sample = 0; sample < blur; sample++) {
    await page.evaluate(
      (t) => {
        window.reel.seek(t);
        // Two frames: one for layout and paint, one for the compositor to catch up.
        return new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        );
      },
      from + (i + (sample / blur) * 0.5) / fps,
    );
    const { data } = await devtools.send("Page.captureScreenshot", {
      format: "png",
      optimizeForSpeed: true,
    });
    if (!ffmpeg.stdin.write(Buffer.from(data, "base64")))
      await new Promise((drained) => ffmpeg.stdin.once("drain", drained));
  }
  if (i % fps === 0) {
    const each = (Date.now() - started) / (i + 1);
    process.stdout.write(
      `\r${(from + i / fps).toFixed(0)}s of ${to.toFixed(0)}s, ${each.toFixed(0)} ms a frame, ${(((frames - i) * each) / 60000).toFixed(1)} min left  `,
    );
  }
}
ffmpeg.stdin.end();
await closed;
await browser.close();
rmSync(work, { recursive: true });
console.log(
  `\n${out}: ${frames} frames, ${((Date.now() - started) / 60000).toFixed(1)} min`,
);
