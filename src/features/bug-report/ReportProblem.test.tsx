// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  BugReportFields,
  BugReportPreview,
} from "../../../shared/bug-report";
import { ReportProblem } from "./ReportProblem";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  discard: vi.fn(),
  onReport: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  api: {
    openBugReport: mocks.open,
    saveBugReport: mocks.save,
    discardBugReport: mocks.discard,
    onBugReport: mocks.onReport,
  },
}));
vi.mock("./ReportScreenshots", () => ({ ReportScreenshots: () => null }));
vi.mock("./ReportRecording", () => ({ ReportRecording: () => null }));
vi.mock("./ReportIncluded", () => ({ ReportIncluded: () => null }));
vi.mock("./ReportTidyUp", () => ({ ReportTidyUp: () => null }));
vi.mock("./ReportPreview", () => ({ ReportPreview: () => null }));
vi.mock("../../ui/ui", () => ({
  ErrorBox: ({ error }: { error: unknown }) => (
    <div role="alert">{String(error)}</div>
  ),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function preview(id: string, title = ""): BugReportPreview {
  return {
    draft: {
      id,
      kind: "bug",
      title,
      description: "description",
      occasion: { kind: "asked" },
      includeLog: true,
      removedFacts: [],
      screenshots: [],
      updatedAt: 1,
    },
    title: title || "Problem report",
    body: "",
    facts: [],
    log: { included: 0, total: 0, size: 0, text: "" },
    destination: {
      repo: "o/r",
      url: "https://github.com/o/r/issues",
      visibility: "public",
    },
    writer: {
      provider: "codex",
      choice: { model: "", fast: false, reasoningEffort: "low" },
    },
    account: null,
    via: "browser",
    dragFiles: [],
    digest: "digest",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
let changed: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.open.mockResolvedValue(preview("old"));
  mocks.save.mockImplementation(
    async (id: string, fields: BugReportFields) => ({
      ...preview(id),
      draft: { ...preview(id).draft, ...fields },
    }),
  );
  mocks.onReport.mockImplementation((cb: () => void) => {
    changed = cb;
    return () => {};
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
async function render() {
  await act(async () => root.render(<ReportProblem />));
}
async function title(value: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function tick() {
  await act(async () => vi.advanceTimersByTimeAsync(350));
}
async function discard() {
  const click = () =>
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Discard")!
      .click();
  await act(async () => click());
  await act(async () => click());
}

it("keeps the replacement's first edit saving when the old draft's save finishes late", async () => {
  const old = deferred<BugReportPreview>();
  mocks.save.mockImplementationOnce(() => old.promise);
  mocks.discard.mockResolvedValue(preview("new"));
  await render();
  await title("old edit");
  await tick();
  expect(mocks.save).toHaveBeenCalledWith(
    "old",
    expect.objectContaining({ title: "old edit" }),
  );
  await discard();
  await act(async () => old.resolve(preview("old", "old edit")));
  expect(container.querySelector("input")!.value).toBe("");
  await title("new edit");
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(
    "new",
    expect.objectContaining({ title: "new edit" }),
  );
  expect(mocks.save).toHaveBeenCalledTimes(2);
});

it("ignores errors and revision counts from a draft replaced by an agent", async () => {
  const old = deferred<BugReportPreview>();
  mocks.save.mockImplementationOnce(() => old.promise);
  await render();
  await title("old edit");
  await tick();
  mocks.open.mockResolvedValue(preview("agent", "agent title"));
  await act(async () => changed());
  await act(async () => old.reject(new Error("old failure")));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("input")!.value).toBe("agent title");
  await title("agent edit");
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(
    "agent",
    expect.objectContaining({ title: "agent edit" }),
  );
});

it("ignores an older open response after a replacement notification", async () => {
  const first = deferred<BugReportPreview>();
  mocks.open
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(preview("agent", "agent title"));
  await render();
  await act(async () => changed());
  await act(async () => first.resolve(preview("old", "old title")));
  expect(container.querySelector("input")!.value).toBe("agent title");
});

it("flushes unsaved keystrokes on unmount, bound to their draft", async () => {
  const save = deferred<BugReportPreview>();
  mocks.save.mockReturnValue(save.promise);
  await render();
  await title("last edit");
  await act(async () => root.unmount());
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledWith(
    "old",
    expect.objectContaining({ title: "last edit" }),
  );
  await act(async () => save.resolve(preview("old", "last edit")));
  await tick();
  expect(mocks.save).toHaveBeenCalledOnce();
});

it("defers replacement notifications while discard is pending", async () => {
  const fresh = deferred<BugReportPreview>();
  mocks.discard.mockReturnValue(fresh.promise);
  await render();
  await discard();
  expect(container.querySelector("input")!.disabled).toBe(true);
  mocks.open.mockResolvedValue(preview("agent", "agent after discard"));
  await act(async () => changed());
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(container.querySelector("input")!.disabled).toBe(true);
  await act(async () => fresh.resolve(preview("new")));
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(container.querySelector("input")!.value).toBe("agent after discard");
  await title("replacement edit");
  await tick();
  expect(mocks.save).toHaveBeenLastCalledWith(
    "agent",
    expect.objectContaining({ title: "replacement edit" }),
  );
});
