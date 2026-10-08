import { expect, it } from "vitest";
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
