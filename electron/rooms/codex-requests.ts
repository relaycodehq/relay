import type {
  AskAgentRequest,
  AgentDecision,
  AgentQuestion,
} from "../../shared/agent-modes";
/** Translate native requests; never accept permissions invented by the renderer. */
export async function codexRequest(
  method: string,
  params: any,
  ask: AskAgentRequest,
) {
  if (method === "item/tool/requestUserInput") {
    const questions: AgentQuestion[] = (params.questions ?? []).map(
      (q: any) => ({
        id: q.id,
        header: q.header,
        question: q.question,
        isSecret: !!q.isSecret,
        options: q.options?.map((o: any) => ({
          label: o.label,
          description: o.description,
        })),
      }),
    );
    if (!questions.length || questions.length > 10)
      throw new Error("Invalid provider questions.");
    const response = await ask({
      kind: "question",
      title: "Codex needs your input",
      questions,
    });
    if (response.kind !== "question")
      throw new Error("Invalid question response.");
    return {
      answers: Object.fromEntries(
        Object.entries(response.answers).map(([id, answers]) => [
          id,
          { answers },
        ]),
      ),
    };
  }
  if (
    [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
    ].includes(method)
  ) {
    const offered: AgentDecision[] = [
      "accept",
      "acceptForSession",
      "decline",
      "cancel",
    ];
    const decisions = Array.isArray(params.availableDecisions)
      ? offered.filter((d) => params.availableDecisions.includes(d))
      : offered;
    const command = method === "item/commandExecution/requestApproval";
    const permissions = method === "item/permissions/requestApproval";
    const detail = [
      params.reason,
      command ? params.command : null,
      params.cwd ? `Directory: ${params.cwd}` : null,
      permissions ? JSON.stringify(params.permissions, null, 2) : null,
      !command && !permissions
        ? JSON.stringify(params.changes ?? params.grantRoot, null, 2)
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    const response = await ask({
      kind: "approval",
      title: command
        ? "Run this command?"
        : permissions
          ? "Allow additional access?"
          : "Allow these file changes?",
      detail,
      decisions,
    });
    if (response.kind !== "approval")
      throw new Error("Invalid approval response.");
    if (permissions)
      return {
        permissions: ["accept", "acceptForSession"].includes(response.decision)
          ? params.permissions
          : {},
        scope: response.decision === "acceptForSession" ? "session" : "turn",
      };
    return { decision: response.decision };
  }
  throw new Error(`Unsupported Codex request: ${method}`);
}
