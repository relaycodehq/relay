import type { Session } from "electron";
import { expect, it, vi } from "vitest";
import { faviconData } from "./favicon";

const sessionServing = (responses: Record<string, () => Response>) =>
  ({
    fetch: async (url: string) => responses[url](),
  }) as unknown as Session;

it("stops reading an icon once it passes 1MB, instead of loading all of it", async () => {
  let served = 0;
  const huge = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (served >= 64 * 1024 * 1024) return controller.close();
      served += 64 * 1024;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
  });
  const session = sessionServing({
    "http://localhost/huge.png": () =>
      new Response(huge, { headers: { "content-type": "image/png" } }),
    "http://localhost/small.png": () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
  });

  const icon = await faviconData(session, [
    "http://localhost/huge.png",
    "http://localhost/small.png",
  ]);

  expect(icon).toBe("data:image/png;base64,AQID");
  expect(served).toBeLessThan(2 * 1024 * 1024);
});

it("gives up on an icon that trickles in too slowly and tries the next", async () => {
  vi.useFakeTimers();
  try {
    let cancelled = false;
    const trickle = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise((resolve) =>
          setTimeout(() => {
            if (!cancelled) controller.enqueue(new Uint8Array([0]));
            resolve();
          }, 1000),
        ),
      cancel: () => {
        cancelled = true;
      },
    });
    const session = sessionServing({
      "http://localhost/slow.png": () =>
        new Response(trickle, { headers: { "content-type": "image/png" } }),
      "http://localhost/small.png": () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        }),
    });

    let icon: string | undefined;
    void faviconData(session, [
      "http://localhost/slow.png",
      "http://localhost/small.png",
    ]).then((data) => (icon = data));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(icon).toBe("data:image/png;base64,AQID");
  } finally {
    vi.useRealTimers();
  }
});
