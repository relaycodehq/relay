import { expect, it } from "vitest";
import { popupBounds } from "./usePopupBounds";

const viewport = { width: 800, height: 600 };

it("prefers above and keeps the popup inside the horizontal viewport", () => {
  expect(
    popupBounds(
      { top: 450, bottom: 550, left: 650, width: 300 },
      viewport,
      340,
    ),
  ).toEqual({ left: 488, width: 300, bottom: 156, maxHeight: 340 });
});

it("opens below a high anchor and limits height to the available space", () => {
  expect(
    popupBounds({ top: 10, bottom: 120, left: -20, width: 900 }, viewport, 800),
  ).toEqual({ left: 12, width: 776, top: 126, maxHeight: 462 });
});

it("uses the roomier side when neither side fits the preferred height", () => {
  expect(
    popupBounds({ top: 260, bottom: 420, left: 20, width: 300 }, viewport, 340),
  ).toMatchObject({ bottom: 346, maxHeight: 242 });
});

it("fits a short command list above without reserving the full menu height", () => {
  expect(
    popupBounds(
      { top: 120, bottom: 210, left: 20, width: 300 },
      viewport,
      288,
      80,
    ),
  ).toMatchObject({ bottom: 486, maxHeight: 102 });
});
