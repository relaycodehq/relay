// Runs Cursor's SDK for Relay, as its own process: `worker.mjs --sdk <index.js> --store <dir>`.
// The SDK is downloaded on first use (see sdk-install.ts), so it's loaded from
// the path Relay names rather than bundled. See protocol.ts for what's spoken.
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import type { SDKAgent, SDKModel, Run } from "@cursor/sdk";
import type {
  CursorMethod,
  CursorMethods,
  CursorModel,
  CursorRequest,
  CursorRun,
  CursorRunResult,
  CursorUpdate,
} from "./protocol";

type Sdk = typeof import("@cursor/sdk");

const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const sdkEntry = flag("--sdk");
const storeDir = flag("--store");

// The SDK finds its sandbox helper and ripgrep in `node_modules` above the
// running script, and this one isn't installed beside it: without this every
// sandboxed turn fails with "sandboxing is not supported in this environment".
if (sdkEntry)
  process.argv[1] = join(
    sdkEntry.replace(/[\\/]node_modules[\\/]@cursor[\\/]sdk[\\/].*$/, ""),
    "worker.mjs",
  );

// stdout is the protocol; whatever the SDK prints goes to stderr instead.
const write = (message: unknown) =>
  process.stdout.write(JSON.stringify(message) + "\n");
console.log = console.info = console.debug = console.error;

let loaded: Promise<Sdk> | undefined;
const sdk = () => {
  if (!sdkEntry) throw new Error("The worker wasn't told where the SDK is.");
  return (loaded ??= import(pathToFileURL(sdkEntry).href) as Promise<Sdk>);
};

let listed: Promise<SDKModel[]> | undefined;
async function models() {
  const { Cursor } = await sdk();
  const list = await (listed ??= Cursor.models.list());
  return list;
}

async function modelList(): Promise<CursorModel[]> {
  return (await models().catch(forgetList)).map((model) => ({
    id: model.id,
    name: model.displayName || model.id,
    description: model.description ?? "",
    parameters: (model.parameters ?? []).map((p) => ({
      id: p.id,
      values: p.values.map((v) => v.value),
    })),
    defaults: (model.variants?.find((v) => v.isDefault)?.params ?? []).map(
      (p) => ({ id: p.id, value: p.value }),
    ),
  }));
}
const forgetList = (error: unknown): never => {
  listed = undefined;
  throw error;
};

/** The model, with its reasoning effort set the way this model names it. */
async function modelSelection(run: CursorRun) {
  if (!run.model) return { id: "auto" };
  if (!run.effort) return { id: run.model };
  const model = (await models().catch(forgetList)).find(
    (m) => m.id === run.model,
  );
  const param = model?.parameters?.find(
    (p) =>
      /effort|reason|think/i.test(p.id) &&
      p.values.some((v) => v.value === run.effort),
  );
  return {
    id: run.model,
    ...(param ? { params: [{ id: param.id, value: run.effort }] } : {}),
  };
}

// Agents stay open between a thread's turns, so the next one starts warm.
const open = new Map<string, { key: string; agent: SDKAgent }>();
const runs = new Map<string, Run>();

async function agentFor(
  run: CursorRun,
  model: Awaited<ReturnType<typeof modelSelection>>,
) {
  const { Agent, JsonlLocalAgentStore } = await sdk();
  const key = JSON.stringify([
    run.cwd,
    run.sandbox,
    run.autoReview,
    run.tools,
    run.systemPrompt,
    run.ambient,
    model?.id,
  ]);
  const held = run.agentId ? open.get(run.agentId) : undefined;
  if (held?.key === key) return held.agent;
  held?.agent.close();

  const options = {
    ...(model ? { model } : {}),
    ...(run.tools ? { tools: run.tools } : {}),
    ...(run.systemPrompt ? { systemPrompt: run.systemPrompt } : {}),
    local: {
      cwd: run.cwd,
      ...(storeDir ? { store: new JsonlLocalAgentStore(storeDir) } : {}),
      // Left out, only what's passed inline loads: none of the user's own rules, MCP servers or hooks.
      ...(run.ambient
        ? {
            settingSources: ["project", "user", "plugins"] as (
              "project" | "user" | "plugins"
            )[],
          }
        : {}),
      ...(run.sandbox ? { sandboxOptions: { enabled: true } } : {}),
      ...(run.autoReview ? { autoReview: true } : {}),
    },
  };
  let agent: SDKAgent | undefined;
  if (run.agentId) {
    // Cursor forgot it, e.g. its store was cleared: start over.
    agent = await Agent.resume(run.agentId, options).catch((error) => {
      if (error?.name === "AgentNotFoundError") return undefined;
      throw error;
    });
  }
  agent ??= await Agent.create(options);
  open.set(agent.agentId, { key, agent });
  return agent;
}

/** What Relay reads of an update, without the file contents and command output it never shows. */
const clip = (value: unknown, limit = 4000): unknown =>
  typeof value === "string" && value.length > limit
    ? value.slice(0, limit)
    : value;

