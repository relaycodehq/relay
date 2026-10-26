// What a read printed, taken back to the file's own lines, so it can open
// highlighted in the file's language beside the file's line numbers. Claude's
// Read and `nl -ba` number every line; `sed -n 115,135p` starts at 115.
import { callActions } from "./call-actions";
import type { AgentActivity } from "./projects";

export type ReadCode = { file: string; code: string; first?: number };

/** A line `cat -n` style: its number, a tab (an arrow in older Claude Code), then the line. */
const numberedLine = /^\s*(\d+)(?:\t|→)(.*)$/;

/** Commands that number what they print: `nl`, `cat -n`. Any other output's leading numbers are the file's own. */
const numbersItsLines = /(?:^|[\s;&|('"])(?:nl\s|cat\s+-[A-Za-z]*n)/;

/** The file a call read and the lines it printed; none for a call that read several, or failed. */
export function readCode(call: AgentActivity): ReadCode | undefined {
  if (!call.detail || call.status === "failed") return undefined;
  const actions = callActions(call);
  const read = actions.length === 1 ? actions[0] : undefined;
  if (read?.kind !== "read") return undefined;
  const lines = call.detail.replace(/\n$/, "").split("\n");
  const numbered = numberedRun(lines);
  // Claude's Read always numbers its lines; a command's output only when the command numbers them and most of it is.
  const numberedByCommand = numbersItsLines.test(call.label) && numbered.length * 2 >= lines.length;
  const isNumbered = numbered.length > 0 && (call.kind === "read" || numberedByCommand);
  if (isNumbered) return { file: read.file, code: numbered.map((l) => l.text).join("\n"), first: numbered[0]!.n };
  const first = rangeStart(lines, read.lines);
  return { file: read.file, code: lines.join("\n"), ...(first ? { first } : {}) };
}

/**
 * The longest run of numbered lines counting up from the top. Output kept from
 * its end may start mid-line, so the run can start on the second line; it
 * stops where something was appended after the file, like a reminder.
 */
function numberedRun(lines: string[]) {
  const runFrom = (start: number) => {
    const run: { n: number; text: string }[] = [];
    for (const line of lines.slice(start)) {
      const found = numberedLine.exec(line);
      if (!found || (run.length && Number(found[1]) !== run.at(-1)!.n + 1)) break;
      run.push({ n: Number(found[1]), text: found[2]! });
    }
    return run;
  };
  const fromTop = runFrom(0);
  const fromSecond = runFrom(1);
  return fromSecond.length > fromTop.length ? fromSecond : fromTop;
}

/** Where `sed -n 115,135p` started, when it printed every line it asked for; output cut short has fewer. */
function rangeStart(lines: string[], range: string | undefined) {
  const [from, to] = (range ?? "").split("–").map(Number);
  return from && to && lines.length === to - from + 1 ? from : undefined;
}
