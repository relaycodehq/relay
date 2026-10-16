import type { AgentOptions } from "../types";
import { openCode, OpenCodeError, subscribe, type SessionCall } from "./client";
import {
  forgetThreadGrants,
  permissionRules,
  threadGrants,
} from "./permissions";
import { connectRelayTools, relayServerName, relayToolRules } from "./mcp";
import { openCodeSubagentBooks } from "./subagents";
import { forgetOpenCodeWatch, openCodeTurnWatcher } from "./watch";
import {
  fetched,
  messageListSchema,
  parseOpenCodeResponse,
  sessionCreatedSchema,
  sessionSchema,
} from "./events";
import { openCodeModels } from "./catalog";
import { splitModel } from "./model-ids";
import { markOpenCodeTurn } from "./server";
import { rememberWorktreeEnv } from "./worktree-env";
import {
  instructions,
  relayToolsOf,
  sendPrompt,
  type TurnSettings,
} from "./prompt";
import { OpenCodeTurn } from "./turn";

/** Runs one turn on an OpenCode session, creating, resuming or forking it first. */
export async function runOpenCode(options: AgentOptions): Promise<string> {
  const { signal, job } = options;
  signal.throwIfAborted();
  const directory = options.cwd;
  // Helper jobs are one-offs; the rest are a thread's turns.
  const oneOff = job.kind === "helper";
  const relayTools = relayToolsOf(options);
  const relayServer = relayTools && relayServerName(relayTools.token);
  const rules = permissionRules(oneOff ? undefined : options.runtimeMode, {
    readOnly: options.readOnly,
    title: oneOff,
    cwd: directory,
    links: options.links,
    relayServer,
  });
  // Only a thread's own turn has someone to ask; the rest is rejected.
  const ask =
    options.onRequest && !oneOff && !options.readOnly
      ? options.onRequest
      : undefined;
  const call: SessionCall = (method, path, body) =>
    openCode<unknown>(method, path, { directory, body });

  // Titles and helper jobs leave nothing behind.
  const ephemeral = !options.session;
  // A turn a restart cut off carries on in the session it was running in.
  const sessionID =
    job.kind === "adopt" && options.session?.id
      ? options.session.id
      : await openSession(options, rules, call);
  const turnKey = options.session?.key;
  if (!ephemeral && sessionID !== options.session?.id)
    await options.session!.onId(sessionID);
  signal.throwIfAborted();
  if (!ephemeral) await rememberWorktreeEnv(directory, options.env);

  const model = splitModel(options.choice.model);
  const catalog = await openCodeModels().catch(() => []);
  const listed = catalog.find((m) => m.id === options.choice.model);
  const variant =
    options.choice.reasoningEffort &&
    listed?.efforts.includes(options.choice.reasoningEffort)
      ? options.choice.reasoningEffort
      : undefined;
  const settings: TurnSettings = {
    agent: options.interactionMode === "plan" ? "plan" : "build",
    ...(model ? { model } : {}),
    ...(variant ? { variant } : {}),
  };

  // MCP tools are named `<server>_<tool>`; the thread's own Relay tools join here.
  const mcpTool = oneOff
    ? undefined
    : await connectRelayTools(call, relayTools);
  const watch = openCodeTurnWatcher(options, {
    id: sessionID,
    directory,
    settings: { ...settings, system: instructions(options) },
    // The thread's own tools stay listed, or the check misses its cache.
    permission: [
      { permission: "*", pattern: "*", action: "ask" },
      ...relayToolRules(relayServer).map((r) => ({
        ...r,
        action: r.action === "allow" ? ("ask" as const) : r.action,
      })),
    ],
  });
  const turn = new OpenCodeTurn({
    options,
    sessionID,
    call,
    oneOff,
    ask,
    grants: ask && turnKey ? threadGrants(turnKey) : undefined,
    mcpTool,
    watch,
    contextWindow: (id) =>
      (listed ?? catalog.find((m) => m.id === id))?.contextWindow,
  });

  const unsubscribe = await subscribe(sessionID, turn.handle);
  const abort = () => {
    if (turn.end.settled) return;
    void call("POST", `/session/${sessionID}/abort`).catch(() => {});
    // The session reports the abort; if it doesn't, stop waiting anyway.
    setTimeout(() => turn.finish(new Error("Cancelled by you.")), 5000).unref();
  };
  signal.addEventListener("abort", abort, { once: true });
  const watchdog = setInterval(() => turn.check(), 5000);
  const deadline = oneOff
    ? setTimeout(
        () =>
          turn.finish(
            new Error(
              "OpenCode reached the 10-minute question limit. The partial answer was kept.",
            ),
          ),
        600000,
      )
    : undefined;

  try {
    if (turnKey) markOpenCodeTurn(turnKey, "start");
    if (job.kind === "compact") {
      const target = model ?? (await sessionModel(call, sessionID));
      if (!target)
        throw new Error("OpenCode has no model to compact this session with.");
      turn.busy = true;
      await call("POST", `/session/${sessionID}/summarize`, target);
      await turn.settle();
      return await turn.end.promise;
    }
    if (job.kind === "adopt") await turn.pickUp();
    else
      await sendPrompt(options, call, sessionID, settings, () => {
        turn.busy = true;
      });
    options.onControl?.({
      steer: (text, id, images) => turn.steer(text, id, images, settings),
    });
    if (signal.aborted) abort();
    const text = await turn.end.promise;
    if (turn.lastMessage) options.session?.onPoint?.(turn.lastMessage);
    watch?.ended(text);
    return text;
  } finally {
    clearInterval(watchdog);
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
    unsubscribe();
    turn.subagents.close();
    if (turnKey) markOpenCodeTurn(turnKey, "end");
    if (ephemeral) void call("DELETE", `/session/${sessionID}`).catch(() => {});
  }
}

