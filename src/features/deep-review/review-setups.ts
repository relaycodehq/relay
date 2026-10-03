// Deep review setups you've run, across projects: named by a helper agent
// once a review starts, pinned to keep, the first one where the next starts.
import { useSyncExternalStore } from "react";
import { z } from "zod";
import {
  deepReviewStartSchema,
  ownReviewCommand,
  type ReviewAgent,
} from "../../../shared/deep-review";
import { api } from "../../lib/api";

const setupSchema = deepReviewStartSchema.pick({
  reviewers: true,
  lead: true,
  runChecks: true,
});
export type ReviewSetupChoice = z.infer<typeof setupSchema>;
const entrySchema = z.object({
  id: z.string().max(100),
  /** When it last ran. */
  at: z.number(),
  name: z.string().max(80).optional(),
  pinned: z.boolean().optional(),
  setup: setupSchema,
});
export type SavedReviewSetup = z.infer<typeof entrySchema>;

const key = "deep-review-setups";
/** Unpinned setups kept; pinned ones are kept on top of these. */
const HISTORY = 8;

type Snapshot = { entries: SavedReviewSetup[]; naming: ReadonlySet<string> };
const naming = new Set<string>();
const listeners = new Set<() => void>();
// Parsed once per stored value and naming change, so renders stay cheap.
let cached:
  { raw: string | null; version: number; snapshot: Snapshot } | undefined;
let version = 0;

function read(): Snapshot {
  const raw = localStorage.getItem(key);
  if (cached?.raw === raw && cached.version === version) return cached.snapshot;
  let value: unknown;
  try {
    value = JSON.parse(raw || "[]");
  } catch {
    value = [];
  }
  const entries = (Array.isArray(value) ? value : []).flatMap((item) => {
    const parsed = entrySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const snapshot = { entries, naming: new Set(naming) };
  cached = { raw, version, snapshot };
  return snapshot;
}
function write(entries: SavedReviewSetup[]) {
  localStorage.setItem(key, JSON.stringify(entries));
  changed();
}
function changed() {
  version += 1;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window ran a review.
  const other = (e: StorageEvent) => e.key === key && changed();
  addEventListener("storage", other);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", other);
  };
}

/** Most recently run first, and which of them a helper is still naming. */
export const useReviewSetups = () =>
  useSyncExternalStore(subscribe, read, read);

/** Two setups match when they'd run the same review; an empty prompt is the agent's own. */
function canonical(setup: ReviewSetupChoice) {
  const choice = (c: ReviewAgent["choice"]) =>
    [c.model, c.reasoningEffort, c.fast] as const;
  return JSON.stringify([
    setup.reviewers.map((r) => [
      r.provider,
      choice(r.choice),
      r.prompt?.trim() || ownReviewCommand(r.provider),
    ]),
    [setup.lead.provider, choice(setup.lead.choice)],
    setup.runChecks,
  ]);
}
export const sameSetup = (a: ReviewSetupChoice, b: ReviewSetupChoice) =>
  canonical(a) === canonical(b);

/** The setup of the last review, where a project without its own starts. */
export const latestReviewSetup = (): ReviewSetupChoice | undefined =>
  read().entries[0]?.setup;

/** The prompt the agent's reviewer ran last, else its own review. */
export function lastPrompt(provider: ReviewAgent["provider"]) {
  for (const entry of read().entries) {
    const reviewer = entry.setup.reviewers.find((r) => r.provider === provider);
    if (reviewer) return reviewer.prompt?.trim() || ownReviewCommand(provider);
  }
  return ownReviewCommand(provider);
}

/** Your own prompts, not commands or skills, newest first. */
export function writtenPrompts() {
  const prompts = read().entries.flatMap((e) =>
    e.setup.reviewers.map((r) => r.prompt?.trim() ?? ""),
  );
  return [...new Set(prompts.filter((p) => p && !/^[/$]/.test(p)))];
}

/** Moves a started review's setup to the front, and has a new one named. */
export function recordReviewSetup(setup: ReviewSetupChoice, focus: string) {
  const entries = read().entries;
  const match = entries.find((e) => sameSetup(e.setup, setup));
  const entry: SavedReviewSetup = match
    ? { ...match, at: Date.now() }
    : { id: crypto.randomUUID(), at: Date.now(), setup };
  let unpinned = 0;
  write(
    [entry, ...entries.filter((e) => e.id !== entry.id)].filter(
      (e) => e.pinned || ++unpinned <= HISTORY,
    ),
  );
  if (entry.name) return;
  naming.add(entry.id);
  changed();
  void api
    .nameReviewSetup({
      reviewers: setup.reviewers,
      lead: setup.lead,
      focus,
    })
    .catch(() => null)
    .then((name) => {
      naming.delete(entry.id);
      // Unless you named it meanwhile; without a name it shows its models.
      if (name)
        write(
          read().entries.map((e) =>
            e.id === entry.id && !e.name ? { ...e, name } : e,
          ),
        );
      else changed();
    });
}

function edit(id: string, patch: Partial<SavedReviewSetup>) {
  write(read().entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
}
export const renameReviewSetup = (id: string, name: string) =>
  edit(id, { name: name.trim().slice(0, 80) });
export const pinReviewSetup = (id: string, pinned: boolean) =>
  edit(id, { pinned });
export const forgetReviewSetup = (id: string) =>
  write(read().entries.filter((e) => e.id !== id));
