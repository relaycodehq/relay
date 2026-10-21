import type { FormDetail, FormAnswer, FormField } from "@opencode/client";
import type {
  AgentQuestion,
  AskAgentRequest,
} from "../../../shared/agent-modes";
import { OpenCodeHttpError, type NativeClient } from "./client";

function question(field: FormField): AgentQuestion | undefined {
  if (field.type === "external" || field.when?.length) return undefined;
  return {
    id: field.key,
    question: field.title || field.key,
    ...(field.description ? { header: field.description } : {}),
    ...(field.type === "multiselect" ? { multiple: true } : {}),
    ...("options" in field && field.options
      ? {
          options: field.options.map((o) => ({
            label: o.label,
            description: o.description,
          })),
        }
      : field.type === "boolean"
        ? { options: [{ label: "Yes" }, { label: "No" }] }
        : {}),
  };
}

/** Translate labels back to native values; unsupported forms are cancelled with a reason. */
export async function answerForm(
  client: NativeClient,
  form: FormDetail,
  ask: AskAgentRequest | undefined,
  signal: AbortSignal,
) {
  const target = { sessionID: form.sessionID, formID: form.id };
  const fields = form.fields.filter((f) => !("hidden" in f && f.hidden));
  const questions = fields.map(question);
  if (!ask || questions.some((q) => !q) || !questions.length) {
    await client.session.form.cancel({
      ...target,
      message:
        "Relay cannot answer this form. Ask with text or simple choices instead.",
    });
    return;
  }
  const response = await ask(
    {
      kind: "question",
      title: form.title,
      questions: questions as AgentQuestion[],
    },
    signal,
  );
  if (signal.aborted || response.kind !== "question") {
    await client.session.form.cancel(target);
    return;
  }
  const answer: FormAnswer = {};
  for (const field of form.fields) {
    if (field.type === "external") continue;
    if (field.hidden) {
      if (field.default !== undefined) answer[field.key] = field.default;
      continue;
    }
    const values = response.answers[field.key] ?? [];
    if (!values.length && field.default !== undefined) {
      answer[field.key] = field.default;
      continue;
    }
    if (!values.length && !field.required) continue;
    if (
      !values.length ||
      (field.type !== "multiselect" && values.length !== 1)
    ) {
      await client.session.form.cancel({
        ...target,
        message:
          "A required answer was missing or had multiple values. Ask again with the expected format.",
      });
      return;
    }
    if (
      "options" in field &&
      field.options &&
      !field.custom &&
      values.some(
        (value) => !field.options!.some((option) => option.label === value),
      )
    ) {
      await client.session.form.cancel({
        ...target,
        message:
          "The answer must use one of the offered choices. Ask again with the expected choices.",
      });
      return;
    }
    const native = (value: string) =>
      "options" in field
        ? (field.options?.find((o) => o.label === value)?.value ?? value)
        : value;
    if (field.type === "multiselect") answer[field.key] = values.map(native);
    else if (field.type === "boolean") {
      if (values[0] !== "Yes" && values[0] !== "No") {
        await client.session.form.cancel({
          ...target,
          message:
            "The answer must be Yes or No. Ask again with the expected choices.",
        });
        return;
      }
      answer[field.key] = values[0] === "Yes";
    } else if (field.type === "number" || field.type === "integer") {
      const number = Number(values[0]);
      if (
        !values[0]?.trim() ||
        !Number.isFinite(number) ||
        (field.type === "integer" && !Number.isInteger(number))
      ) {
        await client.session.form.cancel({
          ...target,
          message:
            "The answer must be a valid number. Ask again with the expected format.",
        });
        return;
      }
      answer[field.key] = number;
    } else answer[field.key] = native(values[0] ?? "");
  }
  try {
    // The service validates native constraints (ranges, formats, patterns and item counts).
    await client.session.form.reply({ ...target, answer }, { signal });
  } catch (error) {
    if (!(error instanceof OpenCodeHttpError) || error.status !== 400)
      throw error;
    await client.session.form.cancel({
      ...target,
      message:
        "The answers did not meet this form's constraints. Ask again and explain the expected format.",
    });
  }
}
