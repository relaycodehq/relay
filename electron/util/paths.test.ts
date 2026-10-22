import { join } from "node:path";
import { expect, it } from "vitest";
import { within } from "./paths";

it("keeps names that only start with dots inside the folder", () => {
  const root = join("/", "repo");
  expect(within(root, join(root, "..env"))).toBe("..env");
  expect(within(root, join(root, "..cache", "a.ts"))).toBe(
    join("..cache", "a.ts"),
  );
  expect(within(root, root)).toBe("");
  expect(within(root, join("/", "repository"))).toBeNull();
  expect(within(root, "/")).toBeNull();
});
