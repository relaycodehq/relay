import type { PromptCache } from "../../../shared/projects";

/**
 * Google publishes no lifetime for Gemini's implicit cache. Relay's own
 * Gemini 4 Neon turns (2026-11) still hit after nearly an hour idle and all
 * missed past two hours, the same shape as Codex, so it gets Codex's hour.
 */
const GEMINI_CACHE_TTL = 60 * 60_000;

/**
 * The prompt cache a request just touched, for Gemini models only: the other
 * models Antigravity runs keep their own caches, which nobody has measured.
 */
export function geminiCache(
  model: string | undefined,
  at = Date.now(),
): PromptCache | undefined {
  if (!model?.toLowerCase().startsWith("gemini")) return undefined;
  return { at, ttlMs: GEMINI_CACHE_TTL };
}
