import { describe, expect, it } from "vitest";
import { programName } from "./activity-labels";

describe("programName", () => {
  it("names the first real program in a command line", () => {
    expect(
      programName("ps -Ao pid,etime,command | grep -E 'a|b' | cut -c1-250"),
    ).toBe("ps");
    expect(programName("cd /repo && npx vitest run tests/unit")).toBe("vitest");
    expect(programName("FOO=1 sudo /usr/bin/rg -n foo src")).toBe("rg");
    expect(programName("export A=1; ./scripts/build.sh")).toBe("build.sh");
  });

  it("unwraps quotes and parentheses around the program", () => {
    expect(programName(`("rg" -n foo)`)).toBe("rg");
    expect(programName(`)(`)).toBe(")(");
  });

  it("reads a word with a long run of closing parentheses in linear time", () => {
    const command = ")".repeat(20_000) + "x";
    const started = performance.now();
    programName(command);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("looks inside Codex's shell wrapper", () => {
    expect(programName(`/bin/zsh -lc 'sed -n 1,80p electron/main.ts'`)).toBe(
      "sed",
    );
    expect(programName(`bash -c "cd app && git status"`)).toBe("git");
  });

  it("looks inside the PowerShell Codex runs on Windows", () => {
    const powershell = String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command`;
    expect(programName(`${powershell} "$env:UE_TIMEOUT='120000'; node unreal/Tools/dev/ue.mjs"`)).toBe("node");
    expect(programName(`${powershell} "C:\\tools\\rg.exe -n foo"`)).toBe("rg.exe");
  });

  it("reads through loops and conditionals to the command they run", () => {
    expect(programName("cd /repo && for f in a b; do wc -l $f; done")).toBe(
      "wc",
    );
    expect(programName("if [ -f x ]; then cat x; fi")).toBe("cat");
    expect(programName("while read line; do echo $line; done < f")).toBe(
      "read",
    );
  });

  it("gives up on a line with nothing but setup", () => {
    expect(programName("cd /repo")).toBeUndefined();
  });
});
