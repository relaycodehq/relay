import { describe, expect, it } from "vitest";
import type { AgentVersion } from "../../../shared/agent-updates";
import { agentItem, doneFor, relayItem, shortVersion, updateItems } from "./update-items";

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

  it("keeps a put-off toast off when that update fails, back for the next release", () => {
    const offered = agentItem(claude(), true, 0)!;
    const failed = agentItem(claude({ update: { status: "failed", message: "EACCES", at: 1 } }), true, 2)!;
    expect(failed.key).toBe(offered.key);
    expect(agentItem(claude({ latest: "2.5.0" }), true, 0)!.key).not.toBe(offered.key);
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

describe("shortVersion", () => {
  it("drops Amp's git hash but leaves prereleases alone", () => {
    expect(shortVersion("0.0.1792022479-gc1a2b3d")).toBe("0.0.1792022479");
    expect(shortVersion("2.4.0-beta.1")).toBe("2.4.0-beta.1");
  });
});
