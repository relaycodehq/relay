// The smaller live demos down the page. Where the app has the component, it
// is the app's: the usage meters with their pace logic, the quick-switch drum
// and the agent turn the phone and the desktop draw from the same code.
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  GitMerge,
  Lock,
} from "lucide-react";
import { UsageMeters } from "../../src/features/agents/UsageMeters";
import { UsageDial } from "../../src/features/agents/UsageDial";
import { QuickSwitchHud } from "../../src/features/quick-switch/QuickSwitchHud";
import type { QuickItem } from "../../src/features/quick-switch/quick-switch";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { Message } from "../../src/features/thread/ProjectMessage";
import {
  presentWindow,
  SESSION_MS,
  WEEK_MS,
  type ProviderUsage,
} from "../../shared/provider-usage";
import { agentName } from "../../shared/agents";
import { chats, projectRoot, turnMessages, turns } from "./sample";
import { reducedMotion, useActive, useLiveTurn } from "./motion";
import { PhoneSidebar, PhoneStatus, PhoneThread } from "./phone";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Monday 00:00 of the current week, local time. */
function weekStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

/** Hours worked by `at` in a week of 9-to-6 weekdays. */
function worked(at: number) {
  const day = Math.floor(at / DAY);
  const hour = (at % DAY) / HOUR;
  const today = day < 5 ? Math.min(Math.max(hour - 9, 0), 9) : 0;
  return Math.min(day, 5) * 9 + today;
}

/** What a provider would report `at` ms into the week, burning `rate` percent per worked hour. */
function usageAt(provider: ProviderUsage["provider"], start: number, at: number, rate: number): ProviderUsage {
  const now = start + at;
  const sessionStart = Math.floor(now / SESSION_MS) * SESSION_MS;
  const inSession = worked(at) - worked(Math.max(sessionStart - start, 0));
  return {
    provider,
    message: null,
    windows: [
      {
        kind: "session",
        usedPercent: Math.min(100, inSession * rate * 5.5),
        resetsAt: sessionStart + SESSION_MS,
        periodMs: SESSION_MS,
      },
      {
        kind: "weekly",
        usedPercent: Math.min(100, worked(at) * rate),
        resetsAt: start + WEEK_MS,
        periodMs: WEEK_MS,
      },
    ],
  };
}

const stamp = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A week as a ruler: the pointer's place along it is the moment shown, so
 * there is nothing to grab. Left alone, the week plays by itself.
 */
function WeekRuler({ at, now, onScrub, onRest }: { at: number; now: number; onScrub: (at: number) => void; onRest: () => void }) {
  const place = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onScrub(Math.round(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * 1000));
  };
  return (
    <div
      className="week"
      role="slider"
      tabIndex={0}
      aria-label="Point in the week"
      aria-valuemin={0}
      aria-valuemax={1000}
      aria-valuenow={at}
      aria-valuetext={stamp.format(now)}
      onPointerMove={(event) => {
        // A finger scrolls the page unless it is pressed and moving along the ruler.
        if (event.pointerType === "mouse" || event.buttons) place(event);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        place(event);
      }}
      onPointerLeave={onRest}
      onPointerUp={(event) => event.pointerType !== "mouse" && onRest()}
      onKeyDown={(event) => {
        const by = event.key === "ArrowRight" ? 6 : event.key === "ArrowLeft" ? -6 : 0;
        if (!by) return;
        event.preventDefault();
        onScrub(Math.min(1000, Math.max(0, at + by)));
      }}
    >
      {days.map((day, index) => (
        <div key={day} className="week-day" data-off={index > 4 || undefined}>
          <span>{day}</span>
          <i />
        </div>
      ))}
      <div className="week-past" style={{ width: `${at / 10}%` }} />
      <div className="week-head" style={{ left: `${at / 10}%` }}>
        <b data-flip={at > 860 || undefined}>{stamp.format(now)}</b>
      </div>
    </div>
  );
}

