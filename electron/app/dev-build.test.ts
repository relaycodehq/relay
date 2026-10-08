import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {} }));
import { app } from "electron";
import { DevBuild } from "./dev-build";

it("removes the rebuild exit handler when quitting is cancelled", () => {
  const events = new EventEmitter();
  const exit = vi.fn();
  Object.assign(app, {
    once: events.once.bind(events),
    removeListener: events.removeListener.bind(events),
    exit,
  });
  vi.stubEnv("RELAY_DEV_STALE", "test-stale.json");
  try {
    const build = new DevBuild(() => {}, { quit: (cancelled) => cancelled() });
    build.restart();
    events.emit("will-quit", { preventDefault() {} });
    expect(exit).not.toHaveBeenCalled();
    const accepted = new DevBuild(() => {}, { quit: () => {} });
    accepted.restart();
    events.emit("will-quit", { preventDefault() {} });
    expect(exit).toHaveBeenCalledWith(75);
  } finally {
    vi.unstubAllEnvs();
  }
});
