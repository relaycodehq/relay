/**
 * A subagent's run, cut down to what a check needs to judge it: its brief,
 * what it said, every call it made, failures, and its edits in full, since
 * a weakened test only shows in the diff.
 */

type Entry =
  | { kind: "said"; text: string }
  | { kind: "call"; text: string }
  | { kind: "failed"; text: string }
  | { kind: "edit"; text: string };

const cap = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}… [cut]`;

const limits = {
  brief: 1500,
  said: 600,
  call: 200,
  failed: 400,
  edit: 2500,
  /** The whole digest; the oldest non-edits go first past it. */
  total: 14000,
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** An edit as a small diff: what went, what came. */
function editText(name: string, input: Record<string, unknown>) {
  const file = str(input.file_path) || str(input.notebook_path) || "a file";
  const pair = (from: string, to: string) =>
    [
      ...from.split("\n").map((l) => `- ${l}`),
      ...to.split("\n").map((l) => `+ ${l}`),
    ].join("\n");
  if (name === "Write") return `${file} (written whole)\n${str(input.content)}`;
  if (name === "MultiEdit" && Array.isArray(input.edits))
    return `${file}\n${(input.edits as Record<string, unknown>[])
      .map((e) => pair(str(e.old_string), str(e.new_string)))
      .join("\n...\n")}`;
  if (name === "NotebookEdit") return `${file}\n${str(input.new_source)}`;
  return `${file}\n${pair(str(input.old_string), str(input.new_string))}`;
}

const editTools = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/** One line for a call: its tool and the input that says what it did. */
function callText(name: string, input: Record<string, unknown>) {
  const what =
    str(input.command) ||
    str(input.file_path) ||
    str(input.pattern) ||
    str(input.url) ||
    str(input.description) ||
    str(input.query);
  return what ? `${name}: ${what}` : name;
}

export class SubagentLog {
  private entries: Entry[] = [];
  /** Entries seen by the last check; a check needs something new. */
  private checked = 0;
  constructor(
    readonly id: string,
    readonly label: string,
    private brief: string,
  ) {}

  said(text: string) {
    if (text.trim()) this.entries.push({ kind: "said", text });
  }
  called(name: string, input: unknown) {
    const args = (input ?? {}) as Record<string, unknown>;
    this.entries.push(
      editTools.has(name)
        ? { kind: "edit", text: editText(name, args) }
        : { kind: "call", text: callText(name, args) },
    );
  }
  failed(output: string) {
    this.entries.push({ kind: "failed", text: output });
  }

  /** Calls and edits since the last check. */
  get fresh() {
    return this.entries.length - this.checked;
  }

  digest() {
    this.checked = this.entries.length;
    const lines = this.entries.map((e) =>
      e.kind === "said"
        ? `It said: ${cap(e.text, limits.said)}`
        : e.kind === "call"
          ? `Call: ${cap(e.text, limits.call)}`
          : e.kind === "failed"
            ? `Failed: ${cap(e.text, limits.failed)}`
            : `Edit: ${cap(e.text, limits.edit)}`,
    );
    const head = `Its brief: ${cap(this.brief, limits.brief)}`;
    let size = head.length + lines.reduce((n, l) => n + l.length + 1, 0);
    for (let i = 0; size > limits.total && i < lines.length; i++)
      if (this.entries[i].kind !== "edit") {
        size -= lines[i].length;
        lines[i] = "";
      }
    const kept = lines.filter(Boolean);
    const dropped = lines.length - kept.length;
    return [
      head,
      ...(dropped ? [`(${dropped} earlier steps left out)`] : []),
      ...kept,
    ].join("\n");
  }
}
