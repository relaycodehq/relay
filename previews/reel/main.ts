import "../../src/styles.css";
import "./reel.css";
import { applyToDocument, resolveChoice } from "../../src/lib/themes";
import { device } from "./kit";
import { RibbonRenderer } from "./ribbon-gl";
import { renderScore, wav } from "./score";
import { Stage } from "./stage";
import { DURATION, Story } from "./story";

const WIDTH = 1920;
const HEIGHT = 1080;

declare global {
  interface Window {
    /** For the recorder: draw the frame at `t` seconds; the score as a base64 WAV. */
    reel: { duration: number; seek(t: number): void; score(): Promise<string> };
  }
}

// Relay's own dark theme, whatever this browser's previews are set to.
applyToDocument(resolveChoice("dark", { theme: "relay" }));

const params = new URLSearchParams(location.search);
const recording = params.has("record");

const root = document.getElementById("root")!;
root.className = "reel";
if (recording) root.dataset.record = "";
root.innerHTML = `
  <div class="reel-frame">
    <canvas class="reel-back"></canvas>
    <div class="reel-panels"></div>
    <canvas class="reel-front"></canvas>
    <div class="reel-over">
      <div class="reel-slug"><span class="reel-clock"></span><span class="reel-where"></span></div>
      <div class="reel-black"></div>
    </div>
  </div>
  <button type="button" class="reel-start" aria-label="Play">
    <svg width="30" height="30" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
  </button>
  <div class="reel-controls">
    <button type="button" data-play></button>
    <input type="range" min="0" max="${DURATION}" step="0.01" value="0" aria-label="Position">
    <span data-readout></span>
  </div>`;

const find = <T extends HTMLElement>(selector: string) =>
  root.querySelector<T>(selector)!;
const frame = find(".reel-frame");
const clock = find(".reel-clock");
const where = find(".reel-where");
const slug = find(".reel-slug");
const black = find(".reel-black");
const play = find<HTMLButtonElement>("[data-play]");
const scrub = find<HTMLInputElement>("input");
const readout = find("[data-readout]");
const start = find<HTMLButtonElement>(".reel-start");

const renderer = new RibbonRenderer(
  find<HTMLCanvasElement>(".reel-back"),
  find<HTMLCanvasElement>(".reel-front"),
);
const stage = new Stage(find(".reel-panels"), WIDTH, HEIGHT);
const story = new Story(stage);

function fit() {
  const k = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
  frame.style.transform = `scale(${k}) translate(-50%, -50%)`;
  // Sharper than the screen needs: the ribbon's edges are all the film has.
  const density = Number(params.get("density")) || Math.min(2, Math.max(1, devicePixelRatio * k));
  renderer.resize(Math.round(WIDTH * density), Math.round(HEIGHT * density), density);
}

let computer = "";
function draw(t: number) {
  const { camera, scene, ...over } = story.frame(t);
  const occluders = stage.place(camera.viewProj, camera.eye);
  renderer.render({ ...scene, viewProj: camera.viewProj, eye: camera.eye, occluders });
  clock.textContent = over.clock;
  if (computer !== over.computer) {
    computer = over.computer;
    where.innerHTML = `${device(computer, 15)}<span>${computer}</span>`;
  }
  slug.style.opacity = over.slug.toFixed(3);
  black.style.opacity = over.black.toFixed(3);
}

let time = Math.min(DURATION, Number(params.get("t") ?? 0));
let playing = params.has("autoplay");
let last = performance.now();

// The score is rendered once, up front, so playing it back and exporting it
// give the same audio. While it sounds, its clock is the film's clock.
const score = renderScore();
let buffer: AudioBuffer | undefined;
let audio: AudioContext | undefined;
let voice: AudioBufferSourceNode | undefined;
let voiceAt = 0;
let voiceFrom = 0;

function quiet() {
  voice?.stop();
  voice = undefined;
}

function sound() {
  quiet();
  if (!playing || !buffer || params.has("mute") || params.has("autoplay")) return;
  audio ??= new AudioContext();
  voice = audio.createBufferSource();
  voice.buffer = buffer;
  voice.connect(audio.destination);
  voiceAt = audio.currentTime + 0.04;
  voiceFrom = time;
  voice.start(voiceAt, time);
}

if (!recording)
  void score.then((rendered) => {
    buffer = rendered;
    if (playing) sound();
  });

function jump(to: number) {
  time = Math.min(DURATION, Math.max(0, to));
  sound();
}

let drawn = -1;
function show() {
  draw(time);
  drawn = time;
  scrub.value = String(time);
  readout.textContent = `${time.toFixed(1)} / ${DURATION.toFixed(1)}`;
  play.textContent = playing ? "Pause" : "Play";
  start.hidden = playing || time > 0;
  if (playing) delete root.dataset.paused;
  else root.dataset.paused = "";
}

function tick(now: number) {
  if (playing) {
    time =
      voice && audio
        ? Math.max(voiceFrom, voiceFrom + audio.currentTime - voiceAt)
        : time + Math.min(0.1, (now - last) / 1000);
    if (time >= DURATION) {
      time = DURATION;
      playing = false;
      quiet();
    }
  }
  last = now;
  // A paused film is a still: nothing to repaint until it's moved.
  if (playing || time !== drawn) show();
  requestAnimationFrame(tick);
}

play.addEventListener("click", () => {
  if (!playing && time >= DURATION) time = 0;
  playing = !playing;
  drawn = -1;
  sound();
});
start.addEventListener("click", () => play.click());
scrub.addEventListener("input", () => jump(Number(scrub.value)));
addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    play.click();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const step = (event.shiftKey ? 5 : 1) * (event.key === "ArrowLeft" ? -1 : 1);
    jump(time + step);
  } else if (event.key === "Home") jump(0);
});
addEventListener("resize", () => {
  fit();
  drawn = -1;
});

fit();
window.reel = {
  duration: DURATION,
  seek(t) {
    time = t;
    show();
  },
  async score() {
    const bytes = wav(await score);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  },
};
if (recording) show();
else requestAnimationFrame(tick);
