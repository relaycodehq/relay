import type { HelperProvider, ReasoningEffort } from "./settings";
import type { ChangedFile, Progress } from "./types";
export const TRIAGE_VERSION = 2;
export const TRIAGE_MODEL = "gpt-5.6-luna";
export interface ChangeGroup {
  id: string;
  name: string;
  description: string;
  paths: string[];
}
export interface TriageUsage {
  inputTokens: number;
  outputTokens: number;
  batches: number;
}
export interface TriageResult {
  version: number;
  revision: string;
  model: string;
  fast?: boolean;
  reasoningEffort?: ReasoningEffort;
  /** Absent in analyses from before Claude grouping, which used Codex. */
  provider?: HelperProvider;
  createdAt: string;
  files: ChangedFile[];
  groups: ChangeGroup[];
  ordinary: Record<string, string>;
  /** Files whose latest model decision failed validation. Absent in older caches. */
  incompleteFiles?: string[];
  usage: TriageUsage;
  notice?: string;
}
export interface TriageState {
  model?: string;
  fast?: boolean;
  reasoningEffort?: ReasoningEffort;
  provider?: HelperProvider;
  id: string;
  revision: string;
  status:
    | "scanning"
    | "classifying"
    | "matching"
    | "paused"
    | "complete"
    | "cancelled"
    | "failed";
  scanned: number;
  total: number;
  checked: number;
  candidates: number;
  usage: TriageUsage;
  resume?: {
    remaining: number;
    reason: "budget" | "paused" | "error" | "incomplete" | "interrupted";
  };
  error?: string;
  result?: TriageResult;
}
export const isAnalyzing = (state?: TriageState | null) =>
  state?.status === "scanning" ||
  state?.status === "classifying" ||
  state?.status === "matching";
/** Files with the reader's own drafts or bookmarks stay out of groups. A
 * bookmark shows only on the revision it was made on, so only there does it count. */
export const notedPaths = (
  progress: Progress | undefined,
  revision: string,
) => [
  ...(progress?.drafts.map((d) => d.path) ?? []),
  ...(progress?.marks
    .filter((m) => m.revision === revision)
    .map((m) => m.path) ?? []),
];
