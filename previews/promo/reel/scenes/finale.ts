import { MonitorCheck, MonitorUp } from "lucide-react";
import markSource from "../../../../assets/relay-mark.svg?raw";
import { clamp, easeOut, span, type Vec3 } from "../math";
import type { Knot } from "../path";
import { Panel } from "../stage";
import { icon, query, setText } from "../kit";
import { TARGET } from "./handoff";

/** Scene times, counted from the ribbon reaching the top of the R. */
export const FINALE = {
  /** The head reaches the end of the leg. */
  drawn: 4.4,
  /** The tail has caught up: what's left of the ribbon is the R. */
  tied: 5.3,
  /** The ribbon gives way to the mark itself. */
  crisp: [5.7, 6.2] as const,
  name: 6.4,
  working: 7.0,
  finished: 8.7,
  bring: 10.6,
  black: [11.9, 12.3] as const,
};

/**
 * The mark's centre line, tip to tail, in the coordinates its paths are
 * drawn in, with the ribbon's width there. Read off assets/relay-mark.svg.
 */
const CENTRE: [number, number, number][] = [
  [115, 64, 1],
  [160, 112, 6],
  [198, 172, 10],
  [228, 240, 15],
  [245, 305, 20],
  [254, 362, 23],
  [251, 402, 24],
  [240, 426, 18],
  [207, 400, 28],
  [178, 368, 30],
  [155, 330, 31],
  [137, 293, 31],
  [131, 262, 30],
  [146, 236, 30],
  [190, 225, 31],
  [245, 228, 31],
  [300, 241, 29],
  [348, 258, 27],
  [388, 279, 22],
  [403, 300, 10],
  [370, 297, 20],
  [328, 297, 21],
  [298, 306, 20],
  [306, 326, 21],
  [335, 352, 22],
  [385, 389, 20],
  [440, 428, 15],
  [478, 462, 10],
  [497, 485, 6],
  [491, 506, 1],
];
/** Knot indexes where the ribbon turns over: the bottom of the stem and the bowl's corner. */
const FOLDS = [7, 19];
/** How far each stretch sits towards the viewer, so the crossings stack like the mark's. */
const LAYER = (index: number) =>
  index <= 7 ? 0 : index <= 12 ? 8 : index <= 19 ? 26 : 16;

const SIZE = 832;

export class Finale {
  /** The mark itself, standing exactly where the ribbon ties it. */
  readonly mark = new Panel(SIZE, SIZE, "reel-mark");
  readonly name = new Panel(520, 96, "reel-wordmark");
  readonly status = new Panel(1100, 44, "reel-status");
  private readonly statusIcon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly bring: HTMLElement;
  private shownIcon = "";

  constructor(centre: Vec3) {
    this.mark.el.innerHTML = markSource.replace(
      /width="32" height="32"/,
      `width="${SIZE}" height="${SIZE}"`,
    );
    this.mark.pos = centre;
    this.name.el.textContent = "Relay";
    this.status.el.innerHTML = `
      <span data-icon></span>
      <span class="waiting-strip-text"><b data-title></b><span data-detail></span></span>
      <button class="primary-action" data-bring>Bring back</button>`;
    for (const panel of [this.mark, this.name, this.status]) panel.solid = false;
    this.name.pos = this.mark.point(463, 792);
    this.status.pos = this.mark.point(463, 884);
    this.statusIcon = query(this.status.el, "[data-icon]");
    this.title = query(this.status.el, "[data-title]");
    this.detail = query(this.status.el, "[data-detail]");
    this.bring = query(this.status.el, "[data-bring]");
  }

  /** What the camera should look at to hold the whole lockup. */
  get focus(): Vec3 {
    return this.mark.point(463, 470);
  }

  /** A point given in the mark's own path coordinates, in the world. */
  at(x: number, y: number, lift = 0): Vec3 {
    return this.mark.point(1.42 * x + 23.698, 1.42 * y - 28.286, lift);
  }

  /** The R as ribbon knots; `roll` is the twist the ribbon arrives with. */
  knots(roll: number): Knot[] {
    let turned = roll;
    return CENTRE.map(([x, y, width], i) => {
      // Half a turn spread across each fold, so the ribbon is edge-on at it.
      for (const fold of FOLDS) {
        if (i === fold - 1 || i === fold + 1) turned += 0.125;
        if (i === fold) turned += 0.25;
      }
      return {
        p: this.at(x, y, LAYER(i)),
        width: width * 1.42 * this.mark.scale,
        roll: turned,
        face: [0, 0, 1] as Vec3,
      };
    });
  }

  update(t: number) {
    this.mark.opacity = span(t, FINALE.crisp[0], FINALE.crisp[1]);
    const named = easeOut(span(t, FINALE.name, FINALE.name + 0.7));
    this.name.opacity = named;
    this.name.el.style.letterSpacing = `${(0.06 - 0.05 * named).toFixed(4)}em`;

    const finished = t >= FINALE.finished;
    const returning = t >= FINALE.bring + 0.18;
    // Each change of state dips out and back, so the line never jumps.
    const dip = (at: number) => span(Math.abs(t - at), 0, 0.18);
    this.status.opacity =
      easeOut(span(t, FINALE.working, FINALE.working + 0.5)) *
      dip(FINALE.finished) *
      dip(FINALE.bring + 0.18);
    const which = returning ? "returning" : finished ? "finished" : "working";
    if (this.shownIcon !== which) {
      this.shownIcon = which;
      this.statusIcon.innerHTML = icon(finished && !returning ? MonitorCheck : MonitorUp, 19);
    }
    setText(
      this.title,
      returning
        ? `Bringing it back from ${TARGET}`
        : finished
          ? `${TARGET} finished`
          : `Working on ${TARGET}`,
    );
    setText(
      this.detail,
      returning ? "" : finished ? " · Split into 31 modules. Tests pass." : " · Running vitest",
    );
    this.bring.style.display = returning ? "none" : "";
    const press = 1 - Math.abs(clamp((t - FINALE.bring) / 0.14, -1, 1));
    this.bring.style.transform = `scale(${(1 - 0.07 * press).toFixed(3)})`;
    this.bring.style.filter = `brightness(${(1 + 0.5 * press).toFixed(3)})`;
  }
}
