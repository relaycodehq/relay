/** Splits text that arrives in chunks into lines, without their newline. */
export class LineBuffer {
  private rest = "";

  /** `line` returning false stops reading this chunk, e.g. once the stream failed. */
  constructor(private line: (text: string) => boolean | void) {}

  push(chunk: string) {
    this.rest += chunk;
    let start = 0;
    let end: number;
    while ((end = this.rest.indexOf("\n", start)) >= 0) {
      const text = this.rest.slice(start, end);
      start = end + 1;
      if (this.line(text) === false) break;
    }
    if (start) this.rest = this.rest.slice(start);
  }

  /** The unfinished line's length. */
  get pending() {
    return this.rest.length;
  }

  /** Hands on what came without a final newline, e.g. an error before an exit. */
  flush() {
    const text = this.rest;
    this.rest = "";
    if (text) this.line(text);
  }

  clear() {
    this.rest = "";
  }
}
