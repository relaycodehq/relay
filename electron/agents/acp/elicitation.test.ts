import { expect, it } from "vitest";
import { formContent, formQuestions } from "./elicitation";

it("answers a yes-or-no field with a boolean, as its schema asks", () => {
  const questions = formQuestions({
    mode: "form",
    message: "Overwrite the file?",
    requestedSchema: {
      properties: {
        overwrite: { type: "boolean", title: "Overwrite" },
        backup: { type: "boolean", title: "Keep a backup" },
      },
    },
  })!;
  expect(
    formContent(questions, { overwrite: ["true"], backup: ["false"] }),
  ).toEqual({ overwrite: true, backup: false });
});
