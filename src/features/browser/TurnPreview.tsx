// The thread's preview as a turn's agent left it, under its answer. A quiet
// browser strip joins its saved frame; the panel button shares the titlebar's
// unseen dot and `active` while the panel shows the page.
import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe, PanelRight } from "lucide-react";
import type { TurnPreview as Preview } from "../../../shared/preview";
import { api } from "../../lib/api";
import { previewKey, usePreviewState } from "./previews";
import "../html-render/html-render.css";
import "../../ui/workspace-panes.css";
import "./turn-preview.css";

/** What the shell tells a thread's previews about its panel. */
export interface ThreadPreviewPanel {
  projectId: string;
  /** The panel is open with the Browser tab in front. */
  showing: boolean;
  /**
   * Since when the panel holds a page the agent opened that the user hasn't
   * looked at; null once they have.
   */
  unseenSince: number | null;
  /** Opens the panel with the Browser tab in front. */
  show: () => void;
}

export const ThreadPreviewContext = createContext<ThreadPreviewPanel | null>(
  null,
);

const shortUrl = (url: string) => url.replace(/^https?:\/\//, "");

export function TurnPreview({
  chatId,
  messageId,
  preview,
}: {
  chatId: string;
  messageId: string;
  preview: Preview;
}) {
  const panel = useContext(ThreadPreviewContext);
  const key = panel ? previewKey(panel.projectId, chatId) : "";
  const current = usePreviewState(key);
  const shot = useQuery({
    queryKey: ["turn-preview-shot", chatId, messageId, preview.at],
    queryFn: () => api.projectChatPreviewShot(chatId, messageId),
    enabled: !!preview.shot,
    staleTime: Infinity,
  });
  const here = !current?.url || current.url === preview.url;
  const showing = !!panel?.showing && here;
  const unseen =
    !!panel && panel.unseenSince !== null && preview.at >= panel.unseenSince;
  const open = () => {
    if (!panel) return;
    if (!here) void api.navigatePreview(panel.projectId, chatId, preview.url);
    panel.show();
  };
  const browse = () =>
    void (here && current
      ? api.previewAction(key, "openExternal")
      : api.openExternal(preview.url));
  const time = new Date(preview.at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <section
      className={`html-render turn-preview${preview.shot ? " has-shot" : ""}`}
      aria-label={preview.title || shortUrl(preview.url)}
    >
      <header className="turn-preview-bar">
        <button
          type="button"
          className="turn-preview-url"
          aria-label={`Open ${shortUrl(preview.url)} in the panel`}
          title={`${preview.url}\n${showing ? "In the panel" : "Open in panel"} · as of ${time}`}
          onClick={open}
          disabled={showing || !panel}
        >
          <Globe size={12} aria-hidden />
          <span>{shortUrl(preview.url)}</span>
        </button>
        <div className="turn-preview-actions">
          {panel && (
            <button
              type="button"
              className={`pane-toggle turn-preview-open ${showing ? "active" : ""}`}
              aria-label={showing ? "In the panel" : "Open in panel"}
              title={showing ? "In the panel" : "Open in panel"}
              aria-pressed={showing}
              disabled={showing}
              onClick={open}
            >
              <PanelRight size={14} aria-hidden />
              {unseen && !showing && (
                <span className="unseen-dot" aria-hidden="true" />
              )}
            </button>
          )}
          <button
            type="button"
            className="pane-toggle"
            aria-label="Open in your browser"
            title={`Open in your browser · as of ${time}`}
            onClick={browse}
          >
            <ExternalLink size={14} aria-hidden />
          </button>
        </div>
      </header>
      {preview.shot && (
        <button
          type="button"
          className="turn-preview-frame"
          onClick={open}
          disabled={showing || !panel}
          aria-label="Open the preview in the panel"
        >
          {shot.data && <img src={shot.data} alt="" />}
        </button>
      )}
    </section>
  );
}
