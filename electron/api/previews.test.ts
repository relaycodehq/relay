import { expect, it, vi } from "vitest";
import { previewHandlers } from "./previews";
import type { ApiContext } from "./context";

it("rejects browser calls clearly when Relay has no desktop preview service", () => {
  const handlers = previewHandlers({} as ApiContext);
  const id = "11111111-1111-4111-8111-111111111111";
  expect(() => handlers.openPreview([id, null])).toThrow("headless Relay");
  expect(() => handlers.previewAction([id, "reload"])).toThrow(
    "headless Relay",
  );
});

it("passes thread identity when an address initializes a preview", async () => {
  const navigate = vi.fn(async () => {});
  const handlers = previewHandlers({
    previews: { navigate },
  } as unknown as ApiContext);
  const project = "11111111-1111-4111-8111-111111111111";
  const chat = "22222222-2222-4222-8222-222222222222";
  await handlers.navigatePreview([
    project,
    chat,
    "http://localhost:8080/chosen",
  ]);
  expect(navigate).toHaveBeenCalledWith(
    project,
    chat,
    "http://localhost:8080/chosen",
  );
  expect(() =>
    handlers.navigatePreview([project, chat, "file:///tmp/page"]),
  ).toThrow();
});
