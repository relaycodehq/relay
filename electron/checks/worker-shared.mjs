// Helpers shared by both check engines: the TypeScript API worker (worker.mjs)
// and the native TypeScript 7 language server client (worker-lsp.mjs).
import { createHash } from "node:crypto";
import { relative, isAbsolute, sep } from "node:path";
export const hash = (text) => createHash("sha256").update(text).digest("hex");
export const send = (value) =>
  process.stdout.write(JSON.stringify(value) + "\n");
export const checkedFile = (path) =>
  /\.[cm]?[jt]sx?$/.test(path) && !path.includes(".ngtypecheck.");
export function projectPaths(root) {
  return {
    local(path) {
      const p = relative(root, path);
      return (
        p &&
        p !== ".." &&
        !p.startsWith(".." + sep) &&
        !isAbsolute(p) &&
        !p.split(/[\\/]/).some((p) => p === "node_modules" || p === ".git")
      );
    },
    pathName: (path) => relative(root, path).replaceAll("\\", "/"),
  };
}
/**
 * Sends one check result, or returns false when a checked file changed on disk
 * meanwhile (its line positions would be stale; the caller rechecks).
 */
export function report({
  seq,
  diagnostics,
  checked,
  pathName,
  current,
  latest,
  configError,
  engine,
}) {
  const all = [
    ...new Map(
      diagnostics.map((item) => [JSON.stringify(item), item]),
    ).values(),
  ];
  // Errors must remain visible even when suggestions exceed the display limit.
  const rank = { error: 0, warning: 1, info: 2 };
  all.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      (a.path ?? "").localeCompare(b.path ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0),
  );
  const files = {},
    versions = new Map();
  for (const path of checked) {
    const text = current(path);
    if (text === undefined) continue;
    const digest = hash(text);
    versions.set(path, digest);
    files[pathName(path)] = {
      hash: digest,
      errors: 0,
      warnings: 0,
      suggestions: 0,
    };
  }
  for (const d of all)
    if (d.path && files[d.path]) {
      if (d.severity === "error") files[d.path].errors++;
      if (d.severity === "warning") files[d.path].warnings++;
      if (d.severity === "info") files[d.path].suggestions++;
    }
  // A concurrent edit invalidates these locations before they reach the UI.
  for (const [path, digest] of versions) {
    const text = latest(path);
    if (text === undefined || hash(text) !== digest) return false;
  }
  send({
    type: "result",
    seq,
    diagnostics: all.slice(0, 1500),
    files,
    errors: all.filter((d) => d.severity === "error").length,
    warnings: all.filter((d) => d.severity === "warning").length,
    suggestions: all.filter((d) => d.severity === "info").length,
    truncated: all.length > 1500,
    engine,
    ...(configError
      ? { message: "Configuration errors prevent a complete project check." }
      : {}),
  });
  return true;
}
export function sourceResult(m, text, seq) {
  if (Buffer.byteLength(text) > 2 * 1024 * 1024)
    throw new Error("This file is too large to preview.");
  send({
    type: "symbol",
    requestId: m.requestId,
    seq,
    result: {
      display: "",
      documentation: "",
      locations: [],
      truncated: false,
      external: false,
      source: { path: m.path, text, hash: hash(text) },
    },
  });
}
