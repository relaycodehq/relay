import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, dialog: { showMessageBox: vi.fn() } }));
import { app, dialog } from "electron";
import { Quit } from "./quit";

beforeEach(() => {
  const events = new EventEmitter();
  Object.assign(app, {
    on: events.on.bind(events),
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
  expect(cancelled).toHaveBeenCalledOnce();
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
