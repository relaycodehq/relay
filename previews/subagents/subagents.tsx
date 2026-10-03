// Subagents beside the Project folder control: an icon and a count while any
// run, five hover cards to choose from, and each agent's run opened read-only.
// Sample data on a clock you can scrub; the app's own styles and turn view.
// Open http://127.0.0.1:5177/previews/subagents/
import "../_shared/desktop-stub";
import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  FolderGit2,
  GitBranch,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import "../../src/styles.css";
import "../../src/app/projects.css";
import "../../src/features/agents/composer-model-picker.css";
import "../_shared/deep-review.css";
import "./subagents.css";
import { initAppearance, setMode, useAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { AgentTurn } from "../../src/features/agent-turn/AgentTurn";
import { RichText } from "../../src/ui/ui";
import { CheckoutControl } from "../../src/features/thread/WorktreeControls";
import type { AgentWorktree } from "../../shared/projects";
import {
  agentAt,
  clock,
  clockEnd,
  currentBatch,
  mainTurnAt,
  projectRoot,
  scripts,
} from "./subagents-data";
import {
  AgentsIndicator,
  variants,
  type CountStyle,
  type Variant,
} from "./subagents-hover";
import { AgentRun, type OpenAs } from "./subagents-view";

initAppearance();
initWindowFocus();

const worktrees: AgentWorktree[] = [
  {
    path: `${projectRoot}-phone`,
    branch: "phone-remote",
    at: Date.now() - 86400000,
  },
  {
    path: `${projectRoot}-share`,
    branch: "share-redesign",
    at: Date.now() - 3600000,
  },
];

function Segmented<T extends string | number>({
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
          key={String(o.value)}
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
  const [variant, setVariant] = useState<Variant>("list");
  const [count, setCount] = useState<CountStyle>("fraction");
  const [openAs, setOpenAs] = useState<OpenAs>("panel");
  const [t, setT] = useState(24);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(3);
  // When you stopped an agent, on the preview clock.
  const [stopped, setStopped] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string>();
  const [dock, setDock] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setT((x) => Math.min(x + 1, clockEnd)),
      1000 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed]);
  useEffect(() => {
    if (t >= clockEnd) setPlaying(false);
  }, [t]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const agents = scripts.map((s) => agentAt(s, t, stopped[s.id]));
  const batch = currentBatch(agents, t);
  const main = mainTurnAt(t, agents, Date.now());
  // Scrubbing back before an agent started closes its run.
  const open = agents.find(
    (a) => a.script.id === openId && a.status !== "waiting",
  );
  const note = variants.find((v) => v.value === variant)!.note;

  const restart = () => {
    setT(0);
    setStopped({});
    setOpenId(null);
    setPlaying(true);
  };
  const stop = (id: string) => {
    setStopped((all) => ({ ...all, [id]: t }));
    setToast(
      "Stops only this agent (the SDK's stopTask). Claude hears it was stopped.",
    );
  };

  const run = open && (
    <AgentRun
      agents={agents}
      open={open}
      as={openAs}
      onSelect={setOpenId}
      onClose={() => setOpenId(null)}
      onStop={stop}
      onToast={setToast}
    />
  );

  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <Bot size={14} /> Subagents
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Hover card</span>
          <Segmented<Variant>
            label="Hover card"
            value={variant}
            onChange={setVariant}
            options={variants.map((v) => ({ value: v.value, label: v.label }))}
          />
        </div>
        <div className="preview-control">
          <span>Count</span>
          <Segmented<CountStyle>
            label="Count"
            value={count}
            onChange={setCount}
            options={[
              { value: "fraction", label: "Done / all" },
              { value: "running", label: "Working" },
              { value: "ticks", label: "Ticks" },
            ]}
          />
        </div>
        <div className="preview-control">
          <span>Opens as</span>
          <Segmented<OpenAs>
            label="Opens as"
            value={openAs}
            onChange={setOpenAs}
            options={[
              { value: "panel", label: "Panel" },
              { value: "thread", label: "Side thread" },
            ]}
          />
        </div>
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
        <div className="preview-clock">
          <button
            type="button"
            className="preview-icon"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
            onClick={() => (t >= clockEnd ? restart() : setPlaying(!playing))}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <input
            type="range"
            min={0}
            max={clockEnd}
            value={t}
            aria-label="Preview clock"
            onChange={(e) => setT(Number(e.target.value))}
          />
          <span className="preview-time">
            {clock(t)} / {clock(clockEnd)}
          </span>
          <Segmented<number>
            label="Speed"
            value={speed}
            onChange={setSpeed}
            options={[
              { value: 1, label: "1×" },
              { value: 3, label: "3×" },
              { value: 10, label: "10×" },
            ]}
          />
          <button
            type="button"
            className="preview-icon"
            aria-label="Restart"
            title="Restart"
            onClick={restart}
          >
            <RotateCcw size={13} />
          </button>
          <span className="preview-note">
            {note} Hover the <Bot size={12} /> icon left of “2 worktrees”.
          </span>
        </div>
      </div>

      <div className="preview-titlebar">
        <FolderGit2 size={14} />
        <span className="muted">relay</span>
        <span className="muted">/</span>
        <span>Show running subagents by the composer</span>
      </div>

      <div className="project-chat-pane">
        {open && openAs === "thread" ? (
          run
        ) : (
          <section
            className="project-chat"
            style={{ "--composer-dock-height": `${dock}px` } as CSSProperties}
          >
            <div className="thread-subheader">
              <span className="thread-privacy">
                <LockKeyhole size={13} /> Private thread
              </span>
            </div>
            <Thread>
              <article className="project-message user">
                <header>
                  <strong>You</strong>
                </header>
                <div className="markdown">
                  <p>
                    Show running subagents next to the Project folder control,
                    with a count, and let me open one to see what it's doing.
                    Find out what the SDK gives us first.
                  </p>
                </div>
              </article>
              <article className="project-message assistant">
                <header>
                  <strong>
                    <ProviderIcon provider="claude" />
                    Claude
                  </strong>
                </header>
                <AgentTurn
                  message={main}
                  projectRoot={projectRoot}
                  onOpenFile={() => setToast("Opens the file, as in the app")}
                  onChanges={() => {}}
                />
                {main.body && (
                  <RichText
                    text={main.body}
                    projectRoot={projectRoot}
                    onOpenFile={() => setToast("Opens the file, as in the app")}
                  />
                )}
              </article>
            </Thread>
            <Dock onHeight={setDock}>
              <div className="thread-context-controls">
                <AgentsIndicator
                  batch={batch}
                  count={count}
                  variant={variant}
                  now={t}
                  onOpen={setOpenId}
                />
                <CheckoutControl
                  worktrees={worktrees}
                  onReveal={() =>
                    setToast("Opens the worktree in Finder, as in the app")
                  }
                />
                <button type="button" className="composer-branch-trigger">
                  <GitBranch size={13} />
                  <span>main</span>
                  <ChevronDown size={12} />
                </button>
                <button
                  type="button"
                  className="composer-branch-sync"
                  data-state="push"
                  aria-label="Push 8 commits to origin/main"
                  onClick={() => setToast("Pushes, as in the app")}
                >
                  <span>
                    <ArrowUp size={12} />8
                  </span>
                </button>
              </div>
              <form
                className="project-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  setToast("Preview: sending isn't wired up");
                }}
              >
                <textarea
                  className="composer-prompt-input dr-textarea dr-docked"
                  aria-label="Message Claude"
                  placeholder="Steer Claude while its agents work…"
                />
                <div className="composer-tools">
                  <span className="spacer" />
                  <button
                    type="submit"
                    className="send-message"
                    aria-label="Send"
                  >
                    <ArrowUp size={16} />
                  </button>
                </div>
              </form>
            </Dock>
          </section>
        )}
        {openAs === "panel" && run}
      </div>

      {toast && (
        <div className="dr-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** The thread stays pinned to its end while the turn grows. */
function Thread({ children }: { children: ReactNode }) {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      const el = scroll.current!;
      if (follow.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(column.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="project-messages"
      ref={scroll}
      onScroll={() => {
        const el = scroll.current!;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="thread-message-column" ref={column}>
        {children}
      </div>
    </div>
  );
}

function Dock({
  children,
  onHeight,
}: {
  children: ReactNode;
  onHeight: (height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() =>
      onHeight(ref.current!.offsetHeight),
    );
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [onHeight]);
  return (
    <div className="thread-bottom-composer" ref={ref}>
      <div className="thread-compose-wrap">{children}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
