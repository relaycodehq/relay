import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderCommand } from "../../../shared/commands";

interface FileCommand extends ProviderCommand {
  body: string;
  /** Skills only: the folder holding SKILL.md and the files it points at. */
  folder?: string;
}

/** Cursor reads these too, so Relay lists the same ones. Earlier folders win. */
const commandFolders = (root: string) => [
  { dir: join(root, ".cursor", "commands"), source: "project" as const },
  { dir: join(root, ".claude", "commands"), source: "project" as const },
  { dir: join(homedir(), ".cursor", "commands"), source: "personal" as const },
  { dir: join(homedir(), ".claude", "commands"), source: "personal" as const },
];
const skillFolders = (root: string) => [
  { dir: join(root, ".cursor", "skills"), source: "project" as const },
  { dir: join(root, ".claude", "skills"), source: "project" as const },
  { dir: join(root, ".agents", "skills"), source: "project" as const },
  { dir: join(homedir(), ".cursor", "skills"), source: "personal" as const },
  { dir: join(homedir(), ".claude", "skills"), source: "personal" as const },
  { dir: join(homedir(), ".agents", "skills"), source: "personal" as const },
  {
    dir: join(homedir(), ".cursor", "skills-cursor"),
    source: "system" as const,
  },
];

/** Cursor's bundled skills that configure its own CLI or IDE, which Relay has its own way of. */
const notForRelay = new Set([
  "canvas",
  "migrate-to-skills",
  "new-repo",
  "origin",
  "rename-chat",
  "sdk",
  "share",
  "shell",
  "statusline",
  "update-cli-config",
  "update-cursor-settings",
]);
const validName = /^[a-zA-Z0-9_.:-]+$/;

function frontmatter(text: string) {
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
    const { fields, body } = frontmatter(text);
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

async function readSkills(dir: string, source: FileCommand["source"]) {
  const found: FileCommand[] = [];
  for (const entry of await entries(dir)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const folder = join(dir, entry.name);
    const text = await readFile(join(folder, "SKILL.md"), "utf8").catch(
      () => "",
    );
    const { fields, body } = frontmatter(text);
    const name = fields.name || entry.name;
    if (!validName.test(name) || !body) continue;
    if (source === "system" && notForRelay.has(name)) continue;
    found.push({
      name,
      source,
      description: (fields.description ?? "").slice(0, 300),
      ...(fields["argument-hint"]
        ? { argumentHint: fields["argument-hint"].slice(0, 80) }
        : {}),
      body,
      folder,
    });
  }
  return found;
}

/** The commands and skills Cursor would find for `root`, on disk. */
async function fileCommands(root: string): Promise<FileCommand[]> {
  const groups = await Promise.all([
    ...commandFolders(root).map((f) => readCommands(f.dir, f.source)),
    ...skillFolders(root).map((f) => readSkills(f.dir, f.source)),
  ]);
  const byName = new Map<string, FileCommand>();
  for (const command of groups.flat())
    if (!byName.has(command.name)) byName.set(command.name, command);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Cursor's own commands and skills in `root`, for the composer's menu. */
export async function cursorFileCommands(
  root: string,
): Promise<ProviderCommand[]> {
  return (await fileCommands(root)).map(
    ({ body: _body, folder: _folder, ...command }) => command,
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
 * command's text. Does that swap; anything that isn't a known command is
 * returned as typed.
 */
export async function expandCursorCommand(
  prompt: string,
  root: string,
): Promise<string> {
  const match = /^\s*\/([a-zA-Z0-9_.:-]+)(?:[ \t]+([\s\S]*))?$/.exec(prompt);
  if (!match) return prompt;
  const command = (await fileCommands(root)).find((c) => c.name === match[1]);
  if (!command) return prompt;
  const text = fillArguments(command.body, match[2]?.trim() ?? "");
  return command.folder
    ? `Follow the "${command.name}" skill, whose files are in ${command.folder}.\n\n${text}`
    : text;
}
