// Settling a thread whose started threads are still working: what happens to
// the ones that keep going. Four options on the real Activity markup.
// Open http://127.0.0.1:5177/previews/settle-family/ (?v=a|b|c|d)
import "../_shared/desktop-stub";
import {
  Fragment,
  StrictMode,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Moon,
  RotateCcw,
  Sun,
  Undo2,
} from "lucide-react";
import "../../src/styles.css";
import "../../src/features/sidebar/sidebar.css";
import "../_shared/chrome.css";
import "./settle-family.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { elapsedLabel, shortAge } from "../../shared/chat-activity";
import { Spinner } from "../../src/ui/ui";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import type { MessageProvider } from "../../src/features/agents/model-picker-catalog";

initAppearance();
initWindowFocus();

type Variant = "a" | "b" | "c" | "d";

const variants: { id: Variant; label: string; about: string }[] = [
  {
    id: "a",
    label: "A · Today",
    about:
      "What main does now: the lead and its finished threads settle, the two still working fall out as ordinary cards with nothing saying where they came from.",
  },
  {
    id: "b",
    label: "B · Settled header",
    about:
      "The lead settles, but stays as one muted line above the threads still working. Settle the last of them and the line goes too.",
  },
  {
    id: "c",
    label: "C · Settle when done",
    about:
      "The finished ones settle now; the lead stays and says it settles when the rest are done and read, then the whole family goes.",
  },
  {
    id: "d",
    label: "D · Ask",
    about:
      "Settle asks first while started threads still work, and the two answers are B and C.",
  },
];

interface Thread {
  id: string;
  project: string;
  title: string;
  branch: string;
  provider: MessageProvider;
  parent?: string;
  running?: boolean;
  runningSince?: number;
  unread?: boolean;
  updated: number;
  settledAt?: number;
}

const min = 60_000;

function sample(now: number): Thread[] {
  return [
    {
      id: "lead",
      project: "Relay",
      title: "List projects similar to Relay and T3",
      branch: "main",
      provider: "claude",
      updated: now - 2 * min,
    },
    {
      id: "boot",
      project: "Relay",
      title: "Worktree bootstrap: includes, setup and teardown",
      branch: "relay/worktree-bootstrap-relay-s-worktree",
      provider: "claude",
      parent: "lead",
      updated: now - 0.5 * min,
    },
    {
      id: "branch",
      project: "Relay",
      title: "Custom branch name for worktree threads",
      branch: "relay/custom-branch-name-when",
      provider: "claude",
      parent: "lead",
      running: true,
      runningSince: now - 6 * min - 5000,
      updated: now - 6 * min,
    },
    {
      id: "width",
      project: "Relay",
      title: "Add adjustable chat width setting",
      branch: "relay/add-a-chat-width-to-relay-the-co",
      provider: "claude",
      parent: "lead",
      updated: now - 17 * min,
    },
    {
      id: "goal",
      project: "Relay",
      title: "Native /goal support in Relay threads",
      branch: "relay/native-goal-the-way-t3",
      provider: "claude",
      parent: "lead",
      running: true,
      runningSince: now - 23 * min - 41_000,
      updated: now - 23 * min,
    },
    {
      id: "invoice",
      project: "Licensing",
      title: "Seat count on renewal invoices",
      branch: "fix/seat-count",
      provider: "codex",
      unread: true,
      updated: now - 42 * min,
    },
    {
      id: "hero",
      project: "Website",
      title: "Pricing page hero spacing",
      branch: "main",
      provider: "claude",
      updated: now - 95 * min,
    },
    {
      id: "flicker",
      project: "Relay",
      title: "Sidebar flickers when a thread finishes",
      branch: "main",
      provider: "claude",
      updated: now - 140 * min,
      settledAt: now - 120 * min,
    },
    {
      id: "electron",
      project: "Relay",
      title: "Bump Electron to 39",
      branch: "relay/electron-39",
      provider: "codex",
      updated: now - 26 * 60 * min,
      settledAt: now - 25 * 60 * min,
    },
  ];
}

/** How long after settling each working thread finishes, so the rest of the story shows. */
const FINISH_AFTER = { branch: 6000, goal: 12000 } as Record<string, number>;

function projectHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function Badge({ name }: { name: string }) {
  return (
    <span
      className="sb-project-badge"
      style={{ "--hue": projectHue(name) } as CSSProperties}
      aria-hidden
    >
      {name[0]}
    </span>
  );
}

