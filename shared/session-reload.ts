import type { NameChanges, SessionReload } from "./projects";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const kinds = (reload: SessionReload) =>
  [
    [reload.skills, "skill", "Skills"],
    [reload.agents, "agent", "Agents"],
  ] as [NameChanges | undefined, string, string][];

/** "Session reloaded · picked up 2 new skills · 1 agent gone", or "Reloading session…" while `live`. */
export function reloadNote(reload: SessionReload, live = false) {
  if (live) return "Reloading session…";
  const added = kinds(reload)
    .filter(([c]) => c?.added.length)
    .map(([c, word]) => count(c!.added.length, `new ${word}`));
  const removed = kinds(reload)
    .filter(([c]) => c?.removed.length)
    .map(([c, word]) => count(c!.removed.length, word));
  return [
    "Session reloaded",
    ...(added.length ? [`picked up ${added.join(" and ")}`] : []),
    ...(removed.length ? [`${removed.join(" and ")} gone`] : []),
  ].join(" · ");
}

/** The names behind `reloadNote`, a line each; undefined when nothing changed. */
export function reloadDetail(reload: SessionReload) {
  const lines = kinds(reload).flatMap(([c, word, Words]) => [
    ...(c?.added.length ? [`New ${word}s: ${c.added.join(", ")}`] : []),
    ...(c?.removed.length ? [`${Words} gone: ${c.removed.join(", ")}`] : []),
  ]);
  return lines.length ? lines.join("\n") : undefined;
}

/** What `after` has that `before` hadn't, and the reverse; undefined unless both are known. */
export function nameChanges(
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): NameChanges | undefined {
  if (!before || !after) return undefined;
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: [...now].filter((name) => !was.has(name)),
    removed: [...was].filter((name) => !now.has(name)),
  };
}
