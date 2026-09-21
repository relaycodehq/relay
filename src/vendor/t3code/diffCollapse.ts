// Adapted from T3 Code. MIT, Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.
export function areAllDiffFilesCollapsed(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): boolean {
  return (
    fileKeys.length > 0 &&
    fileKeys.every((fileKey) => collapsedFileKeys.has(fileKey))
  );
}

export function toggleAllDiffFiles(
  fileKeys: ReadonlyArray<string>,
  collapsedFileKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  return areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys)
    ? new Set()
    : new Set(fileKeys);
}
