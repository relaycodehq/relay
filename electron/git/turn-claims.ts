import { join, resolve, sep } from "node:path";
import { within } from "../util/paths";
import type { TurnFileChange } from "../../shared/projects";

/** What the agent itself did to files during a turn, as its tools reported. */
export interface TurnClaim {
  /** Paths its file tools wrote, absolute or relative to the checkout. */
  edited: string[];
  /** Shell commands it ran; a file one names outright counts as its own. */
  commands: string[];
}

// Letters and digits of any script: `plan.md` is no file of its own inside `úplan.md`.
const pathChar = /[\p{L}\p{M}\p{N}_.@+~\/-]/u;

/** `text` names `path` as a whole path, not as part of a longer one. */
function names(text: string, path: string) {
  for (let at = text.indexOf(path); at >= 0; at = text.indexOf(path, at + 1)) {
    const before = text[at - 1] ?? "";
    const after = text[at + path.length] ?? "";
    if (!pathChar.test(before) && !pathChar.test(after)) return true;
  }
  return false;
}

/** Git lists paths with forward slashes, on Windows too. */
const gitPath = (path: string) => path.split(sep).join("/");
/** `cd dir`, `cd "dir"` or `cd 'dir'`, also inside a quoted `zsh -lc "…"`. */
const cdTarget = /(?:^|[\s;&|("'])cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)"']+))/g;

/**
 * The files among `files` (relative to the checkout `root`) that the agent
 * changed: written by its file tools, or named in a command it ran. The
 * snapshots see the whole checkout, so without this a turn would also claim
 * edits from the user's editor, other threads and CLI sessions that ran
 * meanwhile. Changes a command made without naming the file are missed.
 */
export function ownFiles(
  files: TurnFileChange[],
  claim: TurnClaim,
  root: string,
) {
  const edited = new Set<string>();
  for (const path of claim.edited) {
    const rel = within(root, resolve(root, path));
    if (rel) edited.add(gitPath(rel));
  }
  // A command can name a file from a folder it moves into: `cd sub && sed -i … file.ts`.
  const commands = claim.commands.map((command) => ({
    command,
    folders: [
      root,
      ...[...command.matchAll(cdTarget)].map((m) =>
        resolve(root, m[1] ?? m[2] ?? m[3]!),
      ),
    ],
  }));
  return files.filter((file) => {
    if (edited.has(file.path)) return true;
    const absolute = join(root, file.path);
    return commands.some(({ command, folders }) => {
      const forms = new Set([absolute]);
      for (const folder of folders) {
        const from = within(folder, absolute);
        if (from) forms.add(from).add(`./${from}`);
      }
      // A command on Windows may write a path with either slash.
      for (const form of [...forms]) forms.add(gitPath(form));
      return [...forms].some((form) => names(command, form));
    });
  });
}
