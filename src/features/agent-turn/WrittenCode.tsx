// What a call wrote, opened under its row: a new file whole, an edit as the
// lines it changed, highlighted in the file's own language.
import type { ThemedToken } from "@pierre/diffs";
import { diffArrays } from "diff";
import type { WrittenCode as Written } from "../../../shared/projects";
import { Line, useLines, type Mark } from "./CodeLines";

function Whole({ path, content }: { path: string; content: string }) {
  const lines = useLines(path, content);
  return (
    <>
      {lines.map((tokens, index) => (
        <Line key={index} tokens={tokens} gutter={index + 1} />
      ))}
    </>
  );
}

const gutters: Record<Mark, string> = { removed: "−", added: "+", same: "" };

/** One swapped passage, line by line: only what changed is tinted, the rest is context. */
function Swap({ path, edit }: { path: string; edit: { old: string; new: string } }) {
  const before = useLines(path, edit.old);
  const after = useLines(path, edit.new);
  const rows: { tokens: ThemedToken[]; mark: Mark }[] = [];
  let old = 0;
  let next = 0;
  for (const part of diffArrays(edit.old.split("\n"), edit.new.split("\n")))
    for (let i = 0; i < part.value.length; i++) {
      if (part.removed) rows.push({ tokens: before[old++] ?? [], mark: "removed" });
      else if (part.added) rows.push({ tokens: after[next++] ?? [], mark: "added" });
      else {
        rows.push({ tokens: after[next++] ?? [], mark: "same" });
        old++;
      }
    }
  return (
    <div className="written-hunk">
      {rows.map((row, index) => (
        <Line key={index} tokens={row.tokens} gutter={gutters[row.mark]} mark={row.mark} />
      ))}
    </div>
  );
}

function markOf(line: string): Mark {
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "same";
}

/** A unified diff's lines, tinted by their sign and highlighted as one file. */
/** A diff's lines from its first hunk on; none when it has no hunks, as an added file's whole content. */
function hunkLines(diff: string) {
  const lines = diff.split("\n");
  const first = lines.findIndex((line) => line.startsWith("@@"));
  return first === -1 ? undefined : lines.slice(first);
}

function Patch({ path, diff }: { path: string; diff: string }) {
  const lines = hunkLines(diff);
  const tokens = useLines(path, (lines ?? []).map((line) => line.slice(1)).join("\n"));
  if (!lines) return <Whole path={path} content={diff} />;
  return (
    <div className="written-hunk">
      {lines.map((line, index) => {
        if (line.startsWith("@@")) return <div key={index} className="written-line hunk-head">{line}</div>;
        const mark = markOf(line);
        return <Line key={index} tokens={tokens[index] ?? []} gutter={gutters[mark]} mark={mark} />;
      })}
    </div>
  );
}

/** Past the limit before any of it fit: only the path is left. */
function keptNothing(file: Written) {
  if (!file.cut) return false;
  switch (file.kind) {
    case "whole":
      return !file.content;
    case "patch":
      return !file.diff;
    case "swap":
      return file.edits.every((e) => !e.old && !e.new);
  }
}

/** "+17 −2" for an edit, "24 lines" for a file written whole. */
function size(file: Written) {
  if (keptNothing(file)) return "too long to keep";
  if (file.kind === "whole") return `${file.content.split("\n").length} lines`;
  if (file.kind === "patch" && !hunkLines(file.diff)) return `${file.diff.split("\n").length} lines`;
  const changed =
    file.kind === "swap"
      ? file.edits.flatMap((e) => diffArrays(e.old.split("\n"), e.new.split("\n")))
      : (hunkLines(file.diff) ?? []).map((line) => ({
          added: line.startsWith("+"),
          removed: line.startsWith("-"),
          value: [line],
        }));
  const count = (side: "added" | "removed") =>
    changed.reduce((sum, part) => sum + (part[side] ? part.value.length : 0), 0);
  return `+${count("added")} −${count("removed")}`;
}

export function WrittenCode({ file, shownPath }: { file: Written; shownPath: string }) {
  return (
    <div className="written-code">
      <div className="written-head">
        <span>{shownPath}</span>
        <span>{size(file)}</span>
      </div>
      {!keptNothing(file) && (
      <pre className="written-body">
        {file.kind === "whole" && <Whole path={file.path} content={file.content} />}
        {file.kind === "swap" && file.edits.map((edit, index) => <Swap key={index} path={file.path} edit={edit} />)}
        {file.kind === "patch" && <Patch path={file.path} diff={file.diff} />}
        {file.cut && <div className="written-cut">Cut here: the rest was too long to keep</div>}
      </pre>
      )}
    </div>
  );
}
