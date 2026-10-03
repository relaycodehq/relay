import type { Finding, FindingStatus } from "../../../shared/deep-review";

/** The urgent ones start ticked. */
export const firstPicks = (open: Finding[]) =>
  open.filter((f) => f.priority <= "P1").map((f) => f.id);

/** Fix all's label: the open ones, and whether others were fixed or dismissed already. */
export function fixAllLabel(open: number, total: number) {
  return !open
    ? "Fix all"
    : open < total
      ? `Fix the other ${open}`
      : `Fix all ${open}`;
}

export const findingStatus = (
  statuses: Record<string, FindingStatus> | undefined,
  id: string,
) => statuses?.[id] ?? "open";
