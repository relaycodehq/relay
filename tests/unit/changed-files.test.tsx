import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { ChangedFilesCard } from "../../src/components/ChangedFilesCard";
import {
  buildTurnTree,
  compactCount,
  sumStats,
} from "../../src/lib/turn-diff-tree";

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
  expect(sumStats(files)).toEqual({ additions: 48, deletions: 14 });
  expect(compactCount(999)).toBe("999");
  expect(compactCount(1234)).toBe("1.2k");
  expect(compactCount(45_000)).toBe("45k");
});

it("renders the card header, folders and file rows like T3", () => {
  const many = [
    ...files,
    { path: "docs/a.md", additions: 1, deletions: 0 },
    { path: "docs/b.md", additions: 1, deletions: 0 },
  ];
  const collapsed = renderToStaticMarkup(
    <ChangedFilesCard files={many} onOpen={() => {}} />,
  );
  expect(collapsed).toContain("7 changed files");
  expect(collapsed).toContain(">+50<");
  expect(collapsed).toContain(">−14<");
  expect(collapsed).toContain("Open diff");
  expect(collapsed).toContain('aria-label="Expand all folders"');
  // Over five files, folders start closed.
  expect(collapsed).not.toContain(">ui.tsx<");
  expect(collapsed).toContain(">logo.png<");
  expect(collapsed).toContain(">binary<");

  const open = renderToStaticMarkup(
    <ChangedFilesCard files={files.slice(0, 2)} onOpen={() => {}} />,
  );
  expect(open).toContain("2 changed files");
  expect(open).toContain(">ui.tsx<");
  expect(open).toContain('href="#file-tree-builtin-react"');
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

it("lists changes the agent can't be shown to have made apart, outside the turn's rollback", () => {
  const html = renderToStaticMarkup(
    <ChangedFilesCard
      files={[
        { path: "src/guard.ts", additions: 1, deletions: 0 },
        { path: "notes.md", additions: 2, deletions: 0, unclaimed: true },
      ]}
      onOpen={() => {}}
      onRewind={async () => ({ conflicts: [] })}
    />,
  );
  expect(html).toContain("1 changed file<");
  expect(html).toContain("Also changed during this turn");
  expect(html).toMatch(/changed-files-others[\s\S]*notes\.md/);
  // With nothing of the agent's own, only the folded list shows.
  const theirs = renderToStaticMarkup(
    <ChangedFilesCard
      files={[
        { path: "notes.md", additions: 2, deletions: 0, unclaimed: true },
      ]}
      onOpen={() => {}}
      onRewind={async () => ({ conflicts: [] })}
    />,
  );
  expect(theirs).not.toContain("changed file");
  expect(theirs).toContain("Also changed during this turn");
});
