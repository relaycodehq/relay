import { expect, it } from "vitest";
import { listRows } from "./search-select-rows";

const branches = (n: number, folded = false) =>
  Array.from({ length: n }, (_, i) => ({
    value: `${folded ? "merged" : "branch"}-${i}`,
    group: folded ? "Merged" : "Branches",
    folded,
  }));

it("opens the merged fold past the limit instead of listing nothing", () => {
  const options = [...branches(150), ...branches(3, true)];
  const shut = listRows(options, { foldOpen: false, limit: 100 });
  expect(shut.groups.get("Branches")).toHaveLength(100);
  expect(shut.groups.has("Merged")).toBe(false);
  const open = listRows(options, { foldOpen: true, limit: 100 });
  expect(open.groups.get("Merged")).toHaveLength(3);
  expect(open.over).toBe(50);
});

it("keeps the picked row past the limit", () => {
  const { groups } = listRows(branches(150), {
    foldOpen: false,
    limit: 100,
    value: "branch-140",
  });
  expect(groups.get("Branches")?.at(-1)?.value).toBe("branch-140");
});
