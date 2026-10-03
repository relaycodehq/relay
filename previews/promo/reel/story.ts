import { Camera, type CameraKey, type CameraState } from "./camera";
import { agentColor } from "./kit";
import {
  add,
  clamp,
  easeInOut,
  easeOut,
  lerp,
  mix3,
  scale,
  smooth,
  smoother,
  span,
  type Vec3,
} from "./math";
import { Path, type Knot } from "./path";
import type { Backdrop, Glint, Rgb, Scene, Strand } from "./ribbon-gl";
import { Stage } from "./stage";
import { ACTIVITY, Activity, THREADS } from "./scenes/activity";
import { FINALE, Finale } from "./scenes/finale";
import {
  HANDOFF,
  SOURCE,
  SourceDesk,
  TARGET,
  TargetDesk,
  remoteCall,
} from "./scenes/handoff";
import { PULLS, Pulls } from "./scenes/pulls";
import { REVIEW, REVIEWERS, Review } from "./scenes/review";
import { SENT, SWITCHES, Switcher } from "./scenes/switcher";

/** When each scene's own clock starts, in film seconds. */
export const AT = {
  activity: 4.8,
  switcher: 15.4,
  review: 23.6,
  pulls: 36.2,
  source: 43.6,
  /** The thread lands on the other computer. */
  landed: 52.4,
  /** The ribbon reaches the top of the R. */
  finale: 59.2,
};
export const DURATION = AT.finale + FINALE.black[1] + 0.5;

/** How long the agent runs on the other computer before it's done. */
const NIGHT_SHIFT = 7 * 3600 + 22 * 60;
const TIME_LAPSE = [55.2, AT.finale + FINALE.finished] as const;

const HERO_WIDTH = 54;
const TRAIL = 6000;

/** Piecewise-linear lookup through (time, value) pairs. */
function track(keys: [number, number][], t: number) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (t < keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return lerp(v0, v1, smooth(span(t, t0, t1)));
    }
  return keys[keys.length - 1][1];
}

const hm = (hours: number, minutes: number) => hours * 60 + minutes;

/** The wall clock in the corner, in minutes since the first midnight. */
const CLOCK: [number, number][] = [
  [0, hm(8, 57)],
  [AT.activity - 0.5, hm(8, 57)],
  [AT.activity + 0.3, hm(9, 14)],
  [AT.switcher - 0.5, hm(9, 14)],
  [AT.switcher + 0.3, hm(11, 2)],
  [AT.review - 0.5, hm(11, 2)],
  [AT.review + 0.3, hm(14, 2)],
  [AT.pulls - 0.5, hm(14, 2)],
  [AT.pulls + 0.3, hm(16, 40)],
  [AT.source - 0.5, hm(16, 40)],
  [AT.source + 0.3, hm(23, 10)],
  [AT.landed, hm(23, 11)],
];

interface Sky extends Backdrop {
  t: number;
}

const NO_HORIZON: Rgb = [0, 0, 0];

/**
 * The room's light through the day. It stays in the mark's own violets and
 * navies and only gets darker towards night, so the one warm thing in the
 * film is the dawn coming up under the R.
 */
