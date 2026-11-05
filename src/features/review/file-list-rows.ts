import type { ChangedFile } from "../../../shared/types";
import type { ChangeGroup } from "../../../shared/triage";

export type Row =
  | { type: "file"; file: ChangedFile; grouped: boolean }
  | { type: "group"; group: ChangeGroup }
  | { type: "label"; text: string }
  | { type: "fold"; count: number };

/**
 * Paths that sit in the Viewed section: viewed files, and complete groups.
 * `settled` says whether a path counts as viewed.
 */
export function foldedPaths(
  files: ChangedFile[],
  groups: ChangeGroup[] | null,
  settled: (path: string) => boolean,
) {
  const result = new Set<string>(),
    grouped = new Set<string>();
  for (const group of groups ?? []) {
    group.paths.forEach((p) => grouped.add(p));
    if (group.paths.every(settled)) group.paths.forEach((p) => result.add(p));
  }
  for (const f of files)
    if (!grouped.has(f.filename) && settled(f.filename)) result.add(f.filename);
  return result;
}

/**
 * The list's rows: what's left to view on top, then the Viewed fold and,
 * while it's open or a filter is typed, what's under it. Without `groups`
 * the files are listed plainly.
 */
export function listRows({
  files,
  groups,
  folded,
  filter,
  open,
  viewedOpen,
}: {
  files: ChangedFile[];
  groups: ChangeGroup[] | null;
  folded: Set<string>;
  filter: string;
  /** Groups expanded to show their files. */
  open: Set<string>;
  viewedOpen: boolean;
}): Row[] {
  const matches = (f: ChangedFile) =>
    f.filename.toLowerCase().includes(filter.toLowerCase());
  const fileRow = (file: ChangedFile, grouped: boolean): Row => ({
    type: "file",
    file,
    grouped,
  });
  const top: Row[] = [],
    bottom: Row[] = [];
  let count = 0;
  if (!groups)
    for (const file of files.filter(matches)) {
      const done = folded.has(file.filename);
      (done ? bottom : top).push(fileRow(file, false));
      if (done) count++;
    }
  else {
    const grouped = new Set(groups.flatMap((g) => g.paths)),
      byPath = new Map(files.map((f) => [f.filename, f]));
    for (const group of groups) {
      const members = group.paths
        .map((p) => byPath.get(p))
        .filter((f): f is ChangedFile => !!f && matches(f));
      if (!members.length) continue;
      const done = group.paths.every((p) => folded.has(p)),
        section = done ? bottom : top;
      if (done) count += members.length;
      section.push({ type: "group", group });
      if (open.has(group.id) || filter)
        section.push(...members.map((file) => fileRow(file, true)));
    }
    const normal = files.filter((f) => !grouped.has(f.filename) && matches(f));
    const unviewed = normal.filter((f) => !folded.has(f.filename)),
      viewed = normal.filter((f) => folded.has(f.filename));
    if (unviewed.length)
      top.push(
        { type: "label", text: `Individual changes · ${unviewed.length}` },
        ...unviewed.map((file) => fileRow(file, false)),
      );
    bottom.push(...viewed.map((file) => fileRow(file, false)));
    count += viewed.length;
  }
  if (!bottom.length) return top;
  return [
    ...top,
    { type: "fold", count } as Row,
    ...(viewedOpen || filter ? bottom : []),
  ];
}

const rowHeights: Record<Row["type"], number> = {
  group: 77,
  label: 33,
  fold: 40,
  file: 49,
};

/** The height the virtual list reserves for a row before it's measured. */
export const rowHeight = (row: Row) => rowHeights[row.type];

/** A key that stays with the row as rows above it come and go. */
export function rowKey(row: Row) {
  switch (row.type) {
    case "file":
      return row.file.filename;
    case "group":
      return row.group.id;
    case "fold":
      return "viewed-fold";
    case "label":
      return "individual-label";
  }
}
