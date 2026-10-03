// The Files pane on a sample project kept in memory: tree, folder grid, picture
// viewer, editor, rename, create and trash. Nothing here touches the disk.
// Open http://127.0.0.1:5177/previews/files/
import "../_shared/desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../../src/app/projects.css";
import "../../src/ui/workspace-panes.css";
import "../../src/features/sidebar/sidebar.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { ProjectFiles } from "../../src/app/ProjectViews";
import {
  NavigationLockProvider,
  useNavigationLockRoot,
} from "../../src/lib/navigation-lock";
import type { ChecksController } from "../../src/features/checks/useProjectChecks";
import type { Project } from "../../shared/projects";
import type { DirEntry } from "../../shared/project-files";

initAppearance();
initWindowFocus();

type Node = { text: string } | { image: string } | { bytes: number };
const swatch = (a: string, b: string, w = 640, h = 420) => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const fill = g.createLinearGradient(0, 0, w, h);
  fill.addColorStop(0, a);
  fill.addColorStop(1, b);
  g.fillStyle = fill;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff55";
  g.fillRect(w * 0.1, h * 0.15, w * 0.5, 22);
  g.fillRect(w * 0.1, h * 0.15 + 40, w * 0.35, 14);
  return canvas.toDataURL("image/png");
};

const files = new Map<string, Node>([
  ["README.md", { text: "# Sample project\n\nThis data is made up.\n" }],
  [".gitignore", { text: "output/\nnode_modules/\n" }],
  ["package.json", { text: '{\n  "name": "sample"\n}\n' }],
  [
    "src/main.ts",
    { text: "export const answer = 42;\nconsole.log(answer);\n" },
  ],
  [
    "src/lib/format.ts",
    { text: "export const pad = (n: number) => String(n).padStart(2, '0');\n" },
  ],
  [
    "docs/logo.svg",
    {
      image:
        "data:image/svg+xml;base64," +
        btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="#6565a9"/></svg>',
        ),
    },
  ],
  ["docs/data.bin", { bytes: 48213 }],
  ...[
    "home",
    "settings",
    "files",
    "history",
    "changes",
    "dark",
    "light",
    "phone",
  ].map((name, i): [string, Node] => [
    `output/redesign/${name}.png`,
    { image: swatch(`hsl(${i * 43} 60% 45%)`, `hsl(${i * 43 + 60} 55% 25%)`) },
  ]),
]);
const dirs = new Set<string>([
  "src",
  "src/lib",
  "docs",
  "output",
  "output/redesign",
  "node_modules",
  "empty",
]);
const ignored = (path: string) =>
  path.startsWith("output") || path.startsWith("node_modules");
const now = Date.now();
const revealed: string[] = [];
const fail = (m: string): never => {
  throw new Error(m);
};
const isDir = (p: string) => p === "" || dirs.has(p);
const parentOf = (p: string) =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const sizeOf = (n: Node) =>
  "text" in n ? n.text.length : "bytes" in n ? n.bytes : 20000;
const mime = (p: string) =>
  ({ png: "image/png", svg: "image/svg+xml" })[p.split(".").pop()!] as
    string | undefined;

const relay = window.relay as unknown as Record<
  string,
  (...a: any[]) => Promise<unknown>
