// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { FileDocument } from "./documents";
import { useUnsavedPrompt } from "./useUnsavedPrompt";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Prompt(props: Parameters<typeof useUnsavedPrompt>[0]) {
  return useUnsavedPrompt(props).prompt || null;
}

const host = document.createElement("div");
const root = createRoot(host);

afterEach(() => act(() => root.render(null)));

/** A document with unsaved edits; `typedDuringSave` leaves it dirty after its save lands. */
const editedDocument = (typedDuringSave: boolean) => {
  const doc = { status: { dirty: true, saving: false } } as FileDocument;
  doc.save = async () => {
    doc.status = { ...doc.status, dirty: typedDuringSave };
    return true;
  };
  return doc;
};

const saveAndClose = () =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Save and close",
  )!;

it("keeps asking when edits were typed while saving, instead of closing over them", async () => {
  const doc = editedDocument(true);
  const onClose = vi.fn();
  await act(() =>
    root.render(<Prompt doc={doc} closeRequest={1} onClose={onClose} />),
  );
  await act(async () => saveAndClose().click());
  expect(onClose).not.toHaveBeenCalled();
  expect(saveAndClose()).toBeTruthy();
});

it("closes once the save leaves nothing unsaved", async () => {
  const doc = editedDocument(false);
  const onClose = vi.fn();
  await act(() =>
    root.render(<Prompt doc={doc} closeRequest={1} onClose={onClose} />),
  );
  await act(async () => saveAndClose().click());
  expect(onClose).toHaveBeenCalledTimes(1);
});
