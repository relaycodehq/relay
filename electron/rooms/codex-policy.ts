import type { RuntimeMode } from "../../shared/agent-modes";
// Adapted from T3 Code CodexSessionRuntime.ts (MIT).
export function codexPolicy(mode: RuntimeMode) {
  switch (mode) {
    case "approval-required":
      return {
        approvalPolicy: "untrusted",
        sandbox: "read-only",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly" },
      };
    case "auto-accept-edits":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "workspaceWrite" },
      };
    case "auto":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        approvalsReviewer: "auto_review",
        sandboxPolicy: { type: "workspaceWrite" },
      };
    case "full-access":
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
}
/** A deep review's reviewer: reads and runs what it likes, writes nothing, never asks. */
export const codexReviewerPolicy = {
  approvalPolicy: "never",
  sandbox: "read-only",
  approvalsReviewer: "user",
  sandboxPolicy: { type: "readOnly" },
};
