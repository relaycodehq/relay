// A stand-in for @cursor/sdk, scripted by the prompt, for the Cursor worker's tests.
// It records what it was asked to $CURSOR_FAKE_LOG, one JSON object per line.
import { appendFileSync } from "node:fs";

const log = (entry) => {
  if (process.env.CURSOR_FAKE_LOG)
    appendFileSync(process.env.CURSOR_FAKE_LOG, JSON.stringify(entry) + "\n");
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
    log({
      pid: process.pid,
      agent: this.agentId,
      options: this.options,
      sendOptions: { model: sendOptions.model, mode: sendOptions.mode },
      images: typeof message === "string" ? 0 : message.images.length,
      prompt,
    });
    const say = (update) => sendOptions.onDelta({ update });
    const run = new Run(undefined);
    run.wait = async () => {
      if (/\[\[auth\]\]/.test(prompt))
        throw named("AuthenticationError", "The API key was rejected.");
      if (/\[\[slow\]\]/.test(prompt)) {
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
      if (/\[\[linger\]\]/.test(prompt)) {
        say({ type: "text-delta", text: "part one " });
        await pause(Number(process.env.CURSOR_FAKE_LINGER ?? 800));
        say({ type: "text-delta", text: "part two" });
        return { status: "finished", result: "part one part two" };
      }
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
            {
              id: "reasoning",
              values: [{ value: "low" }, { value: "high" }],
            },
          ],
          variants: [
            { params: [{ id: "reasoning", value: "low" }], isDefault: true },
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
    async login() {},
    async logout() {},
  },
};
