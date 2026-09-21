import { z } from "zod";
import {
  bodySchema,
  filePathSchema,
  shaSchema,
  sideSchema,
} from "./validation";
export const lineQuestionSchema = z
  .object({
    head: shaSchema,
    base: shaSchema,
    path: filePathSchema,
    start: z.number().int().min(1).max(2_000_000),
    end: z.number().int().min(1).max(2_000_000),
    side: sideSchema,
    question: bodySchema.refine((v) => !!v.trim(), "Enter your question."),
  })
  .strict()
  .refine(
    (v) => v.end >= v.start && v.end - v.start < 200,
    "Select up to 200 lines on one side.",
  );
export type LineQuestion = z.infer<typeof lineQuestionSchema>;
export type QuestionTarget = Pick<
  LineQuestion,
  "path" | "start" | "end" | "side"
>;

export function lineExcerpt(text: string, start: number, end: number) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (end > lines.length)
    throw new Error(
      "The selected lines are no longer available. Refresh the file.",
    );
  const first = Math.max(1, start - 25),
    last = Math.min(lines.length, end + 25);
  const excerpt = lines.slice(first - 1, last).map((text, index) => ({
    line: first + index,
    selected: first + index >= start && first + index <= end,
    text,
  }));
  if (JSON.stringify(excerpt).length > 60_000)
    throw new Error(
      "This selection is too large for a line question. Select a smaller range.",
    );
  return excerpt;
}
