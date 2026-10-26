import { expect, it } from "vitest";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import { selectNextOccurrence } from "@codemirror/search";
import { unselectOccurrence } from "./edit-commands";

const run = (
  state: EditorState,
  command: (target: {
    state: EditorState;
    dispatch: (tr: Transaction) => void;
  }) => boolean,
) => {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
};

it("drops the occurrence added last and keeps the first selection", () => {
  let state = EditorState.create({
    doc: "foo foo foo",
    selection: EditorSelection.single(0, 3),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  state = run(state, selectNextOccurrence);
  state = run(state, selectNextOccurrence);
  expect(state.selection.ranges.map((r) => r.from)).toEqual([0, 4, 8]);
  state = run(state, unselectOccurrence);
  expect(state.selection.ranges.map((r) => r.from)).toEqual([0, 4]);
  expect(state.selection.main.from).toBe(0);
});
