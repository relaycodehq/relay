/**
 * Splits a tracked working day across projects. The day's wall-clock time
 * (minus pauses) is the budget and is always handed out in full: every
 * moment goes to the projects that own it, split equally, or stays
 * unassigned. A moment's owners are the projects with an agent turn running
 * then, plus the project the person last touched, while that touch is
 * younger than the idle cap. The minutes between starting the timer and the
 * first touch go to that first project.
 */

/** An agent turn, from its prompt to its answer. */
export interface TurnRun {
  projectId: string;
  chatId: string;
  start: number;
  end: number;
}
/** A moment the person was on a project: a prompt, an answer read, a thread open. */
export interface Touch {
  projectId: string;
  chatId?: string;
  at: number;
}
export interface WorkSpan {
  start: number;
  end: number;
  pauses: { start: number; end?: number }[];
}
export interface AttributionOptions {
  /** How long a touch keeps its project busy without anything else happening. */
  idleCap: number;
  /** Longer turns are cut here and flagged; Relay stamps a turn it reattaches after a restart when it notices it ended. */
  maxTurn: number;
  /** Shorter pieces join another piece of their project in the same stretch. */
  minBlock: number;
  /** Projects that are tracked; the rest count as "other". */
  included: (projectId: string) => boolean;
}
export interface TimePiece {
  /** Null when nobody owns it: idle time, or projects that aren't tracked. */
  projectId: string | null;
  reason?: "idle" | "other";
  start: number;
  end: number;
  chatIds: string[];
  /** Holds time from a turn that ran past `maxTurn`. */
  uncertain: boolean;
}

const IDLE = "\0idle";
const OTHER = "\0other";

interface Share {
  key: string;
  duration: number;
  chatIds: Set<string>;
  uncertain: boolean;
}

/** The span without its pauses, in order. */
export function workingStretches(span: WorkSpan) {
  const pauses = span.pauses
    .map((p) => ({ start: p.start, end: p.end ?? span.end }))
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cursor = span.start;
  for (const p of pauses) {
    if (p.start > cursor)
      out.push({ start: cursor, end: Math.min(p.start, span.end) });
    cursor = Math.max(cursor, p.end);
    if (cursor >= span.end) break;
  }
  if (cursor < span.end) out.push({ start: cursor, end: span.end });
  return out.filter((s) => s.end > s.start);
}

