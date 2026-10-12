import { expect, it } from "vitest";
import { SubagentBook, SubagentBooks } from "./subagent-book";

it("calls one stopped however its agent then words the ending, with its call cut off and no report", async () => {
  const book = new SubagentBook();
  // OpenCode fails the task call of a subagent it aborted.
  book.start("x", {
    description: "Look",
    stop: async () => book.end("x", "failed", "Task cancelled"),
  });
  book.call("x", {
    id: "c",
    kind: "command",
    label: "sleep 30",
    status: "running",
  });
  await book.stop("x");
  expect(book.detail("x")).toMatchObject({
    status: "stopped",
    trace: [{ activity: { status: "stopped" } }],
  });
  expect(book.detail("x")).not.toHaveProperty("report");
  await expect(book.stop("x")).rejects.toThrow(/already finished/);
});

it("counts a session's agents as stopped once the session is gone", () => {
  const books = new SubagentBooks();
  books.open("k").start("x", { description: "Look" });
  const before = books.get("k")!;
  books.drop("k");
  expect(before.list()[0]?.status).toBe("stopped");
  expect(books.get("k")).toBeUndefined();
});
