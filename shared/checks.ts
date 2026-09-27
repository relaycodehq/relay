import { z } from "zod";
import { digestSchema, filePathSchema } from "./validation";
export type CheckProvider = "angular" | "typescript";
export interface CheckTarget {
  id: string;
  label: string;
  config: string;
  provider: CheckProvider;
}
export interface ProjectCheckInfo {
  framework:
    "Angular" | "Next.js" | "TypeScript" | "JavaScript" | "Unsupported";
  targets: CheckTarget[];
  note?: string;
}
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
export interface CheckedFile extends DiagnosticCounts {
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
