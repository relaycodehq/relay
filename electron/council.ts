import type { ProjectChat } from "../shared/projects";

/** Council members read and reason but never change files, and none of them stops to ask. */
export const councilTurn = {
  runtimeMode: "approval-required",
  interactionMode: "default",
} as const;

/** A member thread's latest assistant message; nothing if the thread can't be loaded. */
export async function lastAnswer(
  host: { load(id: string): Promise<ProjectChat> },
  chatId: string,
) {
  const chat = await host.load(chatId).catch(() => undefined);
  return (
    chat && [...chat.messages].reverse().find((m) => m.role === "assistant")
  );
}

/**
 * Starts every slot's turn. Members that never started count as finished, so
 * `someFailed` lets the rest hand over; only when none started is it an error.
 */
export async function startSlots(
  slots: number[],
  start: (slot: number) => Promise<unknown>,
  someFailed: () => Promise<unknown>,
) {
  const failures = await Promise.all(
    slots.map(async (slot) => {
      try {
        await start(slot);
        return undefined;
      } catch (e) {
        return e;
      }
    }),
  );
  if (failures.some(Boolean)) await someFailed();
  const failure = failures.find(Boolean);
  if (failures.every(Boolean)) throw failure;
}
