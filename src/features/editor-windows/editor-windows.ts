import { useSyncExternalStore } from "react";
import type { EditorFileTarget, EditorWindowsState } from "../../../shared/editor-windows";
import { api } from "../../lib/api";
import { requestChannel } from "../../lib/request-channel";
import type { FilesRequest, FileTarget } from "../files/file-link-target";
import {
  adoptBuffers,
  collectUnsaved,
  discardWorkspace,
} from "./unsaved-buffers";

let state: EditorWindowsState = { open: [], focused: null, waiting: [] };
const listeners = new Set<() => void>();
const takingHandoff = new Set<string>();
/** Workspaces with more held for this window while it was taking the last. */
const handoffAgain = new Set<string>();
/** Workspaces whose editor is on its way to a window of its own, hidden here meanwhile. */
const leaving = new Set<string>();

/** Files other windows asked this window's editor to open; the editor window's Files listen. */
export const editorOpens = requestChannel<FilesRequest>();

/** What Files opens for a target another window sent: a commit's version, or the file. */
function filesRequestOf(target: EditorFileTarget): FilesRequest {
  if (target.snapshot) return { snapshot: target.snapshot, path: target.path };
  return target;
}

/** Takes what the main process holds for `where`, if it's for this window. */
async function takeHandoff(where: string) {
  if (takingHandoff.has(where)) return void handoffAgain.add(where);
  takingHandoff.add(where);
  try {
    const { buffers, opens } = await api.takeEditorHandoff(where);
    if (buffers.length) await adoptBuffers(where, buffers);
    for (const target of opens) editorOpens.send(filesRequestOf(target));
  } catch (e) {
    console.warn("Could not take the editor's handoff:", e);
  } finally {
    takingHandoff.delete(where);
    if (handoffAgain.delete(where)) void takeHandoff(where);
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function applyState(next: EditorWindowsState) {
  state = next;
  notify();
  // Held for one window of them; the others get nothing and leave it be.
  for (const where of next.waiting) void takeHandoff(where);
}

/** Keeps up with which editors have windows of their own; call once per page. */
export function followEditorWindows() {
  const stop = api.onEditorWindows(applyState);
  void api
    .editorWindows()
    .then(applyState)
    .catch(() => {});
  return stop;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the workspace's editor is in a window of its own. */
export const useEditorElsewhere = (where: string) =>
  useSyncExternalStore(subscribe, () => isEditorElsewhere(where));

/** Whether this window knows `where`'s editor to be in a window of its own. */
export const isEditorElsewhere = (where: string) =>
  leaving.has(where) || state.open.some((w) => w.where === where);

/** Pops the workspace's editor out, its unsaved edits with it, or brings its window up. */
export async function popOutEditor(projectId: string, where: string) {
  // Hidden first, so nothing is typed here after its edits are collected.
  leaving.add(where);
  notify();
  try {
    const buffers = collectUnsaved(where);
    await api.openEditorWindow(projectId, where, buffers);
    // The window has them now; two copies of one edit would be one too many.
    discardWorkspace(where);
  } finally {
    leaving.delete(where);
    notify();
  }
}

/**
 * Puts the workspace's editor back where it came from. Called from the
 * editor window it hands over its unsaved edits itself; from another, its
 * window is asked to.
 */
export function bringBackEditor(where: string) {
  const buffers = collectUnsaved(where);
  return api.returnEditorWindow(where, buffers.length ? buffers : undefined);
}

/** Shows `target` in the workspace's editor window, raising it. */
export function openInEditorWindow(where: string, target: FileTarget) {
  return api.openInEditorWindow(where, target);
}

/** The editor window puts its editor back whenever another window asks. */
export function answerEditorReturn(onError: (error: unknown) => void) {
  return api.onEditorReturn(
    (where) => void bringBackEditor(where).catch(onError),
  );
}
