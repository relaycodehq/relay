import { describe, expect, it } from "vitest";
import { programName } from "../../shared/activity-labels";

describe("programName", () => {
  it("names the first real program in a command line", () => {
    expect(
      programName("ps -Ao pid,etime,command | grep -E 'a|b' | cut -c1-250"),
    ).toBe("ps");
    expect(programName("cd /repo && npx vitest run tests/unit")).toBe("vitest");
    expect(programName("FOO=1 sudo /usr/bin/rg -n foo src")).toBe("rg");
    expect(programName("export A=1; ./scripts/build.sh")).toBe("build.sh");
  });
  it("looks inside Codex's shell wrapper", () => {
    expect(programName(`/bin/zsh -lc 'sed -n 1,80p electron/main.ts'`)).toBe(
      "sed",
    );
    expect(programName(`bash -c "cd app && git status"`)).toBe("git");
  });
  it("gives up on a line with nothing but setup", () => {
    expect(programName("cd /repo")).toBeUndefined();
  });
});
