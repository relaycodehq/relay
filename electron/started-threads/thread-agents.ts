// The agents a thread may start others on here, and the models each offers:
// start_threads refuses a name it can't run, rather than leave the user a
// thread that failed before it began, and list_agents tells the agent asking.
import {
  agentName,
  runnableAgents,
  type AgentModel,
  type AgentProvider,
} from "../../shared/agents";

/** What the tools learn about the agents on this computer. */
export interface ThreadAgents {
  /** Why `agent` can't run here, once Relay has looked; undefined when it can. */
  cantRun(agent: AgentProvider): string | undefined;
  /** The models it offers. */
  models(agent: AgentProvider): Promise<AgentModel[]>;
}

/** A catalog that won't answer by then is left unchecked. */
const MODELS_TIMEOUT_MS = 15_000;
/** Catalogs start agents' processes; one look serves calls for a while. */
const MODELS_FRESH_MS = 5 * 60_000;
/** Models per agent when list_agents lists them all. */
const LISTED_MODELS = 40;

export interface AgentPick {
  agent?: AgentProvider;
  model?: string;
}

export class AgentChoices {
  private catalogs = new Map<
    AgentProvider,
    { at: number; models: Promise<AgentModel[] | undefined> }
  >();

  constructor(private agents?: ThreadAgents) {}

  /** Why `agent` can't start a thread here; undefined when it can. */
  why(agent: AgentProvider): string | undefined {
    if (!runnableAgents().includes(agent))
      return `${agent} isn't installed here.`;
    return this.agents?.cantRun(agent);
  }

  ready() {
    return runnableAgents().filter((a) => !this.why(a));
  }

  /** Its models; undefined when it can't say in time. */
  models(agent: AgentProvider): Promise<AgentModel[] | undefined> {
    const agents = this.agents;
    if (!agents) return Promise.resolve(undefined);
    const cached = this.catalogs.get(agent);
    if (cached && Date.now() - cached.at < MODELS_FRESH_MS)
      return cached.models;
    const models = timeout(agents.models(agent), MODELS_TIMEOUT_MS).catch(
      (error: unknown) => {
        console.warn(`Models of ${agent} for Relay's tools:`, error);
        return undefined;
      },
    );
    const entry = { at: Date.now(), models };
    this.catalogs.set(agent, entry);
    void models.then((m) => {
      if (!m?.length && this.catalogs.get(agent) === entry)
        this.catalogs.delete(agent);
    });
    return models;
  }

  /** What's wrong with the threads asked for, before the user is asked; undefined when nothing. */
  async refusal(picks: AgentPick[], caller: AgentProvider) {
    const unknown = [
      ...new Set(
        picks.flatMap((p) => (p.agent && this.why(p.agent) ? [p.agent] : [])),
      ),
    ];
    if (unknown.length)
      return `${unknown.map((a) => this.why(a)).join(" ")} Agents that can run here: ${this.ready()
        .map((a) => `${a} (${agentName(a)})`)
        .join(
          ", ",
        )}. A model's name goes in \`model\`, with the agent that offers it; list_agents has each one's models.`;
    const wrong: string[] = [];
    for (const { agent = caller, model } of picks) {
      if (!model) continue;
      const models = await this.models(agent);
      // An agent that lists none takes whatever it's given.
      if (!models?.length || models.some((m) => offers(m, model))) continue;
      const others = models.filter((m) =>
        m.id.toLowerCase().includes(model.toLowerCase()),
      );
      wrong.push(
        `${agentName(agent)} has no model ${model}.${others.length ? ` Did you mean ${others.map((m) => m.id).join(" or ")}?` : ""} Its models: ${models.map((m) => m.id).join(", ")}.`,
      );
    }
    return wrong.length ? [...new Set(wrong)].join("\n") : undefined;
  }

  /** What list_agents returns. */
  async list(caller: AgentProvider, only?: AgentProvider) {
    if (only && this.why(only))
      return { error: await this.refusal([{ agent: only }], caller) };
    const ready = only ? [only] : this.ready();
    const listed = await Promise.all(
      ready.map(async (agent) => {
        const models = await this.models(agent);
        const shown = only ? models : models?.slice(0, LISTED_MODELS);
        return {
          agent,
          name: agentName(agent),
          ...(agent === caller ? { you: true } : {}),
          ...(shown
            ? {
                models: shown.map((m) => ({
                  id: m.id,
                  ...(m.name !== m.id ? { name: m.name } : {}),
                  ...(m.efforts.length ? { efforts: m.efforts } : {}),
                })),
              }
            : { note: "It couldn't list its models just now." }),
          ...(models && shown && models.length > shown.length
            ? {
                more: `${models.length - shown.length} more: list_agents with agent "${agent}"`,
              }
            : {}),
        };
      }),
    );
    const unavailable = only
      ? []
      : runnableAgents().flatMap((agent) => {
          const why = this.why(agent);
          return why ? [{ agent, why }] : [];
        });
    return { agents: listed, ...(unavailable.length ? { unavailable } : {}) };
  }
}

const offers = (m: AgentModel, model: string) =>
  m.id === model || m.resolved === model;

function timeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
