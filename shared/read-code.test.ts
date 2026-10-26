import { describe, expect, it } from "vitest";
import { callActions } from "./call-actions";
import type { AgentActivity } from "./projects";
import { readCode } from "./read-code";

const call = (kind: AgentActivity["kind"], label: string, detail: string, extra: Partial<AgentActivity> = {}) =>
  ({ id: "c", kind, label, detail, status: "complete", ...extra }) as AgentActivity;

describe("readCode", () => {
  it("numbers sed's lines from where it started", () => {
    const read = readCode(call("command", "/bin/zsh -lc 'sed -n 115,117p pages/Player.jsx'", "a\nb\nc\n"));
    expect(read).toEqual({ file: "pages/Player.jsx", code: "a\nb\nc", first: 115 });
  });

  it("leaves sed's lines unnumbered when fewer came back than it asked for", () => {
    expect(readCode(call("command", "sed -n 115,135p pages/Player.jsx", "a\nb\n"))?.first).toBeUndefined();
  });

  it("takes Claude's numbers off its lines and drops what came after the file", () => {
    const detail = "10\tconst a = 1;\n11\t\n12\tconst b = 2;\n\n<system-reminder>\nmalware\n</system-reminder>";
    expect(readCode(call("read", "src/a.ts", detail))).toEqual({
      file: "src/a.ts",
      code: "const a = 1;\n\nconst b = 2;",
      first: 10,
    });
  });

  it("skips a first line the output cap cut in half", () => {
    const detail = "6\tnd of a long line\n117\tnext();\n118\tdone();";
    expect(readCode(call("read", "src/a.ts", detail))).toMatchObject({ code: "next();\ndone();", first: 117 });
  });

  it("reads nl -ba as the file with its numbers", () => {
    const label = "/bin/zsh -lc \"nl -ba electron/main.ts | sed -n '40,41p'\"";
    expect(callActions(call("command", label, ""))).toEqual([{ kind: "read", file: "electron/main.ts", lines: "40–41" }]);
    expect(readCode(call("command", label, "    40\tapp.on();\n    41\tquit();\n"))).toEqual({
      file: "electron/main.ts",
      code: "app.on();\nquit();",
      first: 40,
    });
  });

  it("doesn't take a command's tab-separated output for line numbers", () => {
    const data = "1\tann\n2\tbob\nname\tage\nx\ty\nz\tw";
    expect(readCode(call("command", "cat data.tsv", data))).toEqual({ file: "data.tsv", code: data });
    const ids = "001\tann\n002\tbob\n003\tcam";
    expect(readCode(call("command", "cat data.tsv", ids))).toEqual({ file: "data.tsv", code: ids });
  });

  it("takes cat -n's numbers off", () => {
    expect(readCode(call("command", "cat -n a.ts", "     1\tx\n     2\ty"))).toEqual({ file: "a.ts", code: "x\ny", first: 1 });
  });

  it("shows nothing as code for several files at once or a failed read", () => {
    expect(readCode(call("command", "sed -n 1,2p a.ts; sed -n 1,2p b.ts", "x\ny\nz\nw"))).toBeUndefined();
    expect(readCode(call("command", "cat missing.ts", "No such file", { status: "failed" }))).toBeUndefined();
  });
});
