import { memoOnce } from "../../util/memo";
import type { AgentDefaults, AgentModel } from "../../../shared/agents";
import type { ProviderCommand } from "../../../shared/commands";
import { modelSchema, type ReasoningEffort } from "../../../shared/settings";
import {
  commandId,
  isEffort,
  modelListSchema,
  skillListSchema,
  type MuseModel,
} from "./protocol";
import { acquireMuse, signedIn, type MuseAgent } from "./sessions";

/** How long the catalog's own `muse serve` waits for the next question before it goes. */
const idleMs = 60_000;

let host: { agent: Promise<MuseAgent>; uses: number; idle?: NodeJS.Timeout } | undefined;

/**
 * Runs `ask` on a private, log-free `muse serve` that models, skills, the
 * account and its limits are read from, kept a minute for the next question.
 */
export async function withCatalog<T>(ask: (agent: MuseAgent) => Promise<T>): Promise<T> {
  if (host?.agent) {
    const live = await host.agent.catch(() => undefined);
    if (!live || live.closed) host = undefined;
  }
  if (!host) {
    const agent = acquireMuse(undefined, process.cwd(), undefined, true);
    host = { agent, uses: 0 };
    agent.catch(() => (host = undefined));
  }
  const mine = host;
  clearTimeout(mine.idle);
  mine.uses++;
  try {
    return await ask(await mine.agent);
  } finally {
    mine.uses--;
    if (!mine.uses)
      mine.idle = setTimeout(() => {
        if (host === mine) host = undefined;
        void mine.agent.then((agent) => agent.close(), () => {});
      }, idleMs);
    mine.idle?.unref?.();
  }
}

/** Closes the catalog's process at once, e.g. after signing in as someone else. */
export async function closeCatalog() {
  const current = host;
  host = undefined;
  if (current) {
    clearTimeout(current.idle);
    await current.agent.then((agent) => agent.close(), () => {});
  }
}

/** A model's efforts: Muse lists them, or says it doesn't know them. */
const effortsOf = (model: MuseModel): ReasoningEffort[] =>
  Array.isArray(model.variants) ? model.variants.filter(isEffort) : [];

/** `muse-wonder-1.0` spelled out, for when Muse labels a model with its own id. */
const spelledOut = (id: string) =>
  id
    .split("-")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");

function agentModelOf(model: MuseModel): AgentModel {
  const efforts = effortsOf(model);
  return {
    id: model.modelId,
    name:
      model.displayLabel && model.displayLabel !== model.modelId
        ? model.displayLabel
        : spelledOut(model.modelId),
    description: (model.description ?? "").slice(0, 300),
    efforts,
    ...(isEffort(model.defaultReasoningEffort) && { defaultEffort: model.defaultReasoningEffort }),
    ...(model.contextLimit && { contextWindow: model.contextLimit }),
  };
}

const catalog = memoOnce(async () =>
  modelListSchema.parse(
    await withCatalog((agent) => signedIn(() => agent.connection.request("model/list", {}))),
  ).models,
);

/** The models Muse offers the signed-in account, newest first, as it lists them. */
export async function museModels(): Promise<AgentModel[]> {
  return (await catalog())
    .filter((model) => modelSchema.safeParse(model.modelId).success)
    .map(agentModelOf);
}

/** Forgets the list, e.g. after signing in as someone else. */
export const forgetMuseModels = catalog.forget;

export async function museDefaults(): Promise<AgentDefaults | null> {
  const models = await catalog().catch(() => []);
  const fallback = models.find((m) => m.isDefault);
  return {
    model: fallback?.modelId ?? "",
    effort: isEffort(fallback?.defaultReasoningEffort) ? fallback.defaultReasoningEffort : "",
    efforts: Object.fromEntries(
      models.flatMap((m) =>
        isEffort(m.defaultReasoningEffort) ? [[m.modelId, m.defaultReasoningEffort]] : [],
      ),
    ),
  };
}

const skills = new Map<string, { at: number; list: Promise<ProviderCommand[]> }>();

/**
 * Muse's skills in `root`, as `/name` commands. Muse lists them per session,
 * so a throwaway one in `root` is opened to ask.
 */
export function museCommands(root: string): Promise<ProviderCommand[]> {
  const cached = skills.get(root);
  if (cached && Date.now() - cached.at < 60_000) return cached.list;
  const list = withCatalog(async (agent) => {
    const { connection } = agent;
    const opened = (await connection.request("session/start", {
      commandId: commandId(),
      workspaceRoot: root,
    })) as { session?: { sessionId?: string } };
    const sessionId = opened.session?.sessionId;
    if (!sessionId) return [];
    const found = skillListSchema.parse(await connection.request("skill/list", { sessionId }));
    return found.skills.map(
      (skill): ProviderCommand => ({
        name: skill.selector.replace(/^\//, ""),
        description: (skill.description ?? "").slice(0, 300),
        ...(skill.displayName && { displayName: skill.displayName }),
        ...(skill.argumentHint && { argumentHint: skill.argumentHint }),
        source: "other",
      }),
    );
  }).catch((error) => {
    skills.delete(root);
    throw error;
  });
  skills.set(root, { at: Date.now(), list });
  return list;
}

/** The skills Muse last listed in `root`, without opening a session. */
export async function knownMuseCommands(
  root: string,
): Promise<ProviderCommand[] | undefined> {
  return skills.get(root)?.list.catch(() => undefined);
}
