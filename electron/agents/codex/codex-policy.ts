import type { RuntimeMode } from "../../../shared/agent-modes";
import type { LinkedFolder } from "../../../shared/projects";

/** What Codex is told about approvals and the sandbox for one of Relay's modes. */
interface CodexPolicy {
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalsReviewer: "user" | "auto_review";
  sandboxPolicy: { type: "readOnly" | "workspaceWrite" | "dangerFullAccess" };
}

const readOnly = {
  sandbox: "read-only",
  sandboxPolicy: { type: "readOnly" },
} as const;
const writesWorkspace = {
  sandbox: "workspace-write",
  sandboxPolicy: { type: "workspaceWrite" },
} as const;

const policies: Record<RuntimeMode, CodexPolicy> = {
  "approval-required": {
    ...readOnly,
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
  },
  "auto-accept-edits": {
    ...writesWorkspace,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
  },
  // Codex's own reviewer answers the asks instead of the user.
  auto: {
    ...writesWorkspace,
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
  },
  "full-access": {
    sandbox: "danger-full-access",
    sandboxPolicy: { type: "dangerFullAccess" },
    approvalPolicy: "never",
    approvalsReviewer: "user",
  },
};

export const codexPolicy = (mode: RuntimeMode): CodexPolicy => policies[mode];

/** A deep review's reviewer: reads and runs what it likes, writes nothing, never asks. */
export const codexReviewerPolicy: CodexPolicy = {
  ...readOnly,
  approvalPolicy: "never",
  approvalsReviewer: "user",
};

/**
 * The turn's sandbox: one that writes the workspace writes the folders
 * linked for writing too. Reading takes nothing; Codex reads the whole disk.
 */
export function sandboxPolicyFor(
  policy: CodexPolicy,
  links: readonly LinkedFolder[] = [],
) {
  const roots = links.filter((l) => l.access === "write").map((l) => l.path);
  return policy.sandboxPolicy.type === "workspaceWrite" && roots.length
    ? { ...policy.sandboxPolicy, writableRoots: roots }
    : policy.sandboxPolicy;
}
