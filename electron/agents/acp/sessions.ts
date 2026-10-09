import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import { HostedChild } from "../../agent-host/child";
import type { Entry } from "../../agent-host/protocol";
import { executableCommand } from "../../platform/executables";
import { withTimeout } from "../../util/timeout";
import { signedOutError } from "../errors";
import { HostedSessions, savedMeta, type Lease } from "../hosted-sessions";
import { withWorktreeEnv } from "../worktree-env";
import { hearCommands } from "./commands";
import { AcpConnection, AcpRequestError } from "./connection";
import type { AcpProfile, AcpProvider } from "./profiles";
import {
  ACP_VERSION,
  AUTH_REQUIRED,
  initializeResultSchema,
  sessionResultSchema,
  type AcpSessionState,
} from "./protocol";

/** What Relay reads off an agent's `initialize`. */
const capsSchema = z.object({
  image: z.boolean(),
  http: z.boolean(),
  load: z.boolean(),
  resume: z.boolean(),
  /** The sign-ins it does itself, without the user. */
  auth: z.array(z.string()),
  /** Answers ACP's `logout`. */
  logout: z.boolean().optional(),
});
type AcpCaps = z.infer<typeof capsSchema>;

/** A session's settings as the agent last reported them. */
export type AcpSettings = Pick<AcpSessionState, "configOptions" | "modes" | "models">;

