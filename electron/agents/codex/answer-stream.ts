import { answerLimitError } from "../turn-kit";

/** The fields of an item or delta notification the answer is built from. */
interface AnswerParams {
  delta?: string;
  itemId?: string | null;
  item?: {
    id?: string | null;
    type?: string;
    phase?: string | null;
    text?: string | null;
  };
}
/** T3 Code's turn timeline separates commentary, work and the terminal answer.
 * Codex message phases are optional, so an unphased last message is provisional
 * until the next message or turn completion establishes the terminal message. */
export class CodexAnswerStream {
  private messages = new Map<
    string,
    { text: string; phase?: "commentary" | "final_answer" }
  >();
  private visibleCommentary = new Map<string, string>();
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
    let finished: string | undefined;
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
      if (method === "item/completed" && typeof item.text === "string")
        entry.text = item.text;
      this.messages.set(id, entry);
      if (method === "item/completed" && entry.phase === "commentary")
        finished = id;
    }
    const over = answerLimitError(
      [...this.messages.values()].reduce((n, m) => n + m.text.length, 0),
    );
    if (over) throw over;
    if (this.messages.size > 100) throw new Error("Answer size limit reached.");
    this.publish();
    // A finished note never changes or becomes the answer. Forget it once
    // shown: a long turn writes hundreds, and they don't count to the limit.
    if (finished) {
      this.messages.delete(finished);
      this.visibleCommentary.delete(finished);
    }
  }
  /** A steer was read: what follows is a new answer, below it. */
  restart() {
    this.messages.clear();
    this.visibleCommentary.clear();
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
    if (this.answer) this.onText("");
    this.answer = "";
  }
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
  }
}
