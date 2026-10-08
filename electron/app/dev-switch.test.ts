import { expect, it, vi } from "vitest";
import { listenDevSwitch } from "./dev-switch";

it("routes restore stops to session-closing quits and switches to detaching restarts", () => {
  vi.stubEnv("RELAY_DEV_STALE", "fixture");
  const send = process.send;
  const listeners = new Set(process.listeners("message"));
  process.send = vi.fn() as typeof process.send;
  try {
    const quit = { restart: vi.fn(), stop: vi.fn() };
    listenDevSwitch(quit);
    process.emit(
      "message",
      { type: "relay:dev-stop", detach: false },
      undefined,
    );
    expect(quit.stop).toHaveBeenCalledOnce();
    expect(quit.restart).not.toHaveBeenCalled();
    process.emit(
      "message",
      { type: "relay:dev-stop", detach: true },
      undefined,
    );
    expect(quit.restart).toHaveBeenCalledOnce();
    expect(process.send).toHaveBeenCalledWith({
      type: "relay:dev-ready",
      restore: true,
    });
  } finally {
    for (const listener of process.listeners("message"))
      if (!listeners.has(listener)) process.removeListener("message", listener);
    process.send = send;
    vi.unstubAllEnvs();
  }
});
