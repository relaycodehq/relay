// The hero's backdrop: hairline lanes, one per thread, with a run travelling
// along each and leaving a tick wherever it made a tool call. Drawn on a canvas
// so it costs one small paint per frame, and stopped whenever it isn't seen.

interface Lane {
  y: number;
  /** Head of the run, in px from the left edge; negative while it waits to start. */
  head: number;
  speed: number;
  ticks: number[];
  nextTick: number;
}

const LANE_GAP = 46;

export function startLanes(canvas: HTMLCanvasElement, colors: { line: string; run: string }) {
  const context = canvas.getContext("2d");
  if (!context) return { run() {}, stop() {} };
  let width = 0;
  let height = 0;
  let lanes: Lane[] = [];
  let frame = 0;
  let last = 0;
  let running = false;

  const fresh = (y: number, head: number): Lane => ({
    y,
    head,
    speed: 46 + Math.random() * 70,
    ticks: [],
    nextTick: Math.max(head, 0) + 40 + Math.random() * 120,
  });

  const size = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const stretch = width ? canvas.clientWidth / width : 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    // A resize fires every frame of a window drag: runs that restarted at random
    // on each one strobed, so they keep going, stretched to the new width.
    const kept: Lane[] = [];
    for (let i = 0, y = LANE_GAP / 2; y < height; i++, y += LANE_GAP) {
      const lane = lanes[i];
      if (!lane) {
        kept.push(fresh(y + 0.5, Math.random() * width));
        continue;
      }
      lane.head *= stretch;
      lane.nextTick *= stretch;
      lane.ticks = lane.ticks.map((tick) => tick * stretch);
      kept.push(lane);
    }
    lanes = kept;
    draw(0);
  };

  /** Lanes fade out behind the headline in the middle and at both edges. */
  const fade = (x: number) => {
    const edge = Math.min(x, width - x) / 160;
    const centre = Math.abs(x - width / 2) / (Math.min(width, 1100) * 0.36);
    return Math.max(0, Math.min(1, edge, centre * centre - 0.15));
  };

  const draw = (dt: number) => {
    context.clearRect(0, 0, width, height);
    for (const lane of lanes) {
      lane.head += lane.speed * dt;
      if (lane.head > lane.nextTick) {
        lane.ticks.push(lane.nextTick);
        lane.nextTick += 50 + Math.random() * 190;
      }
      if (lane.head > width + 260) Object.assign(lane, fresh(lane.y, -Math.random() * 500));

      // The lane itself, in short pieces so each can take its own fade.
      context.strokeStyle = colors.line;
      context.lineWidth = 1;
      for (let x = 0; x < width; x += 24) {
        context.globalAlpha = 0.55 * fade(x + 12);
        context.beginPath();
        context.moveTo(x, lane.y);
        context.lineTo(Math.min(x + 24, width), lane.y);
        context.stroke();
      }
      // Ticks the run left behind, dimming with distance from its head.
      context.strokeStyle = colors.run;
      for (const tick of lane.ticks) {
        const age = (lane.head - tick) / 520;
        if (age > 1) continue;
        context.globalAlpha = (1 - age) * 0.8 * fade(tick);
        context.beginPath();
        context.moveTo(tick + 0.5, lane.y - 4);
        context.lineTo(tick + 0.5, lane.y + 4);
        context.stroke();
      }
      // The run: a short bright stretch ending in a square head.
      const tail = lane.head - 90;
      for (let x = Math.max(tail, 0); x < lane.head; x += 6) {
        context.globalAlpha = ((x - tail) / 90) * fade(x);
        context.beginPath();
        context.moveTo(x, lane.y);
        context.lineTo(Math.min(x + 6, lane.head), lane.y);
        context.stroke();
      }
      context.globalAlpha = fade(lane.head);
      context.fillStyle = colors.run;
      context.fillRect(Math.round(lane.head) - 2, lane.y - 2.5, 5, 5);
    }
    context.globalAlpha = 1;
  };

  const tick = (time: number) => {
    const dt = Math.min((time - last) / 1000, 0.05);
    last = time;
    draw(dt);
    frame = requestAnimationFrame(tick);
  };

  const observer = new ResizeObserver(size);
  observer.observe(canvas);
  size();

  return {
    /** Runs while `on`; stopped, the last frame stays. */
    run(on: boolean) {
      if (on === running) return;
      running = on;
      cancelAnimationFrame(frame);
      if (on) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    stop() {
      cancelAnimationFrame(frame);
      observer.disconnect();
    },
  };
}
