import { z } from "zod";
import { HostedChild } from "../../agent-host/child";
import { executableCommand } from "../../platform/executables";
import { withTimeout } from "../../util/timeout";
import { signedOutError } from "../errors";
import { HostedAgent } from "../hosted-agent";
import { HostedSessions, savedMeta } from "../hosted-sessions";
import { highestRequestId, replayLines } from "../hosted-replay";
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
export type AcpSettings = Pick<
  AcpSessionState,
  "configOptions" | "modes" | "models"
>;

/** What a hosted agent keeps for the next Relay: how it started, its session, the turn it was in. */
const metaSchema = z
  .object({
    provider: z.string(),
    accountKey: z.string().optional(),
    credentialsRevision: z.string().optional(),
    home: z.string().optional(),
    caps: capsSchema.optional(),
    session: z
      .object({
        id: z.string(),
        settings: z.unknown().optional(),
        base: z.record(z.string(), z.string()).optional(),
        cost: z.number().optional(),
      })
      .optional(),
    run: z
      .object({ id: z.number(), compaction: z.boolean().optional() })
      .optional(),
  })
  .loose();

const startTimeout = 60_000;

/** One agent process and the one session it runs. */
export class AcpAgent extends HostedAgent<
  AcpConnection,
  { id: number; compaction?: boolean }
> {
  caps?: AcpCaps;
  /**
   * `base`: the settings it opened with, which Default goes back to. `cost`:
   * what the session had cost at the agent's last report, which the next one
   * counts from; unknown for a session picked up again.
   */
  session?: {
    id: string;
    settings: AcpSettings;
    base?: Record<string, string>;
    cost?: number;
  };

  constructor(
    readonly profile: AcpProfile,
    connection: AcpConnection,
  ) {
    super(connection);
  }

  /** What the next Relay reads about this process; `run`, the prompt it's in. */
  keep(run?: { id: number; compaction?: boolean }) {
    this.connection.keep({
      provider: hostedName(this.profile),
      accountKey: this.profile.accountKey,
      credentialsRevision: this.profile.credentialsRevision,
      home: this.profile.home,
      caps: this.caps,
      session: this.session,
      run,
    } satisfies z.infer<typeof metaSchema>);
  }
}

const hostedName = (profile: AcpProfile) =>
  profile.hostedAs ?? profile.provider;
const hosted = new Map<AcpProvider, HostedSessions<AcpAgent>>();
function sessionsOf(profile: AcpProfile) {
  let sessions = hosted.get(profile.provider);
  if (!sessions) {
    sessions = new HostedSessions<AcpAgent>({
      provider: hostedName(profile),
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
    env: withWorktreeEnv(
      profile.environment ?? (process.env as Record<string, string>),
      {
        ...found.env,
        ...env,
      },
    ),
  };
  const child = await sessionsOf(profile).spawnGroup(
    key,
    { provider: hostedName(profile) },
    spec,
    cwd,
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
      // Antigravity 1.4.1 hardcodes third-party model support by client name.
      // Its "zed" identity exposes the account's Claude/GPT models; "relay"
      // filters them out and rejects selecting them. Remove when Google lets
      // Relay opt in without a compatibility identity.
      clientInfo: {
        name: profile.provider === "antigravity" ? "zed" : "relay",
        title: "Relay",
        version: "0.1.0",
      },
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
export async function acquireAcpAgent(
  profile: AcpProfile,
  key: string | undefined,
  cwd: string,
  env?: Record<string, string>,
): Promise<AcpAgent> {
  const sessions = sessionsOf(profile);
  const previous = key ? sessions.get(key) : undefined;
  if (
    key &&
    previous &&
    (previous.profile.accountKey !== profile.accountKey ||
      previous.profile.credentialsRevision !== profile.credentialsRevision)
  ) {
    if (previous.busy)
      throw new Error("Stop the running answer before changing its account.");
    await sessions.close(key);
  }
  return sessions.acquire(key, async () =>
    new AcpAgent(profile, await launch(profile, key, cwd, env)).start(
      initialize,
    ),
  );
}

/**
 * Runs `call`, reading the agent's "sign in first" as Relay's signed out. A
 * turn never signs in itself: a Google sign-in opens a browser.
 */
async function signedIn<T>(
  agent: AcpAgent,
  call: () => Promise<T>,
): Promise<T> {
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
  const take = (sessionId: string, found: AcpSessionState, cost?: number) => {
    agent.session = {
      id: sessionId,
      settings: {
        configOptions: found.configOptions,
        modes: found.modes,
        models: found.models,
      },
      cost,
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
  take(found.sessionId, found, 0);
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
export function reattachAcp(
  profile: AcpProfile,
  owns: (key: string) => boolean,
) {
  return sessionsOf(profile).reattach(owns, (found) => {
    const meta = savedMeta(found, metaSchema);
    if (!meta?.caps || meta.provider !== hostedName(profile)) return;
    // A two-prompt compaction cannot be adopted as one answer. Its saved chat
    // still names the original session until the replacement is fully ready.
    if (profile.provider === "antigravity" && meta.run?.compaction) return;
    const { info } = found;
    const child = new HostedChild(found.attachProcess(), (entries) => {
      connection.continueAfter(
        Math.max(meta.run?.id ?? 0, highestRequestId(entries)),
      );
      return replayLines(entries, info.split);
    });
    const connection = new AcpConnection(child, profile.name);
    connection.onUpdate = (update) => hearCommands(profile.provider, update);
    const agent = new AcpAgent(
      {
        ...profile,
        accountKey: meta.accountKey,
        credentialsRevision: meta.credentialsRevision,
        home: meta.home,
      },
      connection,
    );
    agent.caps = meta.caps;
    if (meta.session)
      agent.session = {
        id: meta.session.id,
        settings:
          sessionResultSchema.safeParse(meta.session.settings ?? {}).data ?? {},
        base: meta.session.base,
        cost: meta.session.cost,
      };
    agent.inflight = meta.run;
    if (!info.open) child.release();
    return agent;
  });
}
