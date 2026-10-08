// Claude Code and Codex sessions started in a terminal in a project's folder,
// for a thread to continue. Only listed when asked; nothing is imported until
// one is picked.
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  LIVE_WINDOW,
  type TerminalAgent,
  type TerminalSession,
  type TerminalSessionPick,
} from "../../shared/terminal-sessions";
import {
  claudeHistory,
  claudeOrigin,
  claudeSlug,
  claudeSummary,
} from "./claude";
import { claudeOpen } from "./claude-open";
import { codexHistory, codexNames, codexOrigin, codexSummary } from "./codex";
import { FileCache, head } from "./scan";

/** An agent's config folder for one account: where its sessions are kept. */
export interface SessionHome {
  provider: TerminalAgent;
  account: string;
  home: string;
}

export interface FoundSession extends TerminalSession {
  path: string;
}

const MOST_ROWS = 30;
/** Session heads read at once while looking for the project's terminal sessions. */
const BATCH = 32;
/** Codex files sessions by the day they started. */
const CODEX_DAYS = 30;

type File = {
  provider: TerminalAgent;
  account: string;
  home: string;
  path: string;
  mtime: number;
  size: number;
};
type Origin = { id: string; cwd: string; terminal: boolean } | undefined;

const real = (path: string) => realpath(path).catch(() => undefined);

async function files(dir: string, keep: (name: string) => boolean) {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter(keep).map((name) => join(dir, name));
}

/** Codex's day folders from today back `CODEX_DAYS`, by local date as it names them. */
function codexDays(sessions: string, now: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: CODEX_DAYS + 1 }, (_, i) => {
    const day = new Date(now - i * 86_400_000);
    return join(
      sessions,
      String(day.getFullYear()),
      pad(day.getMonth() + 1),
      pad(day.getDate()),
    );
  });
}

export class TerminalSessions {
  private origins = new FileCache<Origin>();
  private summaries = new FileCache<{ title: string; turns: number }>();
  private names = new FileCache<Map<string, string>>();

  constructor(
    /** Each agent's usual home first, then its accounts' own folders. */
    private homes: () => Promise<SessionHome[]>,
    private now = () => Date.now(),
    private open = claudeOpen,
  ) {}

  /** The project's terminal sessions, newest first. */
  async list(root: string): Promise<FoundSession[]> {
    const roots = new Set([root, (await real(root)) ?? root]);
    const found = await this.candidates(roots, MOST_ROWS);
    const live = await this.live(found);
    return Promise.all(
      found.map(async ({ file, origin }) => {
        const { title, turns } = await this.summary(file, origin.id);
        return {
          provider: file.provider,
          id: origin.id,
          title: title || "Untitled session",
          updated: file.mtime,
          turns,
          account: file.account,
          live: live(file, origin.id),
          path: file.path,
        } satisfies FoundSession;
      }),
    );
  }

  /** A listed session found again by its id, as it stands now; never by a path from the page. */
  async find(root: string, pick: TerminalSessionPick) {
    const roots = new Set([root, (await real(root)) ?? root]);
    const found = (await this.candidates(roots, Infinity, pick)).find(
      ({ origin }) => origin.id === pick.session,
    );
    if (!found) return;
    const live = await this.live([found]);
    return {
      provider: found.file.provider,
      id: found.origin.id,
      account: found.file.account,
      path: found.file.path,
      live: live(found.file, found.origin.id),
      title: (await this.summary(found.file, found.origin.id)).title,
    };
  }

