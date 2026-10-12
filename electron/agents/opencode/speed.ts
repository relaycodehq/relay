import { streamedIfReal, type Streamed } from "../../../shared/usage";

type Span = { first: number; last: number; done?: boolean };

/**
 * How fast an OpenCode request wrote what it showed. One assistant message is
 * one request; its text parts are timed from their first sighting to their
 * last delta, and a tool call from when it starts being written (`pending`)
 * to when it is whole and runs. Reasoning is never timed, and its tokens are
 * left out, the way Claude's and Codex's speeds leave thinking out.
 *
 * Times are when Relay saw the events, so only live events count: a request
 * pieced together from stored messages afterwards has no honest clock.
 */
export class OpenCodeRequestSpeed {
  private spans = new Map<string, Map<string, Span>>();

  constructor(private now = Date.now) {}

  private mark(messageID: string, key: string, done = false) {
    let spans = this.spans.get(messageID);
    if (!spans) this.spans.set(messageID, (spans = new Map()));
    const at = this.now();
    const span = spans.get(key);
    if (!span) spans.set(key, { first: at, last: at, done });
    else if (!span.done) {
      span.last = at;
      span.done = done;
    }
  }

  /** A text part of the request appeared or grew. */
  text(messageID: string, partID: string) {
    this.mark(messageID, partID);
  }

  /** A tool call of the request, as its status moves on. */
  tool(messageID: string, partID: string, status: string) {
    this.mark(messageID, partID, status !== "pending");
  }

  /** The request finished with these counts; its timing is let go. */
  finish(
    messageID: string,
    tokens: { output?: number | null } | null | undefined,
  ): Streamed | undefined {
    const spans = this.spans.get(messageID);
    this.spans.delete(messageID);
    if (!spans || !tokens) return;
    let ms = 0;
    for (const span of spans.values()) ms += span.last - span.first;
    return streamedIfReal(tokens.output ?? 0, ms);
  }
}
