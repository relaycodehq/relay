import { z } from "zod";
import { HostedChild } from "../../agent-host/child";
import { executableCommand, findExecutable } from "../../platform/executables";
import { withTimeout } from "../../util/timeout";
import { signedOutError } from "../errors";
import { highestRequestId, replayLines } from "../hosted-replay";
import { HostedAgent } from "../hosted-agent";
import { HostedSessions, savedMeta } from "../hosted-sessions";
import { withWorktreeEnv } from "../worktree-env";
import { MuseConnection, MuseRequestError } from "./connection";
import {
  CLIENT_INFO,
  commandId,
  initializeResultSchema,
  openedSchema,
} from "./protocol";

/** How the session should run, as Muse names its settings. */
export type MuseSettings = {
  profile?: string;
  approvalMode?: "allowAll" | "promptUnmatched" | "onRequest" | "denyUnmatched";
  model?: string;
};

/** What a hosted `muse serve` keeps for the next Relay: its session, the turn it was in. */
const metaSchema = z
  .object({
    provider: z.literal("muse"),
    session: z
      .object({
        id: z.string(),
        profile: z.string().optional(),
        approvalMode: z.string().optional(),
        model: z.string().optional(),
      })
      .loose()
      .optional(),
    run: z.object({ turnId: z.string() }).optional(),
  })
  .loose();
type MuseMeta = z.infer<typeof metaSchema>;

const startTimeout = 60_000;

/** One `muse serve` process and the session it runs for a thread. */
export class MuseAgent extends HostedAgent<MuseConnection, { turnId: string }> {
  session?: { id: string } & MuseSettings;
  /** Experimental MSP (permission profiles, sign-in) is on for this connection. */
  experimental = false;

  constructor(
    connection: MuseConnection,
    /** Started without a session log; its sessions keep the profile Muse fixes for them. */
    readonly ephemeral = false,
  ) {
    super(connection);
  }

  /** Permission profiles can be picked: experimental MSP, and sessions with a log. */
  get profiles() {
    return this.experimental && !this.ephemeral;
  }

  keep() {
    this.connection.keep({
      provider: "muse",
      session: this.session,
      run: this.inflight,
    } satisfies MuseMeta);
  }
}

const sessions = new HostedSessions<MuseAgent>({
  provider: "muse",
  name: "Muse Code",
  kind: "process",
  close: (agent) => agent.close(),
});

export const installHint =
  "Install Muse Code with `curl -fsSL https://dev.meta.ai/install.sh | bash`, then sign in.";

async function launch(
  key: string | undefined,
  cwd: string,
  env: Record<string, string> | undefined,
  ephemeral: boolean,
) {
  const executable = await findExecutable("muse").catch(() => {
    throw new Error(`Relay couldn't find Muse Code. ${installHint}`);
  });
  const args = ["serve", ...(ephemeral ? ["--no-session-log"] : [])];
  const line = executableCommand(executable, args);
  const spec = {
    ...line,
    env: withWorktreeEnv(process.env as Record<string, string>, env),
  };
  const child = await sessions.spawnGroup(
    key,
    { provider: "muse" } satisfies MuseMeta,
    spec,
    cwd,
  );
  return new MuseConnection(child);
}

export async function initialize(agent: MuseAgent) {
  const reply = await withTimeout(
    agent.connection.request("initialize", {
      clientInfo: CLIENT_INFO,
      capabilities: {
        experimentalApi: true,
        requestedCapabilities: ["sessionMcp"],
        userInputDialogs: true,
      },
    }),
    startTimeout,
    "Muse Code didn't start in time.",
  ).catch((error: Error) => {
    if (error instanceof MuseRequestError)
      throw new Error(`Muse Code wouldn't start a session for Relay: ${error.message}`);
    throw new Error(`Muse Code couldn't start its session server. ${installHint}\n\n${error.message}`);
  });
  const init = initializeResultSchema.parse(reply);
  agent.experimental = init.experimentalApi;
  agent.connection.notify("initialized");
  return init;
}

/**
 * The process for a thread's session, started and initialized if it isn't
 * running. A thread's runs in the agent host; without a key it's a private
 * one that ends with its turn, and keeps no session log when `ephemeral`.
 */
export function acquireMuse(
  key: string | undefined,
  cwd: string,
  env?: Record<string, string>,
  ephemeral = false,
): Promise<MuseAgent> {
  return sessions.acquire(key, async () =>
    new MuseAgent(await launch(key, cwd, env, ephemeral), ephemeral).start(
      initialize,
    ),
  );
}

/** Runs `call`, reading Muse's "sign in first" as Relay's signed out. */
export async function signedIn<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (
      error instanceof MuseRequestError &&
      (error.kind === "authRequired" || /credential|log ?in|sign ?in/i.test(error.message))
    )
      throw signedOutError("muse");
    throw error;
  }
}

export type MuseMcpServer = {
  transport: "streamableHttp";
  url: string;
  headers: Record<string, string>;
  mode: "optional";
};