const SKY: Sky[] = [
  { t: 0, base: [0.026, 0.028, 0.046], glowA: [0.06, 0.09, 0.2], glowB: [0.09, 0.07, 0.16], horizon: NO_HORIZON, drift: [0, 0], motes: [0.72, 0.74, 1] },
  { t: AT.switcher, base: [0.034, 0.034, 0.05], glowA: [0.1, 0.09, 0.19], glowB: [0.08, 0.07, 0.15], horizon: NO_HORIZON, drift: [0, 0], motes: [0.8, 0.78, 1] },
  { t: AT.review, base: [0.036, 0.035, 0.052], glowA: [0.11, 0.09, 0.19], glowB: [0.09, 0.08, 0.16], horizon: NO_HORIZON, drift: [0, 0], motes: [0.85, 0.8, 1] },
  { t: AT.pulls, base: [0.036, 0.033, 0.052], glowA: [0.13, 0.085, 0.18], glowB: [0.1, 0.075, 0.15], horizon: NO_HORIZON, drift: [0, 0], motes: [0.92, 0.82, 1] },
  { t: AT.source, base: [0.018, 0.019, 0.034], glowA: [0.035, 0.045, 0.13], glowB: [0.06, 0.035, 0.1], horizon: NO_HORIZON, drift: [0, 0], motes: [0.6, 0.64, 1] },
  { t: AT.finale, base: [0.011, 0.012, 0.022], glowA: [0.02, 0.028, 0.08], glowB: [0.035, 0.025, 0.07], horizon: NO_HORIZON, drift: [0, 0], motes: [0.55, 0.58, 0.95] },
  { t: AT.finale + FINALE.finished - 1.4, base: [0.012, 0.013, 0.024], glowA: [0.025, 0.03, 0.085], glowB: [0.04, 0.028, 0.075], horizon: NO_HORIZON, drift: [0, 0], motes: [0.55, 0.58, 0.95] },
  { t: AT.finale + FINALE.finished + 1.4, base: [0.02, 0.021, 0.04], glowA: [0.045, 0.05, 0.13], glowB: [0.06, 0.05, 0.12], horizon: [0.33, 0.2, 0.37], drift: [0, 0], motes: [1, 0.9, 0.92] },
];

function skyAt(t: number): Backdrop {
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1].t <= t) i++;
  const a = SKY[i];
  const b = SKY[i + 1];
  const k = smooth(span(t, Math.max(a.t, b.t - 2.6), b.t));
  const rgb = (x: Rgb, y: Rgb): Rgb => mix3(x as Vec3, y as Vec3, k);
  return {
    base: rgb(a.base, b.base),
    glowA: rgb(a.glowA, b.glowA),
    glowB: rgb(a.glowB, b.glowB),
    horizon: rgb(a.horizon, b.horizon),
    drift: [t * 0.012, t * 0.004],
    motes: rgb(a.motes, b.motes),
  };
}

/** One secondary thread's ribbon out of its Activity card. */
interface Lane {
  path: Path;
  /** How far it has grown once it's out, and how fast it keeps going. */
  reach: number;
  speed: number;
  stops?: number;
  tint: Rgb;
}

interface CouncilStrand {
  path: Path;
  /** Distance at which it's behind its reviewer's pane. */
  hidden: number;
  tint: Rgb;
}

export interface Frame {
  camera: CameraState;
  scene: Omit<Scene, "viewProj" | "eye" | "occluders">;
  /** 0 clear, 1 black. */
  black: number;
  clock: string;
  computer: string;
  slug: number;
}

export class Story {
  private readonly activity = new Activity();
  private readonly switcher = new Switcher();
  private readonly review = new Review();
  private readonly pulls = new Pulls();
  private readonly source = new SourceDesk();
  private readonly target = new TargetDesk();
  private readonly finale: Finale;
  private readonly camera: Camera;
  private readonly hero: Path;
  private readonly lanes: Lane[] = [];
  private readonly council: CouncilStrand[] = [];
  private readonly marks: Record<string, number> = {};
  private readonly headKeys: [number, number][];

