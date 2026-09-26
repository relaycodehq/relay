/** React Query's key for a workspace's working tree; without `where`, every one. */
export const workingTreeKey = (where?: string) =>
  where === undefined
    ? (["working-tree", "project"] as const)
    : (["working-tree", "project", where] as const);
