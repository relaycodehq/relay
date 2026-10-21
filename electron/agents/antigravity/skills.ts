// Antigravity's skills for a folder, found on disk as T3 Code finds them (its
// AntigravitySkills): the ACP server lists no skills of its own.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseYamlFields, textField } from "../skill-frontmatter";
import type { AgentSkill } from "../skill-presentation";

const maxSkillBytes = 1_000_000;

/** A skill file's name and description; undefined when it can't be read as one. */
function readSkill(text: string, fileName: string) {
  const start = text.indexOf("---");
  if (start === -1) return undefined;
  const end = text.indexOf("---", start + 3);
  if (end === -1) return undefined;
  const parsed = parseYamlFields(text.slice(start + 3, end).trim());
  if (parsed.kind !== "parsed") return undefined;
  const raw = parsed.fields.name;
  const name = (typeof raw === "string" && raw) || fileName.slice(0, -3);
  // Its own names aren't trimmed; one that would need it isn't renamed to fit.
  if (!name || name !== name.trim()) return undefined;
  const description = textField(parsed.fields, "description");
  return { name, ...(description ? { description } : {}) };
}

/** The order its loader reads a folder in: by Go's escaped path. */
const sortKey = (entry: string) =>
  encodeURI(entry).replace(
    /[!'()*?#]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * Antigravity's skill roots, in its order: the user's shared `config/skills`,
 * the project's `.gemini/skills`, the user's `antigravity-cli/skills`, then
 * the project's `.agents/skills` and `.agent/skills`. A root holds a SKILL.md
 * itself or in its immediate subfolders; the first skill of a name wins.
 */
export async function discoverAntigravitySkills(
  cwd: string,
  geminiHome = process.env.GEMINI_HOME || join(homedir(), ".gemini"),
): Promise<AgentSkill[]> {
  const roots = [
    { dir: join(geminiHome, "config", "skills"), scope: "user" },
    { dir: resolve(cwd, ".gemini", "skills"), scope: "project" },
    { dir: join(geminiHome, "antigravity-cli", "skills"), scope: "user" },
    { dir: resolve(cwd, ".agents", "skills"), scope: "project" },
    { dir: resolve(cwd, ".agent", "skills"), scope: "project" },
  ];
  let budget = { bytes: 8_000_000, entries: 10_000 };
  const found = new Map<string, AgentSkill>();
  async function scan(dir: string, scope: string, children: boolean) {
    if (!(await stat(dir).catch(() => undefined))?.isDirectory()) return;
    const entries = await readdir(dir).catch(() => undefined);
    if (!entries || entries.length > budget.entries) return;
    budget = { ...budget, entries: budget.entries - entries.length };
    const sorted = [...entries].sort();
    const file = sorted.find((e) => e.toLowerCase() === "skill.md");
    if (file !== undefined) {
      if (!file.endsWith(".md")) return;
      const path = join(dir, file);
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) return;
      if (info.size > Math.min(maxSkillBytes, budget.bytes)) return;
      const text = await readFile(path, "utf8").catch(() => undefined);
      if (text === undefined) return;
      budget = { ...budget, bytes: budget.bytes - info.size };
      const skill = readSkill(text, file);
      if (!skill || found.has(skill.name)) return;
      found.set(skill.name, { ...skill, path, scope, enabled: true });
      return;
    }
    if (!children) return;
    for (const entry of [...sorted].sort((a, b) =>
      sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0,
    ))
      await scan(join(dir, entry), scope, false);
  }
  for (const root of roots) await scan(root.dir, root.scope, true);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
