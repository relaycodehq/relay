import { useEffect, useMemo, useState } from "react";
import type { PanelTabs } from "../features/panel/panel-tabs";
import type { ThreadPreviewPanel } from "../features/browser/TurnPreview";

/**
 * What the previews under a thread's answers know of its panel. Answers left
 * since the agent last opened a page the user hasn't looked at carry the
 * titlebar's unseen dot; one already unseen when the thread opens marks all.
 */
export function useThreadPreviewPanel(
  projectId: string,
  panel: PanelTabs,
  open: boolean,
  show: () => void,
): ThreadPreviewPanel {
  const unseen =
    !!panel.unseen &&
    panel.tabs.find((t) => t.key === panel.unseen)?.surface === "browser";
  const [unseenSince, setUnseenSince] = useState<number | null>(() =>
    unseen ? 0 : null,
  );
  useEffect(
    () => setUnseenSince((since) => (unseen ? (since ?? Date.now()) : null)),
    [unseen],
  );
  const showing = open && panel.front?.surface === "browser";
  return useMemo(
    () => ({ projectId, showing, unseenSince, show }),
    [projectId, showing, unseenSince, show],
  );
}
