import { describe, expect, it } from "vitest";
import {
  AgentUpdates,
  type AgentUpdatesIo,
  type SdkIo,
} from "./agent-updates";
import { isBehind } from "../../shared/agent-updates";

/** A machine where the only agent is Cursor, whose SDK Relay downloads. */
function cursorMachine(state: {
  installed?: string;
  newest?: string | Error;
  account?: { signedIn: boolean; email?: string };
  install?: (version?: string) => Promise<void>;
}) {
  const installs: (string | undefined)[] = [];
  const cursor: SdkIo = {
    source: "npm",
    installed: async () => state.installed,
    newest: async () => {
      if (state.newest instanceof Error) throw state.newest;
      return state.newest;
    },
    install: async (version) => {
      installs.push(version);
      if (state.install) return state.install(version);
      state.installed = version ?? "1.0.32";
    },
    account: async () => state.account,
  };
  const io: AgentUpdatesIo = {
    platform: "darwin",
    find: async (name) => {
      throw new Error(`${name} was not found.`);
    },
    realpath: async (path) => path,
    exists: async () => false,
    exec: async () => ({ code: 1, stdout: "", output: "", timedOut: false }),
    fetch: async () => new Response("{}"),
    claudeChannel: async () => "latest",
    sdks: { cursor },
  };
  const updates = new AgentUpdates(() => {}, io);
  return {
    updates,
    installs,
    cursor: () => updates.current.agents.find((a) => a.provider === "cursor")!,
  };
}

describe("Cursor's SDK in the agent list", () => {
  it("offers to set it up when nothing is downloaded yet", async () => {
    const { updates, cursor } = cursorMachine({ newest: "1.0.33" });
    await updates.check();
    expect(cursor()).toMatchObject({
      installer: "relay",
      latest: "1.0.33",
      error: expect.stringMatching(/isn't downloaded/),
    });
    expect(cursor().current).toBeUndefined();
  });

  it("shows the downloaded version, who's signed in, and a newer release", async () => {
    const { updates, cursor } = cursorMachine({
      installed: "1.0.32",
      newest: "1.0.33",
      account: { signedIn: true, email: "dev@example.com" },
    });
    await updates.check();
    expect(cursor()).toMatchObject({
      current: "1.0.32",
      latest: "1.0.33",
      account: { signedIn: true, email: "dev@example.com" },
    });
    expect(isBehind(cursor())).toBe(true);
  });

  it("sets up with the version Relay was made for, then updates to the newest", async () => {
    const { updates, installs, cursor } = cursorMachine({ newest: "1.0.33" });
    await updates.check();
    await updates.update("cursor");
    // Setting up: no version named, so the pinned one.
    expect(installs).toEqual([undefined]);
    expect(cursor()).toMatchObject({
      current: "1.0.32",
      update: { status: "updated", version: "1.0.32" },
    });

    await updates.check(true);
    expect(isBehind(cursor())).toBe(true);
    await updates.update("cursor");
    expect(installs).toEqual([undefined, "1.0.33"]);
  });

  it("won't reinstall the old version as an update when it can't look for a newer one", async () => {
    const { updates, installs, cursor } = cursorMachine({
      installed: "1.0.34",
      newest: new Error("offline"),
    });
    await updates.check();
    await updates.update("cursor");
    expect(installs).toEqual([]);
    expect(cursor().update).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/look up the newest/),
    });
  });

  it("keeps the reason when the download fails, e.g. a newer SDK this Relay can't run", async () => {
    const { updates, cursor } = cursorMachine({
      installed: "1.0.32",
      newest: "1.0.40",
      install: async () => {
        throw new Error(
          "Cursor SDK 1.0.40 needs dependencies this Relay doesn't have.",
        );
      },
    });
    await updates.check();
    await updates.update("cursor");
    expect(cursor().current).toBe("1.0.32");
    expect(cursor().update).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/Update Relay|needs dependencies/),
    });
  });

  it("says so where this build has no Cursor SDK at all", async () => {
    const io: AgentUpdatesIo = {
      platform: "darwin",
      find: async () => {
        throw new Error("nope");
      },
      realpath: async (p) => p,
      exists: async () => false,
      exec: async () => ({ code: 1, stdout: "", output: "", timedOut: false }),
      fetch: async () => new Response("{}"),
      claudeChannel: async () => "latest",
    };
    const updates = new AgentUpdates(() => {}, io);
    await updates.check();
    expect(
      updates.current.agents.find((a) => a.provider === "cursor")?.error,
    ).toMatch(/no Cursor SDK/);
  });
});

describe("agents from the ACP registry", () => {
  it("keeps one installed or removed while a check was running", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const sdk = (version: string, wait?: Promise<void>): SdkIo => ({
      source: "the ACP registry",
      installed: async () => {
        await wait;
        return version;
      },
      newest: async () => version,
      install: async () => {},
      account: async () => undefined,
    });
    let providers: `acp:${string}`[] = ["acp:old"];
    const io: AgentUpdatesIo = {
      platform: "darwin",
      find: async (name) => {
        throw new Error(`${name} was not found.`);
      },
      realpath: async (path) => path,
      exists: async () => false,
      exec: async () => ({ code: 1, stdout: "", output: "", timedOut: false }),
      fetch: async () => new Response("{}"),
      claudeChannel: async () => "latest",
      registry: {
        providers: () => providers,
        sdk: (provider) =>
          provider === "acp:old" ? sdk("1.0.0", held) : sdk("2.0.0"),
      },
    };
    const updates = new AgentUpdates(() => {}, io);
    const listed = () => updates.current.agents.map((a) => a.provider);
    const checked = updates.check();
    await new Promise((resolve) => setTimeout(resolve, 10));
    providers = ["acp:new"];
    await updates.sync();
    expect(listed()).toContain("acp:new");
    release();
    await checked;
    expect(listed()).toContain("acp:new");
    expect(listed()).not.toContain("acp:old");
  });
});
