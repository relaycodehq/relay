import {
  Editor,
  type EditorFactory,
  type EditorKeymap,
} from "@pierre/diffs/edit";
import { api } from "../../../lib/api";

const keymap: EditorKeymap = [
  {
    bindings: {
      "cmdOrCtrl+d": "copyLineDown",
      "cmdOrCtrl+r": "openSearchReplacePanel",
      "shift+alt+ArrowUp": "moveLineUp",
      "shift+alt+ArrowDown": "moveLineDown",
    },
  },
];

/** Pierre's editor with a longer undo history, Relay's extra keys and the app's clipboard. */
export const createEditor: EditorFactory<undefined, undefined> = (
  type,
  options,
) =>
  new Editor(type, {
    ...options,
    historyMaxEntries: 200,
    keymap,
    clipboard: { readText: (type) => (type ? "" : api.readClipboard()) },
  });
