// Sample data and the setup state both review-prompt options share.
import { useEffect, useState } from "react";
import { agents, type AgentProvider } from "../../shared/agents";
import type { ModelChoice } from "../../shared/settings";

/**
 * What a reviewer is told, as the agent would get it: its own review command
 * (or "" for an agent without one), `/name …` another command, `$name` a Codex
 * skill, anything else is yours.
 */
export type Reviewer = {
  provider: AgentProvider;
  choice: ModelChoice;
  prompt: string;
};
export type Lead = { provider: AgentProvider; choice: ModelChoice };
export type Setup = { reviewers: Reviewer[]; lead: Lead; runChecks: boolean };
export type Saved = {
  id: string;
  setup: Setup;
  at: number;
  /** Written by the helper agent once the review starts, or by you. */
  name?: string;
  /** Stays in the row and past the history cap. */
  pinned?: boolean;
};

export type PromptItem = {
  kind: "command" | "skill";
  name: string;
  description: string;
  /** What goes in the prompt. */
  token: string;
};

/** Sample commands and skills; the real ones come from `api.projectCommands`. */
export const catalog: Record<AgentProvider, PromptItem[]> = {
  claude: [
    command("security-review", "Security review of the pending changes"),
    command("simplify", "Reuse, simplification and efficiency pass"),
    command("review-migrations", "Project · checks migrations run both ways"),
    skill("/", "web-interface-guidelines", "Vercel Web Interface Guidelines"),
    skill("/", "perf-audit", "Personal · hot paths, allocations, re-renders"),
  ],
  codex: [
    command("review-security", "Personal · auth, secrets, injection"),
    skill("$", "test-gaps", "Finds changes no test would catch"),
    skill("$", "race-hunter", "Concurrency, ordering and retries"),
  ],
  cursor: [command("review-security", "Bugbot's security pass")],
  opencode: [command("check", "Project · lint, types and tests")],
};
function command(name: string, description: string): PromptItem {
  return { kind: "command", name, description, token: `/${name}` };
}
function skill(prefix: string, name: string, description: string): PromptItem {
  return { kind: "skill", name, description, token: `${prefix}${name}` };
}

export const nativeCommand = (p: AgentProvider) =>
  agents[p].reviewCommand.startsWith("/") ? agents[p].reviewCommand : "";
export const nativeLabel = (p: AgentProvider) =>
  nativeCommand(p) || "Relay's review prompt";

export type Parsed =
  | { kind: "native"; rest: string }
  | { kind: "command" | "skill"; item: PromptItem; rest: string }
  | { kind: "custom"; text: string };
export function parsePrompt(provider: AgentProvider, prompt: string): Parsed {
  const text = prompt.trim();
  const token = /^[/$][^\s]+/.exec(text)?.[0];
  if (!text) return { kind: "native", rest: "" };
  if (token && token === nativeCommand(provider))
    return { kind: "native", rest: text.slice(token.length).trim() };
  const item = token && catalog[provider].find((i) => i.token === token);
  if (item)
    return { kind: item.kind, item, rest: text.slice(token.length).trim() };
  return { kind: "custom", text };
}

/** Your own prompts, newest first, from what you have run. */
export function customPrompts(saved: Saved[], extra: string[] = []) {
  const all = [
    ...extra,
    ...saved.flatMap((s) => s.setup.reviewers.map((r) => r.prompt)),
  ].map((p) => p.trim());
  return [...new Set(all.filter((p) => p && !/^[/$]/.test(p)))];
}

// ——— Sample lineup ———

const opus = (reasoningEffort: ModelChoice["reasoningEffort"] = "high") => ({
  model: "claude-opus-5-5",
  reasoningEffort,
  fast: false,
});
const minute = 60_000;
const now = Date.now();

const sampleSaved: Saved[] = [
  {
    id: "s1",
    name: "Full council, security pass",
    at: now - 2 * 60 * minute,
    setup: {
      reviewers: [
        { provider: "claude", choice: opus(), prompt: "/code-review" },
        {
          provider: "codex",
          choice: { model: "gpt-6-sol", reasoningEffort: "high", fast: true },
          prompt: "/review",
        },
        {
          provider: "claude",
          choice: {
            model: "claude-sonnet-5",
            reasoningEffort: "high",
            fast: false,
          },
          prompt: "/security-review",
        },
        {
          provider: "cursor",
          choice: { model: "grok-4.7", reasoningEffort: "xhigh", fast: false },
          prompt: "/review-bugbot",
        },
      ],
      lead: { provider: "claude", choice: opus() },
      runChecks: true,
    },
  },
  {
    id: "s2",
    name: "Queue race hunt",
    at: now - 26 * 60 * minute,
    setup: {
      reviewers: [
        {
          provider: "claude",
          choice: opus("xhigh"),
          prompt:
            "Look only for races, lost updates and retry storms in the queue. Ignore style.",
        },
        {
          provider: "codex",
          choice: { model: "gpt-6-sol", reasoningEffort: "xhigh", fast: false },
          prompt: "$race-hunter",
        },
      ],
      lead: { provider: "claude", choice: opus("xhigh") },
      runChecks: true,
    },
  },
  {
    id: "s3",
    name: "Quick Sonnet pass",
    pinned: true,
    at: now - 3 * 24 * 60 * minute,
    setup: {
      reviewers: [
        {
          provider: "claude",
          choice: {
            model: "claude-sonnet-5",
            reasoningEffort: "medium",
            fast: false,
          },
          prompt: "/code-review",
        },
      ],
      lead: {
        provider: "claude",
        choice: {
          model: "claude-sonnet-5",
          reasoningEffort: "medium",
          fast: false,
        },
      },
      runChecks: false,
    },
  },
  {
    id: "s4",
    name: "Animation pause check",
    at: now - 5 * 24 * 60 * minute,
    setup: {
      reviewers: [
        {
          provider: "claude",
          choice: opus(),
          prompt: "/web-interface-guidelines",
        },
        {
          provider: "codex",
          choice: { model: "gpt-6-sol", reasoningEffort: "high", fast: false },
          prompt:
            "Check every new animation pauses when the window is unfocused and uses transform/opacity only.",
        },
      ],
      lead: { provider: "claude", choice: opus() },
      runChecks: false,
    },
  },
];

