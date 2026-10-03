// The order a review goes through a PR's files: grouped files first, as the
// analysis grouped them, then the rest in the repository's order.
import type { ChangedFile } from "../../../shared/types";
import type { ChangeGroup } from "../../../shared/triage";

/** Groups without `excluded` files, which leaves only those still grouping two or more. */
export const openGroups = (groups: ChangeGroup[], excluded: Set<string>) =>
  groups
    .map((group) => ({
      ...group,
      paths: group.paths.filter((path) => !excluded.has(path)),
    }))
    .filter((group) => group.paths.length >= 2);

/**
 * The sidebar and keyboard navigation share this order, including files in
 * collapsed groups. The flat view keeps the repository's order.
 */
export function reviewOrder(
  files: ChangedFile[],
  groups: ChangeGroup[],
  plain: boolean,
) {
  if (plain || !groups.length) return files;
  const byPath = new Map(files.map((entry) => [entry.filename, entry]));
  const grouped = groups.flatMap((group) => group.paths);
  const groupedPaths = new Set(grouped);
  return [
    ...grouped.flatMap((path) => {
      const entry = byPath.get(path);
      return entry ? [entry] : [];
    }),
    ...files.filter((entry) => !groupedPaths.has(entry.filename)),
  ];
}