/** Lets go of what Relay keeps for a thread's session between turns. */
export function closeOpenCodeSession(key: string) {
  openCodeSubagentBooks.drop(key);
  forgetThreadGrants(key);
  forgetOpenCodeWatch(key);
}

/** Resumes, forks or starts the session this turn runs on, with this turn's rules. */
async function openSession(
  options: AgentOptions,
  permission: ReturnType<typeof permissionRules>,
  call: SessionCall,
): Promise<string> {
  const session = options.session;
  if (session?.id) {
    try {
      await call("PATCH", `/session/${session.id}`, { permission });
      return session.id;
    } catch (error) {
      // OpenCode lost it, e.g. its data was cleared: start over.
      if (!(error instanceof OpenCodeError && error.status === 404))
        throw error;
    }
  } else if (session?.fork) {
    const { thread, at } = session.fork;
    // Fork keeps the messages before the one it's given: the one after `at`.
    let messageID: string | undefined;
    if (at) {
      const list = await fetched(
        call,
        "session message list",
        messageListSchema,
        `/session/${thread}/message`,
      );
      const index = list.findIndex((m) => m.info.id === at);
      if (index < 0) throw new Error("The fork point is gone from OpenCode.");
      messageID = list[index + 1]?.info.id;
    }
    const forked = parseOpenCodeResponse(
      "forked session",
      sessionCreatedSchema,
      await call(
        "POST",
        `/session/${thread}/fork`,
        messageID ? { messageID } : {},
      ),
    );
    await call("PATCH", `/session/${forked.id}`, { permission });
    return forked.id;
  }
  // A title keeps OpenCode from spending a model call on naming the session.
  const created = parseOpenCodeResponse(
    "new session",
    sessionCreatedSchema,
    await call("POST", "/session", {
      title: options.job.kind === "helper" ? "Relay helper" : "Relay",
      permission,
    }),
  );
  return created.id;
}

async function sessionModel(call: SessionCall, sessionID: string) {
  const { model } = await fetched(
    call,
    "session",
    sessionSchema,
    `/session/${sessionID}`,
  );
  return model?.providerID && model?.id
    ? { providerID: model.providerID, modelID: model.id }
    : undefined;
}
