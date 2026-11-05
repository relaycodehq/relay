import { answerLimitError } from "../turn-kit";

/** The fields of an item or delta notification the answer is built from. */
interface AnswerParams {
  delta?: string;
  itemId?: string | null;
  item?: {
    id?: string | null;
    type?: string;
    phase?: string | null;
    delivery?: "async" | null;
    text?: string | null;
  };
}

/** A turn shows commentary, work and the terminal answer separately.
 * Codex message phases are optional, so an unphased last message is provisional
 * until the next message or turn completion establishes the terminal message. */
export class CodexAnswerStream {
  private messages = new Map<
    string,
    { text: string; phase?: "commentary" | "final_answer" }
  >();
  private visibleCommentary = new Map<string, string>();
  /** Messages Codex has finished writing. */
  private completed = new Set<string>();
  answer = "";

  constructor(
    private onText: (text: string) => void,
    private onCommentary: (id: string, text: string | null) => void,
  ) {}

  update(method: string, params: AnswerParams) {
    if (
      method !== "item/started" &&
      method !== "item/agentMessage/delta" &&
      method !== "item/completed"
    )
      return;
    if (method === "item/agentMessage/delta") {
      if (typeof params.delta !== "string") return;
      const id = typeof params.itemId === "string" ? params.itemId : "answer";
      const entry = this.messages.get(id) ?? { text: "" };
      entry.text += params.delta;
      this.messages.set(id, entry);
    } else {
      const item = params.item;
      if (item?.type !== "agentMessage") return;
      const id = typeof item.id === "string" ? item.id : "answer";
      const entry = this.messages.get(id) ?? { text: "" };
      if (item.phase === "commentary" || item.phase === "final_answer")
        entry.phase = item.phase;
      if (item.delivery === "async") entry.phase = "commentary";
      if (method === "item/completed" && typeof item.text === "string")
        entry.text = item.text;
      this.messages.set(id, entry);
      if (method === "item/completed") this.completed.add(id);
    }
    const over = answerLimitError(
      [...this.messages.values()].reduce((n, m) => n + m.text.length, 0),
    );
    if (over) throw over;
    if (this.messages.size > 100) throw new Error("Answer size limit reached.");
    const final = this.publish();
    this.forgetNotes(final);
  }

  /**
   * A finished note never changes or becomes the answer: a commentary one, or
   * an unphased one a later, finished message took the answer from. Forget it
   * once shown: a long turn writes hundreds, and they don't count to the limit.
   */
  private forgetNotes(final: string | undefined) {
    // Until it has finished, the message holding the answer may still turn
    // out to be commentary, and the answer goes back to the one before.
    let beforeFinal = final !== undefined && this.completed.has(final);
    for (const [id, message] of this.messages) {
      if (id === final) beforeFinal = false;
      const note = message.phase === "commentary" || beforeFinal;
      if (!note || !this.completed.has(id)) continue;
      this.messages.delete(id);
      this.visibleCommentary.delete(id);
      this.completed.delete(id);
    }
  }

  /** A steer was read: what follows is a new answer, below it. */
  restart() {
    this.messages.clear();
    this.visibleCommentary.clear();
    this.completed.clear();
    this.answer = "";
  }

  /**
   * Codex went on with a goal in a turn of its own: what the last turn
   * answered stays above as a note, and is forgotten like a finished one.
   */
  nextTurn() {
    for (const [id, message] of this.messages) {
      if (message.text && this.visibleCommentary.get(id) !== message.text)
        this.onCommentary(id, message.text);
    }
    this.messages.clear();
    this.visibleCommentary.clear();
    this.completed.clear();
    if (this.answer) this.onText("");
    this.answer = "";
  }

  /** Shows the answer and the notes; returns the answer's message id. */
  private publish() {
    const entries = [...this.messages.entries()];
    const final =
      [...entries].reverse().find(([, m]) => m.phase === "final_answer") ??
      [...entries].reverse().find(([, m]) => m.phase !== "commentary");
    const nextAnswer = final?.[1].text ?? "";
    if (nextAnswer !== this.answer) {
      this.answer = nextAnswer;
      this.onText(nextAnswer);
    }
    const nextCommentary = new Map<string, string>();
    for (const [id, item] of entries) {
      if (id !== final?.[0] && item.text) {
        nextCommentary.set(id, item.text);
        if (this.visibleCommentary.get(id) !== item.text)
          this.onCommentary(id, item.text);
      }
    }
    for (const id of this.visibleCommentary.keys())
      if (!nextCommentary.has(id)) this.onCommentary(id, null);
    this.visibleCommentary = nextCommentary;
    return final?.[0];
  }
}
