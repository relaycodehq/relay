// What phones hear without asking: the thread list as it changes, whether
// someone is at the computer, and answers as they stream.
import { chatIsEmpty } from "../../shared/chat-activity";
import type { ChatMessage, Project } from "../../shared/projects";
import type { RemoteEvent } from "../../shared/remote";
import { chatOrder } from "../../shared/remote-delta";
import { forPhoneEvent, summaryForPhone } from "./for-phone";
import type { RemoteHost } from "./remote-host";

/** Streaming answers go out at most this often; the phone doesn't need every token. */
const streamMs = 150;

export class PhoneFeed {
  private streams = new Map<
    string,
    { timer: NodeJS.Timeout; event: Extract<RemoteEvent, { kind: "message" }> }
  >();
  private lastChats = "";
  private lastPresent?: boolean;
  private watching = false;
  /** Unknown until a phone asks for the overview; nothing is watched before that. */
  private projectIds?: string[];

  constructor(
    private host: Pick<RemoteHost, "projects" | "chats" | "present">,
    private broadcast: (event: RemoteEvent) => void,
  ) {}

  /** The thread list a phone's overview starts from; the feed follows these projects. */
  overview(projects: Project[]) {
    this.projectIds = projects.map((p) => p.id);
    // This phone hears it here; the next list tells the rest again.
    this.lastPresent = undefined;
    return this.summaries();
  }

  /** Relays a chat event, holding back streaming updates to one per message every `streamMs`; only one sent is shaped for phones. */
  chatEvent(event: { chatId: string; message: ChatMessage; title?: string }) {
    const next = { kind: "message" as const, ...event };
    const held = this.streams.get(event.message.id);
    if (event.message.status === "streaming") {
      if (held) held.event = next;
      else
        this.streams.set(event.message.id, {
          event: next,
          timer: setTimeout(() => {
            const latest = this.streams.get(event.message.id);
            this.streams.delete(event.message.id);
            if (latest) this.broadcast(forPhoneEvent(latest.event));
          }, streamMs),
        });
      return;
    }
    if (held) {
      clearTimeout(held.timer);
      this.streams.delete(event.message.id);
    }
    this.broadcast(forPhoneEvent(next));
  }

  /** Follows thread states while a phone is connected. */
  setWatching(watching: boolean) {
    this.watching = watching;
    if (watching) return;
    this.lastChats = "";
    this.lastPresent = undefined;
  }

  /** A project's thread list changed; one new since the overview joins the watch. */
  chatsChanged(projectId: string) {
    if (!this.watching || !this.projectIds) return;
    if (this.projectIds.includes(projectId)) return this.refresh();
    void this.host
      .projects()
      .then((projects) => {
        this.projectIds = projects.map((p) => p.id);
        this.refresh();
      })
      .catch(() => {});
  }

  /** Tells phones when a thread starts, finishes, or starts waiting on them. */
  refresh() {
    if (!this.projectIds) return;
    const chats = this.summaries();
    const signature = JSON.stringify(chats);
    if (signature === this.lastChats) return;
    this.lastChats = signature;
    // Read again as the list moves, which is when a phone decides whether it's
    // news. Coming back goes before the list and leaving after it, so a list
    // sent as presence changes is held, and leaving judges the newest one.
    const present = this.host.present?.();
    if (present) this.sendPresence(present);
    this.broadcast({ kind: "chats", chats });
    if (present === false) this.sendPresence(present);
  }

  /** Someone came to the computer or left it: a phone holding news back hands it out. */
  presenceChanged() {
    if (this.watching && this.projectIds)
      this.sendPresence(this.host.present?.());
  }

  dispose() {
    this.setWatching(false);
    for (const held of this.streams.values()) clearTimeout(held.timer);
    this.streams.clear();
  }

  private sendPresence(present: boolean | undefined) {
    if (present === undefined || present === this.lastPresent) return;
    this.lastPresent = present;
    this.broadcast({ kind: "presence", present });
  }

  private summaries() {
    return (
      (this.projectIds ?? [])
        .flatMap((id) => {
          try {
            return this.host.chats(id);
          } catch {
            return [];
          }
        })
        .filter((c) => !c.archivedAt && !chatIsEmpty(c))
        .sort((a, b) => b.updated - a.updated)
        .slice(0, 300)
        .map(summaryForPhone)
        // Ties included, the order a phone rebuilds a patched list in.
        .sort(chatOrder)
    );
  }
}
