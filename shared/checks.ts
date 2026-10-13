import { z } from "zod";
import { digestSchema, filePathSchema } from "./validation";
type CheckProvider = "angular" | "typescript";
export interface CheckTarget {
  id: string;
  label: string;
  config: string;
  provider: CheckProvider;
}
/** Whether a target's checks can read `path`: scripts, and templates for Angular. */
export const checksCover = (target: CheckTarget | undefined, path: string) =>
  /\.[cm]?[jt]sx?$/.test(path) ||
  (target?.provider === "angular" && path.endsWith(".html"));
export interface ProjectCheckInfo {
  framework:
    "Angular" | "Next.js" | "TypeScript" | "JavaScript" | "Unsupported";
  targets: CheckTarget[];
  note?: string;
}
/** The checker's heap limit in MB, unless its project sets one. */
export const CHECKS_MEMORY_MB = 768;
export const checksMemoryChoices = [512, 768, 1024, 1536, 2048, 4096];
export const memoryLabel = (mb: number) =>
  mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
export interface ProjectDiagnostic {
  path?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}
export interface DiagnosticCounts {
  errors: number;
  warnings: number;
  suggestions: number;
}
export function diagnosticSummary(counts: DiagnosticCounts) {
  const count = (n: number, label: string) =>
    `${n} ${label}${n === 1 ? "" : "s"}`;
  return [
    count(counts.errors, "error"),
    count(counts.warnings, "warning"),
    ...(counts.suggestions ? [count(counts.suggestions, "suggestion")] : []),
  ].join(" · ");
}
export function diagnosticSeverity(counts: DiagnosticCounts) {
  return counts.errors
    ? "error"
    : counts.warnings
      ? "warning"
      : counts.suggestions
        ? "info"
        : undefined;
}
interface CheckedFile extends DiagnosticCounts {
  hash: string;
}
export interface ProjectCheckState extends DiagnosticCounts {
  id: string;
  head: string;
  target: CheckTarget;
  status: "checking" | "ready" | "paused" | "failed" | "stopped";
  startedAt: number;
  checkedAt?: number;
  diagnostics: ProjectDiagnostic[];
  files: Record<string, CheckedFile>;
  truncated?: boolean;
  message?: string;
  /** Which compiler produced the results, and why when it is Relay's fallback. */
  engine?: string;
  /**
   * The checker's heap limit and how much of it is in use, in MB. TypeScript
   * 7's native server has no limit to fill, so it reports no use.
   */
  memory: { limit: number; used?: number };
  /** The project whose settings hold the limit; absent for a PR folder no project holds. */
  projectId?: string;
}
export interface SymbolLocation {
  path: string;
  line: number;
  column: number;
  length: number;
  preview: string;
  hash: string;
}
export const symbolQuerySchema = z
  .object({
    path: filePathSchema,
    line: z.number().int().min(1).max(500000),
    column: z.number().int().min(1).max(2000000),
    hash: digestSchema,
    kind: z.enum(["hover", "definition", "references", "source"]),
  })
  .strict();
export type SymbolQuery = z.infer<typeof symbolQuerySchema>;
export interface SymbolResult {
  source?: { path: string; text: string; hash: string };
  display: string;
  documentation: string;
  locations: SymbolLocation[];
  truncated: boolean;
  external: boolean;
}
