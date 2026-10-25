import type { AgentQuestion } from "../../../shared/agent-modes";
import {
  questionAnswers,
  type AskedQuestion,
} from "../../../shared/asked-questions";
import type { AgentOptions } from "../types";
import {
  cancelledElicitation,
  elicitationRequestSchema,
  type AcpElicitation,
  type AcpFormField,
} from "./protocol";

/** One field of an agent's form as a question on Relay's card. */
type FormQuestion = {
  question: AgentQuestion;
  /** The form's values for this field, from what the user picked or wrote. */
  fill(answers: string[]): [string, unknown][];
};

type Option = NonNullable<AgentQuestion["options"]>[number];

/** Shows a call as asking the user; the returned function records their answers, or none. */
export type QuestionRow = (
  toolCallId?: string,
) => (answers?: AskedQuestion[]) => void;

// The card sends at most 30 answers, keyed by ids of up to 200 characters.
const MAX_QUESTIONS = 30;
const MAX_KEY = 200;

/** OpenCode lets a choice take the user's own words through a `<key>_custom` text field beside it. */
const customKey = (key: string) => `${key}_custom`;

function choicesOf(field: Partial<AcpFormField> | null | undefined) {
  const titled = field?.oneOf ?? field?.anyOf;
  if (titled)
    return titled.map((choice): Option => ({
      label: choice.title || choice.const,
      value: choice.const,
      ...(choice.description ? { description: choice.description } : {}),
    }));
  return field?.enum?.map((value): Option => ({ label: value, value }));
}

/** What the user picked from `options`, and what they wrote instead. */
function split(answers: string[], options: Option[]) {
  const picked = answers.filter((a) => options.some((o) => o.value === a));
  const written = answers
    .filter((a) => !picked.includes(a))
    .map((a) => a.trim())
    .filter(Boolean)
    .join(", ");
  return { picked, written };
}

/** A field the user answers by picking: one choice, or several for an array. */
function choiceQuestion(
  key: string,
  question: AgentQuestion,
  options: Option[],
  custom: string | undefined,
  multiple: boolean,
): FormQuestion {
  return {
    question: {
      ...question,
      ...(multiple ? { multiple } : {}),
      allowCustomAnswer: !!custom,
      options,
    },
    fill: (answers) => {
      const { picked, written } = split(answers, options);
      const fields: [string, unknown][] = [];
      if (picked.length) fields.push([key, multiple ? picked : picked[0]]);
      // A single answer is a pick or the user's own words, never both.
      const ownWords = written && custom && (multiple || !picked.length);
      if (ownWords) fields.push([custom, written]);
      return fields;
    },
  };
}

function numberQuestion(
  key: string,
  question: AgentQuestion,
  integer: boolean,
): FormQuestion {
  return {
    question,
    fill: ([answer]) => {
      const value = Number(answer);
      const valid =
        !!answer?.trim() &&
        (integer ? Number.isInteger(value) : Number.isFinite(value));
      return valid ? [[key, value]] : [];
    },
  };
}

function fieldQuestion(
  key: string,
  field: AcpFormField,
  custom: string | undefined,
  message: string,
): FormQuestion | undefined {
  const question: AgentQuestion = {
    id: key,
    // OpenCode puts a question's short header in the title and the question in the description.
    header: field.description ? (field.title ?? undefined) : undefined,
    question: field.description || field.title || message || key,
  };
  switch (field.type) {
    case "boolean":
      return choiceQuestion(
        key,
        question,
        [
          { label: "Yes", value: "true" },
          { label: "No", value: "false" },
        ],
        undefined,
        false,
      );
    case "number":
    case "integer":
      return numberQuestion(key, question, field.type === "integer");
    case "string": {
      const options = choicesOf(field);
      if (options) return choiceQuestion(key, question, options, custom, false);
      return {
        question,
        fill: (answers) => {
          const written = split(answers, []).written;
          return written ? [[key, written]] : [];
        },
      };
    }
    case "array": {
      const options = choicesOf(field.items);
      return options && choiceQuestion(key, question, options, custom, true);
    }
  }
}

/** The questions an agent's form asks, or undefined for a form the question card can't show. */
export function formQuestions(
  request: AcpElicitation,
): FormQuestion[] | undefined {
  const properties = request.requestedSchema?.properties;
  if (request.mode !== "form" || !properties) return;
  const folded = (key: string) =>
    key.endsWith("_custom") && key.slice(0, -"_custom".length) in properties;
  const keys = Object.keys(properties).filter((key) => !folded(key));
  if (!keys.length || keys.length > MAX_QUESTIONS) return;
  if (keys.some((key) => key.length > MAX_KEY)) return;
  const questions = keys.map((key) =>
    fieldQuestion(
      key,
      properties[key]!,
      customKey(key) in properties ? customKey(key) : undefined,
      request.message ?? "",
    ),
  );
  if (!questions.every((q): q is FormQuestion => q !== undefined)) return;
  return questions;
}

/** The form's content from the card's answers, by question id. */
export const formContent = (
  questions: FormQuestion[],
  answers: Record<string, string[]>,
) =>
  Object.fromEntries(
    questions.flatMap((q) => q.fill(answers[q.question.id] ?? [])),
  );

/**
 * Answers the agent's form with the user's answers to its questions. A form
 * the card can't show, or nobody to ask, cancels it, and the agent goes on
 * without an answer.
 */
export async function answerElicitation(
  options: AgentOptions,
  name: string,
  raw: unknown,
  signal: AbortSignal,
  row: QuestionRow,
) {
  const request = elicitationRequestSchema.parse(raw);
  const questions = formQuestions(request);
  const ask = options.job.kind === "helper" ? undefined : options.onRequest;
  if (!questions || !ask || signal.aborted) return cancelledElicitation;

  const answered = row(request.toolCallId ?? undefined);
  const asked = questions.map((q) => q.question);
  const response = await ask(
    { kind: "question", title: `${name} has a question`, questions: asked },
    signal,
  ).catch(() => undefined);
  if (signal.aborted || response?.kind !== "question") {
    answered();
    return cancelledElicitation;
  }
  answered(questionAnswers(asked, response.answers));
  return {
    action: "accept",
    content: formContent(questions, response.answers),
  };
}
