import { describe, expect, it } from "vitest";
import { permissionRules, type PermissionRule } from "./permissions";

/** OpenCode's own reading of its rules: the last one that matches wins, `*` spans slashes. */
function decide(rules: PermissionRule[], permission: string, target: string) {
  const matches = (glob: string, value: string) =>
    new RegExp(
      `^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
    ).test(value);
  return rules.findLast(
    (r) => matches(r.permission, permission) && matches(r.pattern, target),
  )?.action;
}

const links = [
  { path: "/w/api", access: "read" as const },
  { path: "/w/types", access: "write" as const },
];

describe("linked folders under OpenCode", () => {
  it("reaches linked folders without asking, and asks before editing a read-only one", () => {
    const rules = permissionRules("auto-accept-edits", {
      cwd: "/w/web",
      links,
    });
    expect(decide(rules, "external_directory", "/w/api/*")).toBe("allow");
    expect(decide(rules, "external_directory", "/w/other/*")).toBe("ask");
    // OpenCode names an edited file from the project, or by its full path.
    expect(decide(rules, "edit", "../api/src/main.ts")).toBe("ask");
    expect(decide(rules, "edit", "/w/api/src/main.ts")).toBe("ask");
    expect(decide(rules, "edit", "../types/index.ts")).toBe("allow");
    expect(decide(rules, "edit", "src/app.ts")).toBe("allow");
  });

  it("keeps a reviewer from editing anywhere", () => {
    const rules = permissionRules("full-access", {
      readOnly: true,
      cwd: "/w/web",
      links,
    });
    expect(decide(rules, "external_directory", "/w/api/*")).toBe("allow");
    expect(decide(rules, "edit", "../api/src/main.ts")).toBe("deny");
    expect(decide(rules, "edit", "../types/index.ts")).toBe("deny");
  });

  it("adds nothing to full access or a title job", () => {
    expect(permissionRules("full-access", { links })).toEqual(
      permissionRules("full-access", {}),
    );
    expect(permissionRules(undefined, { title: true, links })).toEqual(
      permissionRules(undefined, { title: true }),
    );
  });
});
