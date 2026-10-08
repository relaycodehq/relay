import { expect, it } from "vitest";
import { codexPolicy, sandboxPolicyFor } from "./codex-policy";

const links = [
  { path: "/w/api", access: "read" as const },
  { path: "/w/types", access: "write" as const },
];

it("lets a workspace-writing turn write only the folders linked for writing", () => {
  expect(sandboxPolicyFor(codexPolicy("auto"), links)).toEqual({
    type: "workspaceWrite",
    writableRoots: ["/w/types"],
  });
  expect(sandboxPolicyFor(codexPolicy("approval-required"), links)).toEqual({
    type: "readOnly",
  });
  expect(sandboxPolicyFor(codexPolicy("auto"), links.slice(0, 1))).toEqual({
    type: "workspaceWrite",
  });
});
