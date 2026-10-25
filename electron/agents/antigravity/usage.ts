import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import {
  SESSION_MS,
  WEEK_MS,
  type ProviderUsage,
  type UsageWindow,
} from "../../../shared/provider-usage";
import { runExecutable } from "../../platform/executables";
import { profileDir, usualHome } from "../accounts/profiles";
import { antigravityAuthMethod } from "./account";

const tokenSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  refresh_token: z.string().min(1),
  project_id: z.string().optional(),
});

type Token = z.infer<typeof tokenSchema>;
export type QuotaCredential = { token: Token; fingerprint: string };
type Access = { fingerprint: string; token: string; until: number };

const endpoints = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];

/** Labels stay with their buckets; Gemini and the shared Claude/GPT pool are independent. */
export function mapAntigravityUsage(raw: unknown): UsageWindow[] {
  const bucket = z.object({
    bucketId: z.string(),
    window: z.string().optional(),
    displayName: z.string().optional(),
    disabled: z.boolean().optional(),
    remainingFraction: z.number().optional(),
    resetTime: z.string().optional(),
  });
  const parsed = z
    .object({
      groups: z
        .array(
          z.object({
            displayName: z.string().optional(),
            buckets: z.array(z.unknown()).optional(),
          }),
        )
        .optional(),
      buckets: z.array(z.unknown()).optional(),
    })
    .safeParse(raw).data;
  if (!parsed) return [];
  const groups = parsed.groups?.some((g) => g.buckets?.length)
    ? parsed.groups
    : [{ buckets: parsed.buckets }];
  return groups.flatMap((group) =>
    (group.buckets ?? []).flatMap((raw): UsageWindow[] => {
      const b = bucket.safeParse(raw).data;
      if (!b) return [];
      if (
        b.disabled ||
        b.remainingFraction === undefined ||
        !["5h", "weekly"].includes(b.window ?? "")
      )
        return [];
      const kind = b.window === "weekly" ? "weekly" : "session";
      const family = b.bucketId.startsWith("gemini-")
        ? "Gemini"
        : b.bucketId.startsWith("3p-")
          ? "Claude & GPT"
          : group.displayName || b.displayName || b.bucketId;
      const reset = Date.parse(b.resetTime ?? "");
      return [
        {
          id: b.bucketId,
          label: `${family} · ${kind === "session" ? "5h" : "Weekly"}`,
          kind,
          usedPercent:
            (1 - Math.max(0, Math.min(1, b.remainingFraction))) * 100,
          resetsAt: Number.isFinite(reset) ? reset : null,
          periodMs: kind === "session" ? SESSION_MS : WEEK_MS,
        },
      ];
    }),
  );
}

/** Read afresh on every operation, so an external sign-in is picked up without restarting. */
export async function readQuotaCredential(
  home: string,
  fileStorage: boolean,
): Promise<QuotaCredential | undefined> {
  const method = await antigravityAuthMethod(home);
  if (method !== "oauth-personal" && method !== "oauth-business") return;
  const path = join(home, "antigravity-acp", "acp_token.json");
  const info = await stat(path).catch(() => undefined);
  let text: string | undefined;
  if (info?.isFile() && info.size < 64_000) text = await readFile(path, "utf8");
  else if (!info && !fileStorage && process.platform === "darwin") {
    text = (
      await runExecutable(
        "/usr/bin/security",
        [
          "find-generic-password",
          "-s",
          "gemini",
          "-a",
          "antigravity-acp",
          "-w",
        ],
        12_000,
      ).catch(() => undefined)
    )?.stdout;
  }
  if (!text || text.length > 64_000) return;
  const token = tokenSchema.safeParse(JSON.parse(text)).data;
  if (!token) return;
  return {
    token,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(token))
      .digest("hex"),
  };
}

class QuotaAuthError extends Error {}

const unavailable = (message: string): ProviderUsage => ({
  provider: "antigravity",
  windows: [],
  message,
});

