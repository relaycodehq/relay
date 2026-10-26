// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { undo, history } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

vi.mock("../../lib/api", () => ({
  api: {
    projectFile: vi.fn(async (_where: string, path: string) => ({
      path,
      branch: "main",
      head: "abc",
      version: "v1",
      contents: "one\ntwo\n",
      original: "one\ntwo\n",
    })),
    localHistoryRecord: vi.fn(async () => null),
  },
}));

const { documents } = await import("./documents");

const views: EditorView[] = [];

const viewOf = (doc: ReturnType<typeof documents.get>) => {
  const view = new EditorView({
    parent: document.body,
    dispatchTransactions: (trs, view) => {
      view.update(trs);
      doc.viewUpdated(view, trs);
    },
  });
  views.push(view);
  doc.attach(view);
  return view;
};

afterEach(() => views.splice(0).forEach((v) => v.destroy()));

it("keeps two views of one file in step, and the file's state with the first", async () => {
  const source = { kind: "project" as const, where: "w" };
  const doc = documents.get(source, "a.txt", () => history());
  await vi.waitFor(() => expect(doc.state).toBeDefined());
  const left = viewOf(doc);
  const right = viewOf(doc);
  expect(right.state.sliceDoc()).toBe("one\ntwo\n");

  right.dispatch({ changes: { from: 0, insert: "zero\n" }, userEvent: "input" });
  expect(left.state.sliceDoc()).toBe("zero\none\ntwo\n");
  expect(doc.text()).toBe("zero\none\ntwo\n");
  expect(doc.status.dirty).toBe(true);

  left.dispatch({ changes: { from: left.state.doc.length, insert: "three\n" }, userEvent: "input" });
  expect(right.state.sliceDoc()).toBe("zero\none\ntwo\nthree\n");
  // Each view undoes its own edits, and the other follows.
  undo(right);
  expect(left.state.sliceDoc()).toBe("one\ntwo\nthree\n");

  // The first view going leaves the document with the other's state.
  doc.detach(left);
  right.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input" });
  expect(doc.text()).toBe("xone\ntwo\nthree\n");
  doc.detach(right);
  documents.close(source, "a.txt", true);
});
