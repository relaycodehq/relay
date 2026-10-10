import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Maximize2, Minus, Plus, X } from "lucide-react";
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
import { frameOnScreen } from "./render-shot";
import { fitZoom, stepZoom } from "./render-zoom";
import { RenderActions, type RenderAction } from "./RenderActions";
import "../../ui/workspace-panes.css";
import "./html-render.css";

/** How far outside the thread's view a page stays loaded. */
const KEEP_MARGIN = "800px 0px";
/** A page Relay couldn't measure opens at this height, then fits itself. */
const UNMEASURED_HEIGHT = 240;
/** The tallest an expanded page grows before its frame scrolls. */
const EXPANDED_MAX_HEIGHT = 8000;
/** The expanded page's bar and the margin around the page. */
const STAGE_BAR = 52;
const STAGE_PADDING = 24;

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

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  const stage = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState(false);
  const [inView, setInView] = useState(false);
  /** What each page said it needs, at the width it said it. */
  const [sizes, setSizes] = useState<
    Record<number, { width: number; height: number }>
  >({});
  const [zoom, setZoom] = useState<number>();
  const expanded = zoom !== undefined;
  const scale = zoom ?? 1;
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string>();
  const theme = useRenderTheme();
  const focused = useWindowFocused();
  const paused = !focused || (!inView && !expanded);

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
  const liveHeight = live && live.width === width ? live.height : undefined;
  const height =
    liveHeight !== undefined
      ? clampRenderHeight(liveHeight)
      : (renderHeightAt(page.heights, width) ?? UNMEASURED_HEIGHT);
  // Expanded, the page keeps the width it lays out at in the thread and grows.
  const fullHeight = Math.min(liveHeight ?? height, EXPANDED_MAX_HEIGHT);

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

  const stageKey = (key: string) =>
    expanded
      ? (
          {
            Escape: () => setZoom(undefined),
            "+": () => setZoom((z) => stepZoom(z ?? 1, 1)),
            "=": () => setZoom((z) => stepZoom(z ?? 1, 1)),
            "-": () => setZoom((z) => stepZoom(z ?? 1, -1)),
            "0": fit,
          } as Record<string, (() => void) | undefined>
        )[key]
      : undefined;
  const stageKeyNow = useRef(stageKey);
  stageKeyNow.current = stageKey;
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
      else if (data.relayRender === "key" && typeof data.key === "string")
        stageKeyNow.current(data.key)?.();
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [index, onCompose]);

  // The frame's box goes to the top layer and back without leaving its place
  // in the document, so the page keeps whatever the user did in it.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    if (expanded && !el.matches(":popover-open")) {
      el.showPopover();
      el.querySelector<HTMLElement>(".html-render-close")?.focus();
    } else if (!expanded && el.matches(":popover-open")) {
      el.hidePopover();
      expandButton.current?.focus();
    }
  }, [expanded]);
  const expand = () =>
    setZoom(
      fitZoom(
        { width, height: fullHeight },
        {
          width: innerWidth - 2 * STAGE_PADDING,
          height: innerHeight - STAGE_BAR - 2 * STAGE_PADDING,
        },
      ),
    );
  const fit = () => {
    if (expanded) expand();
  };

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(timer);
  }, [done]);
  useEffect(() => {
    if (!failure) return;
    const timer = setTimeout(() => setFailure(undefined), 6000);
    return () => clearTimeout(timer);
  }, [failure]);

  const variants = render.pages.length > 1;
  const label = (i: number) => render.pages[i].label ?? `Variant ${i + 1}`;
  const run = async (action: RenderAction) => {
    setFailure(undefined);
    const target = {
      chatId,
      renderId: render.id,
      page: index,
      title: variants ? `${render.title} ${label(index)}` : render.title,
    };
    try {
      if (action === "html") await api.saveRenderHtml(target);
      else {
        const rect = frame.current
          ? await frameOnScreen(
              frame.current,
              liveHeight,
              expanded ? scroller.current : scrollParent(box.current!),
            )
          : undefined;
        const saved = await api.exportRenderImage(target, {
          to: action === "copy" ? "clipboard" : "file",
          rect,
          width: Math.min(Math.max(width, 100), 4000),
          scale: Math.min(Math.max(devicePixelRatio, 1), 4),
        });
        if (action === "png" && !saved) return;
      }
      setDone(true);
    } catch (e) {
      console.error(e);
      setFailure(
        `Couldn't ${action === "copy" ? "copy" : "save"} it: ${errorText(e)}`,
      );
    }
  };

  // Keys belong to the expanded page, except inside its menu; the page
  // hands up the ones pressed inside it.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest?.('[role="menu"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const action = stageKey(event.key);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const variantToggles = variants && (
    <div
      className="pane-toggles html-render-variants"
      role="tablist"
      aria-label="Variants"
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = (index + step + render.pages.length) % render.pages.length;
        setIndex(next);
        (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
      }}
    >
      {render.pages.map((_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          className={`pane-toggle ${i === index ? "active" : ""}`}
          aria-selected={i === index}
          tabIndex={i === index ? 0 : -1}
          onClick={() => setIndex(i)}
        >
          {label(i)}
        </button>
      ))}
    </div>
  );
  const note = failure && (
    <span className="html-render-note" title={failure}>
      {failure}
    </span>
  );

  return (
    <section className="html-render" aria-label={render.title}>
      <header className="html-render-head">
        <span className="html-render-title">{render.title}</span>
        {variantToggles}
        <div className="html-render-actions">
          {!expanded && note}
          <button
            ref={expandButton}
            type="button"
            className="pane-toggle html-render-action"
            aria-label="Expand"
            title="Expand"
            onClick={expand}
          >
            <Maximize2 size={14} />
          </button>
          <RenderActions
            onPick={(action) => void run(action)}
            done={done && !expanded}
          />
        </div>
      </header>
      <div className="html-render-frame" ref={box} style={{ height }}>
        <div
          ref={stage}
          className="html-render-stage"
          popover="manual"
          aria-label={expanded ? render.title : undefined}
          role={expanded ? "dialog" : undefined}
          aria-modal={expanded || undefined}
        >
          {expanded && (
            <div className="html-render-bar">
              <span className="html-render-title">{render.title}</span>
              {variantToggles}
              <div className="html-render-actions">
                {note}
                <div className="pane-toggles" aria-label="Zoom">
                  <button
                    type="button"
                    className="pane-toggle html-render-action"
                    aria-label="Zoom out"
                    title="Zoom out (−)"
                    onClick={() => setZoom(stepZoom(scale, -1))}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    className="pane-toggle html-render-zoom-level"
                    title="Fit (0)"
                    onClick={fit}
                  >
                    {Math.round(scale * 100)}%
                  </button>
                  <button
                    type="button"
                    className="pane-toggle html-render-action"
                    aria-label="Zoom in"
                    title="Zoom in (+)"
                    onClick={() => setZoom(stepZoom(scale, 1))}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <RenderActions
                  onPick={(action) => void run(action)}
                  done={done}
                  container={stage.current}
                />
                <button
                  type="button"
                  className="pane-toggle html-render-action html-render-close"
                  aria-label="Close"
                  title="Close (Esc)"
                  onClick={() => setZoom(undefined)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          <div className="html-render-scroll" ref={scroller}>
            <div
              className="html-render-zoom"
              style={
                expanded
                  ? { width: width * scale, height: fullHeight * scale }
                  : undefined
              }
            >
              {near && width > 0 && (
                <iframe
                  ref={frame}
                  key={src}
                  src={src}
                  title={
                    variants ? `${render.title}: ${label(index)}` : render.title
                  }
                  sandbox="allow-scripts allow-forms"
                  referrerPolicy="no-referrer"
                  style={{
                    colorScheme: theme.scheme,
                    ...(expanded && {
                      width,
                      height: fullHeight,
                      transform: `scale(${scale})`,
                    }),
                  }}
                  onLoad={() => {
                    post({ relayRender: "theme", ...themeNow.current });
                    post({ relayRender: "pause", paused: pausedNow.current });
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
