// What the user marks on an answer: findings dismissed, watch notes closed,
// guesses seen. Each redraws the answer it's on.
import type { FindingStatus } from "../../shared/findings";
import { WATCH_KNOWN_LIMIT, type WatchClose } from "../../shared/watch";
import { setFindingStatus } from "../findings";
import type { ChatCore } from "./core";

/** The user's verdict on a deep review finding: open again, or dismissed. */
export function setFinding(
  core: ChatCore,
  id: string,
  findingId: string,
  status: Extract<FindingStatus, "open" | "dismissed">,
) {
  return core.control(id, async () => {
    const chat = await core.storage.load(id);
    const report = setFindingStatus(chat.findings, findingId, status);
    // The report shows under its answer, which redraws it.
    const message = chat.messages.find((m) => m.id === report);
    if (message) message.version++;
    await core.storage.save(chat);
    if (message) core.emit({ chatId: id, message: structuredClone(message) });
  });
}

/** The same chat object a running turn writes into, so its next publish keeps the note closed. */
export function closeWatchNote(
  core: ChatCore,
  id: string,
  messageId: string,
  noteId: string,
  how: WatchClose,
  read = false,
) {
  const known = how === "known";
  return core.control(id, async () => {
    const chat = await core.storage.load(id);
    const message = chat.messages.find((m) => m.id === messageId);
    const note = message?.notes?.find((n) => n.id === noteId);
    if (!message || !note || note.closed) return;
    note.closed = true;
    note.how = how;
    if (read) note.read = true;
    if (known) note.known = true;
    message.version++;
    await core.storage.save(chat);
    core.emit({ chatId: id, message: structuredClone(message) });
    if (known)
      await core.store.update((s) => {
        // The headline alone doesn't say what topic they closed.
        s.watchKnown = [
          ...(s.watchKnown ?? []).filter(
            (t) => t !== note.title && !t.startsWith(`${note.title}: `),
          ),
          `${note.title}: ${note.line}`,
        ].slice(-WATCH_KNOWN_LIMIT);
      });
  });
}

/** The composer showed a guess, so what's sent next counts for or against it; Escape hides it for good. */
export function seePrediction(
  core: ChatCore,
  id: string,
  messageId: string,
  how: "shown" | "dismissed",
) {
  return core.control(id, async () => {
    const chat = await core.storage.load(id);
    const message = chat.messages.find((m) => m.id === messageId);
    if (!message?.prediction || message.predictionSeen === "dismissed") return;
    if (message.predictionSeen === how) return;
    message.predictionSeen = how;
    message.version++;
    await core.storage.save(chat);
    core.emit({ chatId: id, message: structuredClone(message) });
  });
}
