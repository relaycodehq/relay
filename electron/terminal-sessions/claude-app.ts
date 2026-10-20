// The Claude app runs Claude Code for its Code tab, so its sessions' files sit
// with the terminal's. The title the app shows is only in its own record of
// each session: `claude-code-sessions/<account>/<org>/local_<id>.json`, which
// names the Claude Code session as `cliSessionId`.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FileCache, parsed } from "./scan";

/** Where the Claude app keeps its records of Claude Code sessions. */
export function claudeAppFolder(platform = process.platform) {
  const base =
    platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : platform === "win32"
        ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(base, "Claude", "claude-code-sessions");
}

type Record = { session: string; title: string } | undefined;

async function record(path: string): Promise<Record> {
  const entry = parsed(await readFile(path, "utf8"));
  const session = entry?.cliSessionId,
    title = entry?.title;
  if (typeof session !== "string" || typeof title !== "string") return;
  return title.trim() ? { session, title: title.trim() } : undefined;
}

export class ClaudeAppTitles {
  private records = new FileCache<Record>();

  constructor(private folder = claudeAppFolder()) {}

  /** The app's titles by Claude Code session id; none when there's no app. */
  async get() {
    const names = await readdir(this.folder, { recursive: true }).catch(
      () => [] as string[],
    );
    const found = await Promise.all(
      names
        .filter((name) => /(^|[\\/])local_[^\\/]*\.json$/.test(name))
        .map((name) =>
          this.records
            .get(join(this.folder, name), record)
            .catch(() => undefined),
        ),
    );
    return new Map(found.flatMap((r) => (r ? [[r.session, r.title]] : [])));
  }
}
