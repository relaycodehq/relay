import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, dialog: { showMessageBox: vi.fn() } }));
import { app, dialog } from "electron";
import { Quit } from "./quit";
import { DevBuild } from "./dev-build";

beforeEach(() => {
  const events = new EventEmitter();
  Object.assign(app, {
    on: events.on.bind(events),
    once: events.once.bind(events),
    removeListener: events.removeListener.bind(events),
    emit: events.emit.bind(events),
    listenerCount: events.listenerCount.bind(events),
    exit: vi.fn(),
    quit: vi.fn(() => events.emit("before-quit", { preventDefault() {} })),
  });
  vi.mocked(dialog.showMessageBox).mockReset();
});

function fixture(prepare = vi.fn(async () => {})) {
  const window = { closeToQuit: vi.fn(() => false), open: vi.fn() };
  const shutDown = vi.fn(async () => {});
  const resume = vi.fn();
  const stopping = vi.fn();
  const quit = new Quit({
    window: window as never,
    started: () => true,
    runningTasks: () => [{ description: "Live agent" }],
    prepare,
    cancelled: resume,
    stopping,
    shutDown,
    release: vi.fn(),
  });
  quit.listen();
  return { quit, window, shutDown, prepare, resume, stopping };
}

it("cancels a restart without shutting down, then lets another restart finish", async () => {
  const { quit, window, shutDown } = fixture();
  const cancelled = vi.fn();
  window.closeToQuit.mockImplementationOnce(() => {
    quit.cancel(); // AppWindow's Keep editing callback.
    return true;
  });
  quit.restart(cancelled);
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  expect(quit.detaching).toBe(false);
  expect(shutDown).not.toHaveBeenCalled();
  quit.restart(cancelled);
  await vi.waitFor(() => expect(quit.ready).toBe(true));
  expect(quit.detaching).toBe(true);
  expect(dialog.showMessageBox).not.toHaveBeenCalled();
  expect(cancelled).toHaveBeenCalledOnce();
});

it("reports cancellation when saving fails and Keep open is chosen", async () => {
  const { quit, window, shutDown, resume, stopping, prepare } = fixture(
    vi.fn(async () => {
      throw new Error("disk full");
    }),
  );
  vi.mocked(dialog.showMessageBox).mockResolvedValue({
    response: 0,
    checkboxChecked: false,
  });
  const cancelled = vi.fn();
  quit.restart(cancelled);
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  expect(quit.ready).toBe(false);
  expect(quit.detaching).toBe(false);
  expect(shutDown).not.toHaveBeenCalled();
  expect(stopping).not.toHaveBeenCalled();
  expect(resume).toHaveBeenCalledOnce();
  expect(window.open).toHaveBeenCalledOnce();
  prepare.mockResolvedValue(undefined);
  quit.restart();
  await vi.waitFor(() => expect(quit.ready).toBe(true));
  expect(shutDown).toHaveBeenCalledOnce();
});

it("commits teardown after the user explicitly chooses Quit without saving", async () => {
  const { quit, shutDown, resume, window } = fixture(
    vi.fn(async () => {
      throw new Error("disk full");
    }),
  );
  vi.mocked(dialog.showMessageBox).mockResolvedValue({
    response: 1,
    checkboxChecked: false,
  });
  quit.restart();
  await vi.waitFor(() => expect(quit.ready).toBe(true));
  expect(shutDown).toHaveBeenCalledOnce();
  expect(resume).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});

it("notifies every overlapping restart and removes every rebuild handler on cancellation", async () => {
  const { quit } = fixture(
    vi.fn(async () => {
      throw Error("disk full");
    }),
  );
  let resolveDialog!: (value: {
    response: number;
    checkboxChecked: boolean;
  }) => void;
  vi.mocked(dialog.showMessageBox).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveDialog = resolve;
      }),
  );
  vi.stubEnv("RELAY_DEV_STALE", "fixture");
  try {
    const build = new DevBuild(() => {}, { quit: (cb) => quit.restart(cb) });
    build.restart();
    await vi.waitFor(() => expect(resolveDialog).toBeTypeOf("function"));
    build.restart();
    const switched = vi.fn();
    quit.restart(switched);
    resolveDialog({ response: 0, checkboxChecked: false });
    await vi.waitFor(() => expect(switched).toHaveBeenCalledOnce());
    const events = app as unknown as EventEmitter;
    expect(events.listenerCount("will-quit")).toBe(0);
    events.emit("will-quit", { preventDefault() {} });
    expect(app.exit).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});

it("restores through a non-detaching quit and permits cancellation of background work", async () => {
  const { quit, shutDown } = fixture();
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
    response: 1,
    checkboxChecked: false,
  });
  const cancelled = vi.fn();
  quit.stop(cancelled);
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  expect(quit.detaching).toBe(false);
  expect(shutDown).not.toHaveBeenCalled();
  vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({
    response: 0,
    checkboxChecked: false,
  });
  quit.stop();
  await vi.waitFor(() => expect(quit.ready).toBe(true));
  expect(quit.detaching).toBe(false);
  expect(shutDown).toHaveBeenCalledOnce();
});

it("rejects a restore overlapping a detaching rebuild instead of changing teardown mode", async () => {
  let resolvePrepare!: () => void;
  const { quit } = fixture(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePrepare = resolve;
        }),
    ),
  );
  quit.restart();
  const restoreCancelled = vi.fn();
  quit.stop(restoreCancelled);
  expect(restoreCancelled).toHaveBeenCalledOnce();
  expect(quit.detaching).toBe(true);
  resolvePrepare();
  await vi.waitFor(() => expect(quit.ready).toBe(true));
});

it("does not start another restart while cancellation rolls back saved work", async () => {
  const { quit, window, resume } = fixture();
  let resumed!: () => void;
  resume.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resumed = resolve;
      }),
  );
  window.closeToQuit.mockImplementationOnce(() => {
    void quit.cancel();
    return true;
  });
  const first = vi.fn();
  quit.restart(first);
  const overlapping = vi.fn();
  quit.restart(overlapping);
  expect(overlapping).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  expect(app.quit).toHaveBeenCalledOnce();
  resumed();
  await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
  expect(quit.detaching).toBe(false);
});
