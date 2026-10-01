// OpenRouter credit for the key OpenCode runs on. OpenCode resolves the key
// from its sign-ins, its config or the environment, so Relay asks it rather
// than reading those itself; the key never leaves the main process.
import { openCode } from "./agents/opencode/client";
import { memoOnce } from "./memo";
import {
  openRouterCreditSchema,
  type OpenRouterCredit,
} from "../shared/openrouter-credit";

const API = "https://openrouter.ai/api/v1";

async function openRouterKey(): Promise<string | null> {
  const { providers } = await openCode<{
    providers: { id: string; key?: string }[];
  }>("GET", "/config/providers");
  return providers.find((p) => p.id === "openrouter")?.key?.trim() || null;
}

class Rejected extends Error {}

async function get(path: string, key: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 401 || response.status === 403) throw new Rejected();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  return ((await response.json()) as { data?: unknown })?.data;
}

const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function empty(message: string): OpenRouterCredit {
  return { balance: null, limit: null, spent: null, message };
}

async function load(): Promise<OpenRouterCredit> {
  const key = await openRouterKey().catch(() => null);
  if (!key) return empty("OpenCode has no OpenRouter key");
  try {
    const [info, credits] = await Promise.all([
      get("/key", key) as Promise<Record<string, unknown> | undefined>,
      // Not every key may read the account's credits; the cap still shows.
      (
        get("/credits", key) as Promise<Record<string, unknown> | undefined>
      ).catch((e) => {
        if (e instanceof Rejected) return undefined;
        throw e;
      }),
    ]);
    const bought = num(credits?.total_credits);
    const used = num(credits?.total_usage);
    const amount = num(info?.limit);
    const remaining = num(info?.limit_remaining);
    const reset = info?.limit_reset;
    const day = num(info?.usage_daily);
    const week = num(info?.usage_weekly);
    const month = num(info?.usage_monthly);
    return openRouterCreditSchema.parse({
      balance: bought != null && used != null ? bought - used : null,
      limit:
        amount != null && remaining != null
          ? {
              amount,
              remaining,
              reset:
                reset === "daily" || reset === "weekly" || reset === "monthly"
                  ? reset
                  : null,
            }
          : null,
      spent:
        day != null && week != null && month != null
          ? { day, week, month }
          : null,
      message: null,
    });
  } catch (e) {
    return empty(
      e instanceof Rejected
        ? "OpenRouter rejected the key"
        : "Couldn't reach OpenRouter",
    );
  }
}

const cached = memoOnce(load, 45_000);

/** `force` skips the cached reading, for an explicit refresh. */
export function readOpenRouterCredit(force = false) {
  if (force) cached.forget();
  return cached();
}