/** What a hosted agent keeps for the next Relay: how it started, its session, the turn it was in. */
const metaSchema = z
  .object({
    provider: z.string(),
    caps: capsSchema.optional(),
    session: z
      .object({
        id: z.string(),
        settings: z.unknown().optional(),
        base: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    run: z.object({ id: z.number() }).optional(),
  })
  .loose();

const startTimeout = 60_000;

/** One agent process and the one session it runs. */
export class AcpAgent implements Lease {
  busy = false;
  caps?: AcpCaps;
  /** `base`: the settings it opened with, which Default goes back to. */
  session?: { id: string; settings: AcpSettings; base?: Record<string, string> };
  /** The prompt a restart cut off, for an `adopt` turn to show. */
  inflight?: { id: number };

  constructor(
    readonly profile: AcpProfile,
    readonly connection: AcpConnection,
  ) {}

  get closed() {
    return this.connection.closed;
  }

  /** What the next Relay reads about this process. */
  keep(run?: { id: number }) {
    this.connection.keep({
      provider: this.profile.provider,
      caps: this.caps,
      session: this.session,
      run,
    } satisfies z.infer<typeof metaSchema>);
  }

  close() {
    this.connection.close();
  }
}

const hosted = new Map<AcpProvider, HostedSessions<AcpAgent>>();
function sessionsOf(profile: AcpProfile) {
  let sessions = hosted.get(profile.provider);
  if (!sessions) {
    sessions = new HostedSessions<AcpAgent>({
      provider: profile.provider,
      name: profile.name,
      kind: "process",
      close: (agent) => agent.close(),
    });
    hosted.set(profile.provider, sessions);
  }
  return sessions;
}

async function launch(
  profile: AcpProfile,
  key: string | undefined,
  cwd: string,
  env?: Record<string, string>,
) {
  const found = await profile.command();
  const line = executableCommand(found.command, found.args);
  const spec = {
    ...line,
    env: withWorktreeEnv(process.env as Record<string, string>, {
      ...found.env,
      ...env,
    }),
  };
  const child = await sessionsOf(profile).spawn(
    key,
    { provider: profile.provider },
    { ...spec, cwd, group: true },
    () =>
      spawn(spec.command, spec.args, {
        cwd,
        env: spec.env,
        stdio: ["pipe", "pipe", "pipe"],
        // Its own group, so the tools it starts stop with it.
        detached: process.platform !== "win32",
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams,
  );
  const connection = new AcpConnection(child, profile.name);
  connection.onUpdate = (update) => hearCommands(profile.provider, update);
  return connection;
}

/** An error reply's message, with the reasons a bare "Internal error" leaves out. */
function detailOf(error: AcpRequestError) {
  const reasons = Array.isArray(error.data)
    ? error.data.flatMap((d) =>
        d && typeof d.message === "string"
          ? [`${(d.path ?? []).join(".")}: ${d.message}`]
          : [],
      )
    : [];
  return [error.message, ...reasons].join("\n");
}

async function initialize(agent: AcpAgent) {
  const { connection, profile } = agent;
  const reply = await withTimeout(
    connection.request("initialize", {
      protocolVersion: ACP_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "relay", title: "Relay", version: "0.1.0" },
    }),
    startTimeout,
    `${profile.name} didn't start in time.`,
  ).catch((error: Error) => {
    // It answered, so it's installed: what it said is the problem.
    if (error instanceof AcpRequestError)
      throw new Error(
        `${profile.name} wouldn't start a session for Relay: ${detailOf(error)}`,
      );
    throw new Error(
      `${profile.name} couldn't start its ACP server. ${profile.install}\n\n${error.message}`,
    );
  });
  const init = initializeResultSchema.parse(reply);
  if (init.protocolVersion !== ACP_VERSION)
    throw new Error(
      `${profile.name} speaks ACP version ${init.protocolVersion}; Relay speaks ${ACP_VERSION}. Update ${profile.name}.`,
    );
  const caps = init.agentCapabilities;
  agent.caps = {
    image: !!caps?.promptCapabilities?.image,
    http: !!caps?.mcpCapabilities?.http,
    load: !!caps?.loadSession,
    resume: caps?.sessionCapabilities?.resume != null,
    auth: (init.authMethods ?? [])
      .filter((m) => !m.type || m.type === "agent")
      .map((m) => m.id),
    logout: caps?.auth?.logout != null,
  };
}

/**
 * The process for a thread's session, started and initialized if it isn't
 * running. A thread's runs in the agent host; without a key it's a private
 * one that ends with its turn.
 */
export function acquireAcpAgent(
  profile: AcpProfile,
  key: string | undefined,
  cwd: string,
  env?: Record<string, string>,
): Promise<AcpAgent> {
  return sessionsOf(profile).acquire(key, async () => {
    const agent = new AcpAgent(profile, await launch(profile, key, cwd, env));
    try {
      await initialize(agent);
    } catch (error) {
      agent.close();
      throw error;
    }
    agent.keep();
    return agent;
  });
}

/**
 * Runs `call`, reading the agent's "sign in first" as Relay's signed out. A
 * turn never signs in itself: a Google sign-in opens a browser.
 */
async function signedIn<T>(agent: AcpAgent, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AcpRequestError && error.code === AUTH_REQUIRED)
      throw signedOutError(agent.profile.provider);
    throw error;
  }
}

export type McpServer = {
  type: "http";
  name: string;
  url: string;
  headers: { name: string; value: string }[];
};

/**
 * Puts the agent in session `id`: the one it runs, picked up again without
 * its history where the agent can, or loaded with it. Without an `id`, or
 * one it can't open, a new session. Says whether the history was lost.
 */
export async function openSession(
  agent: AcpAgent,
  options: { id?: string; cwd: string; mcpServers: McpServer[] },
): Promise<{ id: string; lost: boolean }> {
  const { connection } = agent;
  const { id, cwd, mcpServers } = options;
  if (id && agent.session?.id === id) return { id, lost: false };
  const state = (raw: unknown) => sessionResultSchema.parse(raw ?? {});
  const take = (sessionId: string, found: AcpSessionState) => {
    agent.session = {
      id: sessionId,
      settings: {
        configOptions: found.configOptions,
        modes: found.modes,
        models: found.models,
      },
    };
    agent.keep();
  };
  if (id && (agent.caps?.resume || agent.caps?.load)) {
    const method = agent.caps.resume ? "session/resume" : "session/load";
    try {
      // A load replays the history as updates; nobody listens yet, so they go nowhere.
      const found = state(
        await signedIn(agent, () =>
          connection.request(method, { sessionId: id, cwd, mcpServers }),
        ),
      );
      take(id, found);
      return { id, lost: false };
    } catch (error) {
      if (!(error instanceof AcpRequestError)) throw error;
    }
  }
  const found = state(
    await signedIn(agent, () =>
      connection.request("session/new", { cwd, mcpServers }),
    ),
  );
  if (!found.sessionId)
    throw new Error(`${agent.profile.name} didn't name its new session.`);
  take(found.sessionId, found);
  return { id: found.sessionId, lost: !!id };
}

export function closeAcpSession(profile: AcpProfile, key: string) {
  return sessionsOf(profile).close(key);
}

export function detachAcp(profile: AcpProfile) {
  sessionsOf(profile).detach();
}
export function disposeAcp(profile: AcpProfile) {
  sessionsOf(profile).dispose();
}

/**
 * Takes back the processes the agent host kept running while Relay
 * restarted. One in a turn waits, holding what it said meanwhile, for an
 * `adopt` turn.
 */
export function reattachAcp(profile: AcpProfile, owns: (key: string) => boolean) {
  return sessionsOf(profile).reattach(owns, (found) => {
    const meta = savedMeta(found, metaSchema);
    if (!meta?.caps || meta.provider !== profile.provider) return;
    const { info } = found;
    const child = new HostedChild(found.attachProcess(), (entries) => {
      connection.continueAfter(Math.max(meta.run?.id ?? 0, highestRequestId(entries)));
      return replay(entries, info.split);
    });
    const connection = new AcpConnection(child, profile.name);
    connection.onUpdate = (update) => hearCommands(profile.provider, update);
    const agent = new AcpAgent(profile, connection);
    agent.caps = meta.caps;
    if (meta.session)
      agent.session = {
        id: meta.session.id,
        settings: sessionResultSchema.safeParse(meta.session.settings ?? {}).data ?? {},
        base: meta.session.base,
      };
    agent.inflight = meta.run;
    if (!info.open) child.release();
    return agent;
  });
}

const parsed = (text: string): Record<string, unknown> | undefined => {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What a turn cut off by a restart still has to hear: its updates, its reply,
 * and the questions the agent asked that the last Relay never answered.
 */
function replay(entries: Entry[], split: number): string[] {
  const answered = new Set<unknown>();
  for (const entry of entries) {
    if (entry.kind !== "input") continue;
    const sent = parsed(entry.text);
    if (sent && !("method" in sent) && "id" in sent) answered.add(sent.id);
  }
  return entries.flatMap((entry) => {
    if (entry.kind !== "line" || entry.seq < split) return [];
    const said = parsed(entry.text);
    if (said && "method" in said && "id" in said && answered.has(said.id)) return [];
    return [entry.text];
  });
}

/** The highest id Relay gave a request, in what it sent or the agent answered. */
function highestRequestId(entries: Entry[]) {
  let highest = 0;
  for (const entry of entries) {
    if (entry.kind !== "line" && entry.kind !== "input") continue;
    const message = parsed(entry.text);
    // Relay's requests go in with a method and come back without one; the
    // agent's own are numbered by the agent.
    const relays = entry.kind === "input" ? "method" in (message ?? {}) : !("method" in (message ?? {}));
    if (!message || !relays) continue;
    if (typeof message.id === "number") highest = Math.max(highest, message.id);
  }
  return highest;
}
