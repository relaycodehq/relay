// Sample data for the teaser: made-up threads, a made-up turn and made-up
// diffs. Times are milliseconds on the teaser's clock.
import type {
  AgentActivity,
  AgentTrace,
  ChatMessage,
  TurnFileChange,
} from "../../../shared/projects";
import type { FilePair } from "../../../shared/types";
import type { AgentProvider } from "../../../shared/agents";
import { EPOCH } from "./teaser-time";

export const projectRoot = "/Users/you/relay";

export const prompt =
  "Add ⌘1–9 shortcuts that jump to the Nth thread in Activity, and cover them with a test.";

export interface CardData {
  id: string;
  project: string;
  title: string;
  branch: string;
  provider: AgentProvider;
  pr?: number;
  state:
    | { kind: "running"; since: number }
    | { kind: "waiting" }
    | { kind: "unread"; age: string }
    | { kind: "idle"; age: string };
}

export const cards: CardData[] = [
  {
    id: "web",
    project: "website",
    title: "Hero section for the launch page",
    branch: "launch-hero",
    provider: "codex",
    state: { kind: "running", since: -134_000 },
  },
  {
    id: "split",
    project: "relay",
    title: "Split project-chats.ts into modules",
    branch: "split-chats",
    provider: "claude",
    state: { kind: "running", since: -48_000 },
  },
  {
    id: "usage",
    project: "openusage",
    title: "Weekly usage in the menu bar",
    branch: "main",
    provider: "codex",
    state: { kind: "unread", age: "12m" },
  },
  {
    id: "pr",
    project: "api",
    title: "Review: rate-limit the upload endpoint",
    branch: "upload-limits",
    provider: "claude",
    pr: 142,
    state: { kind: "idle", age: "1h" },
  },
  {
    id: "notes",
    project: "relay-releases",
    title: "Release notes for 0.2",
    branch: "main",
    provider: "claude",
    state: { kind: "idle", age: "3h" },
  },
];

type Step =
  | { at: number; say: string }
  | { at: number; took: number; kind: AgentActivity["kind"]; label: string };

export interface TurnScript {
  steps: Step[];
  /** When the answer starts streaming, and how long it takes to write. */
  answerAt: number;
  writeFor: number;
  body: string;
}

export const buildTurn: TurnScript = {
  steps: [
    { at: 0, say: "Looking at how the sidebar orders Activity cards." },
    {
      at: 500,
      took: 500,
      kind: "read",
      label: "src/components/ProjectSidebar.tsx",
    },
    { at: 1100, took: 500, kind: "search", label: "registerShortcut" },
    { at: 1700, took: 450, kind: "read", label: "src/lib/shortcuts.ts" },
    {
      at: 2300,
      say: "Cards already sort by attention, so the Nth card is stable. The bindings go next to ⌘N.",
    },
    { at: 3000, took: 650, kind: "file", label: "src/lib/shortcuts.ts" },
    {
      at: 3700,
      took: 600,
      kind: "file",
      label: "src/components/ProjectSidebar.tsx",
    },
    {
      at: 4350,
      took: 550,
      kind: "file",
      label: "tests/unit/shortcuts.test.ts",
    },
    {
      at: 5000,
      took: 1500,
      kind: "command",
      label: "npx vitest run tests/unit/shortcuts.test.ts",
    },
  ],
  answerAt: 6700,
  writeFor: 1300,
  body:
    "Added **⌘1–9** to jump to the Nth card in Activity. Holding **⌘** shows the numbers on the cards, so you can see where each one goes.\n\n" +
    "The bindings live in `src/lib/shortcuts.ts` next to ⌘N, and `tests/unit/shortcuts.test.ts` covers ordering, settled threads and an empty slot. All 14 tests pass.",
};