export function attributeTime(
  span: WorkSpan,
  turns: TurnRun[],
  touches: Touch[],
  options: AttributionOptions,
): TimePiece[] {
  const runs = turns
    .filter((t) => t.end > t.start)
    .map((t) => {
      const cut = t.end - t.start > options.maxTurn;
      return { ...t, end: cut ? t.start + options.maxTurn : t.end, cut };
    });
  // A turn's prompt and its answer are touches too.
  const points = [
    ...touches,
    ...runs.flatMap((r) => [
      { projectId: r.projectId, chatId: r.chatId, at: r.start },
      { projectId: r.projectId, chatId: r.chatId, at: r.end },
    ]),
  ].sort((a, b) => a.at - b.at);
  // Starting the timer is a touch of whatever comes first, if it comes soon.
  const first = points.find((p) => p.at >= span.start);
  if (first && first.at - span.start <= options.idleCap)
    points.splice(points.indexOf(first), 0, { ...first, at: span.start });
  const keyOf = (projectId: string) =>
    options.included(projectId) ? projectId : OTHER;

  const pieces: TimePiece[] = [];
  for (const stretch of workingStretches(span)) {
    const cuts = new Set([stretch.start, stretch.end]);
    const inside = (t: number) => t > stretch.start && t < stretch.end;
    for (const r of runs)
      for (const t of [r.start, r.end]) if (inside(t)) cuts.add(t);
    for (const p of points)
      for (const t of [p.at, p.at + options.idleCap])
        if (inside(t)) cuts.add(t);
    const bounds = [...cuts].sort((a, b) => a - b);

    const shares: Share[] = [];
    let latest = -1;
    for (let i = 0; i + 1 < bounds.length; i++) {
      const a = bounds[i],
        b = bounds[i + 1],
        mid = (a + b) / 2;
      while (latest + 1 < points.length && points[latest + 1].at <= mid)
        latest++;
      const owners = new Map<
        string,
        { chatIds: Set<string>; uncertain: boolean }
      >();
      const own = (projectId: string, chatId?: string, uncertain = false) => {
        const key = keyOf(projectId);
        const owner = owners.get(key) ?? {
          chatIds: new Set(),
          uncertain: false,
        };
        if (chatId && key !== OTHER) owner.chatIds.add(chatId);
        owner.uncertain ||= uncertain;
        owners.set(key, owner);
      };
      for (const r of runs)
        if (r.start < mid && r.end > mid) own(r.projectId, r.chatId, r.cut);
      const focus = latest >= 0 ? points[latest] : undefined;
      if (focus && mid - focus.at <= options.idleCap)
        own(focus.projectId, focus.chatId);
      if (!owners.size)
        owners.set(IDLE, { chatIds: new Set(), uncertain: false });
      // The owner the previous share went to first, so runs stay whole.
      const previous = shares.at(-1)?.key;
      const ordered = [...owners].sort(
        ([x], [y]) =>
          Number(y === previous) - Number(x === previous) || x.localeCompare(y),
      );
      for (const [key, owner] of ordered) {
        const duration = (b - a) / owners.size;
        const last = shares.at(-1);
        if (last?.key === key) {
          last.duration += duration;
          owner.chatIds.forEach((c) => last.chatIds.add(c));
          last.uncertain ||= owner.uncertain;
        } else shares.push({ key, duration, ...owner });
      }
    }
    pieces.push(
      ...layOut(
        absorbSmall(shares, options.minBlock),
        stretch.start,
        stretch.end,
      ),
    );
  }
  return pieces;
}

/** Moves each short share onto the nearest longer one of its project; totals stay exact. */
function absorbSmall(shares: Share[], minBlock: number): Share[] {
  let list = shares;
  for (;;) {
    const i = list.findIndex(
      (s, i) =>
        s.duration < minBlock &&
        list.some((o, j) => j !== i && o.key === s.key),
    );
    if (i < 0) return list;
    const small = list[i];
    let target = -1;
    for (let d = 1; target < 0 && d < list.length; d++) {
      if (list[i - d]?.key === small.key) target = i - d;
      else if (list[i + d]?.key === small.key) target = i + d;
    }
    const into = list[target];
    into.duration += small.duration;
    small.chatIds.forEach((c) => into.chatIds.add(c));
    into.uncertain ||= small.uncertain;
    list = merge(list.filter((_, j) => j !== i));
  }
}

function merge(shares: Share[]): Share[] {
  const out: Share[] = [];
  for (const s of shares) {
    const last = out.at(-1);
    if (last?.key === s.key) {
      last.duration += s.duration;
      s.chatIds.forEach((c) => last.chatIds.add(c));
      last.uncertain ||= s.uncertain;
    } else out.push(s);
  }
  return out;
}

/** Back to back from the stretch's start, the last one ending exactly at its end. */
function layOut(shares: Share[], start: number, end: number): TimePiece[] {
  let elapsed = 0;
  return shares.map((s, i) => {
    const from = start + Math.round(elapsed);
    elapsed += s.duration;
    const to = i === shares.length - 1 ? end : start + Math.round(elapsed);
    const projectId = s.key === IDLE || s.key === OTHER ? null : s.key;
    return {
      projectId,
      ...(projectId
        ? {}
        : { reason: s.key === IDLE ? ("idle" as const) : ("other" as const) }),
      start: from,
      end: to,
      chatIds: [...s.chatIds],
      uncertain: s.uncertain,
    };
  });
}
