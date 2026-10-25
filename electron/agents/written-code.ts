// The code a file-writing call put down, read from the agent's own call, so
// its trace row can show it opened. Capped by `writtenLimit`.
import type { WrittenCode } from "../../shared/projects";
import { capWritten, writtenByCommand } from "../../shared/call-actions";

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Claude's Write, Edit and MultiEdit, and the files a Bash heredoc writes. */
export function claudeWritten(name: string, input: Record<string, unknown>): WrittenCode[] {
  const path = text(input.file_path) ?? "";
  switch (name) {
    case "Write":
      return capWritten([{ kind: "whole", path, content: text(input.content) ?? "" }]);
    case "Edit":
      return capWritten([
        { kind: "swap", path, edits: [{ old: text(input.old_string) ?? "", new: text(input.new_string) ?? "" }] },
      ]);
    case "MultiEdit": {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return capWritten([
        {
          kind: "swap",
          path,
          edits: edits.map((e: Record<string, unknown>) => ({ old: text(e?.old_string) ?? "", new: text(e?.new_string) ?? "" })),
        },
      ]);
    }
    case "Bash":
      return writtenByCommand(text(input.command) ?? "");
    default:
      return [];
  }
}

/** A Codex file change: each file with the diff Codex applied. */
export function codexWritten(changes: unknown[]): WrittenCode[] {
  return capWritten(
    changes.flatMap((change) => {
      const c = change as Record<string, unknown> | null;
      const path = text(c?.path);
      const diff = text(c?.diff);
      return path && diff ? [{ kind: "patch" as const, path, diff }] : [];
    }),
  );
}

/** An ACP call's diffs: a new file whole, a changed one as the passage it swapped. */
export function acpWritten(content: { type: string; path?: string | null; oldText?: string | null; newText?: string | null }[]): WrittenCode[] {
  return capWritten(
    content.flatMap((item): WrittenCode[] => {
      if (item.type !== "diff" || !item.path || item.newText == null) return [];
      if (!item.oldText) return [{ kind: "whole", path: item.path, content: item.newText }];
      return [{ kind: "swap", path: item.path, edits: [{ old: item.oldText, new: item.newText }] }];
    }),
  );
}
