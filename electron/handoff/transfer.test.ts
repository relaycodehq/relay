import { expect, it } from "vitest";
import { readOnlyModeBridge } from "../../shared/remote";
import type { RemoteClient } from "../../shared/remote-client";
import type { ProjectChatSend } from "../../shared/projects";
import type { ComputerInfos } from "./computer-infos";
import { sendFor, settingsOf } from "./transfer";

const readOnly = {
  id: "11111111-1111-4111-8111-111111111111",
  body: "Look around",
  provider: "codex",
  choice: {},
  runtimeMode: "read-only",
  interactionMode: "default",
} as unknown as ProjectChatSend;

const infosAt = (bridge: number) =>
  ({
    get: async () => ({ version: "0.21.0", bridge }),
  }) as unknown as ComputerInfos;
const client = {} as RemoteClient;
const older = { name: "Build box", bridge: readOnlyModeBridge - 1 };
const current = { name: "Build box", bridge: readOnlyModeBridge };

it("refuses to hand a Read only thread to a computer too old to keep it read only", () => {
  expect(() => settingsOf(readOnly, older)).toThrow(
    "Update Relay on Build box to hand off a Read only thread.",
  );
  expect(settingsOf(readOnly, current).runtimeMode).toBe("read-only");
  const asking = { ...readOnly, runtimeMode: "approval-required" as const };
  expect(settingsOf(asking, older).runtimeMode).toBe("approval-required");
});

it("refuses a Read only message to a thread on a computer too old for it", async () => {
  await expect(
    sendFor(
      infosAt(older.bridge),
      { id: "box", name: older.name },
      client,
      readOnly,
    ),
  ).rejects.toThrow(
    "Update Relay on Build box to send a Read only message there.",
  );
  const sent = await sendFor(
    infosAt(current.bridge),
    { id: "box", name: current.name },
    client,
    readOnly,
  );
  expect(sent.runtimeMode).toBe("read-only");
});
