// A stand-in for @cursor/sdk, scripted by the prompt, for the Cursor worker's tests.
// It records what it was asked to $CURSOR_FAKE_LOG, one JSON object per line.
import { appendFileSync, existsSync, watch } from "node:fs";
import { dirname } from "node:path";

const log = (entry) => {
  if (process.env.CURSOR_FAKE_LOG)
    appendFileSync(process.env.CURSOR_FAKE_LOG, JSON.stringify(entry) + "\n");
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A handoff test decides when the worker may finish, regardless of machine speed.
const released = (file) =>
  new Promise((resolve) => {
    const watcher = watch(dirname(file), () => {
      if (!existsSync(file)) return;
      watcher.close();
      resolve();
    });
    if (existsSync(file)) {
      watcher.close();
      resolve();
    }
  });
const named = (name, message) => Object.assign(new Error(message), { name });

const shell = (command, output) => ({
  type: "shell",
  args: { command },
  ...(output === undefined
    ? {}
    : {
        result: {
          status: "success",
          value: { exitCode: 0, stdout: output, stderr: "" },
        },
      }),
});

let agents = 0;
const known = new Set();

class Run {
  constructor(script) {
    this.script = script;
    this.cancelled = false;
    this.steers = [];
    this.wake = () => {};
  }
  async cancel() {
    this.cancelled = true;
    this.wake();
  }
  async steer(text) {
    this.steers.push(text);
    this.wake();
    return "complete_delivered";
  }
  async wait() {
    return this.script;
  }
}

class FakeAgent {
  constructor(agentId, options) {
    this.agentId = agentId;
    this.options = options;
  }
  close() {
    if (process.env.CURSOR_FAKE_CLOSED)
      appendFileSync(process.env.CURSOR_FAKE_CLOSED, this.agentId + "\n");
  }
  async send(message, sendOptions) {
    const prompt = typeof message === "string" ? message : message.text;
    const customTools = sendOptions.local?.customTools;
    log({
      pid: process.pid,
      agent: this.agentId,
      options: this.options,
      sendOptions: {
        model: sendOptions.model,
        mode: sendOptions.mode,
        ...(customTools ? { customTools: Object.keys(customTools) } : {}),
      },
      images: typeof message === "string" ? 0 : message.images.length,
      prompt,
    });
    // Like the real SDK where its sandbox helper can't run, e.g. Linux without user namespaces.
    if (
      process.env.CURSOR_FAKE_NO_SANDBOX &&
      this.options.local?.sandboxOptions?.enabled
    )
      throw named(
        "ConfigurationError",
        "Local SDK sandboxing was requested, but sandboxing is not supported in this environment. Disable local.sandboxOptions.enabled or remove ~/.cursor/sandbox.json to run without sandboxing.",
      );
    const say = (update) => sendOptions.onDelta({ update });
    const run = new Run(undefined);
    run.wait = async () => {
      if (/\[\[auth\]\]/.test(prompt))
        throw named("AuthenticationError", "The API key was rejected.");
      if (/\[\[ratelimit\]\]/.test(prompt))
        throw named("RateLimitError", "You've hit your Cursor usage limit.");
      if (/\[\[apikey\]\]/.test(prompt))
        throw named(
          "ConfigurationError",
          "The MCP server docs needs an API key in its settings.",
        );
      if (/\[\[slow\]\]/.test(prompt)) {
        say({ type: "text-delta", text: "Working. " });
        await new Promise((resolve) => {
          run.wake = resolve;
        });
        return { status: "cancelled", result: "" };
      }
      if (/\[\[steer\]\]/.test(prompt)) {
        say({ type: "text-delta", text: "Working. " });
        await new Promise((resolve) => {
          run.wake = resolve;
        });
        say({ type: "user-message-appended" });
        say({ type: "text-delta", text: `Got: ${run.steers[0]}` });
        return { status: "finished", result: `Got: ${run.steers[0]}` };
      }
      if (/\[\[flood\]\]/.test(prompt)) {
        say({ type: "text-delta", text: "x".repeat(60000) });
        say({ type: "text-delta", text: "y".repeat(60000) });
        // A cancel ends it early; without one it finishes on its own.
        await Promise.race([
          new Promise((resolve) => {
            run.wake = resolve;
          }),
          pause(1500),
        ]);
        return { status: "finished", result: "done" };
      }
      if (/\[\[linger\]\]/.test(prompt)) {
        say({ type: "text-delta", text: "part one " });
        await released(process.env.CURSOR_FAKE_RELEASE);
        say({ type: "text-delta", text: "part two" });
        return { status: "finished", result: "part one part two" };
      }
      // A run that ends with status "error": the SDK's toRunError gives a message and a code.
      const runCode = /\[\[runerror:(\w+)\]\]/.exec(prompt)?.[1];
      if (runCode)
        return {
          status: "error",
          error: {
            message: "The run stopped.",
            ...(runCode === "none" ? {} : { code: runCode }),
          },
        };
      if (/\[\[fail\]\]/.test(prompt))
        return { status: "error", error: { message: "The model is down." } };
      if (/\[\[plan\]\]/.test(prompt)) {
        say({
          type: "tool-call-completed",
          callId: "p1",
          toolCall: { type: "createPlan", args: { plan: "1. Do it" } },
        });
        return { status: "finished", result: "1. Do it" };
      }
      // Calls a custom tool the way the SDK does: through its MCP server for them.
      if (/\[\[relay\]\]/.test(prompt)) {
        const tool = customTools?.list_threads;
        if (!tool) return { status: "finished", result: "No Relay tools." };
        const toolCall = {
          type: "mcp",
          args: {
            providerIdentifier: "custom-user-tools",
            toolName: "list_threads",
            args: {},
          },
        };
        say({ type: "tool-call-started", callId: "m1", toolCall });
        const result = await tool.execute({}, { toolCallId: "m1" });
        say({
          type: "tool-call-completed",
          callId: "m1",
          toolCall: { ...toolCall, result: { status: "success" } },
        });
        const text = result.content.map((c) => c.text).join("");
        say({ type: "text-delta", text });
        return { status: "finished", result: text };
      }
      if (/\[\[tools\]\]/.test(prompt)) {
        say({ type: "text-delta", text: "Let me look. " });
        await pause(60);
        say({
          type: "tool-call-started",
          callId: "c1",
          toolCall: shell("ls src"),
        });
        say({
          type: "tool-call-completed",
          callId: "c1",
          toolCall: shell("ls src", "a.ts\nb.ts\n"),
        });
        say({
          type: "tool-call-started",
          callId: "c2",
          toolCall: { type: "edit", args: { path: "src/a.ts" } },
        });
        say({
          type: "tool-call-completed",
          callId: "c2",
          toolCall: {
            type: "edit",
            args: { path: "src/a.ts" },
            result: { status: "success" },
          },
        });
        say({ type: "text-delta", text: "Done." });
        return { status: "finished", result: "Done." };
      }
      say({ type: "text-delta", text: "Hel" });
      say({ type: "text-delta", text: "lo" });
      return { status: "finished", result: "Hello" };
    };
    return run;
  }
}

export class JsonlLocalAgentStore {
  constructor(dir) {
    this.dir = dir;
  }
}

export const Agent = {
  async create(options) {
    if (process.env.CURSOR_FAKE_SIGNED_OUT)
      throw named(
        "ConfigurationError",
        "API key is required for cloud operations. Set CURSOR_API_KEY, pass apiKey, or run Cursor.auth.login().",
      );
    const agentId = `agent-${++agents}-${process.pid}`;
    known.add(agentId);
    return new FakeAgent(agentId, options);
  },
  async resume(agentId, options) {
    if (!agentId.startsWith("agent-") || agentId.includes("gone"))
      throw named("AgentNotFoundError", "No such agent.");
    return new FakeAgent(agentId, options);
  },
};

export const Cursor = {
  models: {
    async list() {
      return [
        {
          id: "auto",
          displayName: "Auto",
          parameters: [],
        },
        {
          id: "composer-2.5",
          displayName: "Composer 2.5",
          description: "Cursor's own model",
          parameters: [
            { id: "fast", values: [{ value: "false" }, { value: "true" }] },
          ],
          variants: [
            { params: [{ id: "fast", value: "true" }], isDefault: true },
          ],
        },
        {
          id: "grok-4.7",
          displayName: "Grok 4.7",
          description: "Grok with effort and speed settings",
          parameters: [
            {
              id: "reasoning_effort",
              values: [{ value: "low" }, { value: "high" }],
            },
            { id: "fast", values: [{ value: "false" }, { value: "true" }] },
          ],
          variants: [
            {
              params: [
                { id: "reasoning_effort", value: "high" },
                { id: "fast", value: "true" },
              ],
              isDefault: true,
            },
          ],
        },
        {
          id: "claude-opus-fixture",
          displayName: "Opus fixture",
          parameters: [
            { id: "thinking", values: [{ value: "false" }, { value: "true" }] },
            { id: "effort", values: [{ value: "low" }, { value: "high" }] },
          ],
          variants: [
            {
              params: [
                { id: "thinking", value: "true" },
                { id: "effort", value: "high" },
              ],
              isDefault: true,
            },
          ],
        },
      ];
    },
  },
  auth: {
    async status() {
      return process.env.CURSOR_FAKE_SIGNED_OUT
        ? { status: "logged-out" }
        : { status: "logged-in", backendUrl: "x", email: "dev@example.com" };
    },
    // Asked for the page instead of a browser, it gives one and waits until
    // $CURSOR_FAKE_LOGIN_DONE exists, as if it was signed in there.
    async login(options) {
      if (!options?.onLoginUrl) return;
      options.onLoginUrl("https://cursor.com/loginDeepControl?challenge=fake");
      const done = process.env.CURSOR_FAKE_LOGIN_DONE;
      while (done && !existsSync(done)) await pause(100);
    },
    async logout() {},
  },
};
