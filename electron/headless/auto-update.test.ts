import { expect, it, vi } from "vitest";
import type { UpdateState } from "../../shared/updates";
import { keepUpdated, type Updates } from "./auto-update";

/** An updater that finds 2.0.0 and goes through its steps when asked. */
function fakeUpdates() {
  const steps: string[] = [];
  let now: UpdateState = { status: "idle", current: "1.0.0" };
  const updates: Updates = {
    get now() {
      return now;
    },
    check: async () => {
      steps.push("check");
      return (now = {
        status: "available",
        current: "1.0.0",
        version: "2.0.0",
        install: "auto",
      });
    },
    download: async () => {
      steps.push("download");
      return (now = { status: "ready", current: "1.0.0", version: "2.0.0" });
    },
    install: async () => {
      steps.push("install");
      return (now = {
        status: "installing",
        current: "1.0.0",
        version: "2.0.0",
      });
    },
  };
  return { updates, steps };
}

const quick = { firstAfter: 60_000, every: 60_000, poll: 10, waitAtMost: 200 };

it("installs what's out once no thread is working", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { updates, steps } = fakeUpdates();
  let busy = true;
  const keeper = keepUpdated(
    updates,
    { enabled: async () => true, busy: () => busy },
    quick,
  );
  try {
    const pass = keeper.run();
    await vi.waitFor(() => expect(steps).toEqual(["check", "download"]));
    // Still working: it waits.
    await new Promise((r) => setTimeout(r, 50));
    expect(steps).not.toContain("install");
    busy = false;
    await pass;
    expect(steps).toEqual(["check", "download", "install"]);
  } finally {
    keeper.stop();
  }
});

it("installs anyway after waiting long enough, since agents carry on through it", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { updates, steps } = fakeUpdates();
  const keeper = keepUpdated(
    updates,
    { enabled: async () => true, busy: () => true },
    quick,
  );
  try {
    await keeper.run();
    expect(steps).toEqual(["check", "download", "install"]);
  } finally {
    keeper.stop();
  }
});

it("only says an update is out when auto-update is off", async () => {
  const said = vi.spyOn(console, "log").mockImplementation(() => {});
  const { updates, steps } = fakeUpdates();
  const keeper = keepUpdated(
    updates,
    { enabled: async () => false, busy: () => false },
    quick,
  );
  try {
    await keeper.run();
    expect(steps).toEqual(["check"]);
    expect(said).toHaveBeenCalledWith(
      "Relay 2.0.0 is out; relay update installs it.",
    );
  } finally {
    keeper.stop();
  }
});

it("cancels a waiting install when disabled, and resumes the staged update when enabled", async () => {
  let state: UpdateState = {
    status: "available",
    current: "1.0.0",
    version: "2.0.0",
    install: "auto",
  };
  const install = vi.fn(
    async () =>
      (state = {
        status: "installing",
        current: "1.0.0",
        version: "2.0.0",
      } as UpdateState),
  );
  const download = vi.fn(
    async () =>
      (state = {
        status: "ready",
        current: "1.0.0",
        version: "2.0.0",
      } as UpdateState),
  );
  let enabled = true,
    busy = true;
  const keeper = keepUpdated(
    {
      get now() {
        return state;
      },
      check: async () => state,
      download,
      install,
    },
    { enabled: async () => enabled, busy: () => busy },
    quick,
  );
  try {
    const pass = keeper.run();
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    enabled = false;
    await pass;
    expect(install).not.toHaveBeenCalled();
    expect(state.status).toBe("ready");
    enabled = true;
    busy = false;
    await keeper.run();
    expect(install).toHaveBeenCalledTimes(1);
  } finally {
    keeper.stop();
  }
});
