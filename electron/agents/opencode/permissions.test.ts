import { describe, expect, it } from "vitest";
import {
  askPermission,
  permissionRules,
  readOnlyReply,
  type PermissionRule,
} from "./permissions";
import type { PermissionRequest } from "./events";
import { connectRelayTools } from "./mcp";
import { runtimeModes } from "../../../shared/agent-modes";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";

/** OpenCode's own reading of its rules: the last one that matches wins, `*` spans slashes. */
function decide(rules: PermissionRule[], permission: string, target: string) {
  const matches = (glob: string, value: string) =>
    new RegExp(
      `^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
    ).test(value);
  return rules.findLast(
    (r) => matches(r.permission, permission) && matches(r.pattern, target),
  )?.action;
}

const links = [
  { path: "/w/api", access: "read" as const },
  { path: "/w/types", access: "write" as const },
];

describe("linked folders under OpenCode", () => {
  it("lets reviewers read OpenCode scratch files but not unrelated external folders or spawn agents", () => {
    const rules = permissionRules("full-access", { readOnly: true });
    for (const dir of [tmpdir(), realpathSync(tmpdir())])
      expect(
        decide(
          rules,
          "external_directory",
          `${dir.replaceAll("\\", "/")}/opencode/*`,
        ),
      ).toBe("allow");
    expect(decide(rules, "external_directory", `${tmpdir()}/other/*`)).toBe(
      "ask",
    );
    expect(decide(rules, "task", "general")).toBe("deny");
    expect(decide(rules, "task", "explore")).toBe("deny");
    // Every command goes to readOnlyReply.
    expect(decide(rules, "bash", "git show HEAD:src/app.ts")).toBe("ask");
  });
  it("runs a reviewer's command only when all of it reads", () => {
    const request = (permission: string, command: string) =>
      ({
        id: "p",
        sessionID: "s",
        permission,
        patterns: [command],
        metadata: { command },
      }) as PermissionRequest;
    const bash = (command: string) => readOnlyReply(request("bash", command));
    expect(bash("git show HEAD:src/app.ts")).toBe("once");
    expect(bash("rg -n TODO src | head -20")).toBe("once");
    for (const command of [
      "rm src/app.ts",
      "git branch -D main",
      "git diff --output=x",
      "find . -delete",
      "rg --pre=./evil.sh x",
      "git status > out.txt",
    ])
      expect(bash(command), command).toBe("reject");
    expect(readOnlyReply(request("edit", "a.ts"))).toBe("reject");
  });
  it("reaches linked folders without asking, and asks before editing a read-only one", () => {
    const rules = permissionRules("auto-accept-edits", {
      cwd: "/w/web",
      links,
    });
    expect(decide(rules, "external_directory", "/w/api/*")).toBe("allow");
    expect(decide(rules, "external_directory", "/w/other/*")).toBe("ask");
    // OpenCode names an edited file from the project, or by its full path.
    expect(decide(rules, "edit", "../api/src/main.ts")).toBe("ask");
    expect(decide(rules, "edit", "/w/api/src/main.ts")).toBe("ask");
    expect(decide(rules, "edit", "../types/index.ts")).toBe("allow");
    expect(decide(rules, "edit", "src/app.ts")).toBe("allow");
  });

  it("keeps a reviewer from editing anywhere", () => {
    const rules = permissionRules("full-access", {
      readOnly: true,
      cwd: "/w/web",
      links,
    });
    expect(decide(rules, "external_directory", "/w/api/*")).toBe("allow");
    expect(decide(rules, "edit", "../api/src/main.ts")).toBe("deny");
    expect(decide(rules, "edit", "../types/index.ts")).toBe("deny");
  });

  it("adds nothing to full access or a title job", () => {
    expect(permissionRules("full-access", { links })).toEqual(
      permissionRules("full-access", {}),
    );
    expect(permissionRules(undefined, { title: true, links })).toEqual(
      permissionRules(undefined, { title: true }),
    );
  });
});

describe("Relay's tools under OpenCode", () => {
  // Every thread's server is listed in every session of the folder.
  it("lets a thread call only its own server's tools, unasked, in every mode", () => {
    for (const mode of [...runtimeModes.map((m) => m.value), undefined]) {
      const rules = permissionRules(mode, { relayServer: "relay-aaaaaaaa" });
      expect(decide(rules, "relay-aaaaaaaa_start_threads", "*")).toBe("allow");
      expect(decide(rules, "relay-bbbbbbbb_start_threads", "*")).toBe("deny");
    }
    const reviewer = permissionRules("full-access", { readOnly: true });
    expect(decide(reviewer, "relay-aaaaaaaa_send_to_thread", "*")).toBe("deny");
  });

  it("names a tool by its server, Relay's own as relay", async () => {
    const posted: unknown[] = [];
    const named = await connectRelayTools(
      async (method, path, body) => {
        if (method === "POST") posted.push(body);
        return method === "GET" && path === "/mcp"
          ? { "my.docs": { status: "connected" } }
          : true;
      },
      { url: "http://127.0.0.1:9/mcp", token: "chat.sig" },
    );
    expect(posted).toHaveLength(1);
    expect(named("relay-0123abcd_start_threads")).toEqual({
      server: "relay",
      tool: "start_threads",
    });
    expect(named("my_docs_search")).toEqual({
      server: "my.docs",
      tool: "search",
    });
    expect(named("bash")).toBeUndefined();
  });
});

it("warns that a subagent won't ask, since OpenCode hands it no asks", async () => {
  const asked: unknown[] = [];
  await askPermission(
    {
      id: "p",
      sessionID: "s",
      permission: "task",
      patterns: ["general"],
      always: ["*"],
      metadata: { description: "Find phone code", subagent_type: "general" },
    },
    async (request) => {
      asked.push(request);
      return { kind: "approval", decision: "accept" };
    },
    new AbortController().signal,
  );
  expect(asked[0]).toMatchObject({
    title: "Start a subagent?",
    detail: "Find phone code",
    note: expect.stringMatching(/won't ask/),
  });
});
