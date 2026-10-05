// Threads another thread's agent started through Relay's tools, grouped under
// that lead the same way in the desktop's Activity and the phone's.
import type { StartedBy } from "./projects";

/** What grouping reads; the phone's thread summaries carry just these. */
export interface FamilyMember {
  id: string;
  created: number;
  startedBy?: StartedBy;
  running?: boolean;
  waiting?: boolean;
  pending?: readonly unknown[];
}

/**
 * Activity's cards: threads another thread's agent started sit under their
 * lead, in the order they were started. A settled lead whose threads still
 * show comes back as a header above them, where the first of them would be;
 * `cards` is `top` without those headers.
 */
export function startedFamilies<C extends FamilyMember>(
  active: C[],
  settled: C[] = [],
) {
  const listed = new Set(active.map((c) => c.id));
  const resting = new Map(settled.map((c) => [c.id, c]));
  const started = new Map<string, C[]>();
  for (const c of active) {
    const lead = c.startedBy?.chatId;
    if (lead && (listed.has(lead) || resting.has(lead)))
      started.set(lead, [...(started.get(lead) ?? []), c]);
  }
  for (const children of started.values())
    children.sort((a, b) => a.created - b.created);
  const top: C[] = [];
  const headers = new Set<string>();
  for (const c of active) {
    const lead = c.startedBy?.chatId ?? "";
    if (!started.has(lead)) top.push(c);
    else if (resting.has(lead) && !headers.has(lead)) {
      headers.add(lead);
      top.push(resting.get(lead)!);
    }
  }
  return {
    top,
    cards: top.filter((c) => !headers.has(c.id)),
    started,
    /** Settled leads shown as headers, which the Settled shelf leaves out. */
    headers,
  };
}
export type StartedFamilies<C extends FamilyMember = FamilyMember> = ReturnType<
  typeof startedFamilies<C>
>;

/** "4 threads · 1 working · 1 needs you", on the lead's card. */
export function familyLine(started: readonly FamilyMember[]) {
  const asking = started.filter((c) => c.waiting).length;
  const working = started.filter((c) => c.running && !c.waiting).length;
  return [
    `${started.length} thread${started.length === 1 ? "" : "s"}`,
    working && `${working} working`,
    asking && `${asking} need${asking === 1 ? "s" : ""} you`,
    !working && !asking && "all done",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Every thread in the family is done and read: it folds until something happens. */
export const familySettled = <C extends FamilyMember>(
  started: readonly C[],
  unread: (c: C) => boolean,
) =>
  started.every(
    (c) => !c.running && !c.waiting && !c.pending?.length && !unread(c),
  );
