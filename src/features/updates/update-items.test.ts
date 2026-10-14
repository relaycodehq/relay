import { describe, expect, it } from "vitest";
import type { AgentVersion } from "../../../shared/agent-updates";
import { agentItem, doneFor, relayItem, updateItems } from "./update-items";

const claude = (over: Partial<AgentVersion> = {}): AgentVersion => ({
  provider: "claude",
  current: "2.3.7",
  latest: "2.4.0",
  command: "claude update",
  ...over,
});

describe("relayItem", () => {
  it("keeps a put-off toast off while the download runs, back once it's ready", () => {
    const available = relayItem({
      status: "available",
      current: "0.13.4",
      version: "0.14.0",
      install: "auto",
    })!;
    const downloading = relayItem({
      status: "downloading",
      current: "0.13.4",
      version: "0.14.0",
      progress: 0.4,
    })!;
    const ready = relayItem({ status: "ready", current: "0.13.4", version: "0.14.0" })!;
    expect(downloading.key).toBe(available.key);
    expect(downloading.phase).toBe("busy");
    expect(ready.key).not.toBe(available.key);
    expect(ready).toMatchObject({ label: "Restart", run: "install", phase: "idle" });
  });

  it("shows nothing while idle or in a development build", () => {
    expect(relayItem({ status: "idle", current: "0.13.4" })).toBeUndefined();
    expect(relayItem({ status: "off", current: "0.13.4" })).toBeUndefined();
  });
});

describe("agentItem", () => {
  it("offers a newer release only with notices on, but always shows one under way", () => {
    expect(agentItem(claude(), false, 0)).toBeUndefined();
    expect(agentItem(claude(), true, 0)).toMatchObject({ run: "update-agent", version: "2.4.0" });
    expect(agentItem(claude({ update: { status: "running" } }), false, 0)?.phase).toBe("busy");
  });

  it("sends an agent Relay can't update, or a failed update, to Settings", () => {
    expect(agentItem(claude({ command: undefined }), true, 0)?.run).toBe("agent-details");
    const failed = agentItem(claude({ update: { status: "failed", message: "EACCES", at: 1 } }), false, 2);
    expect(failed).toMatchObject({ failed: true, run: "agent-details" });
  });

  it("shows the check for a moment after updating, then goes", () => {
    const updated = claude({
      current: "2.4.0",
      update: { status: "updated", version: "2.4.0", at: 1000 },
    });
    expect(agentItem(updated, true, 1000 + doneFor - 1)?.phase).toBe("done");
    expect(agentItem(updated, true, 1000 + doneFor)).toBeUndefined();
  });
});

it("puts Relay's toast first", () => {
  const items = updateItems(
    { status: "ready", current: "0.13.4", version: "0.14.0" },
    [claude()],
    true,
    0,
  );
  expect(items.map((i) => i.id)).toEqual(["relay", "agent:claude"]);
});