>;
Object.assign(relay, {
  projectWorkingTree: async () => ({
    head: "a".repeat(40),
    branch: "main",
    revision: "1",
    changes: [],
    upstream: null,
    ahead: 0,
    behind: 0,
    pushTarget: null,
    pushUrl: null,
    operation: null,
    lines: { additions: 0, deletions: 0 },
    outgoing: [],
  }),
  projectFiles: async () => [...files.keys()].filter((p) => !ignored(p)).sort(),
  projectDirectory: async (_w: string, dir: string) => {
    if (!isDir(dir)) fail("That folder doesn’t exist.");
    const entries: DirEntry[] = [];
    const seen = new Set<string>();
    for (const d of dirs)
      if (parentOf(d) === dir && !seen.has(d))
        (seen.add(d),
          entries.push({
            name: d.split("/").pop()!,
            kind: "dir",
            size: 0,
            mtime: now - 86400000,
            ignored: ignored(d),
          }));
    for (const [p, n] of files)
      if (parentOf(p) === dir)
        entries.push({
          name: p.split("/").pop()!,
          kind: "file",
          size: sizeOf(n),
          mtime: now - 3600000,
          ignored: ignored(p),
        });
    entries.sort(
      (a, b) =>
        Number(b.kind === "dir") - Number(a.kind === "dir") ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    return { entries, truncated: false };
  },
  projectFileInfo: async (_w: string, path: string) => {
    const n = files.get(path) ?? fail("That is gone from disk.");
    const base = { path, size: sizeOf(n), mtime: now };
    if ("image" in n) return { ...base, kind: "image", mime: mime(path) };
    if ("bytes" in n)
      return {
        ...base,
        kind: "other",
        reason: "Binary files are not supported here.",
      };
    return { ...base, kind: "text" };
  },
  projectFile: async (_w: string, path: string) => {
    const n = files.get(path);
    if (!n || !("text" in n)) fail("This file no longer exists.");
    const text = (n as { text: string }).text;
    return {
      path,
      contents: text,
      original: text,
      version: String(text.length) + path,
      head: "a".repeat(40),
      branch: "main",
    };
  },
  saveProjectFile: async (
    _w: string,
    path: string,
    _h: string,
    _v: string,
    contents: string,
  ) => {
    files.set(path, { text: contents });
    return { version: String(contents.length) + path };
  },
  projectImage: async (_w: string, path: string) =>
    (files.get(path) as { image: string }).image,
  projectThumbnail: async (_w: string, path: string) =>
    (files.get(path) as { image: string }).image,
  createProjectEntry: async (
    _w: string,
    path: string,
    kind: "file" | "dir",
  ) => {
    if (files.has(path) || dirs.has(path))
      fail("Something with that name already exists.");
    if (!isDir(parentOf(path))) fail("That folder doesn’t exist.");
    if (kind === "dir") dirs.add(path);
    else files.set(path, { text: "" });
  },
  renameProjectEntry: async (_w: string, from: string, to: string) => {
    if (files.has(to) || dirs.has(to))
      fail("Something with that name already exists.");
    for (const [p, n] of [...files])
      if (p === from || p.startsWith(from + "/"))
        (files.delete(p), files.set(to + p.slice(from.length), n));
    for (const d of [...dirs])
      if (d === from || d.startsWith(from + "/"))
        (dirs.delete(d), dirs.add(to + d.slice(from.length)));
  },
  trashProjectEntry: async (_w: string, path: string) => {
    for (const p of [...files.keys()])
      if (p === path || p.startsWith(path + "/")) files.delete(p);
    for (const d of [...dirs])
      if (d === path || d.startsWith(path + "/")) dirs.delete(d);
  },
  revealProjectPath: async (_w: string, path: string) => {
    revealed.push(path);
    document.title = `Revealed: ${path || "(root)"}`;
  },
  openProjectPath: async () => {},
  writeClipboard: async () => {},
  writeClipboardImage: async () => {},
});

const project: Project = {
  id: "sample",
  path: "/sample",
  name: "sample-project",
  repository: null,
  added: now,
};
const checks = {
  enabled: false,
  state: undefined,
  info: undefined,
  buffer: async () => {},
} as unknown as ChecksController;
const client = new QueryClient();
(window as any).__revealed = revealed;

function Preview() {
  // The shell owns this in the app; it locks the tree to the file being edited.
  const lock = useNavigationLockRoot(() => {});
  return (
    <NavigationLockProvider value={lock}>
      <div
        style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      >
        <p
          style={{ margin: 0, padding: "6px 12px", fontSize: 11, opacity: 0.7 }}
        >
          Sample data in memory: nothing here touches the disk.
        </p>
        <ProjectFiles
          project={project}
          where="sample"
          checks={checks}
          onViewing={() => {}}
        />
      </div>
    </NavigationLockProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
