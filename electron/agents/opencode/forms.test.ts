import type { FormDetail, FormField } from "@opencode/client";
import { expect, it, vi } from "vitest";
import { OpenCodeHttpError, type NativeClient } from "./client";
import { answerForm } from "./forms";

async function answer(field: FormField, values: string[], failure?: Error) {
  const reply = failure
    ? vi.fn().mockRejectedValue(failure)
    : vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const client = {
    session: { form: { reply, cancel } },
  } as unknown as NativeClient;
  const form: FormDetail = {
    id: "frm_test",
    sessionID: "ses_test",
    title: "A question",
    fields: [field],
    state: { status: "pending" },
  };
  const ask = vi.fn(async () => ({
    kind: "question" as const,
    answers: { value: values },
  }));
  await answerForm(client, form, ask, new AbortController().signal);
  return { reply, cancel };
}

it.each([
  [{ key: "value", type: "boolean", required: true }, ["maybe"]],
  [{ key: "value", type: "string", required: true }, []],
  [{ key: "value", type: "integer" }, ["2.5"]],
  [
    {
      key: "value",
      type: "string",
      options: [{ label: "SQLite", value: "sqlite" }],
    },
    ["Something else"],
  ],
] as [FormField, string[]][])(
  "cancels an unrepresentable answer instead of silently changing its meaning: %j",
  async (field, values) => {
    const { reply, cancel } = await answer(field, values);
    expect(reply).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.any(String) }),
    );
  },
);

it("preserves an optional boolean's false default", async () => {
  const { reply, cancel } = await answer(
    { key: "value", type: "boolean", default: false },
    [],
  );
  expect(reply).toHaveBeenCalledWith(
    expect.objectContaining({ answer: { value: false } }),
    expect.anything(),
  );
  expect(cancel).not.toHaveBeenCalled();
});

it("lets the service reject field constraints, then explains the rejected answer without retrying it", async () => {
  const { reply, cancel } = await answer(
    { key: "value", type: "number", minimum: 5 },
    ["2"],
    // As the SDK hands it over: our fetch's error inside its ClientError("Transport").
    new Error("Transport", { cause: new OpenCodeHttpError(400) }),
  );
  expect(reply).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      message: expect.stringContaining("constraints"),
    }),
  );
});

it("propagates service failures without cancelling an answer whose outcome is unknown", async () => {
  await expect(
    answer(
      { key: "value", type: "string" },
      ["hello"],
      new OpenCodeHttpError(503),
    ),
  ).rejects.toThrow("HTTP 503");
});
