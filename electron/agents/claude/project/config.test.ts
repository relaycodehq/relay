import { expect, it } from "vitest";
import { runtimeModeSchema } from "../../../../shared/agent-modes";
import {
  claudePermissionMode,
  linkedFolders,
  sessionSignature,
  type ClaudeRunOptions,
} from "./config";

it("maps each approval mode to a Claude permission mode, and Plan to plan", () => {
  expect(
    runtimeModeSchema.options.map((mode) =>
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
  for (const runtimeMode of runtimeModeSchema.options)
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
