import { z } from "zod";
import { shaSchema } from "./validation";
import { workingPathSchema } from "./working-tree";
import type { PullRef } from "./types";
export const syncValueSchema = z
  .object({
    contents: z.string().max(2 * 1024 * 1024),
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
export const syncFileSchema = z.object({
  path: workingPathSchema,
  revision: z.number().int().positive(),
  hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
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
export type SyncTarget = PullRef | { chatId: string };
export interface LiveSyncApi {
  liveSyncState(ref: SyncTarget): Promise<SyncState>;
  liveSyncStart(ref: SyncTarget): Promise<SyncState>;
  liveSyncStop(ref: SyncTarget): Promise<void>;
  liveSyncConflict(
    ref: SyncTarget,
    path: string,
  ): Promise<{
    local: SyncValue;
    shared: SyncValue;
    revision: number;
    localHash: string | null;
    author: string;
  }>;
  liveSyncResolve(
    ref: SyncTarget,
    path: string,
    choice: "local" | "shared",
    revision: number,
    localHash: string | null,
  ): Promise<void>;
}
