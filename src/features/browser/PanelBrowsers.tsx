import type { PanelTabs } from "../panel/panel-tabs";
import { BrowserSurface } from "./BrowserSurface";

/** A browser per Browser tab: the thread's own, and the pages opened beside it. */
export function PanelBrowsers({
  panel,
  projectId,
  chatId,
  draftKey,
}: {
  panel: PanelTabs;
  projectId: string;
  chatId: string | null;
  draftKey: string;
}) {
  return panel.tabs
    .filter((tab) => tab.surface === "browser")
    .map((tab) => (
      <div
        key={tab.key}
        className="panel-body"
        hidden={panel.front?.key !== tab.key}
      >
        <BrowserSurface
          projectId={projectId}
          chatId={chatId}
          page={tab.page}
          front={panel.front?.key === tab.key}
          draftKey={draftKey}
        />
      </div>
    ));
}
