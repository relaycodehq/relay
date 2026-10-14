// Cursor's skills for a folder, found on disk as T3 Code finds them (its
// CursorSkills): Cursor looks through each skill root to any depth.

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { skillFrontmatter, textField, yamlBoolean } from "../skill-frontmatter";
import type { AgentSkill } from "../skill-presentation";

const maxDepth = 10;
const maxSkillBytes = 1_000_000;

type Budget = { entries: number; bytes: number };

/** A SKILL.md's say on itself; undefined when its frontmatter doesn't parse. */
function readSkillFile(text: string | undefined) {
  if (text === undefined) return { cli: true };
  const frontmatter = skillFrontmatter(text);
  if (frontmatter.kind === "malformed") return undefined;
  if (frontmatter.kind === "missing") return { cli: true };
  const { fields } = frontmatter;
  const metadata = fields.metadata;
  const raw =
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).surfaces
      : undefined;
  const surfaces = Array.isArray(raw)
    ? raw.filter((s): s is string => typeof s === "string")
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return {
    // Skills meant for other Cursor surfaces only stay out of the CLI's.
    cli:
      !surfaces.length ||
      surfaces.some((s) => s.trim().toLowerCase() === "cli"),
    description: textField(fields, "description"),
    displayName: textField(fields, "name"),
    manual: yamlBoolean(fields["disable-model-invocation"]) === true,
    agentOnly: yamlBoolean(fields["user-invocable"]) === false,
  };
}

async function skillsInRoot(dir: string, scope: string, budget: Budget) {
  const skills: AgentSkill[] = [];
  const root = await realpath(dir).catch(() => undefined);
  if (!root) return skills;
  const visited = new Set<string>();
  async function visit(folder: string, depth: number): Promise<void> {
    if (budget.entries <= 0) return;
    const real = await realpath(folder).catch(() => undefined);
    if (!real || visited.has(real)) return;
    visited.add(real);
    const path = join(folder, "SKILL.md");
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) {
      const text =
        info.size <= maxSkillBytes && info.size <= budget.bytes
          ? await readFile(path, "utf8").catch(() => undefined)
          : undefined;
      if (text !== undefined) budget.bytes -= info.size;
      const skill = readSkillFile(text);
      const name = basename(folder).trim();
      if (skill?.cli && name)
        skills.push({
          name,
          path,
          scope,
          enabled: true,
          ...(skill.displayName && skill.displayName !== name
            ? { displayName: skill.displayName }
            : {}),
          ...(skill.description ? { description: skill.description } : {}),
          ...(skill.manual ? { userInvocationOnly: true } : {}),
          ...(skill.agentOnly ? { userInvocable: false } : {}),
        });
    }
    // A link out of the root is one skill package: its own SKILL.md counts,
    // its tree isn't walked.
    if (real !== root && !real.startsWith(root + sep)) return;
    const entries = await readdir(folder).catch(() => [] as string[]);
    for (const entry of entries.sort()) {
      if (budget.entries <= 0) return;
      budget.entries--;
      const child = join(folder, entry);
      if (!(await stat(child).catch(() => undefined))?.isDirectory()) continue;
      // Deeper than this is skipped, not fatal, so it can't hide the rest.
      if (depth >= maxDepth) continue;
      await visit(child, depth + 1);
    }
  }
  await visit(root, 0);
  return skills;
}

/**
 * Cursor's skills for `cwd`: the project's `.cursor`, `.agents`, `.codex` and
 * `.claude` skill folders, then the user's. The first skill of a name wins.
 */
export async function discoverCursorSkills(
  cwd: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentSkill[]> {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  const below = (base: string, scope: string) =>
    [".cursor", ".agents", ".codex", ".claude"].map((dot) => ({
      dir: join(base, dot, "skills"),
      scope,
    }));
  const roots = [...(cwd ? below(cwd, "project") : []), ...below(home, "user")];
  const budget: Budget = { entries: 10_000, bytes: 8_000_000 };
  const found = new Map<string, AgentSkill>();
  for (const root of roots) {
    if (budget.entries <= 0) break;
    for (const skill of await skillsInRoot(root.dir, root.scope, budget))
      if (!found.has(skill.name)) found.set(skill.name, skill);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
