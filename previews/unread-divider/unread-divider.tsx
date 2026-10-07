// Where unread starts inside a thread: two ways to mark the first answer you
// haven't seen when you open a thread that moved while you were away.
// Sample threads; the sidebar, "New answer" and "Relay in background" drive
// what counts as seen, the same way useUnread does in the app.
// Open http://127.0.0.1:5177/previews/unread-divider/ (?v=a|b)
import "../_shared/desktop-stub";
import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, Plus, RotateCcw } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/sidebar/sidebar.css";
import "../_shared/chrome.css";
import "./unread-divider.css";
import { initAppearance, setMode, useAppearance } from "../../src/lib/appearance";
import { initWindowFocus, useWindowFocused } from "../../src/lib/window-focus";
import { clock } from "../../shared/waiting";
import type { ChatMessage } from "../../shared/projects";
import { Message } from "../../src/features/thread/ProjectMessage";
import { Spinner } from "../../src/ui/ui";
import {
  arrivals,
  initialSeen,
  projectRoot,
  sampleThreads,
  trace,
} from "./unread-divider-data";

initAppearance();
initWindowFocus();

type Design = "a" | "b";
type OpensAt = "latest" | "first";
type Threads = Record<string, ChatMessage[]>;

const designs: { id: Design; label: string; about: string }[] = [
  {
    id: "a",
    label: "A · Divider",
    about:
      "One line where unread starts, built like the compaction row. Once it has been on screen for 4 s with Relay in front, it fades and leaves its space until the thread is next opened.",
  },
  {
    id: "b",
    label: "B · Rail + jump line",
    about:
      "A thin rail beside everything unread, and a line under the header to jump up to it while it's off screen.",
  },
];

const initialThreads = (): Threads =>
  Object.fromEntries(sampleThreads.map((t) => [t.id, t.messages]));

const lastTime = (messages: ChatMessage[]) =>
  Math.max(0, ...messages.map((m) => m.ended ?? m.created));
const newerThan = (messages: ChatMessage[], seen: number) =>
  messages.some((m) => (m.ended ?? m.created) > seen);

