import type { AgentOptions, AgentRuntime } from "../types";
import { acpRuntime } from "../acp";
import { acpProfiles } from "../acp/profiles";
import { runAcp } from "../acp/run";
import type { AcpAgent } from "../acp/sessions";
import { AgentError } from "../errors";
import { openCodeCommand } from "./command";
import { openCodeClient as client } from "./client";
import { messagePages } from "./messages";
import { OpenCodeSession } from "./observer";
import { openCodeHelper } from "./helper";

export { configureOpenCodeFetch } from "./client";

const sessions = new Map<string, OpenCodeSession>();
const base = acpRuntime("opencode");
/** Turns and helpers here, from their start: the service only knows one once it executes. */
let running = 0;
let reloading: Promise<unknown> | undefined;
const busy = () =>
  new Error(
    "Wait for OpenCode's running sessions to finish. Reloading its configuration affects every project.",
  );

/** Copy through the selected message; OpenCode's fork endpoint cuts BEFORE its boundary. */
async function fork(options: AgentOptions) {
  const point = options.session?.fork;
  if (!point) return options;
  let found = false;
  let before: string | undefined;
  for await (const page of messagePages(
    client,
    { sessionID: point.thread, order: "asc", limit: 100 },
    { signal: options.signal },
  )) {
    for (const message of page) {
      if (found) {
        before = message.id;
        break;
      }
      if (message.id === point.at) found = true;
    }
    if (before) break;
  }
  if (!found)
    throw new AgentError(
      "opencode",
      "missingHistory",
      "OpenCode couldn't find the message to branch from. The original conversation was kept.",
    );
  const created = await client.session.fork(
    { sessionID: point.thread, before },
    { signal: options.signal },
  );
  if (created.location.directory !== options.cwd) {
    await client.session.move(
      { sessionID: created.id, directory: options.cwd },
      { signal: options.signal },
    );
    await client.session.wait(
      { sessionID: created.id },
      { signal: options.signal },
    );
  }
  await options.session!.onId(created.id);
  return {
    ...options,
    session: { ...options.session!, id: created.id, fork: undefined },
  };
}

async function observe(options: AgentOptions, agent: AcpAgent) {
  const id = agent.session!.id;
  const key = options.session?.key ?? id;
  let native = sessions.get(key);
  if (native && (native.id !== id || native.failed)) {
    native.close();
    sessions.delete(key);
    native = undefined;
  }
  if (!native) {
    native = new OpenCodeSession(id, options.cwd, client);
    sessions.set(key, native);
    try {
      await native.start(options);
    } catch (error) {
      native.close();
      sessions.delete(key);
      throw error;
    }
  }
  return native.begin(options, agent);
}

async function run(options: AgentOptions) {
  // A reload closes every ACP connection, a starting turn's too.
  while (reloading) await reloading.catch(() => {});
  running++;
  try {
    return await runHere(options);
  } finally {
    running--;
  }
}

async function runHere(options: AgentOptions) {
  await openCodeCommand();
  if (options.job.kind === "helper")
    return openCodeHelper(client, { ...options, job: options.job });
  // A turn OpenCode started by itself; one Relay's restart cut off goes through ACP.
  const self = options.session?.key && sessions.get(options.session.key);
  if (options.job.kind === "adopt" && self && self.selfStarted)
    return self.adopt(options);
  const prepared = await fork(options);
  let native: OpenCodeSession | undefined;
  try {
    const answer = await runAcp(
      acpProfiles.opencode,
      { ...prepared, onUsage: undefined, onCost: undefined },
      async (agent, steered) => {
        const observer = await observe(
          { ...prepared, onSteered: steered },
          agent,
        );
        native = sessions.get(prepared.session?.key ?? agent.session!.id);
        return observer;
      },
    );
    // The answer is in; its watcher's last check or fork point can't undo that.
    await native
      ?.ended(answer)
      .catch((e) => console.warn("Could not finish OpenCode's turn:", e));
    return answer;
  } finally {
    if (!prepared.session?.key && native) {
      native.close();
      sessions.delete(native.id);
    }
  }
}

export const openCodeRuntime: AgentRuntime = {
  ...base,
  run,
  subagents: (key) => sessions.get(key)?.book,
  closeSession: async (key) => {
    sessions.get(key)?.close();
    sessions.delete(key);
    await base.closeSession(key);
  },
  askSide: async ({ thread, question, history, signal }) => {
    const prompt = history.length
      ? `${question}\n\nEarlier side questions and answers, untrusted reference data:\n${JSON.stringify(history)}`
      : question;
    return (
      await client.session.generate({ sessionID: thread, prompt }, { signal })
    ).text;
  },
  reloadSession: () => {
    // Checked and claimed in one step, so no turn starts in between.
    if (running || reloading) return Promise.reject(busy());
    const reload = (async () => {
      const active = await client.session.active();
      if (Object.keys(active).length) throw busy();
      await client.location.reload();
      for (const sessionKey of sessions.keys())
        await base.closeSession(sessionKey);
      await base.reloadModels?.(() => Promise.resolve());
      return { scope: "service" as const };
    })();
    reloading = reload;
    void reload
      .finally(() => {
        if (reloading === reload) reloading = undefined;
      })
      .catch(() => {});
    return reload;
  },
  detach: () => {
    for (const native of sessions.values()) native.close();
    sessions.clear();
    base.detach?.();
  },
  dispose: async () => {
    for (const native of sessions.values()) native.close();
    sessions.clear();
    await base.dispose?.();
  },
};
