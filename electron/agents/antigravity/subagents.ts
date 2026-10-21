import type { AcpToolCall } from "../acp/protocol";
import { acpActivity } from "../acp/activity";
import { SubagentBooks, type SubagentBook } from "../subagent-book";

export const antigravityBatches = new SubagentBooks();

/** ACP exposes start_subagent batches, not individual children or a way to stop one. */
export class AntigravityBatches {
  private ids = new Set<string>();
  constructor(private book: SubagentBook) {}

  update(call: Partial<AcpToolCall> & { toolCallId: string }) {
    const meta = call._meta as { is_mcp_tool_call?: unknown } | undefined;
    if (!this.ids.has(call.toolCallId)) {
      if (
        (call.kind && call.kind !== "other") ||
        !["Running start_subagent", "Run start_subagent?"].includes(
          call.title ?? "",
        ) ||
        meta?.is_mcp_tool_call === true
      )
        return;
      this.ids.add(call.toolCallId);
      this.book.start(call.toolCallId, {
        description: "Antigravity subagent batch",
        type: "batch",
        canStop: false,
      });
    }
    const output =
      typeof call.rawOutput === "string" ? call.rawOutput : undefined;
    this.book.call(call.toolCallId, acpActivity(call));
    if (output) this.book.report(call.toolCallId, output);
    if (call.status === "failed")
      this.book.end(call.toolCallId, "failed", output);
    else if (call.status === "completed")
      this.book.end(
        call.toolCallId,
        "idle",
        output ??
          "Batch submitted. Antigravity does not report individual child status.",
      );
  }

  settle(stopped: boolean) {
    for (const id of this.ids)
      if (this.book.detail(id)?.status === "running")
        this.book.end(
          id,
          stopped ? "stopped" : "idle",
          stopped
            ? undefined
            : "Antigravity stopped reporting this batch; individual child status is unavailable.",
        );
  }
}
