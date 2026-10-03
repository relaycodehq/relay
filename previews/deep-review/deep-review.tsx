// Deep review, previewed on sample data with the app's own styles and
// controls. Open http://127.0.0.1:5177/previews/deep-review.html
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  LockKeyhole,
  MessageSquareReply,
  Plus,
  ScanSearch,
  ShieldCheck,
  Telescope,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import "../../src/styles.css";
import "../../src/app/projects.css";
import "../../src/features/agents/composer-model-picker.css";
import "../../src/features/thread/code-references.css";
import "../../src/features/changes/changed-files.css";
import "../_shared/deep-review.css";
import { initAppearance, setMode, useAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { ModelField } from "../../src/features/agents/ModelField";
import { agentProviders, reviewerProviders } from "../../shared/agents";
import { ComposerSelect } from "../../src/ui/ComposerSelect";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { ProjectHeadlinePicker } from "../../src/features/projects/ProjectHeadlinePicker";
import { AgentTurn } from "../../src/features/agent-turn/AgentTurn";
import { ChangedFilesCard } from "../../src/features/changes/ChangedFilesCard";
import { FileEntryIcon, RichText } from "../../src/ui/ui";
import type { ProjectFileLink } from "../../shared/project-file-links";
import type {
  AgentActivity,
  AgentTrace,
  ChatMessage,
  Project,
} from "../../shared/projects";
import { effortLabels, type ModelChoice } from "../../shared/settings";
import type { AgentProvider } from "../../shared/agents";

initAppearance();
initWindowFocus();

type Agent = { id: string; provider: AgentProvider; choice: ModelChoice };
type Stage = "setup" | "reviewing" | "findings";
type Look = "verdict" | "cards" | "report";
type Target = "uncommitted" | "branch" | "pr" | "commit";
type Severity = "high" | "medium" | "low";
type Status = "open" | "fixing" | "fixed" | "dismissed";

/** The first two are the default pair; Add reviewer takes the next one. */
const lineup: Agent[] = [
  {
    id: "r1",
    provider: "claude",
    choice: { model: "claude-opus-5-5", reasoningEffort: "high", fast: false },
  },
  {
    id: "r2",
    provider: "codex",
    choice: { model: "gpt-5.6-sol", reasoningEffort: "high", fast: false },
  },
  {
    id: "r3",
    provider: "codex",
    choice: { model: "gpt-5.5", reasoningEffort: "high", fast: false },
  },
  {
    id: "r4",
    provider: "claude",
    choice: { model: "claude-opus-5-5", reasoningEffort: "xhigh", fast: false },
  },
];

const projects: Project[] = ["relay", "relay-releases", "openusage"].map(
  (name, i) => ({
    id: name,
    name,
    path: `/Users/you/${name}`,
    repository: null,
    added: i,
  }),
);

const claudeNames: Record<string, string> = {
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};
function modelName({ provider, choice }: Agent) {
  if (provider === "claude")
    return claudeNames[choice.model] ?? (choice.model || "Claude default");
  if (!choice.model) return "Codex default";
  return choice.model
    .replace(/^gpt-/, "GPT-")
    .replace(/-([a-z])/g, (_, c: string) => " " + c.toUpperCase());
}
const effortOf = ({ choice }: Agent) =>
  choice.reasoningEffort ? effortLabels[choice.reasoningEffort] : "Default";
const nativeReview = (agent: Agent) =>
  agent.provider === "codex" ? "Codex /review" : "/code-review";

const projectRoot = "/Users/you/relay";
type Step =
  | { at: number; say: string }
  | { at: number; kind: AgentActivity["kind"]; label: string; took: number };

/** A scripted turn as the chat would hold it `elapsed` ms after it began. */
function turnAt(
  id: string,
  provider: AgentProvider,
  script: { ms: number; steps: Step[]; body: string },
  created: number,
  elapsed: number,
): ChatMessage {
  const done = elapsed >= script.ms;
  // The answer streams in over the last moment of the turn.
  const written = Math.min(1, Math.max(0, (elapsed - script.ms + 800) / 800));
  const trace = script.steps.flatMap((step, i): AgentTrace[] => {
    if (step.at > elapsed) return [];
    const key = `${id}-${i}`;
    if ("say" in step) return [{ kind: "commentary", id: key, text: step.say }];
    return [
      {
        kind: "activity",
        id: key,
        activity: {
          id: key,
          kind: step.kind,
          label: step.label,
          status:
            done || elapsed >= step.at + step.took ? "complete" : "running",
        },
      },
    ];
  });
  return {
    id,
    role: "assistant",
    provider,
    status: done ? "complete" : "streaming",
    body: done
      ? script.body
      : script.body.slice(0, Math.floor(script.body.length * written)),
    created,
    ...(done ? { ended: created + script.ms } : {}),
    trace,
    version: 1,
  };
}

/** What each reviewer slot does, as its own agent turn. */
const scripts: { ms: number; found: number; steps: Step[]; body: string }[] = [
  {
    ms: 6500,
    found: 3,
    steps: [
      { at: 0, kind: "command", label: "git diff --stat HEAD", took: 500 },
      {
        at: 600,
        say: "Seven files changed. Starting with the queue and the thread scope.",
      },
      {
        at: 900,
        kind: "read",
        label: "src/components/ProjectChat.tsx",
        took: 700,
      },
      { at: 1700, kind: "search", label: "setQueryData", took: 500 },
      {
        at: 2300,
        kind: "read",
        label: "src/components/ProjectShell.tsx",
        took: 700,
      },
      {
        at: 3100,
        say: "The drop handler writes back a list it read before the last move landed. Now the new strip.",
      },
      {
        at: 3500,
        kind: "read",
        label: "src/components/waiting-strip.css",
        took: 500,
      },
      { at: 4100, kind: "search", label: "data-inactive", took: 500 },
      {
        at: 4700,
        kind: "read",
        label: "src/components/PastedTextCard.tsx",
        took: 600,
      },
    ],
    body: [
      "Found **3 issues** in the uncommitted changes.",
      "",
      "1. **High** · Reordering the queue can drop a message, `src/components/ProjectChat.tsx:895`. The drop handler writes back the list it read before the previous move landed.",
      "2. **High** · The thread keeps its PR scope after a checkout, `src/components/ProjectShell.tsx:199`.",
      "3. **Medium** · The waiting strip animates while the window is unfocused, `src/components/waiting-strip.css:12`. It isn’t in the `:root[data-inactive]` list.",
      "",
      "`PastedTextCard.tsx` and `pasted-texts.ts` look fine.",
    ].join("\n"),
  },
  {
    ms: 8500,
    found: 4,
    steps: [
      {
        at: 0,
        kind: "command",
        label: "/bin/zsh -lc 'git diff --stat'",
        took: 500,
      },
      {
        at: 600,
        kind: "command",
        label: "/bin/zsh -lc 'git diff -- src/components/ProjectChat.tsx'",
        took: 700,
      },
      {
        at: 1500,
        kind: "command",
        label: "/bin/zsh -lc \"rg -n 'setQueryData' src/components\"",
        took: 600,
      },
      {
        at: 2300,
        say: "The queue drop reuses a stale list. Looking at the waiting strip and the pasted text card next.",
      },
      {
        at: 2900,
        kind: "command",
        label: "/bin/zsh -lc 'sed -n 1,40p src/components/waiting-strip.css'",
        took: 500,
      },
      {
        at: 3600,
        kind: "command",
        label: "/bin/zsh -lc \"rg -n 'data-inactive' src/styles.css\"",
        took: 500,
      },
      {
        at: 4400,
        kind: "command",
        label: "/bin/zsh -lc 'git diff -- src/components/PastedTextCard.tsx'",
        took: 700,
      },
      {
        at: 5500,
        kind: "command",
        label: "/bin/zsh -lc 'git diff -- src/components/ProjectSidebar.tsx'",
        took: 600,
      },
    ],
    body: [
      "- **[P1] Queue reorder can drop a message**, `src/components/ProjectChat.tsx:895`. Two quick moves: the second writes back the list read before the first landed.",
      "- **[P2] Waiting strip animates while unfocused**, `src/components/waiting-strip.css:12`.",
      "- **[P2] Pasted text card lost on reload**, `src/components/PastedTextCard.tsx:48`.",
      "- **[P3] Unused import**, `src/components/ProjectSidebar.tsx:12`.",
    ].join("\n"),
  },
  {
    ms: 7000,
    found: 2,
    steps: [
      { at: 0, kind: "read", label: "shared/pasted-texts.ts", took: 600 },
      {
        at: 800,
        kind: "read",
        label: "tests/unit/pasted-texts.test.ts",
        took: 600,
      },
      {
        at: 1600,
        say: "The tests cover long pastes but not CRLF input. Trying one.",
      },
      {
        at: 2100,
        kind: "command",
        label: "npx vitest run tests/unit/pasted-texts.test.ts",
        took: 1600,
      },
      { at: 3900, kind: "search", label: "claudeModels", took: 500 },
      {
        at: 4600,
        kind: "read",
        label: "src/components/ModelField.tsx",
        took: 600,
      },
    ],
    body: [
      "Found **2 issues**.",
      "",
      "1. **Medium** · CRLF pastes count double toward the limit, `shared/pasted-texts.ts:31`.",
      "2. **Low** · The Claude model list is cached two ways, `src/components/ModelField.tsx:45`.",
    ].join("\n"),
  },
  {
    ms: 10000,
    found: 2,
    steps: [
      { at: 0, kind: "command", label: "git diff --stat", took: 500 },
      {
        at: 800,
        kind: "command",
        label: "sed -n 1,30p src/components/waiting-strip.css",
        took: 500,
      },
      {
        at: 1800,
        kind: "command",
        label: "rg -n 'infinite' src/components",
        took: 600,
      },
      { at: 3000, say: "One loop isn’t paused. Checking the title changes." },
      {
        at: 3600,
        kind: "command",
        label: "git diff -- electron/thread-titles.ts",
        took: 700,
      },
      {
        at: 5500,
        kind: "command",
        label: "rg -n 'slice(0, 80' electron",
        took: 600,
      },
    ],
    body: [
      "- **[P2] Waiting strip animates while unfocused**, `src/components/waiting-strip.css:12`.",
      "- **[P3] Thread titles can exceed 80 characters**, `electron/thread-titles.ts:40`.",
    ].join("\n"),
  },
];
const verifyMs = 4500;
const verifySteps = (runChecks: boolean): Step[] => [
  { at: 0, say: "Merging duplicates, then checking each finding in the code." },
  {
    at: 300,
    kind: "read",
    label: "src/components/ProjectChat.tsx",
    took: 500,
  },
  {
    at: 900,
    kind: "read",
    label: "src/components/ProjectShell.tsx",
    took: 400,
  },
  {
    at: 1400,
    kind: "read",
    label: "src/components/waiting-strip.css",
    took: 300,
  },
  { at: 1800, kind: "read", label: "shared/pasted-texts.ts", took: 300 },
  ...(runChecks
    ? [
        {
          at: 2200,
          kind: "command" as const,
          label: "npx vitest run tests/unit/queue-reorder.test.ts",
          took: 1200,
        },
      ]
    : []),
  { at: 3500, kind: "read", label: "electron/thread-titles.ts", took: 300 },
];

type Finding = {
  id: string;
  severity: Severity;
  title: string;
  path: string;
  line: number;
  /** Other places the same problem shows up. */
  also?: { path: string; line: number }[];
  why: ReactNode;
  code: string[];
  /** Reviewer slots that raised it. */
  slots: number[];
  check: string;
};
const findings: Finding[] = [
  {
    id: "queue",
    severity: "high",
    title: "Reordering the queue can drop a message",
    path: "src/components/ProjectChat.tsx",
    line: 895,
    why: "The drop handler writes back the list it read before the previous move landed. Two quick moves and the second overwrites the first, so a queued message disappears.",
    code: [
      "if (!chat || !queue || !moving || !target || target.id === moving) return;",
      'qc.setQueryData<ProjectChatData>(["project-chat", chat.id], (data) =>',
    ],
    slots: [0, 1],
    check: "Reproduced with a test: two moves 10 ms apart lose one message.",
  },
  {
    id: "scope",
    severity: "high",
    title: "Thread keeps its PR scope after switching branch",
    path: "src/components/ProjectShell.tsx",
    line: 199,
    why: "Checking out another branch leaves the thread scoped to the old PR, so the agent keeps reviewing files that are no longer on disk.",
    also: [{ path: "src/components/ProjectChat.tsx", line: 456 }],
    code: ["if (dirty) {", "  setQueuedUrl(url);"],
    slots: [0],
    check: "Confirmed by following the checkout path.",
  },
  {
    id: "strip",
    severity: "medium",
    title: "Waiting strip keeps animating when the window is unfocused",
    path: "src/components/waiting-strip.css",
    line: 12,
    why: (
      <>
        Its pulse is <code>infinite</code> but missing from the{" "}
        <code>:root[data-inactive]</code> list in <code>styles.css</code>, so it
        repaints behind the editor.
      </>
    ),
    also: [{ path: "src/styles.css", line: 1446 }],
    code: ["animation: waiting-pulse 1.6s ease-in-out infinite;"],
    slots: [0, 1, 3],
    check: "Confirmed: the class isn’t in the pause list.",
  },
  {
    id: "draft",
    severity: "medium",
    title: "A pasted text card disappears on reload",
    path: "src/components/PastedTextCard.tsx",
    line: 48,
    why: "Pastes now live only in component state, so a reload keeps the draft text but drops its card.",
    code: ["const [pastes, setPastes] = useState<PastedText[]>([]);"],
    slots: [1],
    check: "Reproduced in the app: paste, reload, the card is gone.",
  },
  {
    id: "query",
    severity: "low",
    title: "Two cache lifetimes for one Claude model list",
    path: "src/components/ModelField.tsx",
    line: 45,
    why: "Settings caches the list forever while the composer refetches it, so after an update they can offer different models.",
    also: [{ path: "src/components/ProjectComposer.tsx", line: 174 }],
    code: ["queryFn: () => api.claudeModels(),", "staleTime: Infinity,"],
    slots: [2],
    check: "Confirmed by reading both queries.",
  },
];
const dropped = [
  {
    title: "CRLF pastes count double toward the limit",
    at: "shared/pasted-texts.ts:31",
    reason: "Didn’t reproduce: line endings are normalised first.",
    slot: 2,
  },
  {
    title: "Unused import",
    at: "src/components/ProjectSidebar.tsx:12",
    reason: "Already gone in the working tree.",
    slot: 1,
  },
  {
    title: "Thread titles can exceed 80 characters",
    at: "electron/thread-titles.ts:40",
    reason: "Clamped a few lines later.",
    slot: 3,
  },
];
/** Codex's review scale: P0 drops everything, P3 is nice to have. */
const priority: Record<Severity, { tag: string; meaning: string }> = {
  high: { tag: "P1", meaning: "Fix before this merges" },
  medium: { tag: "P2", meaning: "Should be fixed" },
  low: { tag: "P3", meaning: "Nice to fix" },
};
const severityLabel: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const fileName = (path: string) => path.split("/").pop() ?? path;
const time = (offset: number) =>
  new Date(Date.now() + offset * 60000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

function useClock(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

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
  const [stage, setStage] = useState<Stage>("setup");
  const [look, setLook] = useState<Look>("report");
  const [deep, setDeep] = useState(true);
  const [project, setProject] = useState(projects[0]);
  const [reviewers, setReviewers] = useState<Agent[]>(() => lineup.slice(0, 2));
  const [lead, setLead] = useState<Agent>({
    id: "lead",
    provider: "claude",
    choice: { model: "claude-opus-5-5", reasoningEffort: "high", fast: false },
  });
  const [runChecks, setRunChecks] = useState(true);
  const [target, setTarget] = useState<Target>("uncommitted");
  const [base, setBase] = useState("main");
  const [pr, setPr] = useState("42");
  const [commit, setCommit] = useState("75cf43f");
  const [checkout, setCheckout] = useState("main");
  const [focus, setFocus] = useState("");
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [selected, setSelected] = useState<string[]>(["queue", "scope"]);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [exchanges, setExchanges] = useState<
    { id: number; ids: string[]; note: string; done: boolean }[]
  >([]);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string>();
  const [dock, setDock] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const count = reviewers.length;
  const active = findings
    .map((f) => ({ ...f, slots: f.slots.filter((s) => s < count) }))
    .filter((f) => f.slots.length);
  const activeDropped = dropped.filter((d) => d.slot < count);
  const raw = scripts.slice(0, count).reduce((n, s) => n + s.found, 0);
  const reviewMs = Math.max(...scripts.slice(0, count).map((s) => s.ms));
  const now = useClock(stage === "reviewing");
  const elapsed = now - startedAt;

  useEffect(() => {
    if (stage === "reviewing" && elapsed >= reviewMs + verifyMs)
      setStage("findings");
  }, [stage, elapsed, reviewMs]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function go(next: Stage) {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setExchanges([]);
    setStatus({});
    setSelected(["queue", "scope"]);
    if (next === "reviewing") setStartedAt(Date.now());
    setStage(next);
  }
  function setCount(n: number) {
    setReviewers((current) =>
      n <= current.length
        ? current.slice(0, n)
        : [...current, ...lineup.slice(current.length, n)],
    );
  }
  const statusOf = (id: string): Status => status[id] ?? "open";
  const open = active.filter((f) => statusOf(f.id) === "open");
  const chosen = open.filter((f) => selected.includes(f.id));
  // Style B carries the picked findings in the composer.
  const picking = stage === "findings" && look === "cards" ? chosen : [];
  function toggle(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }
  function setOne(id: string, value: Status) {
    setStatus((s) => ({ ...s, [id]: value }));
    if (value !== "open") setSelected((s) => s.filter((x) => x !== id));
  }
  function fix(ids: string[], note = draft.trim()) {
    if (!ids.length) return;
    const id = Date.now();
    setExchanges((e) => [...e, { id, ids, note, done: false }]);
    setStatus((s) => ({
      ...s,
      ...Object.fromEntries(ids.map((i) => [i, "fixing" as const])),
    }));
    setSelected((s) => s.filter((x) => !ids.includes(x)));
    setDraft("");
    timers.current.push(
      setTimeout(() => {
        setExchanges((e) =>
          e.map((x) => (x.id === id ? { ...x, done: true } : x)),
        );
        setStatus((s) => ({
          ...s,
          ...Object.fromEntries(ids.map((i) => [i, "fixed" as const])),
        }));
      }, fixMs),
    );
  }
  function send() {
    if (picking.length) return fix(picking.map((f) => f.id));
    if (!draft.trim()) return;
    setExchanges((e) => [
      ...e,
      { id: Date.now(), ids: [], note: draft.trim(), done: true },
    ]);
    setDraft("");
  }
  const openFile = (f: { path: string; line?: number }) =>
    setToast(
      `Opens ${f.path}${f.line ? `:${f.line}` : ""} in the Changes diff`,
    );
  const openLink = (link: ProjectFileLink) => openFile(link);
  const high = active.filter((f) => f.severity === "high").length;
  const leadTurn = turnAt(
    "lead",
    lead.provider,
    {
      ms: verifyMs,
      steps: verifySteps(runChecks),
      body: `I checked all **${raw} findings** from ${count === 1 ? "the reviewer" : `the ${count} reviewers`} against the code. **${active.length} hold up**, ${high} of them high.${raw > active.length ? ` The other ${raw - active.length} were duplicates or didn’t hold up.` : ""}`,
    },
    startedAt + reviewMs,
    stage === "reviewing" ? elapsed - reviewMs : Infinity,
  );

  const findingsProps = {
    findings: active,
    count,
    reviewers,
    statusOf,
    selected,
    toggle,
    setOne,
    fix,
    openFile,
  };
  const targetLabel =
    target === "uncommitted"
      ? "Uncommitted changes"
      : target === "branch"
        ? `feature/deep-review vs ${base}`
        : target === "pr"
          ? `PR #${pr}`
          : `Commit ${commit}`;

  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <ScanSearch size={14} /> Deep review
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Step</span>
          <Segmented<Stage>
            label="Step"
            value={stage}
            onChange={go}
            options={[
              { value: "setup", label: "1 · Set up" },
              { value: "reviewing", label: "2 · Reviewing" },
              { value: "findings", label: "3 · Findings" },
            ]}
          />
        </div>
        <div className="preview-control">
          <span>Findings style</span>
          <Segmented<Look>
            label="Findings style"
            value={look}
            onChange={(v) => {
              setLook(v);
              if (stage !== "findings") go("findings");
            }}
            options={[
              { value: "verdict", label: "A · Verdict card" },
              { value: "cards", label: "B · Finding cards" },
              { value: "report", label: "C · Report" },
            ]}
          />
        </div>
        <div className="preview-control">
          <span>Reviewers</span>
          <Segmented<string>
            label="Reviewers"
            value={String(count)}
            onChange={(v) => setCount(Number(v))}
            options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))}
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
      </div>

      <div className="preview-titlebar">
        <FolderGit2 size={14} />
        <span className="muted">{project.name}</span>
        <span className="muted">/</span>
        <span>
          {stage === "setup" ? "New thread" : `Deep review · ${targetLabel}`}
        </span>
      </div>

      <div className="project-chat-pane">
        {stage === "setup" ? (
          <section className="project-chat empty-thread">
            <div className="thread-subheader">
              <span className="thread-privacy">
                <LockKeyhole size={13} /> Private thread
              </span>
            </div>
            <div className="thread-start">
              <div className="thread-introduction">
                {/* Same headline as a new thread, with the app's project picker. */}
                <h1
                  aria-label={
                    deep
                      ? `Deep review of ${project.name}`
                      : `What should we work on in ${project.name}?`
                  }
                >
                  {deep ? "Deep review of " : "What should we work on in "}
                  <ProjectHeadlinePicker
                    project={project}
                    projects={projects}
                    onSelect={setProject}
                    onAdd={() => setToast("Adds a project, as in the app")}
                  />
                  {deep ? "" : "?"}
                </h1>
                <p>
                  {deep
                    ? "Reviewers read the changes on their own. The lead checks what they found, then fixes it with you."
                    : "Understand the code, work on an idea, or review your changes."}
                </p>
              </div>
              <div className="thread-compose-wrap">
                <ContextRow deep={deep} onDeep={setDeep} />
                <form
                  className="project-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (deep) go("reviewing");
                  }}
                >
                  {deep && (
                    <Setup
                      target={target}
                      onTarget={setTarget}
                      base={base}
                      onBase={setBase}
                      pr={pr}
                      onPr={setPr}
                      commit={commit}
                      onCommit={setCommit}
                      checkout={checkout}
                      onCheckout={setCheckout}
                      reviewers={reviewers}
                      onReviewers={setReviewers}
                      lead={lead}
                      onLead={setLead}
                      runChecks={runChecks}
                      onRunChecks={setRunChecks}
                    />
                  )}
                  <textarea
                    className="composer-prompt-input dr-textarea"
                    aria-label={deep ? "What to focus on" : "Message project"}
                    placeholder={
                      deep
                        ? "Anything to focus on? Optional, e.g. the queue changes, security…"
                        : "Ask about the code, plan a change, or build something…"
                    }
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && deep) {
                        e.preventDefault();
                        go("reviewing");
                      }
                    }}
                  />
                  <div className="composer-tools">
                    {deep ? (
                      <>
                        <span className="dr-hint">
                          {count} {count === 1 ? "reviewer" : "reviewers"} and a
                          lead · runs on your plan usage
                        </span>
                        <span className="spacer" />
                        <button type="submit" className="primary dr-start">
                          Start deep review
                        </button>
                      </>
                    ) : (
                      <>
                        <LeadButton agent={lead} />
                        <span className="spacer" />
                        <button
                          type="button"
                          className="send-message"
                          aria-label="Send"
                        >
                          <ArrowUp size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </form>
              </div>
            </div>
          </section>
        ) : (
          <section
            className="project-chat"
            style={{ "--composer-dock-height": `${dock}px` } as CSSProperties}
          >
            <Thread sent={exchanges.length}>
              <article className="project-message user">
                <header>
                  <strong>You</strong>
                  <time>{time(-3)}</time>
                </header>
                <div className="markdown">
                  <Request
                    label={targetLabel}
                    target={target}
                    reviewers={reviewers}
                    lead={lead}
                    focus={focus}
                  />
                </div>
              </article>

              <Council
                reviewers={reviewers}
                startedAt={startedAt}
                elapsed={stage === "reviewing" ? elapsed : Infinity}
                prompt={targetLabel}
                raw={raw}
                kept={active.length}
                collapsed={stage === "findings"}
                onOpenFile={openLink}
              />

              {(stage === "findings" ||
                (stage === "reviewing" && elapsed >= reviewMs)) && (
                <article className="project-message assistant">
                  <LeadHeader agent={lead} />
                  <AgentTurn
                    message={leadTurn}
                    projectRoot={projectRoot}
                    onOpenFile={openLink}
                    onChanges={() => {}}
                  />
                  {leadTurn.body && (
                    <RichText
                      text={leadTurn.body}
                      projectRoot={projectRoot}
                      onOpenFile={openLink}
                    />
                  )}
                  {stage === "findings" && look === "verdict" && (
                    <Verdict {...findingsProps} />
                  )}
                  {stage === "findings" && look === "cards" && (
                    <Cards {...findingsProps} />
                  )}
                  {stage === "findings" && look === "report" && (
                    <Report {...findingsProps} />
                  )}
                  {stage === "findings" && (
                    <Dropped items={activeDropped} reviewers={reviewers} />
                  )}
                </article>
              )}

              {exchanges.map((x) => (
                <Exchange
                  key={x.id}
                  exchange={x}
                  lead={lead}
                  onOpenFile={openLink}
                />
              ))}
            </Thread>
            <Dock onHeight={setDock}>
              {stage === "findings" && look === "cards" && open.length > 0 && (
                <div className="composer-plan-action">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => fix(open.map((f) => f.id))}
                  >
                    <Wrench size={14} /> Fix all {open.length}
                  </button>
                </div>
              )}
              <div className="thread-context-controls">
                <BranchButton />
              </div>
              <form
                className="project-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                {picking.length > 0 && (
                  <div className="code-refs" aria-label="Findings to fix">
                    {picking.map((f) => (
                      <div className="code-ref" key={f.id}>
                        <span className="code-ref-chip">
                          <button
                            type="button"
                            className="code-ref-toggle"
                            onClick={() => openFile(f)}
                          >
                            <i className="dr-dot" data-severity={f.severity} />
                            <span className="code-ref-name">{f.title}</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${f.title}`}
                            onClick={() => toggle(f.id)}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  className="composer-prompt-input dr-textarea dr-docked"
                  aria-label="Message the lead"
                  placeholder={
                    picking.length
                      ? `Anything to add? Send to fix ${picking.length === 1 ? "this finding" : `these ${picking.length} findings`}.`
                      : "Ask the lead about a finding, or tell it what to fix…"
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-tools">
                  <LeadButton agent={lead} />
                  <span className="spacer" />
                  <button
                    type="submit"
                    className="send-message"
                    aria-label="Send"
                    disabled={
                      stage === "reviewing" ||
                      (!draft.trim() && !picking.length)
                    }
                  >
                    <ArrowUp size={16} />
                  </button>
                </div>
              </form>
            </Dock>
          </section>
        )}
      </div>
      {toast && (
        <div className="dr-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function ContextRow({
  deep,
  onDeep,
}: {
  deep: boolean;
  onDeep: (deep: boolean) => void;
}) {
  return (
    <div className="thread-context-controls">
      <button
        type="button"
        className={`thread-context-button ${deep ? "" : "selected"}`}
        onClick={() => onDeep(false)}
      >
        <FolderGit2 size={14} />
        Repository
      </button>
      <button type="button" className="thread-context-button">
        <GitPullRequest size={14} />
        Review a PR
        <ChevronDown size={12} />
      </button>
      <button
        type="button"
        className={`thread-context-button ${deep ? "selected" : ""}`}
        onClick={() => onDeep(true)}
      >
        <ScanSearch size={14} />
        Deep review
      </button>
      <BranchButton />
    </div>
  );
}

function BranchButton() {
  return (
    <button type="button" className="composer-branch-trigger">
      <GitBranch size={13} />
      <span>main</span>
      <ChevronDown size={12} />
    </button>
  );
}

function LeadButton({ agent }: { agent: Agent }) {
  return (
    <button
      type="button"
      className="composer-control composer-model-trigger"
      title="The lead answers here"
    >
      <ProviderIcon provider={agent.provider} />
      <span>{modelName(agent)}</span>
    </button>
  );
}

function Setup(props: {
  target: Target;
  onTarget: (t: Target) => void;
  base: string;
  onBase: (v: string) => void;
  pr: string;
  onPr: (v: string) => void;
  commit: string;
  onCommit: (v: string) => void;
  checkout: string;
  onCheckout: (v: string) => void;
  reviewers: Agent[];
  onReviewers: (r: Agent[]) => void;
  lead: Agent;
  onLead: (a: Agent) => void;
  runChecks: boolean;
  onRunChecks: (v: boolean) => void;
}) {
  const { target, reviewers } = props;
  const targets: { value: Target; label: string; icon: ReactNode }[] = [
    {
      value: "uncommitted",
      label: "Uncommitted changes",
      icon: <FileDiff size={14} />,
    },
    { value: "branch", label: "Branch", icon: <GitBranch size={14} /> },
    { value: "pr", label: "Pull request", icon: <GitPullRequest size={14} /> },
    {
      value: "commit",
      label: "Commit",
      icon: <GitCommitHorizontal size={14} />,
    },
  ];
  return (
    <div className="dr-setup">
      <div className="dr-field">
        <span className="dr-label">Review</span>
        <div className="dr-field-body">
          <div
            className="dr-targets"
            role="radiogroup"
            aria-label="What to review"
          >
            {targets.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={t.value === target}
                onClick={() => props.onTarget(t.value)}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div className="composer-tools dr-inline">
            {target === "uncommitted" && (
              <span className="dr-target-detail">
                7 files
                <span className="diff-stat">
                  <span className="diff-stat-add">+212</span>
                  <span className="diff-stat-del">−48</span>
                </span>
              </span>
            )}
            {target === "branch" && (
              <>
                <span className="dr-target-detail">
                  <GitBranch size={13} /> feature/deep-review
                  <span className="muted">against</span>
                </span>
                <ComposerSelect
                  label="Base branch"
                  value={props.base}
                  onChange={props.onBase}
                  options={["main", "develop", "release/2.4"].map((b) => ({
                    value: b,
                    label: b,
                  }))}
                />
              </>
            )}
            {target === "pr" && (
              <ComposerSelect
                label="Pull request"
                value={props.pr}
                onChange={props.onPr}
                options={[
                  { value: "42", label: "#42 Long pastes as attachment cards" },
                  { value: "41", label: "#41 Waiting strip for queued turns" },
                  { value: "39", label: "#39 Pick a theme per colour mode" },
                ]}
              />
            )}
            {target === "commit" && (
              <ComposerSelect
                label="Commit"
                value={props.commit}
                onChange={props.onCommit}
                options={[
                  {
                    value: "75cf43f",
                    label: "75cf43f Add agent guidance for animations",
                  },
                  {
                    value: "bf51685",
                    label: "bf51685 Pick a theme per colour mode",
                  },
                  {
                    value: "f51cc14",
                    label: "f51cc14 Style only the usage ring’s dial",
                  },
                ]}
              />
            )}
            <span className="spacer" />
            <ComposerSelect
              label="Checkout"
              value={props.checkout}
              onChange={props.onCheckout}
              icon={<FolderGit2 size={13} />}
              options={[
                { value: "main", label: "relay" },
                { value: "worktree", label: "relay-deep-review · worktree" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="dr-field">
        <span className="dr-label">Reviewers</span>
        <div className="dr-field-body">
          <ol className="dr-reviewers">
            {reviewers.map((r, i) => (
              <li key={r.id}>
                <span className="dr-slot">{i + 1}</span>
                <ModelField
                  label={`Reviewer ${i + 1}`}
                  provider={r.provider}
                  providers={reviewerProviders}
                  value={r.choice}
                  allowDefault={false}
                  onChange={(choice, provider) =>
                    props.onReviewers(
                      reviewers.map((x) =>
                        x.id === r.id ? { ...x, choice, provider } : x,
                      ),
                    )
                  }
                />
                <span className="dr-native" title="Runs the agent’s own review">
                  <ScanSearch size={12} />
                  {nativeReview(r)}
                </span>
                <span className="spacer" />
                {reviewers.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove reviewer ${i + 1}`}
                    onClick={() =>
                      props.onReviewers(reviewers.filter((x) => x.id !== r.id))
                    }
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ol>
          {reviewers.length < 4 && (
            <button
              type="button"
              className="text-button dr-add"
              onClick={() =>
                props.onReviewers([
                  ...reviewers,
                  {
                    ...lineup[reviewers.length],
                    id: `r${Date.now()}`,
                  },
                ])
              }
            >
              <Plus size={13} /> Add reviewer
            </button>
          )}
        </div>
      </div>

      <div className="dr-field">
        <span className="dr-label">Lead</span>
        <div className="dr-field-body dr-lead">
          <ModelField
            label="Lead"
            provider={props.lead.provider}
            providers={agentProviders}
            value={props.lead.choice}
            allowDefault={false}
            onChange={(choice, provider) =>
              props.onLead({ ...props.lead, choice, provider })
            }
          />
          <span className="dr-lead-note">
            Merges and verifies the findings, then fixes them with you.
          </span>
          <label className="dr-check">
            <input
              type="checkbox"
              checked={props.runChecks}
              onChange={(e) => props.onRunChecks(e.target.checked)}
            />
            Can run tests to verify
          </label>
        </div>
      </div>
    </div>
  );
}

function Thread({
  children,
  sent,
}: {
  children: ReactNode;
  /** Changes when you send; sending always jumps back to the end. */
  sent: number;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    follow.current = true;
    const e = scroll.current!;
    e.scrollTop = e.scrollHeight;
  }, [sent]);
  // Stay pinned to the bottom while content grows, like the real thread.
  useLayoutEffect(() => {
    const content = column.current!;
    const observer = new ResizeObserver(() => {
      const e = scroll.current!;
      if (follow.current) e.scrollTop = e.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="project-messages"
      ref={scroll}
      onScroll={() => {
        const e = scroll.current!;
        follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 80;
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
  // The thread pads its end by this much so the last message clears it.
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

function LeadHeader({ agent }: { agent: Agent }) {
  return (
    <header>
      <strong>
        <ProviderIcon provider={agent.provider} />
        {agent.provider === "codex" ? "Codex" : "Claude"}
      </strong>
      <time>{time(0)}</time>
    </header>
  );
}

function AgentChip({ agent }: { agent: Agent }) {
  return (
    <span className="dr-agent-chip">
      <ProviderIcon provider={agent.provider} />
      {modelName(agent)}
      <span className="muted">{effortOf(agent)}</span>
    </span>
  );
}

function Request({
  label,
  target,
  reviewers,
  lead,
  focus,
}: {
  label: string;
  target: Target;
  reviewers: Agent[];
  lead: Agent;
  focus: string;
}) {
  return (
    <div className="dr-request">
      <div className="dr-request-title">
        <ScanSearch size={15} />
        <strong>Deep review</strong>
        <span>{label}</span>
        {target === "uncommitted" && (
          <span className="diff-stat">
            <span className="diff-stat-add">+212</span>
            <span className="diff-stat-del">−48</span>
          </span>
        )}
      </div>
      <div className="dr-request-agents">
        {reviewers.map((r) => (
          <AgentChip key={r.id} agent={r} />
        ))}
        <span className="dr-arrow">→</span>
        <AgentChip agent={lead} />
      </div>
      {focus.trim() && <p>{focus}</p>}
    </div>
  );
}

function Council({
  reviewers,
  startedAt,
  elapsed,
  prompt,
  raw,
  kept,
  collapsed,
  onOpenFile,
}: {
  reviewers: Agent[];
  startedAt: number;
  elapsed: number;
  prompt: string;
  raw: number;
  kept: number;
  collapsed: boolean;
  onOpenFile: (link: ProjectFileLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const done = reviewers.filter((_, i) => elapsed >= scripts[i].ms).length;
  const grid = (
    <div className="dr-grid" data-count={reviewers.length}>
      {reviewers.map((r, i) => (
        <Pane
          key={r.id}
          agent={r}
          slot={i}
          startedAt={startedAt}
          elapsed={elapsed}
          prompt={prompt}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
  if (collapsed)
    return (
      <section className="dr-council collapsed">
        <button
          type="button"
          className="dr-council-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Telescope size={14} />
          <span>
            Council · {reviewers.length}{" "}
            {reviewers.length === 1 ? "reviewer" : "reviewers"} · {raw} raw
            findings → {kept} kept
          </span>
          <span className="dr-council-glyphs">
            {reviewers.map((r) => (
              <ProviderIcon key={r.id} provider={r.provider} />
            ))}
          </span>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {open && grid}
      </section>
    );
  return (
    <section className="dr-council">
      <div className="dr-council-head">
        <Telescope size={14} />
        <strong>Council</strong>
        <span>
          {done === reviewers.length
            ? `All ${reviewers.length} done · ${raw} findings`
            : `${done} of ${reviewers.length} done`}
        </span>
      </div>
      {grid}
    </section>
  );
}

/** One reviewer's own thread: the prompt it got and its turn, read-only. */
function Pane({
  agent,
  slot,
  startedAt,
  elapsed,
  prompt,
  onOpenFile,
}: {
  agent: Agent;
  slot: number;
  startedAt: number;
  elapsed: number;
  prompt: string;
  onOpenFile: (link: ProjectFileLink) => void;
}) {
  const script = scripts[slot];
  const done = elapsed >= script.ms;
  const message = turnAt(
    `review-${slot}`,
    agent.provider,
    script,
    startedAt,
    elapsed,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // Like the main thread: stay at the end unless you scrolled up to read.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (follow.current)
        scroll.current!.scrollTop = scroll.current!.scrollHeight;
    });
    observer.observe(column.current!);
    return () => observer.disconnect();
  }, []);
  const command =
    agent.provider === "codex"
      ? "/review"
      : `/code-review ${agent.choice.reasoningEffort || ""}`.trim();
  return (
    <section className="dr-pane" data-done={done || undefined}>
      <header>
        <ProviderIcon provider={agent.provider} />
        <strong>{modelName(agent)}</strong>
        <span className="muted">{effortOf(agent)}</span>
        <span className="spacer" />
        {done && (
          <span className="dr-pane-status done">
            <CircleCheck size={13} /> {script.found} findings
          </span>
        )}
      </header>
      <div
        className="dr-pane-thread"
        ref={scroll}
        onScroll={() => {
          const e = scroll.current!;
          follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 40;
        }}
      >
        <div ref={column}>
          <article className="project-message user">
            <header>
              <strong>You</strong>
              <span className="muted">via Deep review</span>
            </header>
            <div className="markdown">
              <p>
                <code>{command}</code> {prompt}
              </p>
            </div>
          </article>
          <article className="project-message assistant">
            <header>
              <strong>
                <ProviderIcon provider={agent.provider} />
                {agent.provider === "codex" ? "Codex" : "Claude"}
              </strong>
              <time>{time(0)}</time>
            </header>
            <AgentTurn
              message={message}
              projectRoot={projectRoot}
              onOpenFile={onOpenFile}
              onChanges={() => {}}
            />
            {message.body && (
              <RichText
                text={message.body}
                projectRoot={projectRoot}
                onOpenFile={onOpenFile}
              />
            )}
          </article>
        </div>
      </div>
    </section>
  );
}

type FindingsProps = {
  findings: Finding[];
  count: number;
  reviewers: Agent[];
  statusOf: (id: string) => Status;
  selected: string[];
  toggle: (id: string) => void;
  setOne: (id: string, status: Status) => void;
  fix: (ids: string[]) => void;
  openFile: (f: { path: string; line?: number }) => void;
};

function Severity({ value }: { value: Severity }) {
  return (
    <span className="dr-severity" data-severity={value}>
      <i className="dr-dot" data-severity={value} />
      {severityLabel[value]}
    </span>
  );
}

function FileLink({ f, onOpen }: { f: Finding; onOpen: () => void }) {
  return (
    <button type="button" className="dr-file" title={f.path} onClick={onOpen}>
      {fileName(f.path)}
      <span>:{f.line}</span>
    </button>
  );
}

function FoundBy({ f, reviewers }: { f: Finding; reviewers: Agent[] }) {
  return (
    <span
      className="dr-found-by"
      title={`Found by ${f.slots.map((s) => modelName(reviewers[s])).join(", ")}`}
    >
      {f.slots.map((s) => (
        <ProviderIcon key={s} provider={reviewers[s].provider} />
      ))}
      {f.slots.length}/{reviewers.length}
    </span>
  );
}

function StatusNote({
  status,
  onUndo,
}: {
  status: Status;
  onUndo: () => void;
}) {
  if (status === "fixing") return <span className="dr-status">Fixing…</span>;
  if (status === "fixed")
    return (
      <span className="dr-status fixed">
        <CircleCheck size={13} /> Fixed
      </span>
    );
  if (status === "dismissed")
    return (
      <span className="dr-status">
        Dismissed
        <button type="button" className="text-button" onClick={onUndo}>
          <Undo2 size={12} /> Undo
        </button>
      </span>
    );
  return null;
}

function Snippet({ f }: { f: Finding }) {
  return (
    <pre className="dr-snippet">
      {f.code.map((line, i) => (
        <div key={i}>
          <span>{f.line + i}</span>
          <code>{line}</code>
        </div>
      ))}
    </pre>
  );
}

function Verified({ f }: { f: Finding }) {
  return (
    <p className="dr-verified">
      <ShieldCheck size={13} /> {f.check}
    </p>
  );
}

/** A: one card, a checklist of findings, fix buttons in its footer. */
function Verdict(p: FindingsProps) {
  const [expanded, setExpanded] = useState<string | null>("queue");
  const open = p.findings.filter((f) => p.statusOf(f.id) === "open");
  const chosen = open.filter((f) => p.selected.includes(f.id));
  const counts = (["high", "medium", "low"] as const)
    .map((s) => [s, p.findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n);
  return (
    <section className="dr-verdict">
      <header>
        <ScanSearch size={15} />
        <strong>{p.findings.length} findings</strong>
        {counts.map(([s, n]) => (
          <span key={s} className="dr-count" data-severity={s}>
            {n} {severityLabel[s].toLowerCase()}
          </span>
        ))}
        <span className="spacer" />
        <span className="dr-verdict-reviewers">
          {p.reviewers.map((r) => (
            <span key={r.id} title={modelName(r)}>
              <ProviderIcon provider={r.provider} />
              <Check size={10} />
            </span>
          ))}
        </span>
      </header>
      <ul>
        {p.findings.map((f) => {
          const status = p.statusOf(f.id);
          const isOpen = expanded === f.id;
          return (
            <li
              key={f.id}
              className="dr-verdict-row"
              data-status={status}
              data-expanded={isOpen || undefined}
            >
              <div className="dr-verdict-line">
                <input
                  type="checkbox"
                  aria-label={`Fix ${f.title}`}
                  checked={p.selected.includes(f.id)}
                  disabled={status !== "open"}
                  onChange={() => p.toggle(f.id)}
                />
                <Severity value={f.severity} />
                <button
                  type="button"
                  className="dr-verdict-title"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : f.id)}
                >
                  {f.title}
                </button>
                <StatusNote
                  status={status}
                  onUndo={() => p.setOne(f.id, "open")}
                />
                <FileLink f={f} onOpen={() => p.openFile(f)} />
                <FoundBy f={f} reviewers={p.reviewers} />
                <button
                  type="button"
                  className="icon-button dr-chevron"
                  aria-label={isOpen ? "Hide details" : "Show details"}
                  onClick={() => setExpanded(isOpen ? null : f.id)}
                >
                  {isOpen ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
              </div>
              {isOpen && (
                <div className="dr-verdict-detail">
                  <p>{f.why}</p>
                  <Snippet f={f} />
                  <Verified f={f} />
                  {status === "open" && (
                    <div className="dr-actions">
                      <button type="button" onClick={() => p.fix([f.id])}>
                        <Wrench size={14} /> Fix this
                      </button>
                      <button
                        type="button"
                        onClick={() => p.setOne(f.id, "dismissed")}
                      >
                        <X size={13} /> Dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <footer>
        <span className="muted">
          {open.length
            ? "Tick what to fix, or fix them all. You can still just ask."
            : "Nothing left to fix."}
        </span>
        <span className="spacer" />
        <button
          type="button"
          disabled={!chosen.length}
          onClick={() => p.fix(chosen.map((f) => f.id))}
        >
          Fix selected{chosen.length ? ` (${chosen.length})` : ""}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!open.length}
          onClick={() => p.fix(open.map((f) => f.id))}
        >
          <Wrench size={14} />
          {!open.length
            ? "Fix all"
            : open.length < p.findings.length
              ? `Fix the other ${open.length}`
              : `Fix all ${open.length}`}
        </button>
      </footer>
    </section>
  );
}

/** B: a card per finding; picked ones ride along in the composer. */
function Cards(p: FindingsProps) {
  return (
    <div className="dr-cards">
      {p.findings.map((f) => {
        const status = p.statusOf(f.id);
        const picked = p.selected.includes(f.id);
        return (
          <section
            key={f.id}
            className="dr-card"
            data-severity={f.severity}
            data-status={status}
            data-picked={picked || undefined}
          >
            <header>
              <Severity value={f.severity} />
              <strong>{f.title}</strong>
              <span className="spacer" />
              <StatusNote
                status={status}
                onUndo={() => p.setOne(f.id, "open")}
              />
            </header>
            <div className="dr-card-meta">
              <FileLink f={f} onOpen={() => p.openFile(f)} />
              <FoundBy f={f} reviewers={p.reviewers} />
            </div>
            {status !== "dismissed" && (
              <>
                <p className="dr-card-why">{f.why}</p>
                <Snippet f={f} />
                <Verified f={f} />
              </>
            )}
            {status === "open" && (
              <div className="dr-actions">
                <button
                  type="button"
                  className={picked ? "dr-picked" : ""}
                  aria-pressed={picked}
                  onClick={() => p.toggle(f.id)}
                >
                  {picked ? <Check size={13} /> : <Plus size={13} />}
                  {picked ? "In your message" : "Add to message"}
                </button>
                <button type="button" onClick={() => p.fix([f.id])}>
                  <Wrench size={13} /> Fix now
                </button>
                <button
                  type="button"
                  className="dr-quiet"
                  onClick={() => p.setOne(f.id, "dismissed")}
                >
                  <X size={13} /> Dismiss
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** C: the lead's prose with priority notes, and the findings with their files. */
function Report(p: FindingsProps) {
  const [hover, setHover] = useState<string>();
  const has = (id: string) => p.findings.some((f) => f.id === id);
  const note = (id: string) => {
    const f = p.findings.find((x) => x.id === id);
    return (
      f && (
        <button
          type="button"
          className="dr-priority"
          data-priority={priority[f.severity].tag}
          title={priority[f.severity].meaning}
          onMouseEnter={() => setHover(id)}
          onMouseLeave={() => setHover(undefined)}
          onClick={() =>
            document
              .getElementById(`finding-${id}`)
              ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
          }
        >
          {priority[f.severity].tag}
        </button>
      )
    );
  };
  const open = p.findings.filter((f) => p.statusOf(f.id) === "open");
  const chosen = open.filter((f) => p.selected.includes(f.id));
  return (
    <div className="dr-report">
      <div className="markdown">
        <p>
          Two things need fixing before this ships. Reordering the queue can
          drop a message when two moves land close together{note("queue")}, and
          a thread keeps its PR scope after you switch branch{note("scope")}.
        </p>
        {(has("strip") || has("draft") || has("query")) && (
          <p>
            Smaller: the new waiting strip keeps animating behind the editor
            {note("strip")}, a pasted text card doesn’t survive a reload
            {note("draft")}, and the Claude model list is cached two ways
            {note("query")}.
          </p>
        )}
      </div>
      <section className="dr-tray">
        <ol className="dr-tasks">
          {p.findings.map((f) => {
            const status = p.statusOf(f.id);
            return (
              <li
                key={f.id}
                id={`finding-${f.id}`}
                className="dr-task"
                data-status={status}
                data-hover={hover === f.id || undefined}
              >
                <label className="dr-task-head">
                  {status === "fixed" ? (
                    <CircleCheck
                      size={15}
                      className="dr-task-fixed"
                      aria-label="Fixed"
                    />
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`Fix ${f.title}`}
                      checked={p.selected.includes(f.id)}
                      disabled={status !== "open"}
                      onChange={() => p.toggle(f.id)}
                    />
                  )}
                  <span
                    className="dr-priority"
                    data-priority={priority[f.severity].tag}
                    title={priority[f.severity].meaning}
                  >
                    {priority[f.severity].tag}
                  </span>
                  <span className="dr-task-title">{f.title}</span>
                  {status !== "fixed" && (
                    <StatusNote
                      status={status}
                      onUndo={() => p.setOne(f.id, "open")}
                    />
                  )}
                  <FoundBy f={f} reviewers={p.reviewers} />
                </label>
                <ul className="dr-task-files">
                  {[{ path: f.path, line: f.line }, ...(f.also ?? [])].map(
                    (file) => (
                      <li key={`${file.path}:${file.line}`}>
                        <button
                          type="button"
                          className="dr-task-file"
                          title={`${file.path}:${file.line}`}
                          onClick={() => p.openFile(file)}
                        >
                          <FileEntryIcon path={file.path} directory={false} />
                          <span className="dr-task-file-name">
                            {fileName(file.path)}
                          </span>
                          <span className="dr-task-file-line">
                            L{file.line}
                          </span>
                          <span className="dr-task-file-dir">
                            {file.path.split("/").slice(0, -1).join("/")}
                          </span>
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              </li>
            );
          })}
        </ol>
        <footer>
          <span className="spacer" />
          <button
            type="button"
            disabled={!chosen.length}
            onClick={() => p.fix(chosen.map((f) => f.id))}
          >
            Fix selected{chosen.length ? ` (${chosen.length})` : ""}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!open.length}
            onClick={() => p.fix(open.map((f) => f.id))}
          >
            <Wrench size={14} />
            {!open.length
              ? "Fix all"
              : open.length < p.findings.length
                ? `Fix the other ${open.length}`
                : `Fix all ${open.length}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Dropped({
  items,
  reviewers,
}: {
  items: typeof dropped;
  reviewers: Agent[];
}) {
  if (!items.length) return null;
  return (
    <details className="dr-dropped">
      <summary>
        <ChevronRight size={13} /> Not kept · {items.length}
      </summary>
      <ul>
        {items.map((d) => (
          <li key={d.title}>
            <ProviderIcon provider={reviewers[d.slot].provider} />
            <span className="dr-dropped-title">{d.title}</span>
            <code>{d.at}</code>
            <span className="muted">{d.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** What a fix touches, for the lead's turn and its changed files card. */
const fixStats: Record<string, { additions: number; deletions: number }> = {
  queue: { additions: 14, deletions: 6 },
  scope: { additions: 9, deletions: 2 },
  strip: { additions: 1, deletions: 0 },
  draft: { additions: 22, deletions: 4 },
  query: { additions: 3, deletions: 3 },
};
const fixMs = 4000;

function Exchange({
  exchange,
  lead,
  onOpenFile,
}: {
  exchange: { id: number; ids: string[]; note: string; done: boolean };
  lead: Agent;
  onOpenFile: (link: ProjectFileLink) => void;
}) {
  const fixes = findings.filter((f) => exchange.ids.includes(f.id));
  const now = useClock(!exchange.done);
  const reply = turnAt(
    `fix-${exchange.id}`,
    lead.provider,
    fixes.length
      ? {
          ms: fixMs,
          steps: [
            ...fixes.map((f, i) => ({
              at: i * 500,
              kind: "file" as const,
              label: f.path,
              took: 450,
            })),
            {
              at: fixes.length * 500 + 200,
              kind: "command",
              label: "npm test",
              took: 1500,
            },
          ],
          body: [
            `Fixed ${fixes.length === 1 ? "it" : `all ${fixes.length}`}, and \`npm test\` passes.`,
            "",
            ...fixes.map((f) => `- ${f.title}, \`${f.path}:${f.line}\``),
          ].join("\n"),
        }
      : {
          ms: 0,
          steps: [],
          body: "In the real thread the lead answers here, like any chat.",
        },
    exchange.id,
    exchange.done ? Infinity : now - exchange.id,
  );
  return (
    <>
      <article className="project-message user">
        <header>
          <strong>You</strong>
          <time>{time(0)}</time>
        </header>
        <div className="markdown">
          {fixes.length > 0 && (
            <div className="dr-fix-request">
              <MessageSquareReply size={13} />
              Fix{" "}
              {fixes.length === 1
                ? "this finding"
                : `these ${fixes.length} findings`}
              <div className="dr-fix-chips">
                {fixes.map((f) => (
                  <span key={f.id} className="dr-agent-chip">
                    <i className="dr-dot" data-severity={f.severity} />
                    {f.title}
                  </span>
                ))}
              </div>
            </div>
          )}
          {exchange.note && <p>{exchange.note}</p>}
        </div>
      </article>
      <article className="project-message assistant">
        <LeadHeader agent={lead} />
        <AgentTurn
          message={reply}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
          onChanges={() => {}}
        />
        {reply.body && (
          <RichText
            text={reply.body}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
          />
        )}
        {reply.status === "complete" && fixes.length > 0 && (
          <ChangedFilesCard
            files={fixes.map((f) => ({ path: f.path, ...fixStats[f.id] }))}
            onOpen={(path) =>
              onOpenFile({ path: path ?? "", directory: false })
            }
          />
        )}
      </article>
    </>
  );
}

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
