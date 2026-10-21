import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityHome } from "./account";

/**
 * Helpers have no project cwd or Relay tools. Global hooks/MCP can start before
 * a permission request, so refuse configured profiles rather than running them.
 */
export async function antigravityHelper(home = antigravityHome()) {
  for (const [file, key] of [
    ["hooks.json", "hooks"],
    ["mcp_config.json", "mcpServers"],
  ] as const) {
    const info = await stat(join(home, "config", file)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (info && (!info.isFile() || info.size > 64_000))
      throw new Error(
        "Antigravity helper jobs need a profile without global hooks or MCP servers. Choose another helper model.",
      );
    const text = await readFile(join(home, "config", file), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (text === undefined) continue;
    let empty = false;
    try {
      const config = JSON.parse(text);
      const value = config[key] ?? config;
      empty =
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0;
    } catch {}
    if (!empty)
      throw new Error(
        "Antigravity helper jobs need a profile without global hooks or MCP servers. Choose another helper model.",
      );
  }
  const cwd = await realpath(
    await mkdtemp(join(tmpdir(), "relay-antigravity-helper-")),
  );
  return {
    cwd,
    async check() {
      if ((await readdir(cwd)).length)
        throw new Error(
          "Antigravity attempted file work during a text-only helper job.",
        );
    },
    async close(sessionId?: string) {
      if (
        sessionId &&
        /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(sessionId)
      ) {
        const native = join(home, "antigravity-acp");
        const base = join(native, "conversations", sessionId);
        const metadata = await readFile(`${base}.meta`, "utf8")
          .then((text) => JSON.parse(text) as { cwd?: string })
          .catch(() => undefined);
        // The temporary cwd proves this is the helper's history, never a thread's.
        if (metadata?.cwd === cwd) {
          try {
            for (const suffix of [
              ".db",
              ".db-wal",
              ".db-shm",
              ".db-journal",
              ".meta",
            ])
              await rm(`${base}${suffix}`, { force: true });
            await rm(join(native, "brain", sessionId), {
              recursive: true,
              force: true,
            });
          } catch {
            console.warn(
              "Could not remove temporary Antigravity helper history.",
            );
          }
        }
      }
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
