// Records one loop of the website's product tour (previews/website/, the
// app's own components on sample data) into the README's demo GIF. The tour
// runs on its own timers, so this captures it in real time over the DevTools
// screencast instead of seeking frames. Needs the dev server on :5177, ffmpeg
// and gifsicle.
//
//   node scripts/record-readme-demo.mjs   # → docs/media/relay-demo.gif
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const url = option("url", "http://127.0.0.1:5177/previews/website/");
const out = resolve(option("out", "docs/media/relay-demo.gif"));
const fps = Number(option("fps", "12"));
// Room around the tour, more below for the window's shadow.
const pad = { side: 24, top: 24, bottom: 48 };

const frames = mkdtempSync(join(tmpdir(), "relay-demo-"));
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
});
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(url);
await page.waitForSelector(".tour .rw");
await page.addStyleTag({
  content:
    "html { scroll-behavior: auto !important } header.nav, .hero-lanes { display: none !important }",
});
await page.waitForTimeout(1500);

// The tour starts over at its first stop when it scrolls into view.
const box = await page.evaluate((top) => {
  const tour = document.querySelector(".tour");
  window.scrollTo(0, tour.getBoundingClientRect().top + scrollY - top);
  const r = tour.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, pad.top);

const shots = [];
const cdp = await page.context().newCDPSession(page);
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  shots.push({ data, t: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "png" });
const stopShown = (n) =>
  page.waitForFunction(
    (n) =>
      document
        .querySelectorAll(".tour-list button")
        [n].getAttribute("aria-selected") === "true",
    n,
    { timeout: 120_000, polling: 100 },
  );
await stopShown(3);
await stopShown(0);
await cdp.send("Page.stopScreencast");
await browser.close();
console.log(
  `${shots.length} frames over ${(shots.at(-1).t - shots[0].t).toFixed(1)}s`,
);

// The screencast only sends a frame when something changed, so each one is
// held until the next.
let list = "";
shots.forEach((shot, i) => {
  const file = join(frames, `${String(i).padStart(5, "0")}.png`);
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  const held = i + 1 < shots.length ? shots[i + 1].t - shot.t : 1 / fps;
  list += `file '${file}'\nduration ${held.toFixed(4)}\n`;
});
writeFileSync(join(frames, "list.txt"), list);

const crop = [
  Math.round(box.width + pad.side * 2),
  Math.round(box.y + box.height + pad.bottom),
  Math.round(box.x - pad.side),
  0,
].join(":");
const raw = join(frames, "raw.gif");
execFileSync("ffmpeg", [
  ...["-y", "-v", "error", "-f", "concat", "-safe", "0"],
  ...["-i", join(frames, "list.txt")],
  "-vf",
  `crop=${crop},fps=${fps},split[a][b];[a]palettegen=stats_mode=diff:max_colors=160[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
  raw,
]);
execFileSync("gifsicle", ["-O3", "--lossy=20", raw, "-o", out]);
rmSync(frames, { recursive: true, force: true });
console.log(out);
