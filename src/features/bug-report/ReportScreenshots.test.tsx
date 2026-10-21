// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  BugReportPreview,
  BugReportScreenshot,
} from "../../../shared/bug-report";
import { ReportScreenshots, useScreenshot } from "./ReportScreenshots";
import { ReportPreview } from "./ReportPreview";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  dataUrl: vi.fn(),
  remove: vi.fn(),
  add: vi.fn(),
  image: vi.fn(),
  png: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  api: {
    bugReportScreenshot: mocks.read,
    removeBugReportScreenshot: mocks.remove,
    addBugReportScreenshot: mocks.add,
  },
}));
vi.mock("./report-screenshot", () => ({
  dataUrl: mocks.dataUrl,
  reportImage: mocks.image,
  reportPng: mocks.png,
}));
vi.mock("../images/ImageSketch", () => ({
  SketchEditor: ({
    onClose,
  }: {
    onClose: (
      history: { past: []; present: []; future: [] },
      size: { width: number; height: number },
    ) => void;
  }) => (
    <button
      onClick={() =>
        onClose({ past: [], present: [], future: [] }, { width: 1, height: 1 })
      }
    >
      Keep edited screenshot
    </button>
  ),
}));
vi.mock("../../ui/RichText", () => ({ RichText: () => null }));
vi.mock("../../ui/SettingsCard", () => ({ Segmented: () => null }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const shot = (id: string): BugReportScreenshot => ({
  id,
  name: id,
  bytes: 3,
  width: 1,
  height: 1,
});
const key = (id: string) => ["bug-report-screenshot", id];
function preview(shots: BugReportScreenshot[]): BugReportPreview {
  return {
    draft: {
      id: "report",
      kind: "bug",
      title: "Bug",
      description: "",
      occasion: { kind: "asked" },
      includeLog: false,
      removedFacts: [],
      screenshots: shots,
      updatedAt: 1,
    },
    title: "Bug",
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
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.dataUrl.mockResolvedValue("data:image/png;base64,AQID");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.useRealTimers();
});
function report(shots: BugReportScreenshot[], withPreview = true) {
  return (
    <QueryClientProvider client={client}>
      <ReportScreenshots
        draftId="report"
        screenshots={shots}
        locked={false}
        onChange={(next) => root.render(report(next.draft.screenshots))}
        onError={(error) => {
          throw error;
        }}
      />
      {withPreview && (
        <ReportPreview preview={preview(shots)} updating={false} />
      )}
    </QueryClientProvider>
  );
}
async function render(shots: BugReportScreenshot[], withPreview = true) {
  await act(async () => root.render(report(shots, withPreview)));
  await act(async () => vi.advanceTimersByTimeAsync(1));
}

it("shares one byte load and data URL between the thumbnail and actual preview", async () => {
  await render([shot("one")]);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith("one");
  expect(mocks.dataUrl).toHaveBeenCalledOnce();
  expect(
    container.querySelectorAll('img[src="data:image/png;base64,AQID"]'),
  ).toHaveLength(2);
  await render([shot("one")], false);
  await render([shot("one")]);
  expect(mocks.read).toHaveBeenCalledOnce();
});

it("releases replaced and discarded screenshot ids immediately", async () => {
  await render([shot("old")]);
  expect(client.getQueryData(key("old"))).toBeDefined();
  await render([shot("redacted")]);
  expect(
    client.getQueryCache().find({ queryKey: key("old"), exact: true }),
  ).toBeUndefined();
  expect(client.getQueryData(key("redacted"))).toBeDefined();
  await render([]);
  expect(
    client.getQueryCache().findAll({ queryKey: ["bug-report-screenshot"] }),
  ).toHaveLength(0);
});

it("releases removed shots through the remove action", async () => {
  mocks.remove.mockResolvedValue(preview([]));
  await render([shot("remove")]);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Remove remove"]')!
      .click(),
  );
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("remove");
  expect(client.getQueryData(key("remove"))).toBeUndefined();
  expect(container.querySelectorAll("img")).toHaveLength(0);
});

it("garbage collects screenshot bytes and URLs after the page is closed", async () => {
  await render([shot("one")]);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <span>Other settings</span>
      </QueryClientProvider>,
    ),
  );
  expect(client.getQueryData(key("one"))).toBeDefined();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(
    client.getQueryCache().find({ queryKey: key("one"), exact: true }),
  ).toBeUndefined();
});

it("does not publish a removed screenshot or convert it after a pending read finishes", async () => {
  let finish!: (bytes: Uint8Array) => void;
  mocks.read.mockReturnValueOnce(
    new Promise<Uint8Array>((resolve) => {
      finish = resolve;
    }),
  );
  await render([shot("old")]);
  await render([]);
  await act(async () => finish(new Uint8Array([9])));
  expect(mocks.dataUrl).not.toHaveBeenCalled();
  expect(client.getQueryData(key("old"))).toBeUndefined();
});

it("retries a failed load when reopened without reusing another id's pixels", async () => {
  mocks.read.mockRejectedValueOnce(new Error("temporary read failure"));
  await render([shot("retry")], false);
  expect(container.querySelectorAll("img")).toHaveLength(0);
  await render([shot("retry")]);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(container.querySelectorAll("img")).toHaveLength(2);
  let finish!: (bytes: Uint8Array) => void;
  mocks.read.mockReturnValueOnce(
    new Promise<Uint8Array>((resolve) => {
      finish = resolve;
    }),
  );
  function Selected({ id }: { id: string }) {
    const image = useScreenshot(id);
    return <output>{image?.url ?? "loading"}</output>;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Selected id="retry" />
      </QueryClientProvider>,
    ),
  );
  expect(container.querySelector("output")!.textContent).toBe(
    "data:image/png;base64,AQID",
  );
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Selected id="different" />
      </QueryClientProvider>,
    ),
  );
  expect(container.querySelector("output")!.textContent).toBe("loading");
  await act(async () => finish(new Uint8Array([4])));
});

it("does not attach an old edited image when conversion finishes after its draft is closed", async () => {
  mocks.image.mockResolvedValue({
    id: "image",
    name: "old image",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AQID",
  });
  let finish!: (bytes: Uint8Array) => void;
  mocks.png.mockReturnValue(
    new Promise<Uint8Array>((resolve) => {
      finish = resolve;
    }),
  );
  await render([]);
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.defineProperty(input, "files", {
      value: [new File(["png"], "old.png", { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Keep edited screenshot")!
      .click(),
  );
  expect(mocks.png).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <span>Replacement draft</span>
      </QueryClientProvider>,
    ),
  );
  await act(async () => finish(new Uint8Array([1, 2, 3])));
  expect(mocks.add).not.toHaveBeenCalled();
});

it("binds a converted screenshot to its original draft even before the old editor unmounts", async () => {
  mocks.image.mockResolvedValue({
    id: "image",
    name: "old image",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AQID",
  });
  let finish!: (bytes: Uint8Array) => void;
  mocks.png.mockReturnValue(
    new Promise<Uint8Array>((resolve) => {
      finish = resolve;
    }),
  );
  mocks.add.mockResolvedValue(preview([]));
  await render([]);
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.defineProperty(input, "files", {
      value: [new File(["png"], "old.png", { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Keep edited screenshot")!
      .click(),
  );
  await act(async () => finish(new Uint8Array([1, 2, 3])));
  expect(mocks.add).toHaveBeenCalledExactlyOnceWith(
    "report",
    "old image",
    new Uint8Array([1, 2, 3]),
    undefined,
  );
});
