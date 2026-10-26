// What a read printed, opened under its row like a written file: the file's
// own lines, highlighted, beside their line numbers when the output says them.
// No heading: the row above already names the file and the lines.
import type { CSSProperties } from "react";
import type { ReadCode as Read } from "../../../../shared/read-code";
import { Line, useLines } from "./CodeLines";

export function ReadCode({ read }: { read: Read }) {
  const lines = useLines(read.file, read.code);
  const last = (read.first ?? 0) + lines.length;
  // Room for the widest number, so lines past 999 don't push their code over.
  const gutter = { "--gutter-digits": String(last).length } as CSSProperties;
  return (
    <div className="written-code">
      <pre className="written-body" style={gutter}>
        {lines.map((tokens, index) => (
          <Line key={index} tokens={tokens} gutter={read.first ? read.first + index : ""} />
        ))}
      </pre>
    </div>
  );
}