  constructor(stage: Stage) {
    const { activity, switcher, review, pulls, source, target } = this;

    // Where everything stands. One world unit is one CSS pixel at scale 1.
    activity.panel.scale = 1.36;
    activity.panel.pos = [-260, 0, 0];
    activity.panel.turn(0.14);

    switcher.composer.scale = 1.35;
    switcher.composer.pos = [2500, -120, 250];
    switcher.composer.turn(-0.05);
    switcher.drum.scale = 1.35;
    switcher.drum.right = switcher.composer.right;
    switcher.drum.up = switcher.composer.up;
    switcher.drum.pos = switcher.composer.point(137, -113, 46);

    review.panel.scale = 1.3;
    review.panel.pos = [5000, 60, -150];
    review.panel.turn(0.06);

    pulls.panel.scale = 1.15;
    pulls.panel.pos = [7500, -60, 200];
    pulls.panel.turn(-0.07);

    source.panel.scale = 1.11;
    source.panel.pos = [10100, 0, 0];
    source.panel.turn(0.16);
    source.tag();

    target.panel.scale = 1.11;
    target.panel.pos = [12800, 300, -500];
    target.panel.turn(-0.16);
    target.tag();

    this.finale = new Finale([16500, 1650, -400]);
    const { finale } = this;

    for (const panel of [
      activity.panel,
      switcher.composer,
      switcher.drum,
      review.panel,
      pulls.panel,
      source.panel,
      source.label,
      target.panel,
      target.label,
      finale.mark,
      finale.name,
      finale.status,
    ])
      stage.add(panel);

    // The ribbon the film follows: in from the dark, out of the hero's card,
    // through the day's work, across to the other computer, and into the R.
    const knots: Knot[] = [];
    const knot = (name: string, p: Vec3, more: Partial<Knot> = {}) => {
      this.marks[name] = knots.length;
      knots.push({ p, ...more });
    };
    const [, heroY] = activity.lane(0);
    const act = activity.panel;
    const cmp = switcher.composer;
    const rev = review.panel;
    const pul = pulls.panel;
    const src = source.panel;
    const tgt = target.panel;
    const [bx, by] = source.buttonAt();

    // It opens lying flat under the lens like a road, and banks to face the
    // camera by the time it reaches the sidebar.
    knot("far", [-3060, 113, 1623], { width: HERO_WIDTH, face: [0, 1, 0], roll: 0.42 });
    knot("in1", [-2568, 101, 1126], { roll: 0.3 });
    knot("in2", [-1914, 111, 507], { face: [0, 1, 0.25], roll: 0.1 });
    knot("in3", [-1280, 290, -70], { face: [0, 0.4, 1], roll: 0 });
    knot("enter", act.point(110, heroY, -70), { face: [0, 0, 1] });
    knot("emerge", act.point(326, heroY, -34));
    knot("out1", [430, 316, 120]);
    knot("out2", [860, 230, 230], { roll: 0.5 });
    knot("out3", [1380, 40, 300], { roll: 1 });
    knot("compose", cmp.point(-150, 96, -44), { roll: 1.04 });
    knot("through", cmp.point(560, 112, -50));
    knot("clearing", cmp.point(800, 96, -30));
    // It waits in a curl beside the composer until the message is sent.
    knot("park", cmp.point(925, 10, 60));
    knot("launch", cmp.point(985, -90, 110));
    knot("swoop", [3620, -330, 470], { roll: 1.5 });
    knot("rise", [4060, -150, 210], { roll: 2 });
    knot("split", add(rev.pos, [-960, -40, 90]));
    // Every ribbon that goes behind a panel is behind its plane before it
    // reaches the edge; crossing inside would cut it off along a hard line.
    knot("tuck", rev.point(-70, 400, -90));
    knot("lead", rev.point(470, 380, -120));
    knot("clear", rev.point(1000, 430, -70));
    knot("merge", rev.point(1250, 500, -150));
    knot("on1", [6380, -340, 270], { roll: 2.5 });
    knot("pulls", pul.point(-170, 520, -90), { roll: 3 });
    knot("behind", pul.point(550, 330, -120));
    knot("past", pul.point(1270, 150, -90));
    knot("on2", [9050, 270, 300], { roll: 3.5 });
    knot("desk", add(src.pos, [-1010, -70, 60]), { roll: 4 });
    knot("slip", src.point(-80, 470, -90));
    knot("under", src.point(560, 440, -110));
    knot("wait", src.point(bx - 30, by + 170, -100));
    // Out over the top of the window, right above the hand-off button.
    knot("pierce", src.point(bx, -46, -60));
    knot("off", src.point(bx + 90, -270, 110));
    knot("arc1", add(src.pos, [1100, 930, 500]), { roll: 4.5 });
    knot("arc2", [11950, 1120, 60], { roll: 5 });
    // And in behind the same place on the other computer's window.
    knot("near", tgt.point(bx - 190, -330, 260));
    knot("land", tgt.point(bx, -46, -60));
    knot("inside", tgt.point(bx + 50, by + 190, -130));
    knot("above", tgt.point(1420, 150, -120));
    knot("climb", [14700, 1450, -650], { roll: 6 });
    // Into the stem along its own direction, in steps that shorten towards
    // the tip so the curve doesn't swing wide of it.
    const tip = finale.at(115, 64);
    const along: Vec3 = [0.74, -0.67, 0];
    for (const [i, back] of [900, 520, 280, 130, 50].entries())
      knot(`lead${i}`, add(tip, scale(along, -back)), {
        // Narrowing towards the stem's own width, and done turning.
        width: HERO_WIDTH * [1, 0.92, 0.8, 0.64, 0.46][i],
      });
    this.marks.tip = knots.length;
    knots.push(...finale.knots(6));
    this.marks.tail = knots.length - 1;
    this.hero = new Path(knots);

    const at = (name: string) => this.hero.knot(this.marks[name]);
    const hold = (name: string, by = 0) => at(name) + by;
    this.headKeys = [
      [0, at("in1") + 150],
      [1.5, at("in2")],
      [3.0, at("in3")],
      [4.3, at("enter")],
      [5.4, at("emerge")],
      [8.0, at("out1")],
      [11.6, at("out2")],
      [13.7, at("out3")],
      [15.0, at("compose")],
      [16.4, at("park")],
      [AT.switcher + SENT - 0.05, hold("park")],
      [AT.switcher + SENT + 0.2, at("launch")],
      [23.2, at("swoop")],
      [23.9, at("rise")],
      [AT.review + 0.7, at("split")],
      [25.2, at("tuck")],
      [26.5, at("lead")],
      [AT.review + REVIEW.handover - 0.5, at("clear")],
      [AT.review + REVIEW.handover, at("merge")],
      [AT.review + REVIEW.leave - 0.4, hold("merge", 160)],
      [36.4, at("on1")],
      [37.0, at("pulls")],
      [38.0, at("behind")],
      [39.0, at("past")],
      [42.7, at("on2")],
      [43.5, at("desk")],
      [44.0, at("slip")],
      [44.5, at("under")],
      [45.1, at("wait")],
      [AT.source + HANDOFF.sent - 0.05, hold("wait")],
      [AT.source + HANDOFF.sent + 0.18, at("pierce")],
      [49.4, at("off")],
      [50.5, at("arc1")],
      [51.5, at("arc2")],
      [52.15, at("near")],
      [AT.landed, at("land")],
      [52.9, at("inside")],
      [56.6, hold("inside")],
      [57.4, at("above")],
      [58.2, at("climb")],
      [AT.finale, at("tip")],
      [AT.finale + FINALE.drawn, at("tail")],
    ];

    // The other threads: a thinner ribbon out of each card.
    // Each as offsets from where it comes out, then how far it has grown,
    // how fast it keeps growing, and when it stops.
    const laneSpec: [Vec3[], number, number, number?][] = [
      [[[140, 8, 70], [330, 20, 110]], 250, 0],
      [[[300, 40, -60], [900, 190, -380], [1650, 380, -860], [2450, 500, -1450]], 620, 150, ACTIVITY.finished],
      [[[300, -50, 130], [880, -230, 400], [1530, -430, 600], [2280, -560, 780]], 300, 190],
      [[[130, -6, 60], [290, -20, 90]], 200, 0],
      [[[150, -10, 70], [330, -28, 100]], 240, 0],
    ];
    laneSpec.forEach(([offsets, reach, speed, stops], n) => {
      const index = n + 1;
      const [, y] = activity.lane(index);
      const agent = THREADS[index].agents[0];
      const out = act.point(326, y, -30);
      const path = new Path([
        { p: act.point(170, y, -60), width: 27 },
        { p: out },
        ...offsets.map((offset) => ({ p: add(out, offset) })),
      ]);
      this.lanes.push({
        path,
        reach: path.knot(1) + reach,
        speed,
        stops,
        tint: mix3([1, 1, 1], agentColor[agent], 0.2),
      });
    });

    // The council: one strand per reviewer, behind its pane, then back together.
    const split = knots[this.marks.split].p;
    const merge = knots[this.marks.merge].p;
    REVIEWERS.forEach((reviewer, i) => {
      const [px, py] = review.paneCentre(i);
      // Top panes take the upper strands, so the fan never crosses itself.
      const spread = ((i < 2 ? 1 : -1) * (i % 2 ? 1 : 2.4)) * 30;
      const path = new Path([
        { p: add(split, [-420, spread * 0.25, 0]), width: 17 },
        { p: add(split, [0, spread, 0]) },
        { p: rev.point(-60, lerp(400, py, 0.45) - spread * 0.4, -80) },
        { p: rev.point(px - 150, py, -70) },
        { p: rev.point(px + 150, py, -70) },
        { p: rev.point(985, lerp(py, 430, 0.6) + spread * 0.5, -60) },
        { p: add(merge, [-10, spread * 0.6, 0]) },
        { p: add(merge, [330, spread * 0.15, 40]) },
      ]);
      this.council.push({
        path,
        hidden: (path.knot(3) + path.knot(4)) / 2,
        tint: mix3([1, 1, 1], agentColor[reviewer.agent], 0.34),
      });
    });

    this.camera = new Camera(this.shots(), stage.width / stage.height);
  }

