import type { PromptCache } from "../../../shared/projects";

/**
 * OpenAI promises a prefix 30 minutes after its latest read or write and may
 * keep it longer; Codex doesn't say. Measured on GPT-6.1 Sol and GPT-6 Astra
 * (2026-10): every request within 40 minutes hit, most up to about an hour,
 * none after 100 minutes.
 */
export const CODEX_CACHE_TTL = 60 * 60_000;

/**
 * When Codex's requests touched the prompt cache. A request reads it when it
 * goes out, but Codex reports its counts only after the tools it called have
 * run, which is when the next request goes out.
 */
export class CodexCacheClock {
  private sentAt?: number;

  constructor(private now = Date.now) {}

  /** A turn began: its first request goes out now. */
  turnStarted() {
    this.sentAt = this.now();
  }

  /** A request reported its counts; the next one goes out now. */
  reported(): PromptCache {
    const at = this.sentAt ?? this.now();
    this.sentAt = this.now();
    return { at, ttlMs: CODEX_CACHE_TTL };
  }
}