  /**
   * Folders Claude and Codex ran in lately, newest first, from a terminal or
   * not: Relay's own threads are mostly in its projects, which callers drop.
   * Claude keeps a folder per working folder, so its newest session there
   * says where; Codex's files are read newest first until enough are found.
   */
  async recentFolders(most: number) {
    const found = new Map<string, number>();
    const note = (cwd: string, mtime: number) =>
      found.set(cwd, Math.max(found.get(cwd) ?? 0, mtime));
    const seen = new Set<string>();
    const codex: File[] = [];
    for (const { provider, account, home } of await this.homes()) {
      if (provider === "codex") {
        const days = codexDays(join(home, "sessions"), this.now()).slice(0, 15);
        for (const dir of days) {
          const at = await real(dir);
          if (!at || seen.has(at)) continue;
          seen.add(at);
          for (const path of await files(
            dir,
            (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"),
          )) {
            const s = await stat(path).catch(() => undefined);
            if (s?.isFile())
              codex.push({
                provider,
                account,
                home,
                path,
                mtime: s.mtimeMs,
                size: s.size,
              });
          }
        }
        continue;
      }
      const projects = join(home, "projects");
      const at = await real(projects);
      if (!at || seen.has(at)) continue;
      seen.add(at);
      const dirs = await Promise.all(
        (await files(projects, () => true)).map(async (dir) => ({
          dir,
          mtime: (await stat(dir).catch(() => undefined))?.mtimeMs ?? 0,
        })),
      );
      dirs.sort((a, b) => b.mtime - a.mtime);
      await Promise.all(
        dirs.slice(0, most * 3).map(async ({ dir }) => {
          const sessions = await Promise.all(
            (await files(dir, (n) => n.endsWith(".jsonl"))).map(
              async (path) => {
                const s = await stat(path).catch(() => undefined);
                return s?.isFile()
                  ? { path, mtime: s.mtimeMs, size: s.size }
                  : undefined;
              },
            ),
          );
          const newest = sessions
            .filter((s) => !!s)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 3);
          for (const s of newest) {
            const file = { provider, account, home, ...s };
            const origin = await this.origins
              .get(file.path, () => this.origin(file), file)
              .catch(() => undefined);
            if (origin) return note(origin.cwd, s.mtime);
          }
        }),
      );
    }
    codex.sort((a, b) => b.mtime - a.mtime);
    const before = found.size;
    for (
      let at = 0;
      at < Math.min(codex.length, BATCH * 4) && found.size - before < most;
      at += BATCH
    ) {
      const batch = codex.slice(at, at + BATCH);
      const origins = await Promise.all(
        batch.map((file) =>
          this.origins
            .get(file.path, () => this.origin(file), file)
            .catch(() => undefined),
        ),
      );
      batch.forEach((file, i) => {
        const origin = origins[i];
        if (origin) note(origin.cwd, file.mtime);
      });
    }
    return [...found]
      .map(([cwd, mtime]) => ({ cwd, mtime }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  /** What the session holds, as thread messages. */
  history(session: { provider: TerminalAgent; id: string; path: string }) {
    return session.provider === "claude"
      ? claudeHistory(session.path, session.id)
      : codexHistory(session.path, session.id);
  }

  /**
   * Whether a terminal holds a session: a running `claude` lists it, or its
   * file changed in the last minute. Codex lists nothing, so for it the file
   * is all there is to go on.
   */
  private async live(found: { file: File }[]) {
    const now = this.now();
    const claude = found.some(({ file }) => file.provider === "claude")
      ? await this.open(
          (await this.homes()).flatMap((h) =>
            h.provider === "claude" ? [h.home] : [],
          ),
        ).catch(() => new Set<string>())
      : new Set<string>();
    return (file: File, id: string) =>
      (file.provider === "claude" && claude.has(id)) ||
      now - file.mtime < LIVE_WINDOW;
  }

  /**
   * Up to `most` terminal sessions started in one of `roots`, newest first.
   * Most files in these folders are Relay's own sessions or another folder's,
   * so heads are read newest first until enough of them are this project's.
   */
  private async candidates(
    roots: Set<string>,
    most: number,
    only?: TerminalSessionPick,
  ) {
    const all = (await this.files(roots, only)).sort(
      (a, b) => b.mtime - a.mtime,
    );
    const out: { file: File; origin: NonNullable<Origin> }[] = [];
    for (let at = 0; at < all.length && out.length < most; at += BATCH) {
      const checked = await Promise.all(
        all.slice(at, at + BATCH).map(async (file) => ({
          file,
          origin: await this.origins
            .get(file.path, () => this.origin(file), file)
            .catch(() => undefined),
        })),
      );
      for (const { file, origin } of checked)
        if (origin?.terminal && roots.has(origin.cwd))
          out.push({ file, origin });
    }
    return out.slice(0, most);
  }

  private async origin(file: File): Promise<Origin> {
    if (file.provider === "codex") return codexOrigin(file.path);
    let { text, whole } = await head(file.path);
    let origin = claudeOrigin(text);
    // A long first prompt can push where it ran past the usual read.
    if (!origin && !whole)
      origin = claudeOrigin((await head(file.path, 1024 * 1024)).text);
    return origin && { ...origin, id: basename(file.path, ".jsonl") };
  }

  private async summary(file: File, id: string) {
    if (file.provider === "claude")
      return this.summaries.get(file.path, claudeSummary, file);
    const { title: first, turns } = await this.summaries.get(
      file.path,
      async (path) => {
        const { first, turns } = await codexSummary(path);
        return { title: first, turns };
      },
      file,
    );
    const index = join(file.home, "session_index.jsonl");
    const names = await this.names
      .get(index, codexNames)
      .catch(() => new Map<string, string>());
    return { title: names.get(id)?.trim() || first, turns };
  }

  /**
   * Every session file in the agents' folders that could belong to `roots`,
   * each folder read once: an account's folder that links to the usual home
   * counts as the usual home, so its sessions are the default account's.
   */
  private async files(roots: Set<string>, only?: TerminalSessionPick) {
    const seen = new Set<string>();
    const out: File[] = [];
    for (const { provider, account, home } of await this.homes()) {
      if (only && only.provider !== provider) continue;
      const dirs =
        provider === "claude"
          ? [
              ...new Set(
                [...roots].map((r) => join(home, "projects", claudeSlug(r))),
              ),
            ]
          : codexDays(join(home, "sessions"), this.now());
      for (const dir of dirs) {
        const at = await real(dir);
        if (!at || seen.has(at)) continue;
        seen.add(at);
        const paths = await files(dir, (name) =>
          provider === "claude"
            ? name.endsWith(".jsonl") &&
              (!only || name === `${only.session}.jsonl`)
            : name.startsWith("rollout-") &&
              name.endsWith(".jsonl") &&
              (!only || name.endsWith(`-${only.session}.jsonl`)),
        );
        const stats = await Promise.all(
          paths.map((path) => stat(path).catch(() => undefined)),
        );
        paths.forEach((path, i) => {
          const s = stats[i];
          if (s?.isFile())
            out.push({
              provider,
              account,
              home,
              path,
              mtime: s.mtimeMs,
              size: s.size,
            });
        });
      }
    }
    return out;
  }
}
