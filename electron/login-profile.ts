import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Account } from "../shared/types";

export const stableCredentialName = "Review Relay";
export const experimentalCredentialName = "Review Relay Experimental";
export type CredentialName =
  typeof stableCredentialName | typeof experimentalCredentialName;
export interface LoginProfile {
  credentialName: CredentialName;
  imported?: { account: Account; encryptedToken: string };
}

function readProfile(dir: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    if (value?.version !== 1) throw new Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(
      "The saved Relay sign-in could not be read. Existing data has been preserved.",
    );
  }
}

// Called before Electron initializes OS cryptography. Only the encrypted login
// is copied; the two applications never share a writable review database.
export function loginProfile(dir: string, stableDir: string): LoginProfile {
  const own = readProfile(dir);
  if (own)
    return {
      credentialName:
        own.credentialName === stableCredentialName
          ? stableCredentialName
          : experimentalCredentialName,
    };
  const stable = readProfile(stableDir);
  if (!stable?.account || !stable.encryptedToken)
    return { credentialName: experimentalCredentialName };
  const saved = z
    .object({
      account: z.object({
        id: z.string().min(1),
        server: z.url(),
        user: z.object({
          id: z.number().int(),
          login: z.string().min(1),
          full_name: z.string().optional(),
        }),
        persistent: z.literal(true),
      }),
      encryptedToken: z
        .string()
        .min(4)
        .max(65536)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .safeParse(stable);
  if (!saved.success)
    throw new Error(
      "The saved Relay sign-in could not be read. Existing data has been preserved.",
    );
  return { credentialName: stableCredentialName, imported: saved.data };
}
