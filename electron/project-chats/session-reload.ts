import { randomUUID } from "node:crypto";
import {
  agentName,
  agentInfo,
} from "../../shared/agents";
import type { ChatMessage } from "../../shared/projects";
import { contextAgent } from "../../shared/recipient";
import type { ChatCore } from "./core";
import { assertHere } from "./handoff";

/**
 * Restarts the thread's agent on the same conversation, so skills, plugins
 * and instructions changed since it started reach it, and notes that in the
 * thread. A running answer, side question or Claude's background work would
 * be cut off, so the reload waits for none of them: it refuses.
 */
export function reloadSessions(core: ChatCore, id: string) {
  return core.control(id, async () => {
    if (core.closing()) throw new Error("Relay is closing.");
    await core.active.finished(id);
    if (core.active.has(id) || core.active.hasSide(id))
      throw new Error(
        "Wait for the current answer before reloading the session.",
      );
    const chat = await core.storage.load(id);
    assertHere(chat);
    const provider = contextAgent(chat.messages.filter((m) => !m.parentId));
    if (!provider) throw new Error("There is no agent session to reload yet.");
    if (!agentInfo(provider).reload)
      throw new Error(
        `${agentName(provider)} runs every thread in one server, so one thread's session can't be reloaded.`,
      );
    if (core.sessions.pending(id).length)
      throw new Error(
        "Claude still has background work or wake-ups in this thread, and reloading would stop them.",
      );
    // The line shows while the agent restarts, which can take a while, and says what changed once it has.
    const message: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      body: "",
      status: "streaming",
      provider,
      created: Date.now(),
      version: 1,
      reload: {},
    };
    chat.messages.push(message);
    await core.storage.save(chat);
    core.emit({ chatId: id, message: structuredClone(message) });
    let changes: Awaited<ReturnType<typeof core.sessions.reload>>;
    try {
      changes = await core.sessions.reload(id);
    } catch (error) {
      chat.messages.splice(chat.messages.indexOf(message), 1);
      await core.storage.save(chat);
      throw error;
    }
    message.status = "complete";
    message.ended = Date.now();
    message.reload = changes ?? {};
    message.version++;
    await core.storage.save(chat);
    core.emit({ chatId: id, message: structuredClone(message) });
  });
}
