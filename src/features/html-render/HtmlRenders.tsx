import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  RENDER_COMPOSE_CHARS,
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
import "./html-render.css";

/** How far outside the thread's view a page stays loaded. */
const KEEP_MARGIN = "800px 0px";
/** A page Relay couldn't measure opens at this height, then fits itself. */
const UNMEASURED_HEIGHT = 240;

/** The pages an answer showed with show_html, above its reply. */
export function HtmlRenders({
  chatId,
  renders,
  onCompose,
}: {
  chatId: string;
  renders: HtmlRender[];
  /** Puts text in the composer: a picked variant, or a page's relay.compose(). */
  onCompose?: (text: string) => void;
}) {
  return (
    <>
      {renders.map((render) => (
        <RenderCard
          key={render.id}
          chatId={chatId}
          render={render}
          onCompose={onCompose}
        />
      ))}
    </>
  );
}

function scrollParent(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement)
    if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  return null;
}

const RenderCard = memo(function RenderCard({
  chatId,
  render,
  onCompose,
}: {
  chatId: string;
  render: HtmlRender;
  onCompose?: (text: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const page = render.pages[index] ?? render.pages[0];
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState(false);
  const [inView, setInView] = useState(false);
  /** What each page said it needs, at the width it said it. */
  const [sizes, setSizes] = useState<
    Record<number, { width: number; height: number }>
  >({});
  const theme = useRenderTheme();
  const focused = useWindowFocused();
  const paused = !focused || !inView;

  useEffect(() => {
    const el = box.current!;
    const root = scrollParent(el);
    const resize = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    const keep = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root, rootMargin: KEEP_MARGIN },
    );
    const seen = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { root },
    );
    resize.observe(el);
    keep.observe(el);
    seen.observe(el);
    return () => {
      resize.disconnect();
      keep.disconnect();
      seen.disconnect();
    };
  }, []);

  const live = sizes[index];
  const height =
    live && live.width === width
      ? clampRenderHeight(live.height)
      : (renderHeightAt(page.heights, width) ?? UNMEASURED_HEIGHT);

  const post = (message: RenderToFrame) =>
    frame.current?.contentWindow?.postMessage(message, "*");
  // The theme rides in the address so the first paint has it; later changes
  // go by message, which leaves the page as it is.
  const themeNow = useRef(theme);
  themeNow.current = theme;
  const src = useMemo(
    () =>
      `${renderUrl(chatId, render.id, index)}#theme=${encodeURIComponent(JSON.stringify(themeNow.current))}`,
    [chatId, render.id, index, near],
  );
  useEffect(() => post({ relayRender: "theme", ...theme }), [theme]);
  const pausedNow = useRef(paused);
  pausedNow.current = paused;
  useEffect(() => post({ relayRender: "pause", paused }), [paused]);

  const widthNow = useRef(width);
  widthNow.current = width;
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow)
        return;
      const data = event.data as RenderFromFrame | null;
      if (!data || typeof data !== "object") return;
      if (data.relayRender === "size" && Number.isFinite(data.height))
        setSizes((s) => ({
          ...s,
          [index]: { width: widthNow.current, height: data.height },
        }));
      else if (
        data.relayRender === "link" &&
        typeof data.href === "string" &&
        /^(https?|mailto):/i.test(data.href)
      )
        void api.openExternal(data.href).catch(() => {});
      else if (data.relayRender === "compose" && typeof data.text === "string")
        onCompose?.(data.text.slice(0, RENDER_COMPOSE_CHARS));
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [index, onCompose]);

  const variants = render.pages.length > 1;
  const label = (i: number) => render.pages[i].label ?? `Variant ${i + 1}`;
  return (
    <section className="html-render" aria-label={render.title}>
      <header className="html-render-head">
        <span className="html-render-title">{render.title}</span>
        {variants && (
          <div
            className="html-render-variants"
            role="tablist"
            aria-label="Variants"
            onKeyDown={(e) => {
              const step =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next =
                (index + step + render.pages.length) % render.pages.length;
              setIndex(next);
              (
                e.currentTarget.children[next] as HTMLElement | undefined
              )?.focus();
            }}
          >
            {render.pages.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => setIndex(i)}
              >
                {label(i)}
              </button>
            ))}
          </div>
        )}
        {variants && onCompose && (
          <button
            type="button"
            className="html-render-pick"
            onClick={() =>
              onCompose(`Let's go with "${label(index)}" (${render.title}).`)
            }
          >
            Go with this
          </button>
        )}
      </header>
      <div className="html-render-frame" ref={box} style={{ height }}>
        {near && width > 0 && (
          <iframe
            ref={frame}
            key={src}
            src={src}
            title={variants ? `${render.title}: ${label(index)}` : render.title}
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
            style={{ colorScheme: theme.scheme }}
            onLoad={() => {
              post({ relayRender: "theme", ...themeNow.current });
              post({ relayRender: "pause", paused: pausedNow.current });
            }}
          />
        )}
      </div>
    </section>
  );
});
