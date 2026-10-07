import { z } from "zod";
import { digestSchema, shaSchema, textSchema } from "./validation";
import { workingPathSchema } from "./working-tree";
import type { PullRef } from "./types";
const syncValueSchema = z
  .object({
    contents: textSchema,
    mode: z.union([z.literal(0o644), z.literal(0o755)]),
  })
  .strict()
  .nullable();
export type SyncValue = z.infer<typeof syncValueSchema>;
export const syncWriteSchema = z
  .object({
    path: workingPathSchema,
    expected: z.number().int().nonnegative(),
    value: syncValueSchema,
  })
  .strict();
const syncFileSchema = z.object({
  path: workingPathSchema,
  revision: z.number().int().positive(),
  hash: digestSchema.nullable(),
  mode: z.number().int().nullable(),
  author: z.string(),
  updated: z.number(),
});
export type SyncFile = z.infer<typeof syncFileSchema>;
export const syncManifestSchema = z.object({
  base: shaSchema,
  files: z.array(syncFileSchema).max(2000),
});
export type SyncManifest = z.infer<typeof syncManifestSchema>;
export const syncDocumentSchema = syncFileSchema.extend({
  value: syncValueSchema,
});
export type SyncDocument = z.infer<typeof syncDocumentSchema>;
export interface SyncState {
  active: boolean;
  base: string | null;
  branch: string | null;
  lastSync: number | null;
  error: string | null;
  files: number;
  conflicts: { path: string; author: string }[];
  excluded: { path: string; reason: string }[];
}
export const idleSync: SyncState = {
  active: false,
  base: null,
  branch: null,
  lastSync: null,
  error: null,
  files: 0,
  conflicts: [],
  excluded: [],
};
export interface LiveSyncApi {
  liveSyncState(ref: PullRef): Promise<SyncState>;
  liveSyncStart(ref: PullRef): Promise<SyncState>;
  liveSyncStop(ref: PullRef): Promise<void>;
  liveSyncConflict(
    ref: PullRef,
    path: string,
  ): Promise<{
    local: SyncValue;
    shared: SyncValue;
    revision: number;
    localHash: string | null;
    author: string;
  }>;
  liveSyncResolve(
    ref: PullRef,
    path: string,
    choice: "local" | "shared",
    revision: number,
    localHash: string | null,
  ): Promise<void>;
}
