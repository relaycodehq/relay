import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { buildTurnTree, compactCount } from "./turn-diff-tree";

const files = [
  { path: "src/components/ui.tsx", additions: 40, deletions: 10 },
  { path: "src/components/AgentTurn.tsx", additions: 5, deletions: 0 },
  { path: "electron/rooms/claude.ts", additions: 2, deletions: 3 },
  { path: "README.md", additions: 1, deletions: 1 },
  { path: "logo.png", additions: 0, deletions: 0, binary: true },
];

it("builds a folder tree with totals and merged single-child folders", () => {
  const tree = buildTurnTree(files);
  expect(tree.map((n) => [n.kind, n.name])).toEqual([
    ["directory", "electron/rooms"],
    ["directory", "src/components"],
    ["file", "logo.png"],
    ["file", "README.md"],
  ]);
  const src = tree[1]!;
  expect(src.kind === "directory" && src.stat).toEqual({
    additions: 45,
    deletions: 10,
  });
  expect(src.kind === "directory" && src.children.map((n) => n.name)).toEqual([
    "AgentTurn.tsx",
    "ui.tsx",
  ]);
  expect(compactCount(999)).toBe("999");
  expect(compactCount(1234)).toBe("1.2k");
  expect(compactCount(45_000)).toBe("45k");
});

it("renders the card header, folders and file rows", () => {
  const many = [
    ...files,
    { path: "docs/a.md", additions: 1, deletions: 0 },
    { path: "docs/b.md", additions: 1, deletions: 0 },
  ];
  const long = renderToStaticMarkup(
    <ChangedFilesCard files={many} onOpen={() => {}} />,
  );
  expect(long).toContain("7 changed files");
  expect(long).toContain(">+50<");
  expect(long).toContain(">−14<");
  expect(long).toContain("Open diff");
  expect(long).toContain('aria-label="Expand all folders"');
  // Over five files, folders start closed.
  expect(long).not.toContain(">ui.tsx<");
  expect(long).toContain(">logo.png<");
  expect(long).toContain(">binary<");

  const open = renderToStaticMarkup(
    <ChangedFilesCard files={files.slice(0, 2)} onOpen={() => {}} />,
  );
  expect(open).toContain("2 changed files");
  expect(open).toContain(">ui.tsx<");
  expect(open).toContain('href="#file-tree-builtin-react"');

  // Closed, six files in one folder would be a single row.
  const oneFolder = renderToStaticMarkup(
    <ChangedFilesCard
      files={["a", "b", "c", "d", "e", "f"].map((name) => ({
        path: `src/features/x/${name}.ts`,
        additions: 1,
        deletions: 0,
      }))}
      onOpen={() => {}}
    />,
  );
  expect(oneFolder).toContain(">f.ts<");
});

it("offers rollback per row and for the turn, and redo once rolled back", () => {
  const rewind = async () => ({ conflicts: [] });
  const live = renderToStaticMarkup(
    <ChangedFilesCard
      files={files.slice(0, 2)}
      onOpen={() => {}}
      onRewind={rewind}
    />,
  );
  expect(live).toContain(
    'aria-label="Roll back this file to before this turn"',
  );
  expect(live).toContain(
    'aria-label="Roll back this folder to before this turn"',
  );
  expect(live).toContain(">Roll back<");

  const partly = renderToStaticMarkup(
    <ChangedFilesCard
      files={[{ ...files[0]!, revertedBy: "abc" }, files[1]!]}
      onOpen={() => {}}
      onRewind={rewind}
    />,
  );
  expect(partly).toContain("1 rolled back");
  expect(partly).toContain(
    'aria-label="Redo this turn&#x27;s changes to this file"',
  );
  expect(partly).toContain('class="changed-files-item reverted"');

  const all = renderToStaticMarkup(
    <ChangedFilesCard
      files={files.slice(0, 2).map((f) => ({ ...f, revertedBy: "abc" }))}
      onOpen={() => {}}
      onRewind={rewind}
    />,
  );
  expect(all).toContain(">Rolled back<");
  expect(all).toContain(">Redo<");

  // Without a handler, as in the Changes pane, there's nothing to roll back.
  expect(
    renderToStaticMarkup(<ChangedFilesCard files={files} onOpen={() => {}} />),
  ).not.toContain("Roll back");
});
