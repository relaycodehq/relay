// Real subprocess transport; deterministic local provider for desktop integration tests.
const fs = require("node:fs");
const args = process.argv.slice(2);
const capture = process.env.RELAY_AGENT_CAPTURE;
function record(data) {
  if (capture)
    fs.appendFileSync(
      capture,
      JSON.stringify({ cwd: process.cwd(), pid: process.pid, args, ...data }) +
        "\n",
    );
}
if (args.includes("--permission-prompt-tool")) {
  let approvalGranted = false,
    lateSteer = false;
  const rl = require("node:readline").createInterface({ input: process.stdin });
  const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  function finish(answer) {
    emit({
      type: "assistant",
      uuid: "fixture-assistant",
      session_id: "fixture-claude",
      parent_tool_use_id: null,
      message: {
        id: "fixture-message",
        role: "assistant",
        content: [{ type: "text", text: answer }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    emit({
      type: "stream_event",
      uuid: "fixture-event",
      session_id: "fixture-claude",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: answer },
      },
    });
    emit({
      type: "result",
      subtype: "success",
      uuid: "fixture-result",
      session_id: "fixture-claude",
      is_error: false,
      result: answer,
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {},
      permission_denials: [],
    });
  }
  rl.on("line", (line) => {
    const m = JSON.parse(line);
    if (m.type === "control_response") {
      record({ claudeResponse: m });
      if (m.response?.response?.updatedPermissions?.length)
        approvalGranted = true;
      finish("Approval flow completed.");
      return;
    }
    if (m.type === "control_request") {
      emit({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response: {
            commands: [],
            models: [],
            output_style: "default",
            available_output_styles: [],
          },
        },
      });
    }
    if (m.type === "user" && m.priority === "next") {
      record({ provider: "claude", prompt: JSON.stringify(m) });
      // Like Claude Code: queue the steer, read it at the next step, answer it.
      const lifecycle = (state) =>
        emit({
          type: "command_lifecycle",
          command_uuid: m.uuid,
          state,
          uuid: `fixture-lifecycle-${state}`,
          session_id: "fixture-claude",
        });
      lifecycle("queued");
      // A steer that arrives after the last step runs as a turn of its own.
      if (lateSteer) finish("Done before your note.");
      setTimeout(() => {
        lifecycle("started");
        emit({
          type: "stream_event",
          uuid: "fixture-event",
          session_id: "fixture-claude",
          event: { type: "message_start", message: { id: "fixture-steered" } },
        });
        lifecycle("completed");
        finish(`Noted: ${m.message.content}`);
      }, 100);
      return;
    }
    if (m.type === "user") {
      record({ provider: "claude", prompt: JSON.stringify(m) });
      const text = m.message.content
        .find((p) => p.type === "text")
        .text.split("\n\n")[0];
      if (
        (!approvalGranted && text.includes("fixture request approval")) ||
        text.includes("fixture ask question") ||
        text.includes("fixture propose plan")
      ) {
        const tool = text.includes("fixture ask question")
          ? "AskUserQuestion"
          : text.includes("fixture propose plan")
            ? "ExitPlanMode"
            : "Bash";
        emit({
          type: "control_request",
          request_id: "fixture-claude-request",
          request: {
            subtype: "can_use_tool",
            tool_name: tool,
            tool_use_id: "fixture-tool",
            input:
              tool === "AskUserQuestion"
                ? {
                    questions: [
                      {
                        header: "Approach",
                        question: "Which approach should the plan use?",
                        options: [
                          {
                            label: "Small change",
                            description: "Reuse the current design",
                          },
                          { label: "Refactor", description: "Restructure it" },
                        ],
                      },
                    ],
                  }
                : tool === "ExitPlanMode"
                  ? {
                      plan: "## Proposed plan\n\n1. Update the cache guard.\n2. Verify the fix.",
                    }
                  : { command: "npm test" },
            permission_suggestions: [
              {
                type: "addRules",
                rules: [{ toolName: "Bash", ruleContent: "npm test" }],
                behavior: "allow",
                destination: "session",
              },
            ],
          },
        });
      } else if (
        text.includes("fixture wait for steer") ||
        text.includes("fixture late steer")
      ) {
        // Keeps working until a steer arrives.
        lateSteer = text.includes("fixture late steer");
        emit({
          type: "stream_event",
          uuid: "fixture-event",
          session_id: "fixture-claude",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Looking into it." },
          },
        });
      } else if (text.includes("fixture background task")) {
        finish("Started the background task.");
        // Claude Code starts a turn by itself when the task ends; no user message comes first.
        setTimeout(() => finish("The background task finished."), 300);
      } else finish("Claude found the same cache guard.");
    }
  });
} else if (args.includes("--print")) {
  let prompt = "";
  process.stdin.on("data", (d) => (prompt += d));
  process.stdin.on("end", () => {
    record({ provider: "claude", prompt });
    const text = args.includes("--input-format")
      ? JSON.parse(prompt).message.content.find((part) => part.type === "text")
          .text
      : prompt;
    const answer = text.startsWith("Generate a short title")
      ? '{"title":"Cache guard behavior"}'
      : "Claude found the same cache guard.";
    process.stdout.write(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: {
            type: "text_delta",
            text: answer,
          },
        },
      }) + "\n",
    );
    process.stdout.write(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: answer,
      }) + "\n",
    );
  });
} else {
  const rl = require("node:readline").createInterface({ input: process.stdin });
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  let planning = false;
  let approvalGranted = false;
  rl.on("line", (line) => {
    const m = JSON.parse(line);
    if (m.id === undefined) return;
    if (m.id === "fixture-approval" || m.id === "fixture-question") {
      record({ response: m });
      if (m.result?.decision === "acceptForSession") approvalGranted = true;
      if (planning) {
        send({
          method: "item/plan/delta",
          params: {
            threadId: "fixture-thread",
            itemId: "fixture-plan",
            delta: "## Proposed plan\n\n1. Update the cache guard.",
          },
        });
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-plan",
              type: "plan",
              text: "## Proposed plan\n\n1. Update the cache guard.\n2. Verify the fix.",
            },
          },
        });
      }
      send({
        method: "item/completed",
        params: {
          threadId: "fixture-thread",
          item: {
            id: "fixture-answer",
            type: "agentMessage",
            phase: "final_answer",
            text: "Approval flow completed.",
          },
        },
      });
      send({
        method: "turn/completed",
        params: {
          threadId: "fixture-thread",
          turn: { id: "fixture-turn", status: "completed" },
        },
      });
      return;
    }
    if (m.method === "initialize") {
      if (process.env.RELAY_AGENT_HOLD_INITIALIZE === "1") {
        record({ initializing: true });
        return;
      }
      send({ id: m.id, result: { userAgent: "fixture" } });
    } else if (m.method === "skills/list") {
      record({ discovery: true });
      send({
        id: m.id,
        result: {
          data: [
            {
              cwd: process.cwd(),
              skills: [
                {
                  name: "explain",
                  path: require("node:path").join(
                    process.cwd(),
                    ".agents/skills/explain/SKILL.md",
                  ),
                  enabled: true,
                  description: "Explain this project",
                },
                {
                  name: "disabled-skill",
                  path: "/tmp/disabled/SKILL.md",
                  enabled: false,
                  description: "Disabled",
                },
              ],
            },
          ],
        },
      });
    } else if (m.method === "config/read")
      send({ id: m.id, result: { config: {} } });
    else if (
      m.method === "thread/start" ||
      m.method === "thread/resume" ||
      m.method === "thread/fork"
    ) {
      record({ provider: "codex", thread: m.params, method: m.method });
      send({
        id: m.id,
        result: {
          thread: { id: "fixture-thread" },
          model: "fixture-model",
          activePermissionProfile: { id: "review-relay-room" },
        },
      });
    } else if (m.method === "turn/start") {
      record({ provider: "codex", turn: m.params });
      planning = m.params.collaborationMode?.mode === "plan";
      send({ id: m.id, result: { turn: { id: "fixture-turn" } } });
      send({
        method: "turn/started",
        params: { threadId: "fixture-thread", turn: { id: "fixture-turn" } },
      });
      send({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "fixture-thread",
          turnId: "fixture-turn",
          tokenUsage: {
            last: { totalTokens: 193_500 },
            total: { totalTokens: 412_000 },
            modelContextWindow: 258_000,
          },
        },
      });
      if (
        !approvalGranted &&
        m.params.input[0].text
          .split("\n\n")[0]
          .includes("fixture request approval")
      ) {
        send({
          id: "fixture-approval",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "fixture-thread",
            turnId: "fixture-turn",
            itemId: "fixture-command",
            command: "npm test",
            cwd: process.cwd(),
            reason: "Run the project checks",
            availableDecisions: [
              "accept",
              "acceptForSession",
              "decline",
              "cancel",
            ],
          },
        });
        return;
      }
      if (
        m.params.input[0].text.split("\n\n")[0].includes("fixture ask question")
      ) {
        send({
          id: "fixture-question",
          method: "item/tool/requestUserInput",
          params: {
            threadId: "fixture-thread",
            turnId: "fixture-turn",
            itemId: "fixture-question",
            questions: [
              {
                id: "approach",
                header: "Approach",
                question: "Which approach should the plan use?",
                options: [
                  {
                    label: "Small change",
                    description: "Reuse the current design",
                  },
                  { label: "Refactor", description: "Restructure it" },
                ],
              },
            ],
          },
        });
        return;
      }
      if (m.params.input[0].text.startsWith("Generate a short title")) {
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-title",
              type: "agentMessage",
              phase: "final_answer",
              text: '{"title":"Cache guard behavior"}',
            },
          },
        });
        send({
          method: "turn/completed",
          params: {
            threadId: "fixture-thread",
            turn: { id: "fixture-turn", status: "completed" },
          },
        });
        return;
      }
      // Answers that link project files, for the chat's file links.
      const said = m.params.input[0].text;
      const answer =
        Object.entries({
          "fixture edit files":
            "Added `src/guard.ts`; `src/cache.ts:1` needed no change.",
          "fixture long link": "See `src/long.ts:250`.",
          "fixture pr links":
            "See `src/lib/cache.ts`, `src/components/file-60.tsx` and `src/nowhere.ts`.",
        }).find(([prompt]) => said.includes(prompt))?.[1] ??
        "The cache guard prevents duplicate requests.";
      // Edits the checkout mid-turn, so Relay's turn snapshots see changes.
      if (said.includes("fixture edit files")) {
        const fs = require("node:fs"),
          path = require("node:path");
        fs.appendFileSync(
          path.join(m.params.cwd, "README.md"),
          "Edited by the agent.\n",
        );
        fs.mkdirSync(path.join(m.params.cwd, "src"), { recursive: true });
        fs.writeFileSync(
          path.join(m.params.cwd, "src", "guard.ts"),
          "export const guard = true;\n",
        );
        // Codex reports its own edits; Relay credits the turn with only these.
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-edit",
              type: "fileChange",
              status: "completed",
              changes: [
                {
                  path: path.join(m.params.cwd, "README.md"),
                  kind: { type: "update", move_path: null },
                  diff: "",
                },
                {
                  path: path.join(m.params.cwd, "src", "guard.ts"),
                  kind: { type: "add" },
                  diff: "",
                },
              ],
            },
          },
        });
      }
      if (!process.env.RELAY_AGENT_NO_TITLE)
        send({
          method: "thread/name/updated",
          params: {
            threadId: "fixture-thread",
            threadName: "Cache guard behavior",
          },
        });
      send({
        method: "item/started",
        params: {
          threadId: "fixture-thread",
          item: {
            id: "fixture-commentary",
            type: "agentMessage",
            phase: "commentary",
          },
        },
      });
      send({
        method: "item/agentMessage/delta",
        params: {
          threadId: "fixture-thread",
          itemId: "fixture-commentary",
          delta: "I'll inspect the cache guard first.",
        },
      });
      send({
        method: "item/completed",
        params: {
          threadId: "fixture-thread",
          item: {
            id: "fixture-commentary",
            type: "agentMessage",
            phase: "commentary",
            text: "I'll inspect the cache guard first.",
          },
        },
      });
      send({
        method: "item/started",
        params: {
          threadId: "fixture-thread",
          item: {
            id: "fixture-command",
            type: "commandExecution",
            command: "git diff --stat",
            status: "inProgress",
          },
        },
      });
      send({
        method: "item/completed",
        params: {
          threadId: "fixture-thread",
          item: {
            id: "fixture-command",
            type: "commandExecution",
            command: "git diff --stat",
            status: "completed",
            exitCode: 0,
            aggregatedOutput: "example.ts | 2 +-",
          },
        },
      });
      setTimeout(() => {
        send({
          method: "item/started",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-answer",
              type: "agentMessage",
              phase: "final_answer",
            },
          },
        });
        send({
          method: "item/agentMessage/delta",
          params: {
            threadId: "fixture-thread",
            itemId: "fixture-answer",
            delta: answer,
          },
        });
      }, 100);
      if (!m.params.input[0].text.includes("wait for cancellation"))
        setTimeout(() => {
          send({
            method: "item/completed",
            params: {
              threadId: "fixture-thread",
              item: {
                id: "fixture-answer",
                type: "agentMessage",
                phase: "final_answer",
                text: answer,
              },
            },
          });
          send({
            method: "turn/completed",
            params: {
              threadId: "fixture-thread",
              turn: { id: "fixture-turn", status: "completed" },
            },
          });
        }, 2600);
    } else if (m.method === "thread/compact/start") {
      record({ compact: m.params });
      send({ id: m.id, result: {} });
      send({
        method: "turn/started",
        params: { threadId: "fixture-thread", turn: { id: "fixture-compact" } },
      });
      setTimeout(() => {
        send({
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "fixture-thread",
            turnId: "fixture-compact",
            tokenUsage: {
              last: { totalTokens: 18_000 },
              total: { totalTokens: 430_000 },
              modelContextWindow: 258_000,
            },
          },
        });
        send({
          method: "turn/completed",
          params: {
            threadId: "fixture-thread",
            turn: { id: "fixture-compact", status: "completed" },
          },
        });
      }, 300);
    } else if (m.method === "turn/steer") {
      record({ steer: m.params });
      send({ id: m.id, result: { turnId: "fixture-turn" } });
    } else if (m.method === "turn/interrupt") {
      record({ interrupt: m.params });
      send({ id: m.id, result: {} });
      send({
        method: "turn/completed",
        params: { threadId: "fixture-thread", turn: { status: "interrupted" } },
      });
    } else
      send({
        id: m.id,
        error: { message: "Unexpected fixture method: " + m.method },
      });
  });
}
