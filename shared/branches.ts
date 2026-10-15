import { z } from "zod";
export interface BranchRef {
  name: string;
  ref: string;
  current: boolean;
  remote: boolean;
  worktree: boolean;
  /** On a remote whose history shares nothing with HEAD, so no use as a base. */
  unrelated: boolean;
}
export interface BranchList {
  current: string;
  head: string;
  branches: BranchRef[];
  /** Names work usually merges into, most likely first; see `baseCandidates`. */
  bases: string[];
}
export const branchActionSchema = z
  .object({
    kind: z.enum(["switch", "create"]),
    name: z.string().min(1).max(250),
    current: z.string().max(250),
    head: z.string().regex(/^[a-f0-9]{40,64}$/),
  })
  .strict();
export type BranchAction = z.infer<typeof branchActionSchema>;
/** The local branch checking out remote `b` would land on, if it exists. */
export function localTwin(list: BranchRef[], b: BranchRef) {
  if (!b.remote) return undefined;
  const name = b.name.slice(b.name.indexOf("/") + 1);
  return list.find((l) => !l.remote && l.name === name);
}
