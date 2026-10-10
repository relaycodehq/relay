import { useEffect, useMemo, useRef, useState } from "react";
import {
  ASK_ANSWER_MAX_CHARS,
  clampRenderHeight,
  renderHeightAt,
  renderUrl,
  type HtmlRender,
  type RenderFromFrame,
  type RenderToFrame,
} from "../../../shared/html-render";
import { api } from "../../lib/api";
import { useWindowFocused } from "../../lib/window-focus";
import { useRenderTheme } from "./render-theme";
import "./ask-page.css";

/** A page Relay couldn't measure opens at this height, then fits itself. */
const UNMEASURED_HEIGHT = 240;

/**
 * The page an agent asks with (ask_html), above the message box. The page
 * hands over its answer with relay.answer() as the user picks; Send gives the
 * agent the last one, Skip tells it to decide on its own.
 */
export function AskPage({
  chatId,
  page,
  busy,
  onAnswer,
}: {
  chatId: string;
  page: HtmlRender;
  busy: boolean;
  /** JSON from the page, or null to skip. */
  onAnswer: (json: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState<number>();
  const [answer, setAnswer] = useState<string>();
  const theme = useRenderTheme();
  const focused = useWindowFocused();

  useEffect(() => {
    const resize = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    resize.observe(box.current!);
    return () => resize.disconnect();
  }, []);

  const post = (message: RenderToFrame) =>
    frame.current?.contentWindow?.postMessage(message, "*");
  // The theme rides in the address so the first paint has it; later changes
  // go by message, which leaves the page as the user left it.
  const themeNow = useRef(theme);
  themeNow.current = theme;
  const src = useMemo(
    () =>
      `${renderUrl(chatId, page.id, 0)}#theme=${encodeURIComponent(JSON.stringify(themeNow.current))}`,
    [chatId, page.id],
  );
  useEffect(() => post({ relayRender: "theme", ...theme }), [theme]);
  useEffect(() => post({ relayRender: "pause", paused: !focused }), [focused]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow)
        return;
      const data = event.data as RenderFromFrame | null;
      if (!data || typeof data !== "object") return;
      if (data.relayRender === "size" && Number.isFinite(data.height))
        setMeasured(data.height);
      else if (
        data.relayRender === "link" &&
        typeof data.href === "string" &&
        /^(https?|mailto):/i.test(data.href)
      )
        void api.openExternal(data.href).catch(() => {});
      else if (
        data.relayRender === "answer" &&
        typeof data.json === "string" &&
        data.json.length <= ASK_ANSWER_MAX_CHARS
      )
        setAnswer(data.json);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  const height =
    measured !== undefined
      ? clampRenderHeight(measured)
      : (renderHeightAt(page.pages[0]?.heights, width) ?? UNMEASURED_HEIGHT);

  return (
    <>
      <div ref={box} className="ask-page">
        <iframe
          ref={frame}
          src={src}
          title={page.title}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          style={{ height, colorScheme: theme.scheme }}
        />
      </div>
      <footer>
        <button type="button" disabled={busy} onClick={() => onAnswer(null)}>
          Skip
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || answer === undefined}
          onClick={() => answer !== undefined && onAnswer(answer)}
        >
          Send answer
        </button>
      </footer>
    </>
  );
}