/** The turn as the app would hold it `elapsed` ms after it started. */
export function turnAt(
  id: string,
  provider: AgentProvider,
  script: TurnScript,
  started: number,
  elapsed: number,
): ChatMessage {
  const done = elapsed >= script.answerAt + script.writeFor;
  const written = Math.max(
    0,
    Math.min(1, (elapsed - script.answerAt) / script.writeFor),
  );
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
  // Stream whole words so markdown never shows half a `code` span.
  const words = script.body.split(/(?<=\s)/);
  const body = words.slice(0, Math.ceil(words.length * written)).join("");
  return {
    id,
    role: "assistant",
    provider,
    status: done ? "complete" : "streaming",
    body: done ? script.body : written > 0 ? body : "",
    created: EPOCH + started,
    ...(done
      ? { ended: EPOCH + started + script.answerAt + script.writeFor }
      : {}),
    trace,
    version: 1,
  };
}

export const changedFiles: TurnFileChange[] = [
  { path: "src/lib/shortcuts.ts", additions: 24, deletions: 3 },
  { path: "src/components/ProjectSidebar.tsx", additions: 11, deletions: 2 },
  { path: "tests/unit/shortcuts.test.ts", additions: 38, deletions: 0 },
];

const shortcutsBefore = `import { useEffect } from "react";
import { isMac } from "./platform";

export type Shortcut = {
  key: string;
  meta?: boolean;
  shift?: boolean;
  run: () => void;
};

const bindings = new Map<string, Shortcut>();

const id = (s: Pick<Shortcut, "key" | "meta" | "shift">) =>
  [s.meta && "meta", s.shift && "shift", s.key.toLowerCase()]
    .filter(Boolean)
    .join("+");

export function registerShortcut(shortcut: Shortcut) {
  bindings.set(id(shortcut), shortcut);
  return () => bindings.delete(id(shortcut));
}

/** New thread, settings and search; the rest live with their panes. */
export function useAppShortcuts(actions: {
  newThread: () => void;
  settings: () => void;
  search: () => void;
}) {
  useEffect(() => {
    const off = [
      registerShortcut({ key: "n", meta: true, run: actions.newThread }),
      registerShortcut({ key: ",", meta: true, run: actions.settings }),
      registerShortcut({ key: "f", meta: true, run: actions.search }),
    ];
    return () => off.forEach((dispose) => dispose());
  }, [actions]);
}

export function handleKey(event: KeyboardEvent) {
  const meta = isMac ? event.metaKey : event.ctrlKey;
  const match = bindings.get(
    id({ key: event.key, meta, shift: event.shiftKey }),
  );
  if (!match) return false;
  event.preventDefault();
  match.run();
  return true;
}
`;

const shortcutsAfter = `import { useEffect } from "react";
import { isMac } from "./platform";

export type Shortcut = {
  key: string;
  meta?: boolean;
  shift?: boolean;
  run: () => void;
};

const bindings = new Map<string, Shortcut>();

const id = (s: Pick<Shortcut, "key" | "meta" | "shift">) =>
  [s.meta && "meta", s.shift && "shift", s.key.toLowerCase()]
    .filter(Boolean)
    .join("+");

export function registerShortcut(shortcut: Shortcut) {
  bindings.set(id(shortcut), shortcut);
  return () => bindings.delete(id(shortcut));
}

/** ⌘1–9 open the Nth card in Activity, in the order the sidebar shows. */
const slots = Array.from({ length: 9 }, (_, i) => String(i + 1));

/** New thread, settings, search and the Activity slots. */
export function useAppShortcuts(actions: {
  newThread: () => void;
  settings: () => void;
  search: () => void;
  openSlot: (index: number) => void;
}) {
  useEffect(() => {
    const off = [
      registerShortcut({ key: "n", meta: true, run: actions.newThread }),
      registerShortcut({ key: ",", meta: true, run: actions.settings }),
      registerShortcut({ key: "f", meta: true, run: actions.search }),
      ...slots.map((key, index) =>
        registerShortcut({
          key,
          meta: true,
          run: () => actions.openSlot(index),
        }),
      ),
    ];
    return () => off.forEach((dispose) => dispose());
  }, [actions]);
}

export function handleKey(event: KeyboardEvent) {
  const meta = isMac ? event.metaKey : event.ctrlKey;
  const match = bindings.get(
    id({ key: event.key, meta, shift: event.shiftKey }),
  );
  if (!match) return false;
  event.preventDefault();
  match.run();
  return true;
}
`;