export const sampleCursorModels = [
  {
    id: "grok-4.7",
    name: "Grok 4.7",
    description: "",
    efforts: ["high", "xhigh"],
  },
  { id: "composer-2", name: "Composer 2", description: "", efforts: [] },
];

// ——— State ———

/**
 * Stands in for the helper agent that names a setup once its review starts,
 * as `electron/agents/thread-titles.ts` names threads: the prompts say most, then
 * who reviews.
 */
function nameFor(setup: Setup, models: (a: Reviewer | Lead) => string) {
  const { reviewers } = setup;
  const own = new Set<string>(reviewers.map((r) => nativeCommand(r.provider)));
  const focus = reviewers
    .map((r) => r.prompt.trim())
    .find((p) => p && !own.has(p.split(" ")[0]!));
  let name: string;
  if (!focus)
    name =
      reviewers.length === 1
        ? `${models(reviewers[0]!)} solo review`
        : reviewers.length >= 4
          ? "Full council review"
          : `${reviewers.length}-agent review`;
  else if (/^[/$]/.test(focus))
    name = focus.split(" ")[0]!.slice(1).replace(/-/g, " ");
  else
    name = focus
      .replace(/[^\w\s+-]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !filler.has(w.toLowerCase()))
      .slice(0, 3)
      .join(" ");
  return name[0]!.toUpperCase() + name.slice(1);
}
const filler = new Set(
  "a an the and or of for to in on at by with only just new any every all look check find review make sure ignore please that this these those is are be".split(
    " ",
  ),
);

const storeKey = "preview-review-prompts-4";
type Store = {
  setup: Setup;
  /** Most recently run first; the first is where a new review starts. */
  saved: Saved[];
  /** Per agent, the prompt its last reviewer ran; a new reviewer starts there. */
  lastPrompt: Partial<Record<AgentProvider, string>>;
};
const fresh = (): Store => ({
  setup: structuredClone(sampleSaved[0]!.setup),
  saved: sampleSaved,
  lastPrompt: {},
});

const sameSetup = (a: Setup, b: Setup) =>
  JSON.stringify(a) === JSON.stringify(b);
/** Unpinned setups kept; pinned ones are kept on top of these. */
const HISTORY = 8;

function capped(saved: Saved[]) {
  let unpinned = 0;
  return saved.filter((e) => e.pinned || ++unpinned <= HISTORY);
}

export function useSetupStore(models: (a: Reviewer | Lead) => string) {
  const [store, setStore] = useState<Store>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey)!) ?? fresh();
    } catch {
      return fresh();
    }
  });
  useEffect(
    () => localStorage.setItem(storeKey, JSON.stringify(store)),
    [store],
  );
  const { setup, saved } = store;
  const edit = (id: string, patch: Partial<Saved>) =>
    setStore((s) => ({
      ...s,
      saved: s.saved.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  return {
    ...store,
    current: saved.find((s) => sameSetup(s.setup, setup)),
    update: (patch: Partial<Setup>) =>
      setStore((s) => ({ ...s, setup: { ...s.setup, ...patch } })),
    load: (entry: Saved) =>
      setStore((s) => ({ ...s, setup: structuredClone(entry.setup) })),
    /** What the reviewer for `provider` starts with. */
    promptFor: (provider: AgentProvider) =>
      store.lastPrompt[provider] ?? nativeCommand(provider),
    start: () => {
      const match = saved.find((e) => sameSetup(e.setup, setup));
      const id = match?.id ?? crypto.randomUUID();
      setStore((s) => {
        const entry: Saved = match
          ? { ...match, at: Date.now() }
          : { id, setup: structuredClone(s.setup), at: Date.now() };
        const lastPrompt = { ...s.lastPrompt };
        for (const r of s.setup.reviewers) lastPrompt[r.provider] = r.prompt;
        return {
          ...s,
          lastPrompt,
          saved: capped([entry, ...s.saved.filter((e) => e.id !== id)]),
        };
      });
      if (match?.name) return;
      // The helper agent answers in a second or so; the setup shows as naming until then.
      const name = nameFor(setup, models);
      setTimeout(
        () =>
          setStore((s) => ({
            ...s,
            // Unless you named it first.
            saved: s.saved.map((e) =>
              e.id === id && !e.name ? { ...e, name } : e,
            ),
          })),
        1400,
      );
    },
    rename: (id: string, name: string) => edit(id, { name }),
    togglePin: (id: string) =>
      edit(id, { pinned: !saved.find((e) => e.id === id)?.pinned }),
    forget: (id: string) =>
      setStore((s) => ({ ...s, saved: s.saved.filter((e) => e.id !== id) })),
    reset: () => setStore(fresh()),
  };
}
export type SetupStore = ReturnType<typeof useSetupStore>;

export function ago(at: number) {
  const m = Math.round((Date.now() - at) / minute);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
