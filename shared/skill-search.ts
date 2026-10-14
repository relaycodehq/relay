// How the composer's `$` and `/` menus rank what they offer, ported from T3
// Code (its searchRanking, providerSkillSearch and composerSlashCommandSearch)
// so both pick the same rows in the same order.

import type { ProviderCommand } from "./commands";

function normalizeQuery(input: string, leading: RegExp) {
  return input.trim().replace(leading, "").toLowerCase();
}

function scoreSubsequence(value: string, query: string): number | null {
  let queryIndex = 0;
  let first = -1;
  let previous = -1;
  let gaps = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== query[queryIndex]) continue;
    if (first === -1) first = i;
    if (previous !== -1) gaps += i - previous - 1;
    previous = i;
    queryIndex++;
    if (queryIndex === query.length) {
      const span = i - first + 1 - query.length;
      return first * 2 + gaps * 3 + span + lengthPenalty(value, query);
    }
  }
  return null;
}

const lengthPenalty = (value: string, query: string) =>
  Math.min(64, Math.max(0, value.length - query.length));

/** Lower is better; exact, then prefix, word start, anywhere, in order. */
function scoreMatch(
  value: string,
  query: string,
  bases: {
    exact: number;
    prefix?: number;
    boundary?: number;
    includes?: number;
    fuzzy?: number;
    markers?: readonly string[];
  },
): number | null {
  if (!value || !query) return null;
  if (value === query) return bases.exact;
  if (bases.prefix !== undefined && value.startsWith(query))
    return bases.prefix + lengthPenalty(value, query);
  if (bases.boundary !== undefined) {
    let best: number | null = null;
    for (const marker of bases.markers ?? [" ", "-", "_", "/"]) {
      const index = value.indexOf(marker + query);
      if (index !== -1 && (best === null || index + marker.length < best))
        best = index + marker.length;
    }
    if (best !== null)
      return bases.boundary + best * 2 + lengthPenalty(value, query);
  }
  if (bases.includes !== undefined) {
    const index = value.indexOf(query);
    if (index !== -1)
      return bases.includes + index * 2 + lengthPenalty(value, query);
  }
  if (bases.fuzzy !== undefined) {
    const fuzzy = scoreSubsequence(value, query);
    if (fuzzy !== null) return bases.fuzzy + fuzzy;
  }
  return null;
}

const best = (scores: (number | null)[]) => {
  const found = scores.filter((s): s is number => s !== null);
  return found.length ? Math.min(...found) : null;
};

function ranked<T>(
  items: readonly T[],
  score: (item: T) => number | null,
  tie: (item: T) => string,
) {
  return items
    .flatMap((item) => {
      const s = score(item);
      return s === null ? [] : [{ item, score: s, tie: tie(item) }];
    })
    .sort((a, b) => a.score - b.score || a.tie.localeCompare(b.tie))
    .map((entry) => entry.item);
}

/** A skill's row title: its display name, else its name in words (`pdf-tools` → "Pdf Tools"). */
export function skillLabel(
  skill: Pick<ProviderCommand, "name" | "displayName">,
) {
  const shown = skill.displayName?.trim();
  if (shown) return shown;
  return skill.name
    .split(/[\s:_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function scoreSkill(skill: ProviderCommand, query: string) {
  return best([
    scoreMatch(skill.name.toLowerCase(), query, {
      exact: 0,
      prefix: 2,
      boundary: 4,
      includes: 6,
      fuzzy: 100,
      markers: ["-", "_", "/"],
    }),
    scoreMatch(skillLabel(skill).toLowerCase(), query, {
      exact: 1,
      prefix: 3,
      boundary: 5,
      includes: 7,
      fuzzy: 110,
    }),
    scoreMatch(skill.description.toLowerCase(), query, {
      exact: 30,
      prefix: 32,
      boundary: 34,
      includes: 36,
    }),
    scoreMatch(skill.source ?? "", query, {
      exact: 40,
      prefix: 42,
      includes: 44,
    }),
  ]);
}

/** An agent's skills, once per name whatever its case. */
export function agentSkills(commands: readonly ProviderCommand[]) {
  const seen = new Set<string>();
  return commands.filter((c) => {
    const key = c.name.trim().toLowerCase();
    if (!c.skill || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The agent's commands the `/` menu lists beside its skills: one named like
 * a skill it shows is that skill, offered as `/skill:name`.
 */
export function agentSlashCommands(commands: readonly ProviderCommand[]) {
  const skills = new Set(
    agentSkills(commands).map((s) => s.name.toLowerCase()),
  );
  return commands.filter(
    (c) => !c.skill && !skills.has(c.name.trim().toLowerCase()),
  );
}

/** The skills a `$` query offers, best match first; all of them for an empty one. */
export function searchSkills(
  skills: readonly ProviderCommand[],
  query: string,
): ProviderCommand[] {
  const q = normalizeQuery(query, /^\p{Sc}+/u);
  if (!q) return [...skills];
  return ranked(
    skills,
    (skill) => scoreSkill(skill, q),
    (skill) => `${skillLabel(skill).toLowerCase()}\u0000${skill.name}`,
  );
}

/** A row of the `/` menu: Relay's own commands, the agent's, and its skills. */
export interface SlashItem {
  kind: "relay" | "command" | "skill";
  name: string;
  description: string;
  /** For a skill, the skill. */
  skill?: ProviderCommand;
}

/** The `/` menu's rows for `query`, best match first; all of them for an empty one. */
export function searchSlashItems<T extends SlashItem>(
  items: readonly T[],
  query: string,
): T[] {
  const q = normalizeQuery(query, /^\/+/);
  if (!q) return [...items];
  return ranked(
    items,
    (item) => {
      if (item.skill) {
        if (q === "skill") return 0;
        const skillQuery = q.startsWith("skill:") ? q.slice(6) : q;
        const score = skillQuery ? scoreSkill(item.skill, skillQuery) : 0;
        if (score !== null) return score;
        return "skill".startsWith(q) ? Number.MAX_SAFE_INTEGER : null;
      }
      return best([
        scoreMatch(item.name.toLowerCase(), q, {
          exact: 0,
          prefix: 2,
          boundary: 4,
          includes: 6,
          fuzzy: 100,
          markers: ["-", "_", "/"],
        }),
        scoreMatch(item.description.toLowerCase(), q, {
          exact: 20,
          prefix: 22,
          boundary: 24,
          includes: 26,
        }),
      ]);
    },
    (item) =>
      `${["relay", "command", "skill"].indexOf(item.kind)}\u0000${item.name}`,
  );
}
