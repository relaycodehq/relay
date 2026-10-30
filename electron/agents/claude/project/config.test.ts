import { expect, it } from "vitest";
import {
  runtimeModeSchema,
  type AgentRuntimeMode,
} from "../../../../shared/agent-modes";
import {
  claudePermissionMode,
  linkedFolders,
  sessionConfig,
  sessionSignature,
  type ClaudeRunOptions,
} from "./config";

// Read only reaches an agent as Supervised with `readOnly`; see turn-run.
const agentModes = runtimeModeSchema.options.filter(
  (mode): mode is AgentRuntimeMode => mode !== "read-only",
);

it("maps each approval mode to a Claude permission mode, and Plan to plan", () => {
  expect(
    agentModes.map((mode) =>
      claudePermissionMode({ runtimeMode: mode, interactionMode: "default" }),
    ),
  ).toEqual(["default", "acceptEdits", "auto", "bypassPermissions"]);
  expect(
    claudePermissionMode({
      runtimeMode: "full-access",
      interactionMode: "plan",
    }),
  ).toBe("plan");
});

it("keeps a read-only reviewer asking canUseTool whatever its approval mode", () => {
  for (const runtimeMode of agentModes)
    expect(
      claudePermissionMode({
        runtimeMode,
        interactionMode: "default",
        readOnly: true,
      }),
    ).toBe("default");
});

it("writes linked folders as working directories, and lets read-only ones be read without asking", () => {
  expect(
    linkedFolders([
      { path: "/Users/me/api", access: "write" },
      { path: "/Users/me/types", access: "read" },
      { path: "C:\\work\\shared", access: "read" },
    ]),
  ).toEqual({
    additionalDirectories: ["/Users/me/api"],
    settings: {
      permissions: {
        allow: ["Read(//Users/me/types/**)", "Read(//c/work/shared/**)"],
      },
    },
  });
  expect(linkedFolders([])).toEqual({});
});

it("restarts the session when a link's folder or access changes, not its note", () => {
  const base = { runtimeMode: "auto", interactionMode: "default" } as const;
  const api = { path: "/w/api", access: "read" } as const;
  const signature = (links: ClaudeRunOptions["links"]) =>
    sessionSignature({ ...base, links } as ClaudeRunOptions);
  expect(signature([api])).not.toBe(signature([]));
  expect(signature([{ ...api, access: "write" }])).not.toBe(signature([api]));
  expect(signature([{ ...api, note: "the backend" }])).toBe(signature([api]));
});

it("sets a side conversation up as its thread, so its fork reads the thread's cache", () => {
  const thread: ClaudeRunOptions = {
    job: { kind: "prompt" },
    cwd: "/project",
    prompt: "",
    choice: {} as never,
    model: "opus",
    effort: "high",
    signal: new AbortController().signal,
    onText() {},
    runtimeMode: "full-access",
    interactionMode: "default",
    relayTools: { url: "http://127.0.0.1:1/mcp", token: "t", renders: "auto" },
  };
  const side: ClaudeRunOptions = {
    ...thread,
    job: { kind: "side" },
    readOnly: true,
  };
  const { permissionMode: threadMode, ...threadSetup } = sessionConfig(
    thread,
    "/usr/bin/claude",
    true,
    {},
  );
  const { permissionMode: sideMode, ...sideSetup } = sessionConfig(
    side,
    "/usr/bin/claude",
    true,
    {},
  );
  // Same tools, MCP servers and system prompt; only asking differs.
  expect(sideSetup).toEqual(threadSetup);
  expect(threadMode).toBe("bypassPermissions");
  expect(sideMode).toBe("default");
});