export type OpenOptions = {
  /** The conversation to pick up; without one, a new one. */
  id?: string;
  /** With no `id`: start as a copy of this session, cut after its turn `at`. */
  fork?: { thread: string; at?: string };
  cwd: string;
  /** Folders the session may write besides `cwd`. */
  roots: string[];
  mcpServers: Record<string, MuseMcpServer>;
  settings: MuseSettings;
};

/**
 * Puts the agent in its session: the one it runs, the saved one picked up
 * again, a fork, or a new one. Says whether a saved one was lost.
 */
export async function openSession(
  agent: MuseAgent,
  options: OpenOptions,
): Promise<{ id: string; lost: boolean }> {
  const { connection } = agent;
  const config = Object.keys(options.mcpServers).length
    ? { mcpServers: options.mcpServers }
    : undefined;
  if (options.id && agent.session?.id === options.id) {
    await applySettings(agent, options.settings);
    return { id: options.id, lost: false };
  }
  const take = (id: string, settings: MuseSettings) => {
    agent.session = { id, ...settings };
    agent.keep();
  };
  if (options.id) {
    try {
      const opened = openedSchema.parse(
        await signedIn(() =>
          connection.request("session/resume", {
            commandId: commandId(),
            sessionId: options.id,
            excludeItems: true,
            ...(config && { config }),
          }),
        ),
      );
      take(opened.session.sessionId, { model: opened.session.modelId ?? undefined });
      await applySettings(agent, options.settings);
      return { id: opened.session.sessionId, lost: false };
    } catch (error) {
      if (!(error instanceof MuseRequestError)) throw error;
      if (error.kind === "sessionInUse")
        throw new Error(
          "This Muse Code conversation is open in another Muse Code, perhaps a terminal. Close it there, then send again.",
        );
      if (error.kind !== "sessionNotFound") throw error;
    }
  }
  const roots = [options.cwd, ...options.roots];
  if (options.fork && !options.id) {
    const opened = openedSchema.parse(
      await signedIn(() =>
        connection.request("session/fork", {
          commandId: commandId(),
          sessionId: options.fork!.thread,
          excludeItems: true,
          ...(options.fork!.at && { cutPoint: { lastTurnId: options.fork!.at } }),
        }),
      ),
    );
    take(opened.session.sessionId, { model: opened.session.modelId ?? undefined });
    await applySettings(agent, options.settings);
    return { id: opened.session.sessionId, lost: false };
  }
  const { profile, approvalMode, model } = options.settings;
  const opened = openedSchema.parse(
    await signedIn(() =>
      connection.request("session/start", {
        commandId: commandId(),
        workspaceRoot: options.cwd,
        ...(roots.length > 1 && { workspaceRoots: roots }),
        ...(profile && agent.profiles && { permissionProfile: profile }),
        ...(approvalMode && { approvalMode }),
        ...(model && { modelId: model }),
        ...(config && { config }),
      }),
    ),
  );
  take(opened.session.sessionId, { profile, approvalMode, model });
  return { id: opened.session.sessionId, lost: !!options.id };
}

/** Brings a running session to the thread's mode and model, where they changed. */
async function applySettings(agent: MuseAgent, wanted: MuseSettings) {
  const session = agent.session!;
  const { connection } = agent;
  const sessionId = session.id;
  if (wanted.profile && wanted.profile !== session.profile && agent.profiles) {
    await connection.request("session/setPermissionProfile", {
      commandId: commandId(),
      sessionId,
      profileId: wanted.profile,
    });
    session.profile = wanted.profile;
  }
  if (wanted.approvalMode && wanted.approvalMode !== session.approvalMode) {
    await connection.request("session/setApprovalMode", {
      commandId: commandId(),
      sessionId,
      mode: wanted.approvalMode,
    });
    session.approvalMode = wanted.approvalMode;
  }
  if (wanted.model && wanted.model !== session.model) {
    await connection.request("session/setModel", {
      commandId: commandId(),
      sessionId,
      model: { modelId: wanted.model },
    });
    session.model = wanted.model;
  }
  agent.keep();
}

export function closeMuseSession(key: string) {
  return sessions.close(key);
}

export function detachMuse() {
  sessions.detach();
}

export function disposeMuse() {
  sessions.dispose();
}

/**
 * Takes back the processes the agent host kept running while Relay
 * restarted. One in a turn waits, holding what it said meanwhile, for an
 * `adopt` turn.
 */
export function reattachMuse(owns: (key: string) => boolean) {
  return sessions.reattach(owns, (found) => {
    const meta = savedMeta(found, metaSchema);
    if (!meta?.session) return;
    const { info } = found;
    const child = new HostedChild(found.attachProcess(), (entries) => {
      connection.continueAfter(highestRequestId(entries));
      return replayLines(entries, info.split);
    });
    const connection = new MuseConnection(child);
    const agent = new MuseAgent(connection);
    // The last Relay initialized it with experimental MSP on.
    agent.experimental = true;
    agent.session = {
      ...meta.session,
      approvalMode: meta.session.approvalMode as MuseSettings["approvalMode"],
    };
    agent.inflight = meta.run;
    if (!info.open) child.release();
    return agent;
  });
}
