import { expect, it } from "vitest";
import { LineBuffer } from "./line-buffer";

it("joins lines split across chunks and keeps the unfinished end", () => {
  const lines: string[] = [];
  const buffer = new LineBuffer((line) => void lines.push(line));
  buffer.push('{"a":');
  buffer.push('1}\n\n{"b"');
  expect(lines).toEqual(['{"a":1}', ""]);
  expect(buffer.pending).toBe(4);
  buffer.push(":2}\nlast");
  buffer.flush();
  expect(lines).toEqual(['{"a":1}', "", '{"b":2}', "last"]);
});

it("stops at the line that says so", () => {
  const lines: string[] = [];
  const buffer = new LineBuffer((line) => {
    lines.push(line);
    return line !== "stop";
  });
  buffer.push("a\nstop\nb\n");
  expect(lines).toEqual(["a", "stop"]);
});
