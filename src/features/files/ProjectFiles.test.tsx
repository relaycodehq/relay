// @vitest-environment happy-dom
import { act, useEffect, useState, type ButtonHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/projects";
import type { FileInfo } from "../../../shared/project-files";
import type { ChecksController } from "../checks/useProjectChecks";
import { requestChannel } from "../../lib/request-channel";
import type { FilesRequest } from "./file-link-target";
import { ProjectFiles } from "./ProjectFiles";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  files: vi.fn(async () => ["file.txt"]),
  image: vi.fn(async () => "data:image/png;base64,AA=="),
  video: vi.fn(async () => "file:///sample.mp4"),
  directory: vi.fn(async () => ({ entries: [], truncated: false })),
  mounted: vi.fn(),
  unmounted: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  api: {
    projectFileInfo: mocks.info,
    projectFiles: mocks.files,
    projectImage: mocks.image,
    projectVideo: mocks.video,
    projectDirectory: mocks.directory,
  },
}));

vi.mock("../../ui/PaneResizer", () => ({ PaneResizer: () => null }));
vi.mock("./FileTree", () => ({ FileTree: () => null }));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({ getTotalSize: () => 0, getVirtualItems: () => [] }),
}));

vi.mock("../../ui/ui", () => ({
  ErrorBox: () => null,
  Loading: () => null,
  IconButton: ({
    label,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
    <button aria-label={label} {...props} />
  ),
}));

vi.mock("../editor/TextFile", () => ({
  default: function Editor() {
    const [text, setText] = useState("original");
    useEffect(() => {
      mocks.mounted();
      return () => {
        mocks.unmounted();
      };
    }, []);
    return (
      <textarea value={text} onInput={(e) => setText(e.currentTarget.value)} />
    );
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const project: Project = {
  id: "project",
  path: "/project",
  name: "Project",
  repository: null,
  added: 0,
  plain: true,
};

const checks = {} as ChecksController;
const onViewing = () => {};
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let opens: ReturnType<typeof requestChannel<FilesRequest>>;

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  host = document.createElement("div");
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  opens = requestChannel<FilesRequest>();
  mocks.info.mockImplementation(
    async (_where: string, path: string): Promise<FileInfo> => ({
      path,
      kind: path.endsWith(".png")
        ? "image"
        : path.endsWith(".mp4")
          ? "video"
          : "text",
      size: 1,
      mtime: 1,
    }),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  localStorage.clear();
  vi.clearAllMocks();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

async function render(active: boolean) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProjectFiles
          active={active}
          project={project}
          where="project"
          watched={false}
          checks={checks}
          onViewing={onViewing}
          opens={opens}
        />
      </QueryClientProvider>,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(10));
}

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

it.each(["picture.png", "clip.mp4", "/tmp/outside.png"])(
  "pauses hidden media reads and refreshes %s when shown",
  async (path) => {
    await render(true);
    await act(async () =>
      opens.send({ path, outside: path.startsWith("/"), directory: false }),
    );
    await advance(10);
    const payload = path.endsWith(".mp4") ? mocks.video : mocks.image;
    expect(payload).toHaveBeenCalledTimes(1);
    await render(false);
    mocks.info.mockClear();
    payload.mockClear();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["project-file-info"] });
      await client.invalidateQueries({
        queryKey: [path.endsWith(".mp4") ? "project-video" : "project-image"],
      });
    });
    await advance(15_000);
    expect(mocks.info).not.toHaveBeenCalled();
    expect(payload).not.toHaveBeenCalled();
    await render(true);
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(payload).toHaveBeenCalledTimes(1);
  },
);

it("stops hidden file searches and refreshes the list on return", async () => {
  await render(true);
  await act(async () =>
    opens.send({ path: "file", search: "file", directory: false }),
  );
  await advance(10);
  expect(mocks.files).toHaveBeenCalledTimes(1);
  await render(false);
  mocks.files.mockClear();
  await advance(15_000);
  expect(mocks.files).not.toHaveBeenCalled();
  await render(true);
  expect(mocks.files).toHaveBeenCalledTimes(1);
});

it.each(["file.txt", "/tmp/outside.txt"])(
  "keeps an edited %s buffer mounted when the Files tab hides and shows",
  async (path) => {
    await render(true);
    await act(async () =>
      opens.send({ path, outside: path.startsWith("/"), directory: false }),
    );
    await advance(10);
    const editor = host.querySelector("textarea")!;
    expect(editor).not.toBeNull();
    await act(async () => {
      editor.value = "unsaved changes";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render(false);
    await advance(15_000);
    await render(true);
    expect(host.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("unsaved changes");
    expect(mocks.mounted).toHaveBeenCalledTimes(1);
    expect(mocks.unmounted).not.toHaveBeenCalled();
  },
);
