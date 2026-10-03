import { expect, it } from "vitest";
import { readBounded, ResponseTooLarge } from "./http";

const streamed = (...parts: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts)
          controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
  );

it("reads a body within the limit, including multi-byte text split across chunks", async () => {
  const [a, b] = [
    new TextEncoder().encode("žluť").subarray(0, 1),
    new TextEncoder().encode("žluť").subarray(1),
  ];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(a);
        controller.enqueue(b);
        controller.close();
      },
    }),
  );
  expect(await readBounded(response, 100, "too big")).toBe("žluť");
});

it("refuses a declared length over the limit without reading it", async () => {
  const response = new Response("x".repeat(20), {
    headers: { "content-length": "20" },
  });
  await expect(readBounded(response, 10, "too big")).rejects.toBeInstanceOf(
    ResponseTooLarge,
  );
});

it("stops a streamed body once it passes the limit", async () => {
  await expect(
    readBounded(streamed("12345", "67890", "x"), 10, "too big"),
  ).rejects.toThrow(new ResponseTooLarge("too big"));
});
