import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderCommand } from "../../../shared/commands";
import { pickable, type AgentSkill } from "../skill-presentation";
import { planSkillDispatch } from "../skill-dispatch";
import { mayMentionSkill } from "../../../shared/skill-mentions";
import { discoverCursorSkills } from "./skills";

interface FileCommand extends ProviderCommand {
  body: string;
}

/** Cursor reads these too, so Relay lists the same ones. Earlier folders win. */
const commandFolders = (root: string) => [
  { dir: join(root, ".cursor", "commands"), source: "project" as const },
  { dir: join(root, ".claude", "commands"), source: "project" as const },
  { dir: join(homedir(), ".cursor", "commands"), source: "personal" as const },
  { dir: join(homedir(), ".claude", "commands"), source: "personal" as const },
];
const validName = /^[a-zA-Z0-9_.:-]+$/;

function splitFrontmatter(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].replace(/^["']|["']$/g, "").trim();
  }
  return { fields, body: (match ? match[2] : text).trim() };
}

async function entries(dir: string) {
  return readdir(dir, { withFileTypes: true }).catch(() => []);
}

async function readCommands(dir: string, source: FileCommand["source"]) {
  const found: FileCommand[] = [];
  for (const entry of await entries(dir)) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const name = entry.name.slice(0, -3);
    const text = await readFile(join(dir, entry.name), "utf8").catch(() => "");
    const { fields, body } = splitFrontmatter(text);
    if (!validName.test(name) || !body) continue;
    found.push({
      name,
      source,
      description: (fields.description || body).slice(0, 300),
      ...(fields["argument-hint"]
        ? { argumentHint: fields["argument-hint"].slice(0, 80) }
        : {}),
      body,
    });
  }
  return found;
}

/** The commands Cursor would find for `root`, on disk. */
async function fileCommands(root: string): Promise<FileCommand[]> {
  const groups = await Promise.all(
    commandFolders(root).map((f) => readCommands(f.dir, f.source)),
  );
  const byName = new Map<string, FileCommand>();
  for (const command of groups.flat())
    if (!byName.has(command.name)) byName.set(command.name, command);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Cursor's own commands in `root`, for the composer's menu. */
export async function cursorFileCommands(
  root: string,
): Promise<ProviderCommand[]> {
  return (await fileCommands(root)).map(
    ({ body: _body, ...command }) => command,
  );
}

/** `$ARGUMENTS` and `$1`… in a command's text, as Cursor fills them in. */
function fillArguments(body: string, args: string) {
  const words = args.split(/\s+/).filter(Boolean);
  let used = false;
  const filled = body
    .replace(/\$ARGUMENTS/g, () => ((used = true), args))
    .replace(/(?<!\w)\$(\d{1,2})\b/g, (_, n: string) => {
      used = true;
      return words[Number(n) - 1] ?? "";
    });
  return used || !args ? filled : `${filled}\n\n${args}`;
}

/**
 * Cursor's SDK sends `/name` as plain text, where its CLI would swap in the
 * command's or skill's text. Does that swap; anything that isn't a known
 * command or skill is returned as typed.
 */
export async function expandCursorCommand(
  prompt: string,
  root: string,
): Promise<string> {
  const match = /^\s*\/([a-zA-Z0-9_.:-]+)(?:[ \t]+([\s\S]*))?$/.exec(prompt);
  if (!match) return prompt;
  const args = match[2]?.trim() ?? "";
  const command = (await fileCommands(root)).find((c) => c.name === match[1]);
  if (command) return fillArguments(command.body, args);
  const skill = (await discoverCursorSkills(root)).find(
    (s) => s.name === match[1] && pickable(s),
  );
  if (!skill) return prompt;
  return expandCursorSkill(skill, args);
}

async function expandCursorSkill(skill: AgentSkill, args: string) {
  const { body } = splitFrontmatter(await readFile(skill.path, "utf8"));
  return `Follow the "${skill.name}" skill, whose files are in ${dirname(skill.path)}.\n\n${fillArguments(body, args)}`;
}

/**
 * The prompt as Cursor's SDK should get it. The SDK sends `/name` as plain
 * text, so the last `$skill` mentioned becomes the `/name` that opens its own
 * block, which is then swapped for the skill's text; what comes before it
 * goes first, earlier mentions as `/name`.
 */
export async function cursorPrompt(
  prompt: string,
  cwd: string,
  request?: string,
) {
  if (!mayMentionSkill(request ?? prompt))
    return expandCursorCommand(prompt, cwd);
  const skills = await discoverCursorSkills(cwd).catch(() => []);
  const plan = planSkillDispatch(
    prompt,
    new Set(skills.filter(pickable).map((s) => s.name)),
    request,
  );
  if (!plan) return expandCursorCommand(prompt, cwd);
  // The dispatch names a known skill. Keep its identity instead of resolving
  // a same-named slash command, and accept arguments on following lines too.
  const [, name, args = ""] = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(plan.command)!;
  const skill = skills.find((s) => s.name === name)!;
  return [plan.lead, await expandCursorSkill(skill, args.trim())]
    .filter(Boolean)
    .join("\n\n");
}
