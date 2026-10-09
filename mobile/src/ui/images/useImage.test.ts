import { beforeEach, expect, it, vi } from "vitest";
import { imageFailed, useImage, type Source } from "./useImage";

// Drive render/effect cleanup separately so late bridge replies can be tested deterministically.
const hooks = vi.hoisted(() => ({
  state: undefined as unknown,
  dependencies: undefined as unknown[] | undefined,
  effect: undefined as (() => void | (() => void)) | undefined,
  cleanup: undefined as (() => void) | undefined,
}));
const remote = vi.hoisted(() => ({
  active: "one",
  status: "online",
  overview: { bridge: 14 } as { bridge?: number } | undefined,
  call: vi.fn(),
  desktop: vi.fn(),
}));
const outgoing = vi.hoisted(() => vi.fn());
vi.mock("react", () => ({
  useState: () => [
    hooks.state,
    (value: unknown) => {
      hooks.state = value;
    },
  ],
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    if (
      dependencies.some(
        (value, i) => !Object.is(value, hooks.dependencies?.[i]),
      )
    ) {
      hooks.effect = effect;
      hooks.dependencies = dependencies;
    }
  },
}));
vi.mock("../../remote/RemoteProvider", () => ({ useRemote: () => remote }));
vi.mock("../../remote/outbox", () => ({ outgoingImage: outgoing }));

const render = (source: Source, max?: number) => {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- This harness drives the mocked hook lifecycle.
  const result = useImage(source, max);
  if (hooks.effect) {
    hooks.cleanup?.();
    hooks.cleanup = hooks.effect() || undefined;
    hooks.effect = undefined;
  }
  return result;
};
let id = 0;
const source = (path = "/shot.png"): Source => ({
  kind: "read",
  chatId: "chat",
  messageId: String(++id),
  path,
});
const deferred = () => {
  let resolve!: (data: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  hooks.cleanup?.();
  hooks.state = hooks.dependencies = hooks.effect = hooks.cleanup = undefined;
  remote.active = "one";
  remote.status = "online";
  remote.overview = { bridge: 14 };
  remote.call.mockReset();
  remote.desktop.mockReset();
  outgoing.mockReset().mockReturnValue("pending-image");
});

it("ignores an old row's reply when the live row changes images", async () => {
  const a = source(),
    b = source("/sidebar.png");
  const first = deferred(),
    second = deferred();
  remote.call
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(a, 264);
  await Promise.resolve();
  expect(render(b, 264).uri).toBeUndefined();
  first.resolve("old-image");
  await vi.waitFor(() => expect(remote.call).toHaveBeenCalledTimes(2));
  expect(render(b, 264).uri).toBeUndefined();
  second.resolve("new-image");
  await vi.waitFor(() => expect(render(b, 264).uri).toBe("new-image"));
  expect(remote.call).toHaveBeenCalledTimes(2);
});

it("doesn't keep a loaded thumbnail when opening full size or switching computers", async () => {
  const image = source();
  remote.call.mockResolvedValue("thumbnail");
  render(image, 264);
  await vi.waitFor(() => expect(render(image, 264).uri).toBe("thumbnail"));
  remote.desktop.mockResolvedValue("full");
  expect(render(image).uri).toBeUndefined();
  await vi.waitFor(() => expect(render(image).uri).toBe("full"));
  remote.active = "two";
  remote.call.mockResolvedValue("other-computer");
  expect(render(image, 264).uri).toBeUndefined();
  await vi.waitFor(() => expect(render(image, 264).uri).toBe("other-computer"));
});

it("waits for the bridge version and fetches once on older desktops", async () => {
  const image = source();
  remote.overview = undefined;
  render(image, 264);
  await Promise.resolve();
  expect(remote.desktop).not.toHaveBeenCalled();
  expect(remote.call).not.toHaveBeenCalled();
  remote.overview = { bridge: 13 };
  remote.desktop.mockResolvedValue("legacy-full");
  render(image, 264);
  await vi.waitFor(() => expect(render(image, 264).uri).toBe("legacy-full"));
  expect(remote.desktop).toHaveBeenCalledWith(
    "projectChatReadImage",
    "chat",
    image.kind === "read" && image.messageId,
    "/shot.png",
  );
  expect(render(image).uri).toBe("legacy-full");
  await Promise.resolve();
  expect(remote.desktop).toHaveBeenCalledTimes(1);
});

it("retries a transient failure when the connection returns", async () => {
  const image = source();
  remote.call.mockRejectedValueOnce(new Error("offline"));
  render(image, 264);
  await vi.waitFor(() => expect(render(image, 264).failed).toBe(true));
  remote.status = "offline";
  render(image, 264);
  remote.status = "online";
  remote.call.mockResolvedValue("retried");
  render(image, 264);
  await vi.waitFor(() => expect(render(image, 264).uri).toBe("retried"));
});

it("uses the legacy image call when the overview omits its bridge version", async () => {
  const image = source();
  remote.overview = {};
  remote.desktop.mockResolvedValue("legacy-full");
  render(image, 264);
  await vi.waitFor(() => expect(render(image, 264).uri).toBe("legacy-full"));
  expect(remote.call).not.toHaveBeenCalled();
  expect(remote.desktop).toHaveBeenCalledTimes(1);
});

it("uses the outbox for pending attachments without fetching them", async () => {
  expect(render({ kind: "pending", messageId: "pending", index: 0 }).uri).toBe(
    "pending-image",
  );
  await Promise.resolve();
  expect(remote.call).not.toHaveBeenCalled();
  expect(remote.desktop).not.toHaveBeenCalled();
});

it("keeps an open pending image after its acknowledged send leaves the outbox", () => {
  const pending: Source = { kind: "pending", messageId: "sending", index: 0 };
  expect(render(pending, 264).uri).toBe("pending-image");
  outgoing.mockReturnValue(undefined);
  expect(render(pending, 528).uri).toBe("pending-image");
  expect(render(pending).uri).toBe("pending-image");
  expect(render({ ...pending, index: 1 }).uri).toBeUndefined();
  expect(remote.call).not.toHaveBeenCalled();
  expect(remote.desktop).not.toHaveBeenCalled();
});

it("skips failed previews in galleries while still allowing a full-size retry", async () => {
  const image = source();
  remote.call.mockRejectedValue(new Error("This turn didn't read that image."));
  render(image, 264);
  await vi.waitFor(() => expect(render(image, 264).failed).toBe(true));
  expect(imageFailed(image, "one")).toBe(true);
  remote.desktop.mockResolvedValue("full");
  render(image);
  await vi.waitFor(() => expect(render(image).uri).toBe("full"));
  expect(imageFailed(image, "one")).toBe(false);
});