function slim(call: any) {
  if (!call || typeof call !== "object") return call;
  const args: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(call.args ?? {}))
    args[name] = name === "plan" ? value : clip(value);
  const result = call.result;
  return {
    type: call.type,
    args,
    ...(result
      ? {
          result: {
            status: result.status,
            ...(result.value && call.type === "shell"
              ? {
                  exitCode: result.value.exitCode,
                  output: String(
                    (result.value.stdout ?? "") + (result.value.stderr ?? ""),
                  ).slice(-8000),
                }
              : {}),
            ...(result.status === "error"
              ? { error: String(result.error?.message ?? result.error ?? "") }
              : {}),
          },
        }
      : {}),
  };
}

// Text arrives a word at a time; it goes out in bunches, always before what follows it.
const pending = new Map<string, { text: string; timer?: NodeJS.Timeout }>();
function flush(run: string) {
  const held = pending.get(run);
  if (!held?.text) return;
  clearTimeout(held.timer);
  const text = held.text;
  pending.delete(run);
  write({ event: "update", run, update: { type: "text-delta", text } });
}

function forward(run: string, update: any) {
  switch (update?.type) {
    case "text-delta": {
      const held = pending.get(run) ?? { text: "" };
      held.text += String(update.text ?? "");
      held.timer ??= setTimeout(() => flush(run), 40);
      pending.set(run, held);
      return;
    }
    case "tool-call-started":
    case "tool-call-completed":
      flush(run);
      write({
        event: "update",
        run,
        update: {
          type: update.type,
          callId: update.callId,
          toolCall: slim(update.toolCall),
        } satisfies CursorUpdate,
      });
      return;
    case "token-delta":
    case "summary-started":
    case "summary-completed":
    case "turn-ended":
    case "user-message-appended":
      flush(run);
      write({
        event: "update",
        run,
        update: {
          ...update,
          ...(update.type === "user-message-appended"
            ? { message: undefined }
            : {}),
        },
      });
  }
}

async function start(params: CursorRun): Promise<CursorRunResult> {
  const model = await modelSelection(params);
  const agent = await agentFor(params, model);
  const message = params.images.length
    ? {
        text: params.prompt,
        images: params.images.map((i) => ({
          data: i.data,
          mimeType: i.mimeType,
        })),
      }
    : params.prompt;
  const run = await agent
    .send(message as string, {
      ...(model ? { model } : {}),
      mode: params.mode,
      onDelta: ({ update }) => forward(params.run, update),
    })
    .catch((error) => {
      // A new agent nobody was told about can't be resumed: let it go.
      if (agent.agentId !== params.agentId) {
        open.delete(agent.agentId);
        agent.close();
      }
      throw error;
    });
  // Told once the turn runs, so an interrupted first turn still leaves a thread
  // that can resume, and one the SDK refused to start (no sandbox here) leaves none.
  write({
    event: "update",
    run: params.run,
    update: { type: "agent", agentId: agent.agentId },
  });
  runs.set(params.run, run);
  try {
    const result = await run.wait();
    flush(params.run);
    return {
      agentId: agent.agentId,
      status:
        result.status === "cancelled"
          ? "cancelled"
          : result.status === "error"
            ? "error"
            : "finished",
      text: typeof result.result === "string" ? result.result : "",
      ...(result.status === "error"
        ? {
            error: String(
              (result as { error?: { message?: string } }).error?.message ??
                (result as { error?: unknown }).error ??
                "Cursor failed.",
            ),
          }
        : {}),
    };
  } finally {
    runs.delete(params.run);
  }
}

type Handlers = {
  [M in CursorMethod]: (
    params: CursorMethods[M]["params"],
  ) => Promise<CursorMethods[M]["result"]>;
};

const auth = async () => {
  const { Cursor } = await sdk();
  const status = await Cursor.auth.status();
  return status.status === "logged-in"
    ? { status: "logged-in" as const, email: status.email }
    : { status: "logged-out" as const };
};

const handlers: Handlers = {
  models: modelList,
  "auth.status": auth,
  "auth.login": async () => {
    const { Cursor } = await sdk();
    await Cursor.auth.login({ apiKeyName: "Relay" });
    listed = undefined;
    return auth();
  },
  "auth.logout": async () => {
    const { Cursor } = await sdk();
    await Cursor.auth.logout();
    listed = undefined;
    return auth();
  },
  run: start,
  cancel: async ({ run }) => {
    await runs.get(run)?.cancel();
    return null;
  },
  steer: async ({ run, text }) => {
    const running = runs.get(run);
    if (!running?.steer)
      throw new Error("Cursor can't take a message while it works here.");
    const outcome = await running.steer(text);
    if (outcome !== "complete_delivered")
      throw new Error(
        "Cursor didn't take the message; it goes as the next turn.",
      );
    return null;
  },
};

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let request: CursorRequest;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const handler = handlers[request.method] as
    ((params: unknown) => Promise<unknown>) | undefined;
  if (!handler) {
    write({
      id: request.id,
      error: { name: "Error", message: `No ${request.method}.` },
    });
    return;
  }
  handler(request.params).then(
    (result) => write({ id: request.id, result }),
    (error) =>
      write({
        id: request.id,
        error: {
          name: String(error?.name ?? "Error"),
          message: String(error?.message ?? error),
        },
      }),
  );
});
// Relay closing our input is how we're told to stop.
lines.on("close", async () => {
  await Promise.allSettled([...runs.values()].map((run) => run.cancel()));
  for (const { agent } of open.values()) agent.close();
  process.exit(0);
});
