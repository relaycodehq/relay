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
    saveProjectFile: vi.fn(async () => ({ version: "v2" })),
    localHistoryRecord: vi.fn(async () => null),
  },
}));

const { api } = await import("../../lib/api");
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

it("drops a disk check that read the file before a save", async () => {
  const source = { kind: "project" as const, where: "w" };
  const doc = documents.get(source, "b.txt", () => history());
  await vi.waitFor(() => expect(doc.state).toBeDefined());
  const view = viewOf(doc);
  view.dispatch({ changes: { from: 0, insert: "zero\n" }, userEvent: "input" });
  let readDone!: () => void;
  vi.mocked(api.projectFile).mockImplementationOnce(async (_where, path) => {
    await new Promise<void>((resolve) => (readDone = resolve));
    return {
      path,
      branch: "main",
      head: "abc",
      version: "v1",
      contents: "one\ntwo\n",
      original: "one\ntwo\n",
    };
  });
  const checked = doc.check();
  expect(await doc.save()).toBe(true);
  readDone();
  await checked;
  expect(doc.text()).toBe("zero\none\ntwo\n");
  doc.detach(view);
  documents.close(source, "b.txt", true);
});

it("keeps unsaved edits when the file moves to another folder", async () => {
  const from = { kind: "project" as const, where: "/old", plain: true };
  const to = { kind: "project" as const, where: "/new", plain: true };
  const doc = documents.get(from, "c.txt", () => history());
  await vi.waitFor(() => expect(doc.state).toBeDefined());
  const view = viewOf(doc);
  view.dispatch({ changes: { from: 0, insert: "zero\n" }, userEvent: "input" });
  documents.rename(from, "c.txt", "c.txt", to);
  expect(documents.find(from, "c.txt")).toBeUndefined();
  expect(documents.find(to, "c.txt")?.text()).toBe("zero\none\ntwo\n");
  doc.detach(view);
  documents.close(to, "c.txt", true);
});

it("shows a file rewritten with other line breaks line by line", async () => {
  const source = { kind: "project" as const, where: "w" };
  const read = (contents: string, version: string) =>
    vi.mocked(api.projectFile).mockImplementationOnce(async (_where, path) => ({
      path,
      branch: "main",
      head: "abc",
      version,
      contents,
      original: "one\ntwo\n",
    }));
  read("one\r\ntwo\r\n", "crlf");
  const doc = documents.get(source, "d.txt", () => history());
  await vi.waitFor(() => expect(doc.state).toBeDefined());
  const view = viewOf(doc);

  read("one\ntwo\nthree\n", "lf");
  await doc.check();
  expect(view.state.doc.lines).toBe(4);
  expect(doc.text()).toBe("one\ntwo\nthree\n");

  // A line typed now ends the way the file's lines do.
  view.dispatch({ changes: { from: view.state.doc.length, insert: view.state.lineBreak } });
  expect(doc.text()).toBe("one\ntwo\nthree\n\n");
  doc.detach(view);
  documents.close(source, "d.txt", true);
});

it("gives pasted text the file's line breaks", async () => {
  const source = { kind: "project" as const, where: "w" };
  vi.mocked(api.projectFile).mockImplementationOnce(async (_where, path) => ({
    path,
    branch: "main",
    head: "abc",
    version: "crlf",
    contents: "one\r\n",
    original: "one\r\n",
  }));
  const doc = documents.get(source, "e.txt", () => history());
  await vi.waitFor(() => expect(doc.state).toBeDefined());
  const view = viewOf(doc);

  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", "two\nthree\n");
  view.contentDOM.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
  );
  expect(doc.text()).toBe("two\r\nthree\r\none\r\n");
  doc.detach(view);
  documents.close(source, "e.txt", true);
});
