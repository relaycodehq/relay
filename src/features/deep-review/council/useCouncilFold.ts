import { useEffect, useState } from "react";

/** A council's panes, open while it works and folded once it has `settled`. */
export function useCouncilFold(settled: boolean) {
  const [open, setOpen] = useState(!settled);
  useEffect(() => {
    if (settled) setOpen(false);
  }, [settled]);
  return { open, toggle: () => setOpen((v) => !v) };
}
