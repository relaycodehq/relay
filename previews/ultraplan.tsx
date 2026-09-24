// Ultraplan: a third composer mode after Build and Plan, picked from the mode
// button's menu. The lead writes one brief; thinkers on different models work
// from it on their own, read-only, and never see each other; then the lead
// picks and checks their notes in the code and plans in its own voice. Each
// thinker gets its own job ("different angles"), or all get the same brief,
// where agreement means confidence. The looks differ in where that choice
// lives: a toggle in the council row, tiles in the menu, or per thinker.
// Sample data, the app's own styles. Open http://127.0.0.1:5177/previews/ultraplan.html
import "./desktop-stub";
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
import { Menu } from "@base-ui/react/menu";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Compass,
  FileText,
  FolderGit2,
  Hammer,
  Landmark,
  Layers,
  LockKeyhole,
  Orbit,
  PencilRuler,
  Plus,
  RotateCcw,
  Route,
  Search,
  ShieldAlert,
  Shrink,
  Split,
  X,
} from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/composer-model-picker.css";
import "../src/components/code-references.css";
import "../src/components/deep-review.css";
import "./deep-review.css";
import "./ultraplan.css";
import { initAppearance, setMode, useAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import { ProviderIcon } from "../src/components/ComposerModelPicker";
import { ComposerSelect } from "../src/components/ComposerSelect";
import { MessageActions } from "../src/components/MessageActions";
import { RichText } from "../src/components/ui";

initAppearance();
initWindowFocus();

type Look = "toggle" | "tiles" | "per-thinker";
type Mode = "build" | "plan" | "ultra";
type Kind = "angles" | "same";
/** "same" is a job only in the per-thinker look: no job, just the brief. */
type AngleId =
  | "same"
  | "skeptic"
  | "scout"
  | "route"
  | "simplifier"
  | "architect";
interface Thinker {
  id: string;
  angle: AngleId;
  model: string;
}

const projectRoot = "/Users/sample/relay";
const started = Date.now() - 6 * 60000;
const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const models = [
  { id: "claude-opus-5-5", name: "Opus 5.5", provider: "claude" },
  { id: "claude-sonnet-5", name: "Sonnet 5", provider: "claude" },
  { id: "gpt-6-sol", name: "GPT-6-Sol", provider: "codex" },
  { id: "gpt-6-luna", name: "GPT-6-Luna", provider: "codex" },
  { id: "gpt-6-astra", name: "GPT-6-Astra", provider: "codex" },
] as const;
const model = (id: string) => models.find((m) => m.id === id) ?? models[0];
/** The thread's own agent leads: the strongest model picks, cheaper ones think. */
const lead = models[0];

const kindLabel: Record<Kind, string> = {
  angles: "Different angles",
  same: "Same brief",
};
const kindIcon = (kind: Kind, size = 13) =>
  kind === "angles" ? <Split size={size} /> : <Layers size={size} />;

type Level = "high" | "medium" | "low";
interface Note {
  text: string;
  evidence?: string;
  confidence: Level;
}
type Step = { kind: "read" | "search"; text: string };
interface Report {
  steps: Step[];
  notes: Note[];
  assumed?: string;
  question?: string;
}

// An angle is a job with a deliverable, not a persona: that's what moves results.
const angles: Record<
  AngleId,
  { label: string; job: string; icon: ReactNode; report: Report }
> = {
  same: {
    label: "Same brief",
    job: "No job of its own: the brief, as the others get it",
    icon: <Layers size={13} />,
    report: { steps: [], notes: [] },
  },
  skeptic: {
    label: "Skeptic",
    job: "Lists how it fails: trigger, consequence, where, how likely",
    icon: <ShieldAlert size={13} />,
    report: {
      steps: [
        { kind: "read", text: "electron/deep-review.ts" },
        { kind: "search", text: "chat.deepReview" },
        { kind: "read", text: "shared/projects.ts" },
      ],
      notes: [
        {
          text: "A second ultraplan in a thread overwrites the first: council state is one per thread.",
          evidence: "shared/projects.ts:323",
          confidence: "high",
        },
        {
          text: "Stop has to reach every thinker, as deep review's does.",
          evidence: "electron/deep-review.ts:138",
          confidence: "high",
        },
      ],
      assumed: "Thinkers run at the same time.",
      question: "Should a stopped ultraplan resume, or start over?",
    },
  },
  scout: {
    label: "Codebase scout",
    job: "Finds what already exists to reuse, with file and line",
    icon: <Compass size={13} />,
    report: {
      steps: [
        { kind: "search", text: "handoffPrompt" },
        { kind: "read", text: "electron/project-chats.ts" },
        { kind: "read", text: "electron/rooms/claude-project.ts" },
      ],
      notes: [
        {
          text: "`handoffPrompt` already writes the brief the council needs.",
          evidence: "electron/project-chats.ts:109",
          confidence: "high",
        },
        {
          text: "Read-only sessions exist: `readOnly` drops Edit and Write.",
          evidence: "electron/rooms/claude-project.ts:647",
          confidence: "high",
        },
        {
          text: "Deep review's reviewer panes can show thinkers as they are.",
          evidence: "src/components/DeepReview.tsx:615",
          confidence: "medium",
        },
      ],
    },
  },
  route: {
    label: "Other route",
    job: "Proposes a materially different approach than the obvious one",
    icon: <Route size={13} />,
    report: {
      steps: [
        { kind: "read", text: "electron/rooms/claude-project.ts" },
        { kind: "search", text: "agentProgressSummaries" },
        { kind: "read", text: "shared/agent-modes.ts" },
      ],
      notes: [
        {
          text: "Skip hidden threads: run thinkers as Claude subagents inside the lead's session. Less code, one process.",
          evidence: "electron/rooms/claude-project.ts:633",
          confidence: "medium",
        },
      ],
      assumed: "The lead is Claude.",
      question: "Is mixing Claude and Codex a must-have?",
    },
  },
  simplifier: {
    label: "Simplifier",
    job: "Cuts to the smallest version that does the job",
    icon: <Shrink size={13} />,
    report: {
      steps: [
        { kind: "read", text: "shared/deep-review.ts" },
        { kind: "read", text: "src/components/ComposerModeControls.tsx" },
        { kind: "search", text: "interactionMode" },
      ],
      notes: [
        {
          text: "Fixed angles in v1; let people change models only.",
          confidence: "medium",
        },
        {
          text: "No brief step: pass the last few messages as they are.",
          confidence: "low",
        },
      ],
    },
  },
  architect: {
    label: "Architect",
    job: "Where it lives, what it touches, how it ages",
    icon: <Landmark size={13} />,
    report: {
      steps: [
        { kind: "read", text: "electron/deep-review.ts" },
        { kind: "read", text: "shared/projects.ts" },
        { kind: "search", text: "createReviewer" },
      ],
      notes: [
        {
          text: "Extract a `Council` from `DeepReviews`: spawn, wait, stop, resume, hand over.",
          evidence: "electron/deep-review.ts:58",
          confidence: "high",
        },
        {
          text: "Key council state by the request message.",
          evidence: "shared/projects.ts:323",
          confidence: "high",
        },
      ],
    },
  },
};
const angleOptions = (look: Look) =>
  (Object.keys(angles) as AngleId[])
    .filter((id) => look === "per-thinker" || id !== "same")
    .map((id) => ({
      value: id,
      label: angles[id].label,
      description: angles[id].job,
      icon: angles[id].icon,
    }));
const modelOptions = models.map((m) => ({
  value: m.id as string,
  label: m.name,
  icon: <ProviderIcon provider={m.provider} />,
}));

// Same brief: one task, different models. What differs is only what each found.
const sameReports: Report[] = [
  {
    steps: [
      { kind: "read", text: "electron/deep-review.ts" },
      { kind: "read", text: "shared/projects.ts" },
      { kind: "search", text: "interactionMode" },
    ],
    notes: [
      {
        text: "Council state is one per thread; key it by the request message.",
        evidence: "shared/projects.ts:323",
        confidence: "high",
      },
      {
        text: "Stop has to reach every thinker.",
        evidence: "electron/deep-review.ts:138",
        confidence: "high",
      },
    ],
    question: "Should a stopped ultraplan resume, or start over?",
  },
  {
    steps: [
      { kind: "search", text: "handoffPrompt" },
      { kind: "read", text: "electron/project-chats.ts" },
      { kind: "read", text: "src/components/ComposerModeControls.tsx" },
    ],
    notes: [
      {
        text: "State per request message, not per thread.",
        evidence: "shared/projects.ts:323",
        confidence: "high",
      },
      {
        text: "The mode button only toggles; it has no room for a third mode.",
        evidence: "src/components/ComposerModeControls.tsx:64",
        confidence: "medium",
      },
    ],
  },
  {
    steps: [
      { kind: "read", text: "electron/deep-review.ts" },
      { kind: "search", text: "host.close" },
      { kind: "read", text: "electron/project-chats.ts" },
    ],
    notes: [
      {
        text: "Council state per request message.",
        evidence: "shared/projects.ts:323",
        confidence: "high",
      },
      {
        text: "Stop has to reach every thinker.",
        evidence: "electron/deep-review.ts:138",
        confidence: "medium",
      },
      {
        text: "Close each thinker's agent once it answers, or it idles until Relay quits.",
        evidence: "electron/deep-review.ts:187",
        confidence: "high",
      },
    ],
  },
  {
    steps: [
      { kind: "read", text: "shared/projects.ts" },
      { kind: "read", text: "src/components/DeepReview.tsx" },
      { kind: "search", text: "deepReview" },
    ],
    notes: [
      {
        text: "Council state per request message.",
        evidence: "shared/projects.ts:323",
        confidence: "high",
      },
      {
        text: "Reuse the reviewer panes for thinkers.",
        evidence: "src/components/DeepReview.tsx:615",
        confidence: "medium",
      },
    ],
  },
];

const briefText = (kind: Kind) =>
  [
    "- **Goal:** Ultraplan, a third composer mode where thinkers on different models plan in parallel and the lead picks and checks.",
    "- **Decided:** one mode button with a menu; thinkers never edit files; no debate rounds.",
    "- **Constraints:** build on deep review's fan-out; keep the cost visible.",
    "- **Look at:** `electron/deep-review.ts`, `shared/projects.ts`, `src/components/ComposerModeControls.tsx`",
    "- **Open:** where council state lives; how Stop reaches thinkers.",
    kind === "angles"
      ? "\nEach thinker also gets its own job."
      : "\nEvery thinker gets exactly this, so agreement means something.",
  ].join("\n");

function leadAnswer(run: CouncilRun) {
  if (run.kind === "same") {
    const name = (slot: number) =>
      model(run.thinkers[slot]?.model ?? lead.id).name;
    return `All ${run.thinkers.length} thinkers got the same brief, so here's where they agreed, and what I checked.

- **All of them:** council state is one per thread today (\`shared/projects.ts:323\`). It moves to the request message.
- **Two of them:** Stop has to reach every thinker, as deep review's does (\`electron/deep-review.ts:138\`).
- **Only ${name(2)}:** close each thinker's agent once it answers, or it idles until Relay quits. Checked \`electron/deep-review.ts:187\`: deep review does exactly that. It's in.
- **Set aside:** "the mode button has no room for a third mode", from ${name(1)}. True that it only toggles today, but that's the part the menu replaces.

**Plan:** extract a \`Council\` from \`DeepReviews\`, key its state by the request message, stop and close thinkers the way reviewers are, and reuse the reviewer panes.

**Question for you:** should a stopped ultraplan resume, or start over?`;
  }
  return `Here's the plan. I checked the council's claims in the code: five held, one I set aside.

1. Pull the fan-out out of \`electron/deep-review.ts\` into a \`Council\` that deep review and Ultraplan share: spawn, wait, stop, resume, hand over.
2. Keep council state per request message. Today it's one per thread (\`shared/projects.ts:323\`), so a second ultraplan would overwrite the first.
3. Write the brief in \`handoffPrompt\`'s shape (\`electron/project-chats.ts:109\`); every thinker gets the same brief plus its job.
4. Run thinkers with \`readOnly\` (\`electron/rooms/claude-project.ts:647\`), and let Stop reach all of them, as deep review's does.
5. Show them in deep review's reviewer panes.

**Set aside:** running thinkers as Claude subagents, from the other route. It's less code, but Codex couldn't join, and mixing model families is the main reason to have a council.

**Questions for you**
- Should a stopped ultraplan resume, or start over?
- Is mixing Claude and Codex a must-have? If not, the subagent route is back on the table.`;
}

const planAnswer =
  "(Sample plan from one agent.)\n\n1. Add Ultraplan to the mode menu.\n2. Reuse the deep review fan-out for the thinkers.\n3. Show their panes above the lead's answer.\n\nPick Ultraplan to have a council think it over first.";

const defaultThinkers: Thinker[] = [
  { id: "t1", angle: "skeptic", model: "claude-sonnet-5" },
  { id: "t2", angle: "scout", model: "gpt-6-sol" },
  { id: "t3", angle: "route", model: "gpt-6-luna" },
];
const MAX_THINKERS = 4;

const TICK = 400;
const BRIEF_TICKS = 5;
const CHECK_TICKS = 7;
/** Ticks per revealed step, by thinker slot. */
const pace = [2, 3, 4, 3];
const STEPS = 3;
const thinkerDone = (slot: number) => BRIEF_TICKS + pace[slot]! * (STEPS + 1);
type Phase = "brief" | "thinking" | "checking" | "done";
function phaseOf(run: CouncilRun): Phase {
  if (run.tick < BRIEF_TICKS) return "brief";
  const thought = Math.max(...run.thinkers.map((_, i) => thinkerDone(i)));
  if (run.tick < thought) return "thinking";
  if (run.tick < thought + CHECK_TICKS) return "checking";
  return "done";
}
const sameBrief = (run: CouncilRun, slot: number) =>
  run.kind === "same" || run.thinkers[slot]!.angle === "same";
const reportFor = (run: CouncilRun, slot: number) =>
  sameBrief(run, slot)
    ? sameReports[slot]!
    : angles[run.thinkers[slot]!.angle].report;
const claimCount = (run: CouncilRun) =>
  run.thinkers.reduce((n, _, i) => n + reportFor(run, i).notes.length, 0);

type Item =
  | {
      kind: "user";
      id: string;
      body: string;
      mode: Mode;
      council?: Kind;
      created: number;
    }
  | { kind: "assistant"; id: string; body: string; created: number }
  | CouncilRun;
interface CouncilRun {
  kind: Kind;
  id: string;
  thinkers: Thinker[];
  tick: number;
  stopped: boolean;
  /** Unset follows the run: open while it works, closed once the plan is in. */
  open?: boolean;
  created: number;
}
const isRun = (i: Item): i is CouncilRun =>
  i.kind === "angles" || i.kind === "same";

const seeded: Item[] = [
  {
    kind: "user",
    id: "u0",
    mode: "build",
    body: "I want several agents to think a problem over before anyone writes code, then one lead pulls it together. Like deep review, but for planning.",
    created: started,
  },
  {
    kind: "assistant",
    id: "a0",
    body: "Deep review already does most of the plumbing: reviewers in hidden threads, a handover, and a lead in the visible thread. What's review-specific is the diff scope and the findings format; the fan-out itself would carry over.",
    created: started + 40000,
  },
];
const seededDraft =
  "Plan Ultraplan as a third mode next to Build and Plan. What breaks, what's the smallest version, and where does its state live?";

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
  const [look, setLook] = useState<Look>("toggle");
  const [mode, setComposerMode] = useState<Mode>("plan");
  const [kind, setKind] = useState<Kind>("angles");
  /** Bumped each time Ultraplan is picked, to replay the border. */
  const [spark, setSpark] = useState(0);
  const [thinkers, setThinkers] = useState<Thinker[]>(defaultThinkers);
  const [items, setItems] = useState<Item[]>(seeded);
  const [draft, setDraft] = useState(seededDraft);
  const [dock, setDock] = useState(0);
  const [sent, setSent] = useState(0);
  const [toast, setToast] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const timers = useRef<number[]>([]);

  const council = items.find(
    (i): i is CouncilRun => isRun(i) && !i.stopped && phaseOf(i) !== "done",
  );
  const running = !!council;

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(undefined), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // One clock drives the running council: brief, thinkers, then the lead's checks.
  const councilId = council?.id;
  useEffect(() => {
    if (!councilId) return;
    const t = window.setInterval(
      () => updateRun(councilId, (r) => ({ ...r, tick: r.tick + 1 })),
      TICK,
    );
    return () => window.clearInterval(t);
  }, [councilId]);

  const updateRun = (id: string, fn: (r: CouncilRun) => CouncilRun) =>
    setItems((all) => all.map((i) => (isRun(i) && i.id === id ? fn(i) : i)));

  const pick = (next: Mode, nextKind = kind) => {
    if (next === "ultra") setSpark((n) => n + 1);
    setComposerMode(next);
    setKind(nextKind);
  };
  const changeLook = (next: Look) => {
    setLook(next);
    // Per thinker, the brief is a job; elsewhere it's the council's kind.
    if (next === "per-thinker") {
      if (kind === "same")
        setThinkers((all) => all.map((t) => ({ ...t, angle: "same" })));
      setKind("angles");
    } else
      setThinkers((all) =>
        all.map((t, i) =>
          t.angle === "same"
            ? { ...t, angle: defaultThinkers[i]?.angle ?? "architect" }
            : t,
        ),
      );
  };
  // Per thinker, a council where nobody has a job is a same-brief council.
  const councilKind: Kind =
    look === "per-thinker"
      ? thinkers.every((t) => t.angle === "same")
        ? "same"
        : "angles"
      : kind;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (running) {
      setToast("Preview: the council is still working");
      return;
    }
    if (mode === "build") {
      setToast("Preview: Build doesn't do anything here. Try Plan or Ultraplan");
      return;
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const user: Item = {
      kind: "user",
      id,
      body: text,
      mode,
      created: now,
      ...(mode === "ultra" ? { council: councilKind } : {}),
    };
    if (mode === "ultra")
      setItems((all) => [
        ...all,
        user,
        {
          kind: councilKind,
          id: id + "-council",
          thinkers,
          tick: 0,
          stopped: false,
          created: now,
        },
      ]);
    else {
      setItems((all) => [...all, user]);
      timers.current.push(
        window.setTimeout(
          () =>
            setItems((all) => [
              ...all,
              {
                kind: "assistant",
                id: id + "-a",
                body: planAnswer,
                created: Date.now(),
              },
            ]),
          1200,
        ),
      );
    }
    setDraft("");
    setSent((n) => n + 1);
  };

  const buildIt = () => {
    pick("build");
    setDraft("Go ahead with that plan.");
    input.current?.focus();
  };

  const ultra = mode === "ultra";
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <Orbit size={14} /> Ultraplan
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Angles or same brief</span>
          <Segmented<Look>
            label="Where the choice lives"
            value={look}
            onChange={changeLook}
            options={[
              { value: "toggle", label: "A · Toggle in the council" },
              { value: "tiles", label: "B · Tiles in the menu" },
              { value: "per-thinker", label: "C · Per thinker" },
            ]}
          />
        </div>
        {council && (
          <button
            type="button"
            className="text-button"
            onClick={() => updateRun(council.id, (r) => ({ ...r, tick: 999 }))}
          >
            Skip to the plan
          </button>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setItems(seeded);
            setThinkers(defaultThinkers);
            setComposerMode("plan");
            setKind("angles");
            setDraft(seededDraft);
          }}
        >
          Reset
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
      </div>

      <div className="preview-titlebar">
        <FolderGit2 size={14} />
        <span className="muted">relay</span>
        <span className="muted">/</span>
        <span>Multi-agent planning</span>
      </div>

      <div className="project-chat-pane">
        <section
          className="project-chat"
          style={{ "--composer-dock-height": `${dock}px` } as CSSProperties}
        >
          <div className="thread-subheader">
            <span className="thread-privacy">
              <LockKeyhole size={13} /> Private thread
            </span>
          </div>

          <Thread sent={sent}>
            {items.map((item) =>
              isRun(item) ? (
                <Council
                  key={item.id}
                  run={item}
                  onToggle={(open) =>
                    updateRun(item.id, (r) => ({ ...r, open }))
                  }
                  onResume={() =>
                    updateRun(item.id, (r) => ({ ...r, stopped: false }))
                  }
                  onBuild={buildIt}
                />
              ) : item.kind === "user" ? (
                <UserMessage key={item.id} item={item} />
              ) : (
                <Answer key={item.id} body={item.body} created={item.created} />
              ),
            )}
          </Thread>

          <Dock onHeight={setDock}>
            <div className="up-halo" data-on={ultra}>
              <span key={`glow-${spark}`} className="up-glow" />
              <div className="up-ring" data-on={ultra}>
                <span key={`ring-${spark}`} className="up-ring-fill" />
                <form
                  className="project-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <textarea
                    ref={input}
                    className="composer-prompt-input dr-textarea dr-docked"
                    aria-label="Message Claude"
                    placeholder={
                      ultra
                        ? "Something hard? The council thinks it over before anyone builds…"
                        : mode === "plan"
                          ? "Plan a change…"
                          : "Ask about the code, plan a change, or build something…"
                    }
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Tab" && e.shiftKey) {
                        e.preventDefault();
                        pick(
                          mode === "build"
                            ? "plan"
                            : mode === "plan"
                              ? "ultra"
                              : "build",
                        );
                      } else if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  {ultra && (
                    <ThinkerRow
                      look={look}
                      kind={kind}
                      onKind={(k) => pick("ultra", k)}
                      thinkers={thinkers}
                      onChange={setThinkers}
                    />
                  )}
                  <div className="composer-tools">
                    <button
                      type="button"
                      className="composer-control composer-model-trigger"
                      onClick={() =>
                        setToast("Preview: the thread's agent is also the lead")
                      }
                    >
                      <ProviderIcon provider="claude" />
                      <span>{lead.name}</span>
                      <ChevronDown size={12} />
                    </button>
                    <span className="composer-divider" aria-hidden />
                    {look === "tiles" ? (
                      <ModeTiles mode={mode} kind={kind} onPick={pick} />
                    ) : (
                      <ModeList mode={mode} onPick={pick} />
                    )}
                    <span className="spacer" />
                    {running && (
                      <button
                        type="button"
                        className="composer-stop"
                        aria-label="Stop"
                        title="Stop the council and the lead"
                        onClick={() =>
                          updateRun(council.id, (r) => ({
                            ...r,
                            stopped: true,
                          }))
                        }
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <rect x="2" y="2" width="8" height="8" rx="1.5" />
                        </svg>
                      </button>
                    )}
                    {(!running || !!draft.trim()) && (
                      <button
                        type="submit"
                        className={`primary send-message ${ultra ? "up-send" : ""}`}
                        aria-label={
                          ultra
                            ? `Send to ${thinkers.length} thinkers, then ${lead.name}`
                            : "Send message"
                        }
                        title={
                          ultra
                            ? `${thinkers.length} thinkers, then ${lead.name} picks and checks`
                            : "Send message"
                        }
                      >
                        <ArrowUp size={18} />
                        {ultra && (
                          <span className="up-send-count">
                            {thinkers.length}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>
          </Dock>
        </section>
      </div>

      {toast && (
        <div className="dr-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

const modeRows: { mode: Mode; icon: ReactNode; label: string; hint: string }[] =
  [
    {
      mode: "build",
      icon: <Bot size={15} />,
      label: "Build",
      hint: "edits files",
    },
    {
      mode: "plan",
      icon: <PencilRuler size={14} />,
      label: "Plan",
      hint: "no edits",
    },
    {
      mode: "ultra",
      icon: <Orbit size={14} />,
      label: "Ultraplan",
      hint: "a council thinks first",
    },
  ];
const kindHint: Record<Kind, string> = {
  angles: "Each thinker gets its own job",
  same: "Every thinker gets the same task; agreement means confidence",
};

/** The mode button every look shares. */
function ModeTrigger({ mode }: { mode: Mode }) {
  const row = modeRows.find((r) => r.mode === mode)!;
  return (
    <Menu.Trigger
      aria-label="Mode"
      title="Mode · ⇧Tab to switch"
      className={`composer-control composer-interaction up-mode ${mode !== "build" ? "selected" : ""}`}
      data-mode={mode}
    >
      {row.icon}
      <span className={mode === "ultra" ? "up-gradient-text" : undefined}>
        {row.label}
      </span>
      <ChevronDown size={12} />
    </Menu.Trigger>
  );
}

/** A and C: three modes, one line each; the council's kind lives elsewhere. */
function ModeList({
  mode,
  onPick,
}: {
  mode: Mode;
  onPick: (mode: Mode) => void;
}) {
  return (
    <Menu.Root>
      <ModeTrigger mode={mode} />
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup
            className="composer-select-popup up-mode-list"
            aria-label="Mode"
          >
            <Menu.RadioGroup
              value={mode}
              onValueChange={(value) => onPick(value as Mode)}
            >
              {modeRows.map((r) => (
                <Menu.RadioItem
                  key={r.mode}
                  className="composer-select-item"
                  value={r.mode}
                  data-mode={r.mode}
                  closeOnClick
                >
                  <span className="up-mode-row">
                    {r.icon}
                    <span
                      className={
                        r.mode === "ultra" ? "up-gradient-text" : undefined
                      }
                    >
                      {r.label}
                    </span>
                    <small>{r.hint}</small>
                  </span>
                  <Menu.RadioItemIndicator>
                    <Check size={13} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** B: the three modes as tiles, and the council's kind in a strip below. */
function ModeTiles({
  mode,
  kind,
  onPick,
}: {
  mode: Mode;
  kind: Kind;
  onPick: (mode: Mode, kind?: Kind) => void;
}) {
  return (
    <Menu.Root orientation="horizontal">
      <ModeTrigger mode={mode} />
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup
            className="composer-select-popup up-tiles-popup"
            aria-label="Mode"
          >
            <Menu.RadioGroup
              className="up-tiles"
              value={mode}
              onValueChange={(value) => onPick(value as Mode)}
            >
              {modeRows.map((r) => (
                <Menu.RadioItem
                  key={r.mode}
                  className="up-tile"
                  value={r.mode}
                  data-mode={r.mode}
                  closeOnClick
                >
                  <span className="up-tile-icon">{r.icon}</span>
                  <strong
                    className={
                      r.mode === "ultra" ? "up-gradient-text" : undefined
                    }
                  >
                    {r.label}
                  </strong>
                  <small>{r.hint}</small>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.RadioGroup
              className="up-tile-kinds"
              data-dim={mode !== "ultra" || undefined}
              value={mode === "ultra" ? kind : ""}
              onValueChange={(value) => onPick("ultra", value as Kind)}
            >
              <span className="up-tile-kinds-label">Council</span>
              {(["angles", "same"] as const).map((k) => (
                <Menu.RadioItem
                  key={k}
                  className="up-tile-kind"
                  value={k}
                  title={kindHint[k]}
                  closeOnClick
                >
                  {kindIcon(k, 12)}
                  {kindLabel[k]}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ThinkerRow({
  look,
  kind,
  onKind,
  thinkers,
  onChange,
}: {
  look: Look;
  kind: Kind;
  onKind: (kind: Kind) => void;
  thinkers: Thinker[];
  onChange: (thinkers: Thinker[]) => void;
}) {
  const set = (id: string, patch: Partial<Thinker>) =>
    onChange(thinkers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const add = () => {
    const angle =
      (Object.keys(angles) as AngleId[]).find(
        (a) => a !== "same" && !thinkers.some((t) => t.angle === a),
      ) ?? "skeptic";
    // Prefer a family the council doesn't have yet, then a model it doesn't.
    const codex = thinkers.filter(
      (t) => model(t.model).provider === "codex",
    ).length;
    const provider = codex * 2 < thinkers.length ? "codex" : "claude";
    const next =
      models.find(
        (m) =>
          m.provider === provider &&
          m.id !== lead.id &&
          !thinkers.some((t) => t.model === m.id),
      ) ?? models.find((m) => !thinkers.some((t) => t.model === m.id))!;
    onChange([...thinkers, { id: crypto.randomUUID(), angle, model: next.id }]);
  };
  const oneFamily =
    thinkers.length > 1 &&
    thinkers.every(
      (t) => model(t.model).provider === model(thinkers[0]!.model).provider,
    );
  const jobs = look === "per-thinker" || kind === "angles";
  return (
    <div className="composer-tools up-thinkers" aria-label="Thinkers">
      {look === "toggle" ? (
        <div className="up-kind-toggle" role="radiogroup" aria-label="Council">
          {(["angles", "same"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              title={kindHint[k]}
              onClick={() => k !== kind && onKind(k)}
            >
              {kindIcon(k, 12)}
              {kindLabel[k]}
            </button>
          ))}
        </div>
      ) : (
        <span className="up-row-label">
          {look === "per-thinker" ? (
            <>
              <Orbit size={12} />
              Council
            </>
          ) : (
            <>
              {kindIcon(kind, 12)}
              {kindLabel[kind]}
            </>
          )}
        </span>
      )}
      {thinkers.map((t) => (
        <span key={t.id} className="up-thinker">
          {jobs && (
            <ComposerSelect<AngleId>
              label="Job"
              value={t.angle}
              icon={angles[t.angle].icon}
              options={angleOptions(look)}
              onChange={(angle) => set(t.id, { angle })}
            />
          )}
          <ComposerSelect<string>
            label="Model"
            value={t.model}
            icon={<ProviderIcon provider={model(t.model).provider} />}
            options={modelOptions}
            onChange={(m) => set(t.id, { model: m })}
          />
          {thinkers.length > 1 && (
            <button
              type="button"
              className="up-thinker-remove"
              aria-label="Remove thinker"
              onClick={() => onChange(thinkers.filter((x) => x.id !== t.id))}
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {thinkers.length < MAX_THINKERS && (
        <button
          type="button"
          className="composer-control"
          aria-label="Add a thinker"
          title="Add a thinker"
          onClick={add}
        >
          <Plus size={13} />
        </button>
      )}
      {oneFamily && (
        <span className="up-hint">
          All one family: mix Claude and Codex for different takes
        </span>
      )}
    </div>
  );
}

function UserMessage({ item }: { item: Extract<Item, { kind: "user" }> }) {
  return (
    <article className="project-message user">
      <header>
        <strong>You</strong>
        {item.mode === "ultra" && item.council && (
          <span className="up-chip">
            <Orbit size={11} />
            Ultraplan · {kindLabel[item.council].toLowerCase()}
          </span>
        )}
        {item.mode === "plan" && (
          <span className="up-chip plain">
            <PencilRuler size={11} />
            Plan
          </span>
        )}
        <time>{time(item.created)}</time>
      </header>
      <div className="markdown">
        <p>{item.body}</p>
      </div>
    </article>
  );
}

function Answer({
  body,
  created,
  lead: isLead,
  after,
}: {
  body: string;
  created: number;
  lead?: boolean;
  after?: ReactNode;
}) {
  return (
    <article className="project-message assistant">
      <header>
        <strong>
          <ProviderIcon provider="claude" />
          {isLead ? lead.name : "Claude"}
        </strong>
        {isLead && (
          <span className="muted">lead · picked and checked the council's notes</span>
        )}
      </header>
      <RichText text={body} projectRoot={projectRoot} onOpenFile={() => {}} />
      {after}
      <MessageActions
        text={body}
        sent={created}
        pending={false}
        onReply={() => {}}
      />
    </article>
  );
}

const stages: { phase: Phase; label: string }[] = [
  { phase: "brief", label: "Brief" },
  { phase: "thinking", label: "Thinkers" },
  { phase: "checking", label: "Pick & check" },
];
const order: Phase[] = ["brief", "thinking", "checking", "done"];

function Council({
  run,
  onToggle,
  onResume,
  onBuild,
}: {
  run: CouncilRun;
  onToggle: (open: boolean) => void;
  onResume: () => void;
  onBuild: () => void;
}) {
  const phase = phaseOf(run);
  const count = run.thinkers.length;
  const open = run.open ?? phase !== "done";
  const claims = claimCount(run);
  const thought = Math.max(...run.thinkers.map((_, i) => thinkerDone(i)));
  const checked = Math.min(
    claims,
    Math.floor(((run.tick - thought) * claims) / CHECK_TICKS),
  );
  const thinkers = `${count} ${count === 1 ? "thinker" : "thinkers"}`;
  const status = run.stopped
    ? "stopped"
    : phase === "brief"
      ? `${lead.name} is writing the brief`
      : phase === "thinking"
        ? `${thinkers} at work`
        : phase === "checking"
          ? `${lead.name} is checking claims · ${checked} of ${claims}`
          : `${thinkers} · ${claims} claims checked, 1 set aside`;
  const at = order.indexOf(phase);
  return (
    <>
      <section className="deep-review-council up-council" aria-label="Council">
        <button
          type="button"
          className="deep-review-council-toggle"
          aria-expanded={open}
          onClick={() => onToggle(!open)}
        >
          <Orbit size={14} />
          <strong>Ultraplan</strong>
          <span className="up-kind">
            {kindIcon(run.kind, 12)}
            {kindLabel[run.kind]}
          </span>
          <span
            className={!run.stopped && phase !== "done" ? "up-live" : undefined}
          >
            {status}
          </span>
          <span className="deep-review-council-glyphs">
            {run.thinkers.map((t) => (
              <ProviderIcon key={t.id} provider={model(t.model).provider} />
            ))}
          </span>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {open && (
          <>
            <ol className="up-stages" aria-label="Stages">
              {stages.map((s, i) => (
                <li
                  key={s.phase}
                  data-state={
                    i < at ? "done" : i === at && !run.stopped ? "now" : "later"
                  }
                >
                  {i < at ? <CircleCheck size={12} /> : <span>{i + 1}</span>}
                  {s.label}
                </li>
              ))}
            </ol>
            <div className="up-brief">
              <header>
                <FileText size={12} />
                <strong>Brief</strong>
                <span className="muted">
                  by {lead.name} ·{" "}
                  {run.kind === "same"
                    ? "every thinker gets exactly this"
                    : "plus each thinker's job"}
                </span>
              </header>
              {phase === "brief" ? (
                <p className="muted">Writing the brief…</p>
              ) : (
                <RichText
                  text={briefText(run.kind)}
                  projectRoot={projectRoot}
                  onOpenFile={() => {}}
                />
              )}
            </div>
            <div className="deep-review-grid" data-count={count}>
              {run.thinkers.map((t, i) => (
                <ThinkerPane
                  key={t.id}
                  run={run}
                  thinker={t}
                  slot={i}
                />
              ))}
            </div>
          </>
        )}
        {run.stopped && (
          <div className="deep-review-stopped" role="status">
            <span>Ultraplan stopped.</span>
            <button type="button" className="resume-answer" onClick={onResume}>
              <RotateCcw size={13} />
              Resume
            </button>
          </div>
        )}
      </section>
      {phase === "done" && (
        <Answer
          body={leadAnswer(run)}
          created={run.created + 60000}
          lead
          after={
            <button type="button" className="up-build" onClick={onBuild}>
              <Hammer size={13} />
              Build this plan
            </button>
          }
        />
      )}
    </>
  );
}

function ThinkerPane({
  run,
  thinker,
  slot,
}: {
  run: CouncilRun;
  thinker: Thinker;
  slot: number;
}) {
  const m = model(thinker.model);
  const angle = run.kind === "angles" ? angles[thinker.angle] : undefined;
  const report = reportFor(run, slot);
  const thinking = run.tick - BRIEF_TICKS;
  const shown =
    thinking < 0 ? 0 : Math.min(STEPS, Math.floor(thinking / pace[slot]!));
  const done = run.tick >= thinkerDone(slot);
  return (
    <section
      className="deep-review-pane"
      aria-label={`${angle?.label ?? `Thinker ${slot + 1}`}: ${m.name}`}
    >
      <header>
        {angle && <span className="up-pane-lens">{angle.icon}</span>}
        <strong>{angle?.label ?? `Thinker ${slot + 1}`}</strong>
        <ProviderIcon provider={m.provider} />
        <span className="muted">{m.name}</span>
        <span className="spacer" />
        {done ? (
          <span className="deep-review-pane-status done">
            <CircleCheck size={13} /> Done
          </span>
        ) : (
          <span className="deep-review-pane-status">
            {thinking < 0 ? "Waiting for the brief" : "Thinking"}
          </span>
        )}
      </header>
      <div className="deep-review-pane-thread up-pane-body">
        <p className="up-pane-angle">
          {angle?.job ?? "Same brief as the others"} · read-only
        </p>
        <ul className="up-steps">
          {report.steps.slice(0, shown).map((s, i) => (
            <li key={i}>
              {s.kind === "read" ? (
                <FileText size={12} />
              ) : (
                <Search size={12} />
              )}
              <span>{s.kind === "read" ? "Read" : "Searched"}</span>
              <code>{s.text}</code>
            </li>
          ))}
        </ul>
        {done && (
          <>
            <ul className="up-notes" aria-label="Notes">
              {report.notes.map((n, i) => (
                <li key={i}>
                  <span className="up-confidence" data-level={n.confidence}>
                    {n.confidence}
                  </span>
                  <span>
                    <RichText text={n.text} />
                    {n.evidence && <code className="up-evidence">{n.evidence}</code>}
                  </span>
                </li>
              ))}
            </ul>
            {report.assumed && (
              <p className="up-meta">
                <strong>Assumed</strong> {report.assumed}
              </p>
            )}
            {report.question && (
              <p className="up-meta">
                <strong>Question for you</strong> {report.question}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Thread({ children, sent }: { children: ReactNode; sent: number }) {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    follow.current = true;
    const e = scroll.current!;
    e.scrollTop = e.scrollHeight;
  }, [sent]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      const e = scroll.current!;
      if (follow.current) e.scrollTop = e.scrollHeight;
    });
    observer.observe(column.current!);
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