function CardState({ t, now }: { t: Thread; now: number }) {
  if (t.running)
    return (
      <span className="sb-card-state running">
        <Spinner size={11} steady />
        Working
        <span className="sb-elapsed">{elapsedLabel(t.runningSince!, now)}</span>
      </span>
    );
  return (
    <time className={`sb-card-state ${t.unread ? "unread" : ""}`}>
      {t.unread && <i />}
      {shortAge(t.updated, now)}
    </time>
  );
}

function familyLine(kids: Thread[]) {
  const working = kids.filter((k) => k.running).length;
  const fresh = kids.filter((k) => !k.running && k.unread).length;
  return [
    `${kids.length} thread${kids.length === 1 ? "" : "s"}`,
    working && `${working} working`,
    fresh && `${fresh} new`,
    !working && !fresh && "all done",
  ]
    .filter(Boolean)
    .join(" · ");
}

interface Ctx {
  now: number;
  selected: string;
  open: (id: string) => void;
  settle: (id: string) => void;
}

/** The real ThreadCard's markup, minus the context menu. */
function Card({
  t,
  ctx,
  compact = false,
  family,
  state,
  actions,
}: {
  t: Thread;
  ctx: Ctx;
  compact?: boolean;
  family?: { kids: Thread[]; open: boolean; onFold: () => void };
  /** Replaces the age or live state on the top row. */
  state?: React.ReactNode;
  /** Replaces Snooze and Settle on hover. */
  actions?: React.ReactNode;
}) {
  const selected = ctx.selected === t.id;
  const live = <CardState t={t} now={ctx.now} />;
  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        "sb-card",
        selected && "selected",
        t.unread && "unread",
        !selected && !t.unread && "dim",
        compact && "compact",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => ctx.open(t.id)}
      onKeyDown={(e) => e.key === "Enter" && ctx.open(t.id)}
    >
      {!compact && (
        <div className="sb-card-top">
          <Badge name={t.project} />
          <span className="sb-card-name">
            <span className="sb-card-project">{t.project}</span>
          </span>
          {state ?? live}
          <div className="sb-card-actions">
            {actions ?? (
              <>
                <button
                  className="sb-card-action icon"
                  aria-label="Snooze"
                  title="Snooze"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Clock size={14} />
                </button>
                {!t.running && (
                  <button
                    className="sb-card-action"
                    title="Settle — hide until something new happens"
                    onClick={(e) => {
                      e.stopPropagation();
                      ctx.settle(t.id);
                    }}
                  >
                    <Check size={13} />
                    Settle
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <div className="sb-card-title">{t.title}</div>
      <div className="sb-card-meta">
        {family ? (
          <button
            className="sb-card-family"
            aria-expanded={family.open}
            onClick={(e) => {
              e.stopPropagation();
              family.onFold();
            }}
          >
            {family.open ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )}
            {familyLine(family.kids)}
          </button>
        ) : (
          <span className="sb-card-branch">{t.branch}</span>
        )}
        {compact && live}
        {compact && !t.running && (
          <div className="sb-card-actions">
            <button
              className="sb-card-action icon"
              title="Settle — hide until something new happens"
              aria-label={`Settle ${t.title}`}
              onClick={(e) => {
                e.stopPropagation();
                ctx.settle(t.id);
              }}
            >
              <Check size={13} />
            </button>
          </div>
        )}
        <span className="sb-card-provider">
          <ProviderIcon provider={t.provider} />
        </span>
      </div>
    </div>
  );
}

/** D: Settle on a lead with threads still working asks what to do with them. */
function AskSettle({
  working,
  onLater,
  onNow,
}: {
  working: number;
  onLater: () => void;
  onNow: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        data-popup-shown={open || undefined}
        className="sb-card-action"
        title="Settle — hide until something new happens"
        onClick={(e) => e.stopPropagation()}
      >
        <Check size={13} />
        Settle
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="sb-menu-positioner"
        >
          <Popover.Popup
            className="sb-menu"
            aria-label="Settle"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sb-snooze-presets">
              <div className="sb-menu-heading">
                {working} threads it started are still working
              </div>
              <button
                className="sb-menu-item"
                onClick={() => {
                  setOpen(false);
                  onLater();
                }}
              >
                <span>Settle when they're done</span>
                <small>with the rest</small>
              </button>
              <button
                className="sb-menu-item"
                onClick={() => {
                  setOpen(false);
                  onNow();
                }}
              >
                <span>Settle now</span>
                <small>keep the {working} out</small>
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function App() {
  const params = new URLSearchParams(location.search);
  const [variant, setVariant] = useState<Variant>(
    (params.get("v") as Variant) || "b",
  );
  const [now, setNow] = useState(Date.now());
  const [threads, setThreads] = useState(() => sample(Date.now()));
  const [selected, setSelected] = useState("");
  /** C, or D answered "when they're done": the lead waits for its threads. */
  const [waiting, setWaiting] = useState(false);
  /** D answered "now": draws like B. */
  const [askedNow, setAskedNow] = useState(false);
  const [folded, setFolded] = useState(false);
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark" ||
      matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const patch = (id: string, change: Partial<Thread>) =>
    setThreads((all) =>
      all.map((t) => (t.id === id ? { ...t, ...change } : t)),
    );

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setThreads(sample(Date.now()));
    setSelected("");
    setWaiting(false);
    setAskedNow(false);
    setFolded(false);
  };

  const pick = (v: Variant) => {
    setVariant(v);
    history.replaceState(null, "", `?v=${v}`);
    reset();
  };

  /** The working ones finish a few seconds apart once the lead is settled. */
  const finishLater = () => {
    for (const [id, after] of Object.entries(FINISH_AFTER))
      timers.current.push(
        window.setTimeout(
          () =>
            patch(id, {
              running: false,
              runningSince: undefined,
              unread: true,
              updated: Date.now(),
            }),
          after,
        ),
      );
  };

  const kidsOf = (id: string, all = threads) =>
    all.filter((t) => t.parent === id && !t.settledAt);

  /** What the backend does today: the lead and its finished threads settle. */
  const settleNow = (id: string) => {
    const at = Date.now();
    setThreads((all) =>
      all.map((t) =>
        t.id === id || (t.parent === id && !t.running && !t.settledAt)
          ? { ...t, settledAt: at }
          : t,
      ),
    );
    if (id === "lead") finishLater();
  };

  /** C: the finished ones go now, the lead waits for the rest. */
  const settleWhenDone = () => {
    const at = Date.now();
    setThreads((all) =>
      all.map((t) =>
        t.parent === "lead" && !t.running && !t.unread && !t.settledAt
          ? { ...t, settledAt: at }
          : t,
      ),
    );
    setWaiting(true);
    finishLater();
  };

  // C: once every thread left is done and read, the whole family settles.
  useEffect(() => {
    if (!waiting) return;
    const kids = kidsOf("lead");
    if (kids.some((k) => k.running || k.unread)) return;
    setWaiting(false);
    const at = Date.now();
    setThreads((all) =>
      all.map((t) =>
        t.id === "lead" || (t.parent === "lead" && !t.settledAt)
          ? { ...t, settledAt: at }
          : t,
      ),
    );
  }, [waiting, threads]);

  const ctx: Ctx = {
    now,
    selected,
    open: (id) => {
      setSelected(id);
      patch(id, { unread: false });
    },
    settle: (id) => {
      if (
        id === "lead" &&
        variant === "c" &&
        kidsOf("lead").some((k) => k.running)
      )
        return settleWhenDone();
      settleNow(id);
    },
  };

  const listed = threads.filter((t) => !t.settledAt);
  const listedIds = new Set(listed.map((t) => t.id));
  const lead = threads.find((t) => t.id === "lead")!;
  const leadKids = kidsOf("lead");
  const style = variant === "d" ? (askedNow ? "b" : "c") : variant;
  // Started threads whose lead is settled: loose cards today, or under a header.
  const orphans = listed.filter((t) => t.parent && !listedIds.has(t.parent));
  const settled = threads
    .filter((t) => t.settledAt)
    .sort((a, b) => b.settledAt! - a.settledAt!);

  const leadCard = (t: Thread) => {
    const kids = kidsOf(t.id);
    const working = kids.filter((k) => k.running).length;
    const open = kids.length > 0 && !folded;
    return (
      <Fragment key={t.id}>
        <Card
          t={t}
          ctx={ctx}
          family={
            kids.length
              ? { kids, open, onFold: () => setFolded(!folded) }
              : undefined
          }
          state={
            waiting ? (
              <span className="sb-card-state sf-pending">
                <Check size={12} />
                Settles when done
              </span>
            ) : undefined
          }
          actions={
            waiting ? (
              <button
                className="sb-card-action"
                title="Keep it in Activity after all"
                onClick={(e) => {
                  e.stopPropagation();
                  setWaiting(false);
                }}
              >
                <Undo2 size={13} />
                Keep open
              </button>
            ) : variant === "d" && working ? (
              <>
                <button
                  className="sb-card-action icon"
                  aria-label="Snooze"
                  title="Snooze"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Clock size={14} />
                </button>
                <AskSettle
                  working={working}
                  onLater={settleWhenDone}
                  onNow={() => {
                    setAskedNow(true);
                    settleNow("lead");
                  }}
                />
              </>
            ) : undefined
          }
        />
        {open && (
          <div className="sb-started">
            {kids.map((k) => (
              <Card key={k.id} t={k} ctx={ctx} compact />
            ))}
          </div>
        )}
      </Fragment>
    );
  };

  const settledHeader = () => (
    <Fragment key="settled-lead">
      <div
        role="button"
        tabIndex={0}
        className={`sf-settled-lead ${selected === lead.id ? "selected" : ""}`}
        onClick={() => setSelected(lead.id)}
        onKeyDown={(e) => e.key === "Enter" && setSelected(lead.id)}
      >
        <Badge name={lead.project} />
        <span className="sf-settled-title">{lead.title}</span>
        <small>Settled</small>
        <button
          className="sb-card-action icon"
          title="Move back to activity"
          aria-label="Unsettle"
          onClick={(e) => {
            e.stopPropagation();
            patch(lead.id, { settledAt: undefined });
          }}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <div className="sb-started sf-under-settled">
        {orphans
          .filter((o) => o.parent === lead.id)
          .map((k) => (
            <Card key={k.id} t={k} ctx={ctx} compact />
          ))}
      </div>
    </Fragment>
  );

  const cards: React.ReactNode[] = [];
  let headerDrawn = false;
  for (const t of listed) {
    if (t.parent && listedIds.has(t.parent)) continue;
    if (t.parent && !listedIds.has(t.parent)) {
      if (style === "a") cards.push(<Card key={t.id} t={t} ctx={ctx} />);
      else if (!headerDrawn) {
        headerDrawn = true;
        cards.push(settledHeader());
      }
      continue;
    }
    cards.push(
      t.id === "lead" ? leadCard(t) : <Card key={t.id} t={t} ctx={ctx} />,
    );
  }
  const topCount = cards.length;

  const current = variants.find((v) => v.id === variant)!;
  const story =
    lead.settledAt || waiting
      ? leadKids.some((k) => k.running)
        ? "The working ones finish on their own in a few seconds; click one to read it."
        : "Done. Settle or open what's left, or Reset."
      : "Hover the Relay card and press Settle.";

  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>Settling a lead</strong>
        <span className="preview-tag">Sample data</span>
        <div className="preview-segmented" role="radiogroup">
          {variants.map((v) => (
            <button
              key={v.id}
              role="radio"
              aria-checked={v.id === variant}
              onClick={() => pick(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="sf-about">
          {current.about} <em>{story}</em>
        </span>
        <button className="sf-bar-button" onClick={reset}>
          Reset
        </button>
        <button
          className="sf-bar-button"
          aria-label="Toggle theme"
          onClick={() => {
            setMode(dark ? "light" : "dark");
            setDark(!dark);
          }}
        >
          {dark ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
      <div className="sf-stage">
        <aside className="sf-sidebar">
          <div className="sb">
            <div className="sb-view-heading sf-heading">
              <h2>Activity</h2>
              <small>{topCount ? `${topCount} open` : "All settled"}</small>
            </div>
            <div className="sb-scroll">
              <div className="sb-cards">{cards}</div>
              {settled.length > 0 && (
                <section className="sb-shelf">
                  <button className="sb-shelf-toggle" aria-expanded>
                    <span>
                      Settled <b>{settled.length}</b>
                    </span>
                    <hr />
                    <ChevronRight size={12} />
                  </button>
                  <div className="sb-shelf-list">
                    {settled.map((t) => (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        className={`sb-compact ${selected === t.id ? "selected" : ""}`}
                        onClick={() => setSelected(t.id)}
                      >
                        <Badge name={t.project} />
                        <span className="sb-compact-title">{t.title}</span>
                        <small>{shortAge(t.updated, now)}</small>
                        <button
                          className="sb-card-action icon"
                          title="Move back to activity"
                          aria-label="Unsettle"
                          onClick={(e) => {
                            e.stopPropagation();
                            patch(t.id, { settledAt: undefined });
                          }}
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
