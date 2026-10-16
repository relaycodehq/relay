import { answerLimitError } from "../turn-kit";

interface Part {
  type: string;
  text: string;
  messageID: string;
}

/**
 * A turn's answer from OpenCode's text parts, in the order they started.
 * Text written before a tool call moves out of it as commentary; reasoning
 * parts are kept for their deltas but never shown.
 */
export class OpenCodeAnswer {
  text = "";
  private parts = new Map<string, Part>();
  private order: string[] = [];
  private commentary = new Set<string>();
  /** While the turn is rebuilt from what OpenCode stored, nothing is shown. */
  private rebuilding = false;

  constructor(
    private readonly onText: (text: string) => void,
    private readonly onCommentary:
      ((id: string, text: string | null) => void) | undefined,
    private readonly onOverLimit: (error: Error) => void,
  ) {}

  /** A text or reasoning part as OpenCode last sent it; `text` left out keeps what it had. */
  set(
    id: string,
    type: string,
    text: string | null | undefined,
    messageID: string,
  ) {
    const known = this.parts.get(id);
    const body = text ?? known?.text ?? "";
    this.parts.set(id, { type, text: body, messageID });
    if (type !== "text") return;
    if (!known) this.order.push(id);
    if (this.commentary.has(id)) this.note(id, body);
    this.publish();
  }

  /** Adds to a part it has; returns the part, or nothing for one it doesn't know. */
  append(id: string, delta: string) {
    const part = this.parts.get(id);
    if (!part) return;
    part.text += delta;
    if (part.type === "text") {
      if (this.commentary.has(id)) this.note(id, part.text);
      else this.publish();
    }
    return part;
  }

  /** A tool call started: the text so far was commentary on the way. */
  toCommentary() {
    for (const id of this.order) {
      const part = this.parts.get(id)!;
      if (this.commentary.has(id) || !part.text.trim()) continue;
      this.commentary.add(id);
      this.note(id, part.text);
    }
    this.publish();
  }

  /** A steer was read: the rest of the turn continues below it, as a new answer. */
  steered() {
    this.toCommentary();
    for (const id of this.order) this.onCommentary?.(id, null);
    this.order.length = 0;
    this.commentary.clear();
    this.text = "";
  }

  /** Starts over from what `replay` feeds back in, showing only the result. */
  rebuild(replay: () => void) {
    this.rebuilding = true;
    try {
      for (const id of this.commentary) this.onCommentary?.(id, null);
      this.parts.clear();
      this.order.length = 0;
      this.commentary.clear();
      replay();
    } finally {
      this.rebuilding = false;
    }
    this.publish();
  }

  private note(id: string, text: string) {
    this.onCommentary?.(id, text.slice(0, 12000));
  }

  private publish() {
    if (this.rebuilding) return;
    const next = this.order
      .filter((id) => !this.commentary.has(id))
      .map((id) => this.parts.get(id)!.text)
      .filter((t) => t.trim())
      .join("\n\n");
    const over = answerLimitError(next.length);
    if (over) return this.onOverLimit(over);
    if (next !== this.text) {
      this.text = next;
      this.onText(next);
    }
  }
}