function age(at: number) {
  const minutes = Math.max(1, Math.round((Date.now() - at) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

/** How much of what came before the marker stays in view above it, so the
 * end of your own message says what the new part answers. */
const context = 72;

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="preview-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function App() {
  const appearance = useAppearance();
  const [design, setDesignState] = useState<Design>(() =>
    new URLSearchParams(location.search).get("v") === "b" ? "b" : "a",
  );
  const setDesign = (d: Design) => {
    setDesignState(d);
    const url = new URL(location.href);
    url.searchParams.set("v", d);
    history.replaceState(null, "", url);
  };
  const [opensAt, setOpensAt] = useState<OpensAt>("latest");
  const [threads, setThreads] = useState<Threads>(initialThreads);
  const [seen, setSeen] = useState<Record<string, number>>(initialSeen);
  const [openId, setOpenId] = useState("flaky");
  const [front, setFront] = useState(true);
  // Taken when you arrive in a thread: what you'd read up to. It holds still
  // while you're there, so the marker doesn't chase the answers you watch land.
  const [since, setSince] = useState<number | null>(initialSeen.flaky);
  const [read, setRead] = useState(false);
  // Bumped on every arrival in a thread, so the view places itself again.
  const [arrived, setArrived] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const arrivalCount = useRef(0);

  const messages = threads[openId]!;
  const windowFocused = useWindowFocused();

  // Open and in front counts as read, as in useUnread.
  useEffect(() => {
    if (!front) return;
    const latest = lastTime(threads[openId]!);
    setSeen((s) => (s[openId]! >= latest ? s : { ...s, [openId]: latest }));
  }, [threads, openId, front]);

  const open = (id: string) => {
    if (id === openId) return;
    const last = seen[id]!;
    setOpenId(id);
    setSince(newerThan(threads[id]!, last) ? last : null);
    setRead(false);
    setArrived((n) => n + 1);
  };

  const comeBack = (inFront: boolean) => {
    setFront(inFront);
    if (!inFront) return;
    // Answers that landed behind the window move the marker to them.
    const last = seen[openId]!;
    if (newerThan(threads[openId]!, last)) {
      setSince(last);
      setRead(false);
    }
  };

  const arrive = () => {
    const script = arrivals[arrivalCount.current++ % arrivals.length]!;
    const id = `new-${arrivalCount.current}`;
    const created = Date.now();
    const update = (patch: Partial<ChatMessage>) =>
      setThreads((all) => ({
        ...all,
        flaky: all.flaky!.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      }));
    setThreads((all) => ({
      ...all,
      flaky: [
        ...all.flaky!,
        {
          id,
          role: "assistant",
          body: "",
          status: "streaming",
          created,
          provider: "claude",
          model: { name: "Opus 5.5", effort: "high" },
          unprompted: true,
          trace: trace(script.steps.slice(0, 1), true),
          version: 1,
        },
      ],
    }));
    timers.current.push(
      setTimeout(() => update({ trace: trace(script.steps, true) }), 1200),
      setTimeout(
        () =>
          update({
            status: "complete",
            body: script.body,
            ended: Date.now(),
            trace: trace(script.steps),
          }),
        2600,
      ),
    );
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    arrivalCount.current = 0;
    setThreads(initialThreads());
    setSeen(initialSeen);
    setOpenId("flaky");
    setFront(true);
    setSince(initialSeen.flaky!);
    setRead(false);
    setArrived((n) => n + 1);
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const unread = (id: string) =>
    (id !== openId || !front) && newerThan(threads[id]!, seen[id]!);
  const running = (id: string) =>
    threads[id]!.some((m) => m.status === "streaming");
  const firstNew =
    since === null ? -1 : messages.findIndex((m) => m.created > since);
  const about = designs.find((d) => d.id === design)!.about;

  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <Eye size={14} /> Where unread starts
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Design</span>
          <Segmented<Design>
            label="Design"
            value={design}
            onChange={setDesign}
            options={designs.map((d) => ({ value: d.id, label: d.label }))}
          />
        </div>
        <div className="preview-control">
          <span>Opens at</span>
          <Segmented<OpensAt>
            label="Opens at"
            value={opensAt}
            onChange={setOpensAt}
            options={[
              { value: "latest", label: "Latest" },
              { value: "first", label: "First new" },
            ]}
          />
        </div>
        <div className="preview-control">
          <span>Relay</span>
          <Segmented<"front" | "back">
            label="Relay window"
            value={front ? "front" : "back"}
            onChange={(v) => comeBack(v === "front")}
            options={[
              { value: "front", label: "In front" },
              { value: "back", label: "In background" },
            ]}
          />
        </div>
        <button type="button" className="ud-bar-button" onClick={arrive}>
          <Plus size={12} /> New answer
        </button>
        <button
          type="button"
          className="ud-bar-button"
          disabled={firstNew < 0 || read}
          onClick={() => setRead(true)}
        >
          Mark read
        </button>
        <button type="button" className="ud-bar-button" onClick={reset}>
          <RotateCcw size={12} /> Reset
        </button>
        <span className="spacer" />
        <Segmented<string>
          label="Colour mode"
          value={appearance.palette.kind}
          onChange={(v) => setMode(v as "light" | "dark")}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <span className="ud-note">
          {about} Open another thread and come back: it's gone. Leave, press
          New answer, come back: it's above that answer.
        </span>
      </div>

      <div className="ud-body">
        <aside className="ud-sidebar">
          <div className="sb">
            <div className="ud-sb-project">relay</div>
            <div className="sb-thread-list flat">
              {sampleThreads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`sb-thread${t.id === openId ? " selected" : ""}${unread(t.id) ? " unread" : ""}`}
                  onClick={() => open(t.id)}
                >
                  <span className="sb-thread-title">{t.title}</span>
                  {running(t.id) ? (
                    <span className="sb-status running" title="Working">
                      <Spinner size={11} steady />
                    </span>
                  ) : unread(t.id) ? (
                    <span className="sb-status unread" title="New activity">
                      <i />
                    </span>
                  ) : (
                    <time className="sb-age">
                      {age(lastTime(threads[t.id]!))}
                    </time>
                  )}
                </button>
              ))}
            </div>
          </div>
        </aside>
        <div className="project-chat-pane">
          <ThreadView
            key={openId}
            design={design}
            opensAt={opensAt}
            messages={messages}
            firstNew={firstNew}
            since={since}
            read={read}
            focused={front && windowFocused}
            arrived={arrived}
            onRead={() => setRead(true)}
          />
        </div>
      </div>
    </div>
  );
}

