import { expect, it } from "vitest";
import { projectChatSendSchema } from "./send";

const image = {
  name: "shot.png",
  mimeType: "image/png",
  dataUrl: "data:image/png;base64,AAAA",
};
const send = {
  id: "b74407b4-0d67-434d-9da6-7fa8f71f88be",
  body: "Review the screenshots",
  provider: "claude",
  choice: { model: "", reasoningEffort: "", fast: false },
  runtimeMode: "approval-required",
  interactionMode: "default",
};

it.each([10, 100])(
  "accepts all %i screenshots in a single message",
  (count) => {
    expect(
      projectChatSendSchema.parse({
        ...send,
        images: Array.from({ length: count }, () => image),
      }).images,
    ).toHaveLength(count);
  },
);

it("still rejects an oversized individual image", () => {
  expect(
    projectChatSendSchema.safeParse({
      ...send,
      images: [
        { ...image, dataUrl: `data:image/png;base64,${"A".repeat(1_100_000)}` },
      ],
    }).success,
  ).toBe(false);
});
