import { useEffect, useRef } from "react";

/** A new bar every this many milliseconds; the rest scroll smoothly between. */
const barEvery = 55;
const barWidth = 3;
const gap = 2.5;

interface Bar {
  /** Loudness 0–1 the bar settles on. */
  target: number;
  height: number;
  velocity: number;
  /** Loudness heard while this bar was the newest. */
  sum: number;
  peak: number;
  frames: number;
}

const bar = (height = 0): Bar => ({
  target: 0,
  height,
  velocity: 0,
  sum: 0,
  peak: 0,
  frames: 0,
});

/**
 * Microphone loudness, 0–1. Speech sits around −23 dBFS after the browser's
 * gain control; this puts it near the middle, with quiet syllables low and
 * only real peaks near the top, so the bars keep their shape.
 */
export function loudness(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const db = 10 * Math.log10(sum / samples.length + 1e-10);
  return Math.min(1, Math.max(0, (db + 48) / 38)) ** 1.8;
}

/**
 * The voice as a strip of bars that scrolls right to left. The rightmost bar
 * follows the microphone live; each bar springs to its height with a little
 * overshoot, and older ones fade out toward the left edge.
 */
export function DictationWave({
  analyser,
  level,
  active,
  settling,
}: {
  analyser?: AnalyserNode;
  /** Loudness for previews without a microphone. */
  level?: () => number;
  /** Listening for real (the model loaded); otherwise drawn muted. */
  active: boolean;
  /** Finishing: the bars ease down flat. */
  settling: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const props = useRef({ active, settling });
  props.current = { active, settling };

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const samples = new Float32Array(analyser?.fftSize ?? 512);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    let bars: Bar[] = [];
    let width = 0,
      height = 0,
      count = 0,
      frame = 0,
      last = performance.now(),
      sinceBar = 0,
      mix = props.current.active ? 1 : 0,
      glow = 0,
      shownGlow = 0,
      colors = { accent: "", muted: "" };

    const measure = () => {
      const box = element.getBoundingClientRect(),
        ratio = devicePixelRatio || 1;
      width = box.width;
      height = box.height;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      count = Math.ceil(width / (barWidth + gap)) + 2;
      while (bars.length < count) bars.unshift(bar());
      bars = bars.slice(-count);
      const style = getComputedStyle(element);
      colors = {
        accent: style.getPropertyValue("--wave-live").trim() || "#6565a9",
        muted: style.getPropertyValue("--wave-idle").trim() || "#898b93",
      };
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // A visible window behind the editor would still repaint every frame.
      if (root.hasAttribute("data-inactive")) {
        last = now;
        return;
      }
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      const { active, settling } = props.current;
      let live = 0;
      if (settling) live = 0;
      else if (analyser) {
        analyser.getFloatTimeDomainData(samples);
        live = loudness(samples);
      } else if (level) live = level();

      sinceBar += dt * 1000;
      while (sinceBar >= barEvery) {
        sinceBar -= barEvery;
        bars.shift();
        bars.push(bar(bars.at(-1)?.height));
      }
      // Mostly the average, with some of the peak, so syllables stand apart.
      const newest = bars[bars.length - 1];
      newest.sum += live;
      newest.peak = Math.max(newest.peak, live);
      newest.frames++;
      newest.target = 0.6 * (newest.sum / newest.frames) + 0.4 * newest.peak;
      if (settling) for (const each of bars) each.target = 0;

      for (const each of bars) {
        if (reduced) {
          each.height = each.target;
          continue;
        }
        // Slightly underdamped: a bar pops up past its height and settles.
        const stiffness = 420,
          damping = 24;
        each.velocity +=
          (stiffness * (each.target - each.height) - damping * each.velocity) *
          dt;
        each.height += each.velocity * dt;
      }
      mix += ((active ? 1 : 0) - mix) * Math.min(1, dt * 6);
      // The capsule around the bars swells with the voice (see dictation.css).
      glow +=
        ((settling ? 0 : live) - glow) *
        Math.min(1, dt * (live > glow ? 18 : 5));
      if (Math.abs(glow - shownGlow) > 0.02) {
        shownGlow = glow;
        element.parentElement?.style.setProperty("--voice", glow.toFixed(2));
      }

      context.clearRect(0, 0, width, height);
      const step = barWidth + gap,
        scroll = reduced ? 0 : (sinceBar / barEvery) * step,
        middle = height / 2,
        floor = 1.5,
        room = middle * 0.9;
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.fillStyle = colors.muted;
      drawBars(1 - mix);
      context.fillStyle = colors.accent;
      drawBars(mix);

      function drawBars(alpha: number) {
        if (alpha < 0.01) return;
        context!.globalAlpha = alpha;
        context!.beginPath();
        for (let i = 0; i < bars.length; i++) {
          const x = width - (bars.length - i) * step + step - scroll - barWidth;
          if (x < -barWidth) continue;
          const half = Math.max(floor, Math.min(room, bars[i].height * room));
          context!.roundRect(
            x,
            middle - half,
            barWidth,
            half * 2,
            barWidth / 2,
          );
        }
        context!.fill();
      }
      // Fade the oldest bars out toward the left edge.
      context.globalAlpha = 1;
      context.globalCompositeOperation = "destination-out";
      const fade = context.createLinearGradient(0, 0, width * 0.45, 0);
      fade.addColorStop(0, "#000");
      fade.addColorStop(1, "#0000");
      context.fillStyle = fade;
      context.fillRect(0, 0, width * 0.45, height);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      element.parentElement?.style.removeProperty("--voice");
    };
  }, [analyser, level]);

  return <canvas ref={canvas} className="dictation-wave" aria-hidden />;
}
