import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withoutHostPaths } from "./snapshot";

describe("withoutHostPaths", () => {
  it("shows paths in the thread's folder relative to it, and the home folder as ~", () => {
    const root = join(homedir(), "code", "app");
    expect(withoutHostPaths(`read ${join(root, "src/a.ts")}`, root)).toBe(
      "read src/a.ts",
    );
    expect(withoutHostPaths(`cat ${join(homedir(), ".zshrc")}`, root)).toBe(
      "cat ~/.zshrc",
    );
  });

  it("leaves a folder that only starts like the home folder alone", () => {
    const sibling = `${homedir()}ex/notes.md`;
    expect(withoutHostPaths(sibling, null)).toBe(sibling);
  });
});
