import { useState } from "react";
import type { Finding, FindingStatus } from "../../../shared/deep-review";
import { findingStatus, firstPicks } from "./finding-picks";

/** The open findings, which of them are ticked to fix, and fixing some. */
export function useFindingPicks(
  findings: Finding[],
  statuses: Record<string, FindingStatus> | undefined,
  onFix: (findings: Finding[]) => void,
) {
  const open = findings.filter((f) => findingStatus(statuses, f.id) === "open");
  const [selected, setSelected] = useState<string[]>(() => firstPicks(open));
  const chosen = open.filter((f) => selected.includes(f.id));
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const fix = (list: Finding[]) => {
    setSelected((s) => s.filter((id) => !list.some((f) => f.id === id)));
    onFix(list);
  };
  return { open, selected, chosen, toggle, fix };
}
