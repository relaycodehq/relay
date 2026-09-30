// Centrelines for "elay", in the R's own coordinates (the inner group of
// assets/relay-mark.svg). Baseline ~495 where the R's leg lands; x-height ~335.
import { FOLD, type RibbonStep } from "./wordmark-ribbon";

// The pen lifts once, before the a, the way the R's leg meets the e.
const el: RibbonStep[] = [
  // e: out of the leg's curl, up into the loop, round and out
  [497, 500, 1, 85],
  [525, 478, 7, 55],
  [565, 452, 12, 25],
  [615, 420, 13, 5],
  [655, 385, 13, -10],
  [670, 352, 12, -30],
  [655, 327, 10, -60],
  [622, 322, 10, -45],
  [590, 345, 12, -20],
  [573, 395, 13, 0],
  [578, 450, 13, 20],
  [602, 487, 12, 30],
  [642, 497, 12, 20],
  [685, 478, 12, 5],
  [718, 445, 12, -10],
  // l, ending in a tail that points at the a
  [752, 390, 12, -15],
  [785, 300, 12, -25],
  [805, 215, 12, -35],
  [806, 165, 10, -55],
  [787, 145, 9, -82],
  [765, 163, 10, -45],
  [757, 230, 12, -15],
  [760, 330, 13, 5],
  [767, 430, 13, 20],
  [785, 488, 12, 30],
  [815, 497, 10, 20],
  [845, 482, 6, 45],
  [862, 462, 1, 80],
];

const ay: RibbonStep[] = [
  // a: round the bowl, fold, down the stem
  [985, 352, 1, 80],
  [965, 336, 7, 50],
  [935, 330, 10, 20],
  [903, 340, 12, 0],
  [883, 375, 13, -15],
  [878, 425, 13, -10],
  [890, 475, 13, 10],
  [918, 496, 12, 25],
  [950, 488, 12, 20],
  [972, 450, 12, 0],
  [983, 400, 12, -15],
  [990, 355, 12, -20],
  [1004, 336, 10, -15],
  FOLD,
  [1000, 400, 13, 10],
  [998, 465, 13, 15],
  [1016, 494, 12, 20],
  [1048, 488, 12, 10],
  [1076, 450, 12, -10],
  // y: first arm, fold, second arm, fold, the long tail
  [1092, 395, 12, -20],
  [1098, 355, 12, -20],
  [1112, 336, 10, -15],
  FOLD,
  [1108, 400, 13, 10],
  [1108, 462, 13, 15],
  [1129, 494, 12, 25],
  [1162, 482, 12, 10],
  [1182, 430, 12, -10],
  [1190, 360, 12, -20],
  [1204, 338, 10, -15],
  FOLD,
  [1196, 420, 13, 5],
  [1190, 520, 13, 10],
];

/** The y's tail loops back and flicks out to the right. */
const loopTail: RibbonStep[] = [
  [1174, 600, 13, 20],
  [1146, 652, 12, 35],
  [1114, 662, 10, 50],
  [1098, 640, 10, 30],
  [1119, 592, 12, 10],
  [1169, 556, 12, -5],
  [1229, 532, 9, -20],
  [1279, 518, 5, -45],
  [1309, 514, 1, -80],
];

/** The y's tail sweeps back under the word and thins out beneath the e. */
const swashTail: RibbonStep[] = [
  [1174, 600, 13, 20],
  [1140, 645, 13, 35],
  [1080, 668, 12, 45],
  [980, 676, 12, 30],
  [860, 667, 11, 10],
  [740, 647, 9, -15],
  [640, 628, 5, -45],
  [580, 618, 1, -80],
];

export const joined: RibbonStep[][] = [el, [...ay, ...loopTail]];
export const swash: RibbonStep[][] = [el, [...ay, ...swashTail]];
