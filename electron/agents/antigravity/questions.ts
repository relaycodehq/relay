import type { AgentQuestion } from "../../../shared/agent-modes";
import type { AcpPermissionRequest } from "../acp/protocol";
import { cancelledPermission, picked } from "../acp/protocol";
import type { AgentOptions } from "../types";
import { questionAnswers } from "../../../shared/asked-questions";

/** Google's native choice questions use the permission channel, but are never approvals. */
export function antigravityQuestion(
  request: AcpPermissionRequest,
): AgentQuestion | undefined {
  const id = request.toolCall.toolCallId;
  if (
    !id?.startsWith("interaction_") ||
    id.length > 200 ||
    !request.options.length
  )
    return;
  const ids = new Set(request.options.map((o) => o.optionId));
  if (
    ids.size !== request.options.length ||
    [...ids].some((id) => !id.trim() || id.length > 16000)
  )
    return;
  return {
    id,
    header: "Question",
    question: (request.toolCall.title?.trim() || "Choose an option.").slice(
      0,
      16000,
    ),
    allowCustomAnswer: false,
    options: request.options.map((o) => ({
      label: (o.name?.trim() || o.optionId).slice(0, 512),
      value: o.optionId,
    })),
  };
}

export async function answerAntigravityQuestion(
  options: AgentOptions,
  request: AcpPermissionRequest,
  signal: AbortSignal,
) {
  const question = antigravityQuestion(request);
  if (
    !question ||
    !options.onRequest ||
    signal.aborted ||
    options.job.kind === "helper"
  )
    return cancelledPermission;
  const activity = {
    id: question.id,
    kind: "tool" as const,
    label: "request_user_input",
  };
  options.onActivity?.({ ...activity, status: "running" });
  const response = await options
    .onRequest(
      {
        kind: "question",
        title: "Antigravity has a question",
        questions: [question],
      },
      signal,
    )
    .catch(() => undefined);
  const answers =
    response?.kind === "question" ? response.answers?.[question.id] : undefined;
  const value = answers?.length === 1 ? answers[0] : undefined;
  const exact = request.options.find((o) => o.optionId === value);
  const labels = question.options!.filter((o) => o.label === value);
  const selected =
    exact?.optionId ?? (labels.length === 1 ? labels[0]!.value : undefined);
  const accepted = !signal.aborted && selected !== undefined;
  options.onActivity?.({
    ...activity,
    status: accepted ? "complete" : "stopped",
    ...(accepted
      ? {
          questionAnswers: questionAnswers([question], {
            [question.id]: [selected],
          }),
        }
      : {}),
  });
  return accepted ? picked(selected) : cancelledPermission;
}
