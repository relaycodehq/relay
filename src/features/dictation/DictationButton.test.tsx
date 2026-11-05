// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bindings } from "../../lib/shortcuts";

const session = vi.hoisted(() => ({
  snapshot: { phase: "idle" as string, loading: false },
  startDictation: vi.fn(async () => true),
}));

vi.mock("./audio/session", () => ({
  cancelDictation: vi.fn(),
  clearDictationError: vi.fn(),
  dictationModelState: () => ({ status: "ready" }),
  dictationSnapshot: () => session.snapshot,
  startDictation: session.startDictation,
  stopDictation: vi.fn(async () => true),
  useDictation: () => session.snapshot,
  useDictationModel: () => ({ status: "ready" }),
}));

vi.mock("./audio/microphones", () => ({
  setDictationMicrophone: vi.fn(),
  useDictationMicrophone: () => "",
  useMicrophones: () => [],
}));

const { DictationButton } = await import("./DictationButton");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeEach(() => session.startDictation.mockClear());

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function renderComposer() {
  const host = document.createElement("div");
  document.body.append(host);
  const composer = createRef<HTMLDivElement>();
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <div ref={composer}>
        <DictationButton
          owner={composer}
          target={() => ({ begin() {}, update() {}, end() {} })}
          composer={composer}
          resetKey="draft"
        />
      </div>,
    ),
  );
}

function pressDictate() {
  const combo = bindings("dictate")[0]!;
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code: combo.code,
      key: combo.code === "Space" ? " " : combo.code,
      altKey: combo.alt,
      ctrlKey: combo.ctrl,
      metaKey: combo.meta,
      shiftKey: combo.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

it("starts dictating into the composer from its shortcut", async () => {
  await renderComposer();
  pressDictate();
  expect(session.startDictation).toHaveBeenCalledTimes(1);
});

it("leaves the composer behind Settings alone", async () => {
  await renderComposer();
  const settings = document.createElement("div");
  settings.className = "settings-screen";
  document.body.append(settings);
  pressDictate();
  expect(session.startDictation).not.toHaveBeenCalled();
});

it("leaves the composer behind an open dialog alone", async () => {
  await renderComposer();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  pressDictate();
  expect(session.startDictation).not.toHaveBeenCalled();
});

it("tries again from the shortcut while its own prompt is showing", async () => {
  session.startDictation.mockResolvedValueOnce(false);
  await renderComposer();
  await act(async () => pressDictate());
  expect(
    document.querySelector('.dictation-prompt[role="dialog"]'),
  ).not.toBeNull();
  pressDictate();
  expect(session.startDictation).toHaveBeenCalledTimes(2);
});