/** A week of limits, played or scrubbed: the meters and their wording are the app's. */
export function UsageDemo() {
  const [ref, active] = useActive<HTMLDivElement>();
  const [start] = useState(weekStart);
  // Thousandths of the week; starts on Tuesday afternoon.
  const [at, setAt] = useState(230);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || held || reducedMotion()) return;
    const timer = window.setInterval(() => setAt((value) => (value >= 760 ? 50 : value + 2)), 90);
    return () => window.clearInterval(timer);
  }, [active, held]);
  const offset = (at / 1000) * WEEK_MS;
  const now = start + offset;
  const providers = [
    { usage: usageAt("claude", start, offset, 1.5), provider: "claude" as const },
    { usage: usageAt("codex", start, offset, 2.7), provider: "codex" as const },
  ];
  return (
    <div className="usage-demo" ref={ref}>
      {providers.map(({ usage, provider }) => (
        <div key={provider} className="usage-demo-card">
          <header>
            <ProviderIcon provider={provider} />
            <strong>{agentName(provider)}</strong>
            <UsageDial meters={usage.windows.map((window) => presentWindow(window, now))} />
          </header>
          <UsageMeters usage={usage} now={now} />
        </div>
      ))}
      <WeekRuler
        at={at}
        now={now}
        onScrub={(next) => {
          setHeld(true);
          setAt(next);
        }}
        onRest={() => setHeld(false)}
      />
    </div>
  );
}

const presets: QuickItem[] = [
  { id: "1", provider: "claude", name: "Opus 5.5", effort: "High", fast: false },
  { id: "2", provider: "codex", name: "GPT-5.6-Sol", effort: "High", fast: false },
  { id: "3", provider: "claude", name: "Sonnet 5", effort: "Medium", fast: false },
  { id: "4", provider: "opencode", name: "OpenCode default", effort: "Default", fast: false },
  { id: "5", provider: "cursor", name: "Cursor default", effort: "Default", fast: false },
];

