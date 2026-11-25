import { expect, it } from "vitest";
import { antigravityFailure } from "./failure";

it("tells an error from Google from an answer about one", () => {
  expect(
    antigravityFailure(
      "⚠ INVALID_ARGUMENT (code 400): * tools[0].enum[0]: cannot be empty\n* more",
    ),
  ).toBe(
    "INVALID_ARGUMENT (code 400): * tools[0].enum[0]: cannot be empty\n* more",
  );
  expect(
    antigravityFailure("The log says ⚠ INVALID_ARGUMENT (code 400): bad enum."),
  ).toBeUndefined();
  expect(antigravityFailure("⚠ Back up first.")).toBeUndefined();
});