function ThreadView({
  design,
  opensAt,
  messages,
  firstNew,
  since,
  read,
  focused,
  arrived,
  onRead,
}: {
  design: Design;
  opensAt: OpensAt;
  messages: ChatMessage[];
  firstNew: number;
  since: number | null;
  read: boolean;
  /** Relay in front: the simulated toggle and the real window both. */
  focused: boolean;
  arrived: number;
  onRead: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastTop = useRef(0);
  const [dock, setDock] = useState(0);
  const [scrolledUp, setScrolledUp] = useState(false);
  // Where the start of the unread part is relative to what you can see.
  const [where, setWhere] = useState<"above" | "in" | "below">("in");
  const seenFor = useDividerSeen(
    design === "a" && firstNew >= 0 && !read && focused,
    marker,
    scroll,
    dock,
    onRead,
  );

  const before = firstNew < 0 ? messages : messages.slice(0, firstNew);
  const after = firstNew < 0 ? [] : messages.slice(firstNew);
  const newAnswers = after.filter((m) => m.role === "assistant").length;
  const sinceLabel = since === null ? "" : clock(since);

  const locate = useCallback(() => {
    const el = scroll.current;
    const start = marker.current;
    if (!el || !start) return setWhere("in");
    const view = el.getBoundingClientRect();
    const top = start.getBoundingClientRect().top;
    setWhere(
      top < view.top + 8
        ? "above"
        : top > view.bottom - dock - 24
          ? "below"
          : "in",
    );
  }, [dock]);

  const offsetOf = (el: HTMLElement) =>
    scroll.current!.scrollTop +
    el.getBoundingClientRect().top -
    scroll.current!.getBoundingClientRect().top;

  // Arriving: pinned to the end, or with the first new message at the top.
  useLayoutEffect(() => {
    const el = scroll.current!;
    const place = () => {
      if (opensAt === "first" && marker.current)
        el.scrollTop = offsetOf(marker.current) - context;
      else el.scrollTop = el.scrollHeight;
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      lastTop.current = el.scrollTop;
      locate();
    };
    place();
    // Off-screen messages lay out at estimated heights first; place again
    // once they've taken their real ones.
    const frame = requestAnimationFrame(() => requestAnimationFrame(place));
    return () => cancelAnimationFrame(frame);
  }, [arrived, opensAt, dock > 0]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      const el = scroll.current!;
      if (follow.current) el.scrollTop = el.scrollHeight;
      locate();
    });
    observer.observe(column.current!);
    return () => observer.disconnect();
  }, [locate]);

  const onScroll = () => {
    const el = scroll.current!;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (el.scrollTop < lastTop.current - 1 && distance > 1)
      follow.current = false;
    else if (el.scrollTop > lastTop.current && distance < 80)
      follow.current = true;
    lastTop.current = el.scrollTop;
    setScrolledUp(distance > 160);
    locate();
  };

  const jump = () => {
    const el = scroll.current!;
    if (!marker.current) return;
    follow.current = false;
    el.scrollTo({
      top: offsetOf(marker.current) - context,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  };

  const message = (m: ChatMessage) => (
    <Message
      key={m.id}
      message={m}
      chatId=""
      onReply={() => {}}
      onFork={() => {}}
      onChanges={() => {}}
      onTurnDiff={() => {}}
      onRewind={async () => ({ conflicts: [] })}
      projectRoot={projectRoot}
      onOpenFile={() => {}}
    />
  );

  return (
    <section
      className="project-chat"
      aria-label="Project chat"
      style={{ "--composer-dock-height": `${dock}px` } as CSSProperties}
    >
      <div className="ud-stage">
        {design === "b" && (
          <JumpLine
            shown={after.length > 0 && !read && where !== "in"}
            where={where}
            count={newAnswers}
            since={sinceLabel}
            onJump={jump}
            onRead={onRead}
          />
        )}
        <div className="project-messages" ref={scroll} onScroll={onScroll}>
          <div className="thread-message-column" ref={column}>
            {before.map(message)}
            {after.length > 0 &&
              (design === "a" ? (
                <>
                  <div
                    ref={marker}
                    className="unread-divider"
                    data-read={read || undefined}
                    data-seen={seenFor || undefined}
                    role="separator"
                    aria-label={`New since ${sinceLabel}`}
                  >
                    <span>New since {sinceLabel}</span>
                  </div>
                  {after.map(message)}
                </>
              ) : (
                <div
                  ref={marker}
                  className="unread-run"
                  data-read={read || undefined}
                  aria-label={`New since ${sinceLabel}`}
                  style={
                    {
                      "--unread-label": `"new since ${sinceLabel}"`,
                    } as CSSProperties
                  }
                >
                  {after.map(message)}
                </div>
              ))}
          </div>
        </div>
      </div>
      <Dock onHeight={setDock} collapsed={scrolledUp} />
    </section>
  );
}

/** How long the divider stays once seen, before it fades. */
const SEEN_FOR = 4000;

/**
 * A's divider marks itself read after it has been at least half in view, with
 * Relay in front, for SEEN_FOR. Scrolling it away or leaving the window starts
 * the count again. The view's bottom edge is the composer's top, since the
 * thread scrolls under it. Returns whether it's counting.
 */
function useDividerSeen(
  armed: boolean,
  marker: RefObject<HTMLDivElement | null>,
  scroll: RefObject<HTMLDivElement | null>,
  dock: number,
  onSeen: () => void,
) {
  const [visible, setVisible] = useState(false);
  const seen = useRef(onSeen);
  seen.current = onSeen;
  useEffect(() => {
    const el = marker.current;
    if (!armed || !el) return setVisible(false);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry!.intersectionRatio >= 0.5),
      {
        root: scroll.current,
        rootMargin: `0px 0px -${dock}px 0px`,
        threshold: [0, 0.5, 1],
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [armed, dock, marker, scroll]);
  const counting = armed && visible;
  useEffect(() => {
    if (!counting) return;
    const timer = setTimeout(() => seen.current(), SEEN_FOR);
    return () => clearTimeout(timer);
  }, [counting]);
  return counting;
}

/** B's line under the header: only while the unread start is off screen. */
function JumpLine({
  shown,
  where,
  count,
  since,
  onJump,
  onRead,
}: {
  shown: boolean;
  where: "above" | "in" | "below";
  count: number;
  since: string;
  onJump: () => void;
  onRead: () => void;
}) {
  // Keeps its last direction while it fades out.
  const [dir, setDir] = useState<"above" | "below">("above");
  useEffect(() => {
    if (where !== "in") setDir(where);
  }, [where]);
  const Arrow = dir === "above" ? ArrowUp : ArrowDown;
  const what =
    count === 0
      ? "New messages"
      : `${count} new ${count === 1 ? "answer" : "answers"}`;
  return (
    <div className="unread-jump" data-shown={shown || undefined} inert={!shown}>
      <div className="unread-jump-inner">
        <button type="button" className="unread-jump-go" onClick={onJump}>
          <Arrow size={13} />
          <span>
            {what} <span className="muted">since {since}</span>
          </span>
        </button>
        <span className="spacer" />
        <button type="button" className="text-button" onClick={onRead}>
          Mark read
        </button>
      </div>
    </div>
  );
}

function Dock({
  onHeight,
  collapsed,
}: {
  onHeight: (height: number) => void;
  collapsed: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMeasure(ref, onHeight, collapsed);
  return (
    <div
      className={`thread-bottom-composer${collapsed ? " collapsed" : ""}`}
      ref={ref}
    >
      <div className="thread-compose-wrap">
        <form
          className="project-composer"
          onSubmit={(e) => e.preventDefault()}
        >
          <textarea
            className="composer-prompt-input"
            aria-label="Message Claude"
            placeholder="Ask Claude anything… (sending is off in the preview)"
          />
          <div className="composer-tools">
            <span className="spacer" />
            <button type="submit" className="send-message" aria-label="Send">
              <ArrowUp size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** The dock's height, kept while it's collapsed so the thread doesn't jump. */
function useMeasure(
  ref: RefObject<HTMLDivElement | null>,
  onHeight: (height: number) => void,
  collapsed: boolean,
) {
  const held = useRef(collapsed);
  held.current = collapsed;
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (!held.current) onHeight(ref.current!.offsetHeight);
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [onHeight, ref]);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