/** The composer's quick switch, stepping through presets as ⌃⌘←/→ does. */
export function QuickSwitchDemo() {
  const [ref, active] = useActive<HTMLDivElement>();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [touched, setTouched] = useState(false);
  const step = (by: number) => {
    setDir(by);
    setIndex((value) => (value + by + presets.length) % presets.length);
  };
  useEffect(() => {
    if (!active || touched || reducedMotion()) return;
    const timer = window.setInterval(() => step(1), 2100);
    return () => window.clearInterval(timer);
  }, [active, touched]);
  const item = presets[index];
  return (
    <div className="quick-demo" ref={ref}>
      <QuickSwitchHud
        style="drum"
        open
        items={presets}
        index={index}
        dir={dir}
        onPick={(next, way) => {
          setTouched(true);
          setDir(way ?? Math.sign(next - index) ?? 1);
          setIndex(next);
        }}
      />
      <div className="project-composer quick-demo-composer">
        <span className="quick-demo-prompt">Make the settings page keyboard-navigable</span>
        <div className="composer-tools">
          <span className="rw-pick">
            <ProviderIcon provider={item.provider} />
            {item.name}
          </span>
          <span className="rw-pick">{item.effort}</span>
          <span className="spacer" />
          <button
            type="button"
            className="icon-button"
            aria-label="Previous preset"
            onClick={() => {
              setTouched(true);
              step(-1);
            }}
          >
            <ChevronLeft size={15} />
          </button>
          <kbd>⌃⌘← →</kbd>
          <button
            type="button"
            className="icon-button"
            aria-label="Next preset"
            onClick={() => {
              setTouched(true);
              step(1);
            }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

const trees = [
  { thread: "Split project-chats.ts into modules", branch: "split-chats", commits: 3 },
  { thread: "Hero section for the launch page", branch: "launch-hero", commits: 5 },
  { thread: "Rate-limit the upload endpoint", branch: "upload-limits", commits: 2 },
];

/** Threads on branches of their own beside `main`; Merge lands one the way a branch merge does. */
export function WorktreeGraph() {
  const [ref, active] = useActive<HTMLDivElement>(0.4);
  const [drawn, setDrawn] = useState(false);
  const [merged, setMerged] = useState<boolean[]>(trees.map(() => false));
  useEffect(() => {
    if (active) setDrawn(true);
  }, [active]);
  return (
    <div className="tree-demo" ref={ref} data-drawn={drawn || undefined}>
      <div className="tree-main">
        <GitBranch size={14} />
        <code>main</code>
        <span>Your checkout. Relay does not change it.</span>
      </div>
      {trees.map((tree, index) => (
        <div key={tree.branch} className="tree-row" data-merged={merged[index] || undefined}>
          <svg width="56" height="64" viewBox="0 0 56 64" aria-hidden="true">
            <path className="tree-rail" d="M12 0V64" />
            <path className="tree-fork" d="M12 4C12 26 40 14 40 32" pathLength={1} />
            <path className="tree-back" d="M40 32C40 50 12 40 12 62" pathLength={1} />
            <circle className="tree-dot" cx="40" cy="32" r="4" />
            <circle className="tree-land" cx="12" cy="62" r="4" />
          </svg>
          <div>
            <strong>{tree.thread}</strong>
            <span>
              <code>{tree.branch}</code> ·{" "}
              {merged[index] ? "merged into main" : `${tree.commits} commits ahead`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMerged(merged.map((value, i) => (i === index ? !value : value)))}
          >
            {merged[index] ? (
              "Undo"
            ) : (
              <>
                <GitMerge size={13} /> Merge
              </>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * One turn on the computer and on the phone at once: same thread, same steps.
 * The link above the phone opens it into a foldable, with Activity beside the thread.
 */
const LIVE = "shortcuts";

export function PhoneSync() {
  const [ref, active] = useActive<HTMLDivElement>();
  const shown = useLiveTurn(turns[LIVE].steps.length, active, 6000);
  const messages = turnMessages(LIVE, shown);
  const [open, setOpen] = useState(false);
  // Unfolded, the cards in Activity open their thread in the other half.
  const [picked, setPicked] = useState(LIVE);
  const [unread, setUnread] = useState<ReadonlySet<string>>(() => new Set(["hero"]));
  const chat = chats.find((c) => c.id === picked)!;
  const settled = useMemo(
    () => turnMessages(picked, turns[picked].steps.length + (chat.running ? 0 : 1)),
    [picked, chat.running],
  );
  const thread = messages.map((m) => (
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
  ));
  const model = (id: string) => {
    const { name, effort } = turns[id].model;
    return name ? `${name}${effort ? ` · ${effort[0].toUpperCase()}${effort.slice(1)}` : ""}` : "Default";
  };
  const fold = () => {
    setOpen(!open);
    if (open) setPicked(LIVE);
  };
  return (
    <div className="sync-stage">
      <div className="sync" ref={ref} data-live={active || undefined} data-open={open || undefined}>
        <div className="sync-desk">
          <header>
            <i />
            <i />
            <i />
            <span>Relay on studio-mac</span>
          </header>
          <div className="thread-message-column">{thread}</div>
        </div>
        <div className="sync-link" aria-hidden="true">
          <span className="sync-wire">
            <i />
            <i />
            <i />
          </span>
          <span className="sync-note">
            <Lock size={11} /> end-to-end encrypted
          </span>
          <span className="sync-note">over your tailnet</span>
        </div>
        <div className="fold">
          <button type="button" className="fold-link" aria-pressed={open} onClick={fold}>
            {open ? "Fold it back" : "Works on fold"}
          </button>
          <div className="fold-half fold-flap">
            <div className="fold-screen" />
          </div>
          {/* Folded: the cover screen, a phone like any other. */}
          <div className="fold-half fold-phone">
            <div className="fold-screen">
              <div className="ph ph-cover">
                <PhoneStatus hole="center" />
                <PhoneThread chat={chats.find((c) => c.id === LIVE)!} messages={messages} model={model(LIVE)} />
              </div>
            </div>
          </div>
          {/* Unfolded: the inner screen. From 600dp wide the app puts the list beside the thread. */}
          <div className="fold-inner" inert={!open}>
            <div className="ph">
              <PhoneStatus hole="right" />
              <PhoneSidebar
                selected={picked}
                unread={unread}
                onOpen={(c) => {
                  if (!turns[c.id]) return;
                  setPicked(c.id);
                  setUnread((was) => new Set([...was].filter((id) => id !== c.id)));
                }}
              />
              <PhoneThread
                key={picked}
                chat={chat}
                messages={picked === LIVE ? messages : settled}
                model={model(picked)}
                pane
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
