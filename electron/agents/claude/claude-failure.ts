import { signedOutError, usageLimitError } from "../errors";
import { resetMs } from "../usage-limit";

/** The part of Claude's stream frames that says why a turn can fail, as the SDK and `--print` both write it. */
interface Frame {
  type: string;
  error?: string;
  parent_tool_use_id?: string | null;
  rate_limit_info?: {
    status?: string;
    resetsAt?: number;
    isUsingOverage?: boolean;
    overageInUse?: boolean;
    overageStatus?: string;
  };
}

/** Collects what a turn's frames say about its login and limits, to read once its result fails. */
export class ClaudeFailureWatch {
  // The CLI can end a turn it couldn't authenticate as a plain error result.
  private signedOut = false;
  // A request the plan's limit refused.
  private limited = false;
  // The plan's limit reported spent, lifting at `resetsAt` (seconds) if known.
  // Extra usage can still carry the request, so this alone fails nothing, and
  // while it does every turn sees this, whatever else made one fail.
  private rejected?: { resetsAt?: number; overage: boolean };

  see(frame: Frame) {
    if (frame.type === "rate_limit_event" && frame.rate_limit_info) {
      const info = frame.rate_limit_info;
      if (info.status === "rejected")
        this.rejected = {
          resetsAt: info.resetsAt,
          overage:
            !!(info.isUsingOverage || info.overageInUse) ||
            info.overageStatus === "allowed" ||
            info.overageStatus === "allowed_warning",
        };
    }
    if (frame.type !== "assistant") return;
    if (frame.error === "authentication_failed") this.signedOut = true;
    if (
      (frame.error === "rate_limit" || frame.error === "billing_error") &&
      !frame.parent_tool_use_id
    )
      this.limited = true;
  }

  /** Why the turn ended, if its limit or login did it. */
  failure(failed: boolean) {
    // A refused request can still end in a "successful" result whose answer
    // is the limit notice, so the refusal decides. With extra usage carrying
    // turns the plan is rejected throughout, so a failure says nothing of it.
    const refused =
      this.limited || (failed && this.rejected?.overage === false);
    if (!this.signedOut && refused)
      return usageLimitError(
        "claude",
        "Claude hit its usage limit.",
        resetMs(this.rejected?.resetsAt),
      );
    if (failed && this.signedOut) return signedOutError("claude");
  }
}
