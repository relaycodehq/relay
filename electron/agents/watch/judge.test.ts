import { describe, expect, it } from "vitest";
import { judgePrompt, parseVerdicts, type JudgedTurn } from "./judge";

const note = (ref: string, action: "told" | "open" = "open") => ({
  ref,
  title: "Failed setup never reruns",
  line: "A failed setup command is marked done and never runs again.",
  points: ["There is **no retry** for it."],
  action,
  read: action === "told",
});

describe("judgePrompt", () => {
  it("puts each note under its answer with what the person did", () => {
    const prompt = judgePrompt([
      { role: "user", body: "Build the setup step." },
      {
        role: "assistant",
        body: "Done.",
        files: ["setup.ts"],
        notes: [note("N1", "told"), note("N2")],
      },
      { role: "user", body: "Add a retry." },
    ]);
    const answer = prompt.indexOf("<assistant>");
    const first = prompt.indexOf('<note id="N1">');
    const next = prompt.indexOf("Add a retry.");
    expect(answer).toBeLessThan(first);
    expect(first).toBeLessThan(next);
    expect(prompt).toContain("(changed: setup.ts)");
    expect(prompt).toContain(
      "sent it to the agent as their next message, after opening its details",
    );
    expect(prompt).toContain("The person left it there.");
  });

  it("shrinks every message rather than dropping the end of a long thread", () => {
    const turns: JudgedTurn[] = Array.from({ length: 80 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      body: `${i} `.padEnd(4000, "x") + `end-${i}`,
    }));
    turns[1].notes = [note("N1")];
    const prompt = judgePrompt(turns);
    expect(prompt.length).toBeLessThan(70_000);
    expect(prompt).toContain("end-79");
    expect(prompt).toContain('<note id="N1">');
  });
});

describe("parseVerdicts", () => {
  it("reads fenced JSON and keeps only the notes it was asked about", () => {
    const verdicts = parseVerdicts(
      'Here you go:\n```json\n[{"note":"N1","worth":"no","later":"agent","why":"The next answer added the retry unprompted."},{"note":"N9","worth":"yes","later":"never","why":"made up"},{"note":"N2","worth":"great","later":"never","why":"bad grade"}]\n```',
      ["N1", "N2"],
    );
    expect([...verdicts]).toEqual([
      [
        "N1",
        {
          worth: "no",
          later: "agent",
          why: "The next answer added the retry unprompted.",
        },
      ],
    ]);
  });

  it("reads a reply that isn't JSON as no verdicts", () => {
    expect(parseVerdicts("I can't grade these.", ["N1"]).size).toBe(0);
  });
});
