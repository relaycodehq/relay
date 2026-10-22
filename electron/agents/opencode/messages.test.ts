import { expect, it } from "vitest";
import { messagePages } from "./messages";
import type { NativeClient } from "./client";

it("pages through a long session without naming the order beside a cursor", async () => {
  const ids = Array.from({ length: 45 }, (_, i) => `msg_${i}`);
  const asked: object[] = [];
  const client = {
    message: {
      list: async (query: {
        order?: string;
        limit: number;
        cursor?: string;
      }) => {
        asked.push(query);
        // What OpenCode answers: a cursor already says which way it goes.
        if (query.cursor && query.order)
          throw new Error("Cursor cannot be combined with order");
        const from = Number(query.cursor ?? 0);
        const next = from + query.limit;
        return {
          data: ids.slice(from, next).map((id) => ({ id })),
          cursor: { next: next < ids.length ? String(next) : null },
        };
      },
    },
  } as unknown as Pick<NativeClient, "message">;
  const seen: string[] = [];
  for await (const page of messagePages(client, {
    sessionID: "ses",
    order: "desc",
    limit: 20,
  }))
    seen.push(...page.map((m) => m.id));
  expect(seen).toEqual(ids);
  expect(asked).toEqual([
    { sessionID: "ses", order: "desc", limit: 20 },
    { sessionID: "ses", limit: 20, cursor: "20" },
    { sessionID: "ses", limit: 20, cursor: "40" },
  ]);
});
