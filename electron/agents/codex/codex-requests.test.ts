import { expect, it } from "vitest";
import { codexRequest } from "./codex-requests";

const never = async () => {
  throw new Error("The user should not have been asked.");
};

it("fails a question with no id, naming the field, instead of asking one the answer can't be matched to", async () => {
  await expect(
    codexRequest(
      "item/tool/requestUserInput",
      { questions: [{ question: "Which?" }] },
      never,
    ),
  ).rejects.toThrow(
    "Codex sent an unexpected item/tool/requestUserInput request (questions.0.id",
  );
});

it("fails a question request that has no questions list", async () => {
  await expect(
    codexRequest("item/tool/requestUserInput", {}, never),
  ).rejects.toThrow("unexpected item/tool/requestUserInput request (questions");
});

it("asks a question with the optional fields missing, null or new", async () => {
  let asked: any;
  const answer = await codexRequest(
    "item/tool/requestUserInput",
    {
      questions: [
        {
          id: "a",
          question: "Which?",
          header: null,
          isSecret: null,
          options: null,
          somethingNew: 1,
        },
        {
          id: "b",
          question: "How?",
          options: [{ label: "Fast", description: null }, { label: "Slow" }],
        },
      ],
      futureField: true,
    },
    async (request) => {
      asked = request;
      return { kind: "question", answers: { a: ["x"], b: ["Fast"] } };
    },
  );
  expect(asked.questions).toEqual([
    {
      id: "a",
      header: undefined,
      question: "Which?",
      isSecret: false,
      options: undefined,
    },
    {
      id: "b",
      header: undefined,
      question: "How?",
      isSecret: false,
      options: [
        { label: "Fast", description: undefined },
        { label: "Slow", description: undefined },
      ],
    },
  ]);
  expect(answer).toEqual({
    answers: { a: { answers: ["x"] }, b: { answers: ["Fast"] } },
  });
});

it("fails a permissions request that names no permissions instead of granting undefined", async () => {
  await expect(
    codexRequest("item/permissions/requestApproval", { reason: "Why" }, never),
  ).rejects.toThrow(
    "unexpected item/permissions/requestApproval request (permissions",
  );
});

it("fails an approval whose command or reason isn't text", async () => {
  await expect(
    codexRequest(
      "item/commandExecution/requestApproval",
      { command: ["npm", "test"] },
      never,
    ),
  ).rejects.toThrow("unexpected item/commandExecution/requestApproval request");
});

it("asks for a command approval with every optional field left out", async () => {
  let asked: any;
  const answer = await codexRequest(
    "item/commandExecution/requestApproval",
    { command: null, availableDecisions: "accept", unknown: 1 },
    async (request) => {
      asked = request;
      return { kind: "approval", decision: "decline" };
    },
  );
  expect(asked.decisions).toEqual([
    "accept",
    "acceptForSession",
    "decline",
    "cancel",
  ]);
  expect(answer).toEqual({ decision: "decline" });
});