export const shortcutsPair: FilePair = {
  old: {
    name: "src/lib/shortcuts.ts",
    contents: shortcutsBefore,
    cacheKey: "teaser-old",
  },
  next: {
    name: "src/lib/shortcuts.ts",
    contents: shortcutsAfter,
    cacheKey: "teaser-new",
  },
  binary: false,
};

export const terminalLines: { at: number; text: string; tone?: string }[] = [
  {
    at: 0,
    text: "~/relay main* ❯ npx vitest run tests/unit/shortcuts.test.ts",
    tone: "prompt",
  },
  { at: 700, text: "" },
  { at: 750, text: " RUN  v4.1.2 /Users/you/relay", tone: "dim" },
  { at: 1100, text: "" },
  {
    at: 1200,
    text: " ✓ tests/unit/shortcuts.test.ts (14 tests) 38ms",
    tone: "pass",
  },
  { at: 1450, text: "   ✓ opens the Nth Activity card with ⌘N", tone: "dim" },
  { at: 1550, text: "   ✓ skips settled threads", tone: "dim" },
  { at: 1650, text: "   ✓ ignores an empty slot", tone: "dim" },
  { at: 1900, text: "" },
  { at: 1950, text: " Test Files  1 passed (1)", tone: "pass" },
  { at: 2050, text: "      Tests  14 passed (14)", tone: "pass" },
  { at: 2150, text: "   Duration  412ms", tone: "dim" },
  { at: 2500, text: "" },
  { at: 2550, text: "~/relay main* ❯ ", tone: "prompt" },
];

// Deep review: two reviewers, then the lead's report.
export const reviewScripts: TurnScript[] = [
  {
    steps: [
      { at: 0, took: 500, kind: "command", label: "git diff --stat HEAD" },
      {
        at: 700,
        say: "Seven files changed. Starting with the queue and the thread scope.",
      },
      {
        at: 1300,
        took: 600,
        kind: "read",
        label: "src/components/ProjectChat.tsx",
      },
      { at: 2000, took: 500, kind: "read", label: "src/lib/queue.ts" },
      { at: 2600, took: 700, kind: "search", label: "moveQueued" },
      {
        at: 3400,
        took: 600,
        kind: "read",
        label: "src/components/ProjectShell.tsx",
      },
    ],
    answerAt: 4300,
    writeFor: 700,
    body: "**4 findings.** Two can lose a message or keep a stale scope.",
  },
  {
    steps: [
      { at: 0, took: 700, kind: "command", label: "git diff HEAD" },
      { at: 900, say: "Checking the reorder path against concurrent sends." },
      { at: 1500, took: 700, kind: "read", label: "src/lib/queue.ts" },
      {
        at: 2300,
        took: 600,
        kind: "read",
        label: "src/components/waiting-strip.css",
      },
      {
        at: 3100,
        took: 900,
        kind: "command",
        label: "npx vitest run tests/unit/queue.test.ts",
      },
    ],
    answerAt: 4600,
    writeFor: 700,
    body: "**3 findings**, one of them a race in `moveQueued`.",
  },
];

export type Severity = "high" | "medium";
export const findings: {
  id: string;
  severity: Severity;
  title: string;
  files: { path: string; line: number }[];
  by: AgentProvider[];
}[] = [
  {
    id: "queue",
    severity: "high",
    title: "Reordering the queue can drop a message",
    files: [{ path: "src/components/ProjectChat.tsx", line: 895 }],
    by: ["claude", "codex"],
  },
  {
    id: "scope",
    severity: "high",
    title: "Thread keeps its PR scope after switching branch",
    files: [
      { path: "src/components/ProjectShell.tsx", line: 199 },
      { path: "src/components/ProjectChat.tsx", line: 456 },
    ],
    by: ["claude"],
  },
  {
    id: "strip",
    severity: "medium",
    title: "Waiting strip keeps animating when the window is unfocused",
    files: [{ path: "src/components/waiting-strip.css", line: 12 }],
    by: ["claude", "codex"],
  },
  {
    id: "draft",
    severity: "medium",
    title: "A pasted text card disappears on reload",
    files: [{ path: "src/components/PastedTextCard.tsx", line: 48 }],
    by: ["codex"],
  },
];
