import type { PanelTabs } from "../panel/panel-tabs";
import { BrowserSurface } from "./BrowserSurface";
import { previewKey } from "./previews";

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
        {/* Another thread's tab of the same name gets a browser of its own. */}
        <BrowserSurface
          key={previewKey(projectId, chatId, tab.page)}
          projectId={projectId}
          chatId={chatId}
          page={tab.page}
          front={panel.front?.key === tab.key}
          draftKey={draftKey}
        />
      </div>
    ));
}