  private shots(): CameraKey[] {
    const { switcher, review, pulls, source, target, finale } = this;
    const shot = (
      t: number,
      target: Vec3,
      distance: number,
      yaw = 0,
      pitch = 0,
      roll = 0,
    ): CameraKey => ({
      t,
      target,
      roll,
      eye: add(target, [
        Math.sin(yaw) * Math.cos(pitch) * distance,
        Math.sin(pitch) * distance,
        Math.cos(yaw) * Math.cos(pitch) * distance,
      ]),
    });
    const compose = add(switcher.composer.pos, [0, 150, 0]);
    const council = review.panel.pos;
    const board = pulls.panel.pos;
    const desk = source.panel.pos;
    const mini = target.panel.pos;
    return [
      shot(0, [-1900, 200, 450], 1250, -0.78, 0.02),
      shot(1.5, [-1870, 200, 420], 1240, -0.77, 0.02),
      shot(3.0, [-1420, 230, 60], 1450, -0.46, 0.02),
      shot(4.2, [-760, 170, -120], 1680, -0.08, 0.01),
      shot(5.6, [150, 0, 0], 1820, -0.07, 0.01),
      shot(9.6, [220, -10, 0], 1740, 0.04, 0),
      shot(13.3, [330, -20, 0], 1700, 0.1, 0),
      shot(15.8, add(compose, [70, 0, 0]), 1720, -0.09, 0.02),
      shot(19.2, add(compose, [90, 0, 0]), 1620, 0.02, 0.01),
      shot(22.4, add(compose, [120, -10, 0]), 1660, 0.08, 0),
      shot(24.3, council, 2080, -0.06, 0.01),
      shot(30, add(council, [20, 0, 0]), 2020, 0.03, 0),
      shot(35.8, add(council, [70, -10, 0]), 2050, 0.1, 0),
      shot(37.5, board, 1860, -0.14, 0.02),
      shot(42.2, add(board, [50, 0, 0]), 1800, -0.02, 0),
      shot(44.2, add(desk, [0, 26, 0]), 2020, 0.08, 0.01),
      shot(48.7, add(desk, [20, 20, 0]), 1900, 0.13, 0.012),
      shot(50.4, [11350, 700, 200], 2700, -0.1, 0.05, 0.03),
      shot(52.3, add(mini, [0, 26, 0]), 2020, -0.22, 0.02),
      shot(54.0, add(mini, [0, 20, 0]), 1920, -0.16, 0.01),
      shot(55.7, [11440, 470, -250], 4750, -0.02, 0.05),
      shot(57.3, [11480, 500, -250], 4650, 0, 0.045),
      shot(AT.finale + 0.5, add(finale.focus, [-120, 90, 0]), 2750, -0.1, 0.02),
      shot(AT.finale + FINALE.tied, finale.focus, 2420, 0, 0),
      shot(DURATION, finale.focus, 2330, 0, 0),
    ];
  }

