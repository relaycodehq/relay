import type { SessionReload } from "../../../../shared/projects";
import { nameChanges } from "../../../../shared/session-reload";
import { findExecutable } from "../../../platform/executables";
import { withTimeout } from "../../../util/timeout";
import { runAccount } from "../../accounts";
import {
  sessionConfig,
  sessionSignature,
  type ClaudeRunOptions,
} from "./config";
import { forgetClaudeCommands } from "./catalog";
import type { ClaudeStream } from "./sdk";
import {
  closeClaudeSession,
  closeSession,
  newSession,
  sessions,
  startSession,
  type ClaudeSession,
} from "./session";

/** The skills and agents a running Claude Code loaded; a list it can't give in time is left out. */
async function loaded(stream: ClaudeStream) {
  const names = (list: () => Promise<{ name: string }[]>) =>
    withTimeout(Promise.resolve().then(list), 15_000, "").then(
      (items) => items.map((item) => item.name),
      () => undefined,
    );
  const [skills, agents] = await Promise.all([
    names(() => stream.supportedCommands()),
    names(() => stream.supportedAgents()),
  ]);
  return { skills, agents };
}

const idle = (session: ClaudeSession) =>
  !session.busy && !session.turn && !session.unprompted && !session.work.any;

/**
 * Restarts the live session under `key` in a fresh Claude Code that resumes
 * the same conversation, so it loads skills, plugins, agents and CLAUDE.md
 * changed since, and says which skills and agents came and went. Undefined
 * when nothing was live, or the fresh one didn't start: the next turn starts
 * one either way.
 */
export async function reloadClaudeSession(
  key: string,
): Promise<SessionReload | undefined> {
  const old = sessions.get(key);
  if (!old?.threadId || old.frames.ended) {
    closeClaudeSession(key);
    return undefined;
  }
  const working = () =>
    new Error(
      "Claude is still working in this session; reload it once that's done.",
    );
  if (!idle(old)) throw working();
  const executable = await findExecutable("claude");
  const before = await loaded(old.stream);
  if (sessions.get(key) !== old || !idle(old)) throw working();
  sessions.delete(key);
  closeSession(old);
  forgetClaudeCommands();

  const options: ClaudeRunOptions = {
    ...old.options,
    session: {
      ...(old.options.session ?? { onId: async () => {} }),
      key,
      id: old.threadId,
      fork: undefined,
    },
  };
  const holder = newSession(
    options,
    sessionSignature(options),
    new AbortController(),
  );
  holder.busy = false;
  holder.threadId = old.threadId;
  holder.skipsPermissions = old.skipsPermissions;
  // The options are the last turn's until the next one runs; whatever it asks meanwhile waits for that turn's.
  let resolve!: () => void;
  holder.ready = { promise: new Promise<void>((r) => (resolve = r)), resolve };
  try {
    const { env } = await runAccount("claude", options.account);
    await startSession(
      holder,
      sessionConfig(options, executable, holder.skipsPermissions, env),
      key,
    );
  } catch (error) {
    holder.input.close();
    holder.stream?.close();
    console.warn("Claude didn't restart; the next message resumes it:", error);
    return undefined;
  }
  sessions.set(key, holder);
  const after = await loaded(holder.stream);
  const skills = nameChanges(before.skills, after.skills);
  const agents = nameChanges(before.agents, after.agents);
  return { ...(skills ? { skills } : {}), ...(agents ? { agents } : {}) };
}