/** Owns only derived access tokens. Saved Google logins and API keys are never removed. */
export function createAntigravityUsageReader(
  read: () => Promise<QuotaCredential | undefined>,
  fetcher: typeof fetch = fetch,
  now = Date.now,
) {
  let cached: Access | undefined;
  let generation = 0;
  const request = (url: string, init: RequestInit) =>
    fetcher(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
  const access = async (credential: QuotaCredential, started: number) => {
    if (
      cached?.fingerprint === credential.fingerprint &&
      cached.until > now() + 60_000
    )
      return cached;
    const response = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credential.token.client_id,
        client_secret: credential.token.client_secret,
        refresh_token: credential.token.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (response.status === 400 && error?.error === "invalid_grant")
        throw new QuotaAuthError();
      throw new Error("Google token refresh failed.");
    }
    const token = z
      .object({
        access_token: z.string().min(1),
        expires_in: z.number().positive(),
      })
      .parse(await response.json());
    const result = {
      fingerprint: credential.fingerprint,
      token: token.access_token,
      until: now() + token.expires_in * 1000,
    };
    if (generation === started) cached = result;
    return result;
  };
  return async (): Promise<ProviderUsage> => {
    const started = ++generation;
    try {
      let credential = await read();
      if (!credential) {
        if (generation === started) cached = undefined;
        return unavailable("Sign in with Google to see Antigravity limits.");
      }
      // A quota read is safe to retry once after a documented bearer-token refusal.
      for (let attempt = 0; attempt < 2; attempt++) {
        const auth = await access(credential, started);
        const responses = await Promise.allSettled(
          endpoints.map(async (endpoint) => {
            const response = await request(
              `${endpoint}/v1internal:retrieveUserQuotaSummary`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${auth.token}`,
                  "Content-Type": "application/json",
                  "User-Agent": `antigravity/hub/1.0.0 (aidev_client; os_type=${process.platform}; arch=${process.arch})`,
                },
                body: JSON.stringify(
                  credential!.token.project_id
                    ? { project: credential!.token.project_id }
                    : {},
                ),
              },
            );
            if (response.status === 401) throw new QuotaAuthError();
            if (!response.ok) throw new Error("Google quota request failed.");
            return mapAntigravityUsage(await response.json());
          }),
        );
        const windows = new Map<string, UsageWindow>();
        for (const result of responses)
          if (result.status === "fulfilled")
            for (const window of result.value) {
              const previous = windows.get(window.id!);
              if (!previous || window.usedPercent > previous.usedPercent)
                windows.set(window.id!, window);
            }
        const refused = responses.some(
          (r) => r.status === "rejected" && r.reason instanceof QuotaAuthError,
        );
        // An old response must not clear a token cached by a newer operation.
        if (refused && cached === auth && generation === started)
          cached = undefined;
        if (refused && attempt === 0) {
          credential = await read();
          if (!credential)
            return unavailable(
              "Sign in with Google to see Antigravity limits.",
            );
          continue;
        }
        if (windows.size)
          return {
            provider: "antigravity",
            windows: [...windows.values()].slice(0, 16),
            message: null,
          };
        return unavailable(
          refused
            ? "Sign in with Google again to read Antigravity limits."
            : "Google did not report usable quota windows.",
        );
      }
    } catch (error) {
      if (error instanceof QuotaAuthError) {
        if (generation === started) cached = undefined;
        return unavailable(
          "Sign in with Google again to read Antigravity limits.",
        );
      }
      return unavailable(
        "Couldn't read Antigravity limits. Refresh to try again.",
      );
    }
    return unavailable("Couldn't read Antigravity limits.");
  };
}

const readers = new Map<
  string,
  ReturnType<typeof createAntigravityUsageReader>
>();

export function readAntigravityUsage(account = SYSTEM_ACCOUNT) {
  const home =
    account === SYSTEM_ACCOUNT
      ? usualHome("antigravity")
      : profileDir("antigravity", account);
  const fileStorage =
    account !== SYSTEM_ACCOUNT || !!process.env.AGY_ACP_FORCE_FILE_STORAGE;
  const key = `${home}:${fileStorage}`;
  let reader = readers.get(key);
  if (!reader)
    readers.set(
      key,
      (reader = createAntigravityUsageReader(() =>
        readQuotaCredential(home, fileStorage),
      )),
    );
  return reader();
}
