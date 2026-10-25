// What Relay's own helpers beside the answers cost: side checks and guesses.
import { usageLog } from "../usage";
import type { ChatCore } from "./core";

/** What side checks spent in the last `days`, by thread. */
export function watchSpend(core: ChatCore, days: number) {
  const titles = new Map(
    (core.store.get().chats ?? []).map((c) => [c.id, c.title]),
  );
  return (
    core.watchSpend?.summary(days, (id) => titles.get(id)) ??
    Promise.resolve(undefined)
  );
}

/** The composer's guesses of the last `days`: what they cost and how often they were sent. */
export function predictionSpend(core: ChatCore, days: number) {
  return (
    core.predictions?.summary(days, async (chats, since) => {
      let usd = 0;
      for (const e of await usageLog())
        if (e.at >= since && e.job === "thread" && e.chat && chats.has(e.chat))
          for (const spend of Object.values(e.models)) usd += spend.usd ?? 0;
      return usd;
    }) ?? Promise.resolve(undefined)
  );
}
