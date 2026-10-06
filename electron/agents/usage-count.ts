import type { AgentProvider } from "../../shared/agents";
import {
  addTokens,
  noTokens,
  type UsageEntry,
  type UsageJob,
  type UsageModelSpend,
} from "../../shared/usage";
import type { WatchSpend } from "../../shared/watch";
import { logUsage } from "../usage";
import type { AgentOptions, AgentRuntime, UsageReport } from "./types";
import { listCost } from "./watch/prices";

type Counting = Pick<AgentOptions, "job" | "usage">;

function jobOf(options: Counting): UsageJob {
  if (options.usage?.job) return options.usage.job;
  if (options.job.kind === "helper") return "helper";
  if (options.job.kind === "answer") return "room";
  return "thread";
}

/**
 * Tallies one run's requests by model and logs them as one entry when the
 * run ends. A live session keeps working after its run (background tasks,
 * subagents finishing), and what it reports then is logged as it comes.
 */
export class CountedRun {
  private start = Date.now();
  private models = new Map<string, UsageModelSpend>();
  private ended = false;

  constructor(
    private provider: AgentProvider,
    private options: Counting,
  ) {}

  add = (report: UsageReport) => {
    const usd = report.usd ?? listCost(report.model, report.tokens);
    if (this.ended) {
      this.log(Date.now(), 0, false, [
        [report.model, { tokens: report.tokens, usd, requests: 1 }],
      ]);
      return;
    }
    const was = this.models.get(report.model) ?? {
      tokens: noTokens(),
      usd: 0,
      requests: 0,
    };
    this.models.set(report.model, {
      tokens: addTokens(was.tokens, report.tokens),
      // One unpriced request leaves the model's dollars unknown, not short.
      usd:
        was.usd === undefined || usd === undefined ? undefined : was.usd + usd,
      requests: was.requests + 1,
    });
  };

  /** The watcher's side checks run beside the thread and count as Relay's own work. */
  watched(spend: WatchSpend) {
    if (spend.kind !== "check") return;
    this.log(
      Date.now(),
      0,
      false,
      [[spend.model, { tokens: spend.tokens, usd: spend.usd, requests: 1 }]],
      "watch",
    );
  }

  end() {
    this.ended = true;
    if (!this.models.size) return;
    // A compaction rewrites the context; it answers nothing.
    this.log(
      this.start,
      Date.now() - this.start,
      this.options.job.kind !== "compact",
      [...this.models],
    );
    this.models.clear();
  }

  private log(
    at: number,
    ms: number,
    answer: boolean,
    models: [string, UsageModelSpend][],
    job = jobOf(this.options),
  ) {
    const entry: UsageEntry = {
      at,
      ms,
      provider: this.provider,
      job,
      answer,
      models: Object.fromEntries(models),
    };
    if (this.options.usage?.chat) entry.chat = this.options.usage.chat;
    if (this.options.usage?.project) entry.project = this.options.usage.project;
    logUsage(entry);
  }
}

/** The runtime with every run counted for the Usage page. */
export function counted(
  provider: AgentProvider,
  runtime: AgentRuntime,
): AgentRuntime {
  const { askSide } = runtime;
  return {
    ...runtime,
    // A `/btw` answered from the session is a run of its own.
    askSide:
      askSide &&
      (async (options) => {
        const run = new CountedRun(provider, {
          job: { kind: "side" },
          usage: options.usage,
        });
        try {
          return await askSide({
            ...options,
            onUsage: (usage) => {
              run.add(usage);
              options.onUsage?.(usage);
            },
          });
        } finally {
          run.end();
        }
      }),
    run: async (options) => {
      const run = new CountedRun(provider, options);
      const watch = options.watch && {
        ...options.watch,
        onSpend: (spend: WatchSpend) => {
          run.watched(spend);
          options.watch!.onSpend?.(spend);
        },
      };
      try {
        return await runtime.run({
          ...options,
          watch,
          onUsage: (usage) => {
            run.add(usage);
            options.onUsage?.(usage);
          },
        });
      } finally {
        run.end();
      }
    },
  };
}
