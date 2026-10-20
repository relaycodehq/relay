import { readdir, realpath } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import type { TerminalAgent } from "../../shared/terminal-sessions";
import type { SessionHome } from "./index";
import { codexOrigin } from "./codex";
import { storedCodexFolders } from "./codex-store";
import { claudeOrigin } from "./claude";
import { head } from "./scan";

/** Discover folders from session metadata, never from credentials or a history's tool output. */
export async function discoverSessionFolders(
  homes: SessionHome[],
  provider: TerminalAgent,
) {
  const folders = new Map<string, string>();
  const seen = new Set<string>();
  for (const account of homes) {
    if (account.provider !== provider) continue;
    const home = await realpath(account.home).catch(() => undefined);
    if (!home || seen.has(home)) continue;
    seen.add(home);
    if (provider === "codex")
      for (const folder of await storedCodexFolders(home))
        folders.set(folder.path, folder.name);
    const dir = join(home, provider === "codex" ? "sessions" : "projects");
    const names = await readdir(dir, { recursive: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as string[];
        throw error;
      },
    );
    const files = names.filter((name) =>
      provider === "codex"
        ? basename(name).startsWith("rollout-") && name.endsWith(".jsonl")
        : name.split(sep).length === 2 && name.endsWith(".jsonl"),
    );
    // Bound concurrent reads, even when an account holds years of sessions.
    for (let at = 0; at < files.length; at += 32) {
      const origins = await Promise.all(
        files.slice(at, at + 32).map(async (name) => {
          try {
            const path = join(dir, name);
            if (provider === "codex") return codexOrigin(path);
            let text = await head(path);
            let origin = claudeOrigin(text.text);
            if (!origin && !text.whole) {
              text = await head(path, 1024 * 1024);
              origin = claudeOrigin(text.text);
            }
            return origin;
          } catch (error) {
            // Codex may be migrating a rollout while this scan is in flight.
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              return undefined;
            throw error;
          }
        }),
      );
      for (const origin of origins)
        if ((origin?.app || origin?.terminal) && !folders.has(origin.cwd))
          folders.set(origin.cwd, "");
    }
  }
  return [...folders].map(([path, name]) => ({
    path,
    name: name || basename(path),
  }));
}