  /** Distance along the hero path of a named knot. */
  private at(name: string) {
    return this.hero.knot(this.marks[name]);
  }

  private head(t: number) {
    const keys = this.headKeys;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++)
      if (t < keys[i][0]) {
        const [t0, d0] = keys[i - 1];
        const [t1, d1] = keys[i];
        const k = span(t, t0, t1);
        // A hold on either side eases; a run between two runs keeps its pace.
        const stillBefore = i < 2 || keys[i - 2][1] === d0;
        const stillAfter = i + 1 >= keys.length || keys[i + 1][1] === d1;
        const eased = stillBefore && stillAfter
          ? easeInOut(k, 2)
          : stillBefore
            ? k * k * (2 - k)
            : stillAfter
              ? 1 - (1 - k) * (1 - k) * (1 + k)
              : k;
        return lerp(d0, d1, eased);
      }
    return keys[keys.length - 1][1];
  }

  frame(t: number): Frame {
    const { activity, switcher, review, pulls, source, target, finale } = this;
    const strands: Strand[] = [];

    // Panels and their scenes.
    const shown = (from: number, to: number) =>
      Math.min(smooth(span(t, from, from + 0.9)), 1 - smooth(span(t, to, to + 0.8)));
    activity.panel.opacity = shown(3.9, 15.6);
    activity.update(t - AT.activity);
    switcher.composer.opacity = shown(13.6, 23.3);
    switcher.update(t - AT.switcher);
    switcher.drum.opacity *= switcher.composer.opacity;
    review.panel.opacity = shown(22.5, 36.3);
    review.update(t - AT.review);
    pulls.panel.opacity = shown(35.1, 43.7);
    pulls.update(t - AT.pulls);

    const since = t - AT.landed;
    const lapse = easeInOut(span(t, TIME_LAPSE[0], TIME_LAPSE[1]), 2);
    const worked = Math.max(0, since) + lapse * NIGHT_SHIFT;
    const finished = t >= TIME_LAPSE[1];
    const leaving = 1 - smooth(span(t, 60.6, 61.8));
    source.panel.opacity = Math.min(smooth(span(t, 42.4, 43.4)), leaving);
    source.label.opacity = source.panel.opacity * 0.9;
    source.update(t - AT.source, since, remoteCall(worked));
    // Once the thread is away, its computer can go quiet.
    const asleep = smooth(span(t, AT.landed + 1.4, AT.landed + 3.4));
    source.panel.el.style.filter = asleep > 0 ? `brightness(${(1 - 0.22 * asleep).toFixed(3)})` : "";
    target.panel.opacity = Math.min(smooth(span(t, 48.9, 49.8)), leaving);
    target.label.opacity = target.panel.opacity * 0.9;
    target.update(since, worked, finished);
    finale.update(t - AT.finale);

    // The hero ribbon.
    const head = this.head(t);
    const tip = this.at("tip");
    const gather = smoother(span(t, AT.finale + 1.2, AT.finale + FINALE.tied));
    const tail = Math.min(lerp(Math.max(0, head - TRAIL), tip, gather), head);
    const crisp = span(t - AT.finale, FINALE.crisp[0], FINALE.crisp[1]);
    const glints: Glint[] = [];
    // A soft light rides just behind the head while it's on the move.
    glints.push({ at: head - 90, width: 260, strength: 0.16 });
    for (const { at, preset } of SWITCHES) {
      const k = span(t, AT.switcher + at, AT.switcher + at + 0.7);
      if (k > 0 && k < 1)
        glints.push({
          at: lerp(this.at("out3"), this.at("park") + 60, k),
          width: 190,
          strength: 1.1 * Math.sin(Math.PI * Math.min(1, k * 1.25)),
          color: agentColor[preset.agent],
        });
    }
    for (let i = 0; i < 5; i++) {
      const k = span(t, AT.review + REVIEW.fixed(i), AT.review + REVIEW.fixed(i) + 0.6);
      if (k > 0 && k < 1)
        glints.push({
          at: lerp(this.at("lead"), this.at("merge") + 160, k),
          width: 130,
          strength: 0.8 * Math.sin(Math.PI * k),
          color: [0.3, 0.76, 0.54],
        });
    }
    const approved = span(t, AT.pulls + PULLS.approved, AT.pulls + PULLS.approved + 0.9);
    if (approved > 0 && approved < 1)
      glints.push({
        at: lerp(this.at("pulls") - 300, this.at("past") + 200, approved),
        width: 240,
        strength: 0.7 * Math.sin(Math.PI * approved),
      });
    const sweep = span(t - AT.finale, FINALE.tied + 0.1, FINALE.crisp[1] + 0.2);
    if (sweep > 0 && sweep < 1)
      glints.push({
        at: lerp(tip, this.at("tail"), easeInOut(sweep, 2)),
        width: 260,
        strength: 0.55 * Math.sin(Math.PI * sweep),
      });

    // The leg deepens to violet and the tuck under the bowl sits in shade, as in the mark.
    const tuck = [this.hero.knot(this.marks.tip + 19), this.hero.knot(this.marks.tip + 22)];
    const leg = this.hero.knot(this.marks.tip + 23);
    const end = this.at("tail");
    const markTint = (d: number): Rgb => {
      const shade = Math.min(span(d, tuck[0] - 12, tuck[0] + 26), 1 - span(d, tuck[1] - 20, tuck[1] + 24));
      const violet = smooth(span(d, leg, end));
      // Lighter than the travelling ribbon, to meet the mark it becomes.
      const base = mix3([1.16, 1.16, 1.1], [0.72, 0.66, 1.02], violet * 0.85);
      return mix3(base, [0.6, 0.56, 0.74], clamp(shade));
    };
    if (head > tail) {
      if (tail < tip)
        strands.push({
          path: this.hero,
          from: tail,
          to: Math.min(head, tip),
          taperTail: 620,
          taperHead: head < tip ? 460 : 0,
          glints,
        });
      if (head > tip)
        strands.push({
          path: this.hero,
          from: Math.max(tail, tip),
          to: head,
          taperHead: lerp(300, 60, span(head, end - 500, end)),
          taperTail: tail >= tip ? 150 : 0,
          alpha: 1 - crisp,
          reverse: 0,
          // The mark is drawn, not lit: the glow goes as the ribbon ties.
          halo: 0.45 * (1 - smooth(span(t - AT.finale, FINALE.drawn - 1.5, FINALE.tied))),
          tint: markTint,
          glints,
        });
    }

    // Bring back: the light runs the R the other way.
    const back = span(t - AT.finale, FINALE.bring + 0.1, FINALE.bring + 1.2);
    if (back > 0 && back < 1)
      strands.push({
        path: this.hero,
        from: tip,
        to: end,
        glintOnly: true,
        glints: [
          {
            at: lerp(end + 150, tip - 150, easeInOut(back, 2)),
            width: 280,
            strength: 1.1,
          },
        ],
      });

    // The other threads.
    const u = t - AT.activity;
    const lanesOut = 1 - smooth(span(t, 14.6, 16.2));
    if (lanesOut > 0)
      this.lanes.forEach((lane, i) => {
        const born = 0.75 + (i + 1) * 0.13;
        const grown = easeOut(span(u, born, born + 1.3));
        if (grown <= 0) return;
        const running = Math.max(0, Math.min(u, lane.stops ?? 1e9) - born);
        const to = Math.min(lane.path.length, lane.reach * grown + lane.speed * running);
        const lit: Glint[] = [];
        if (lane.speed > 0 && (lane.stops === undefined || u < lane.stops)) {
          const k = (u * 0.42 + i * 0.37) % 1;
          lit.push({ at: lerp(lane.path.knot(1), to, k), width: 150, strength: 0.42 * Math.sin(Math.PI * k) });
        }
        if (i === 0)
          // Needs input: an amber light that waits at its end.
          lit.push({ at: to - 70, width: 120, strength: 0.5 + 0.28 * Math.sin(u * 3.1), color: [0.85, 0.6, 0.17] });
        strands.push({
          path: lane.path,
          from: 0,
          to,
          taperHead: Math.min(220, to * 0.45),
          tint: lane.tint,
          alpha: lanesOut,
          glints: lit,
        });
      });

    // The council.
    const r = t - AT.review;
    const councilAlpha = Math.min(
      lerp(1, 0.4, smooth(span(r, REVIEW.report, REVIEW.report + 0.8))),
      1 - smooth(span(t, 35.9, 36.9)),
    );
    if (r > REVIEW.council && councilAlpha > 0)
      this.council.forEach((strand, i) => {
        const reviewer = REVIEWERS[i];
        const first = reviewer.calls[0][0];
        const inward = easeOut(span(r, REVIEW.council + i * 0.08, first + 0.1));
        const outward = smooth(span(r, reviewer.done, REVIEW.handover + 0.1));
        const to = lerp(strand.hidden * inward, strand.path.length, outward);
        if (to < 2) return;
        const lit: Glint[] = [];
        if (r > first && r < reviewer.done) {
          const k = (r * 1.1 + i * 0.29) % 1;
          lit.push({ at: lerp(0, strand.hidden, k), width: 130, strength: 0.5 * Math.sin(Math.PI * k) });
        }
        strands.push({
          path: strand.path,
          from: 0,
          to,
          taperTail: 300,
          taperHead: outward >= 1 ? 260 : 120,
          tint: strand.tint,
          alpha: councilAlpha,
          glints: lit,
        });
      });

    const minutes =
      t < AT.landed
        ? track(CLOCK, t)
        : hm(23, 11) + (lapse * NIGHT_SHIFT) / 60;
    const day = Math.floor(minutes) % 1440;
    const clock = `${String(Math.floor(day / 60)).padStart(2, "0")}:${String(day % 60).padStart(2, "0")}`;

    return {
      camera: this.camera.at(t),
      scene: {
        light: [-0.42, 0.66, 0.62],
        time: t,
        exposure: 1,
        strands,
        backdrop: skyAt(t),
      },
      black: Math.max(
        1 - smooth(span(t, 0.1, 1.3)),
        smooth(span(t - AT.finale, FINALE.black[0], FINALE.black[1])),
      ),
      clock,
      computer: t < AT.landed - 1.2 ? SOURCE : TARGET,
      slug: Math.min(
        smooth(span(t, 1.6, 2.8)),
        1 - 0.999 * smooth(span(Math.abs(t - (AT.landed - 1.2)), 0.5, 0)),
        1 - smooth(span(t - AT.finale, FINALE.black[0] - 0.3, FINALE.black[0])),
      ),
    };
  }
}
