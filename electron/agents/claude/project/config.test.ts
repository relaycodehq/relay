import { expect, it } from "vitest";
import { runtimeModeSchema } from "../../../../shared/agent-modes";
import { claudePermissionMode } from "./config";

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
