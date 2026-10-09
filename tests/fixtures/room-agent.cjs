// Real subprocess transport; deterministic local provider for desktop integration tests.
const fs = require("node:fs");
const args = process.argv.slice(2);
// A deep review lead's answer: a summary, then its findings for Relay to list.
const leadReport = (findings) =>
  [
    "Reordering the queue can drop a message `F1`.",
    "",
    "```relay-findings",
    JSON.stringify({
      findings,
      dropped: [
        { title: "Unused import", reason: "Already gone.", reviewers: [2] },
      ],
    }),
    "```",
  ].join("\n");
const queueFinding = {
  id: "F1",
  priority: "P1",
  title: "Reordering the queue can drop a message",
  files: [{ path: "src/queue.ts", line: 3 }],
  reviewers: [1, 2],
  check: "Read the drop handler.",
};
const leadAnswer = leadReport([queueFinding]);
const twoFindings = leadReport([
  queueFinding,
  {
    id: "F2",
    priority: "P2",
    title: "The queue never shrinks",
    files: [{ path: "src/queue.ts", line: 1 }],
    reviewers: [2],
  },
]);
const capture = process.env.RELAY_AGENT_CAPTURE;
// How long a Codex turn streams before it completes. A test that must act on a
// running turn either sends "wait for cancellation" or raises this.
const turnMs = Number(process.env.RELAY_AGENT_TURN_MS) || 300;
function record(data) {
  if (capture)
    fs.appendFileSync(
      capture,
      JSON.stringify({
        cwd: process.cwd(),
        pid: process.pid,
        args,
        // Which account's folder it ran with; see electron/agents/accounts.
        claudeConfig: process.env.CLAUDE_CONFIG_DIR,
        codexHome: process.env.CODEX_HOME,
        // A worktree thread's dev-server port offset; see project-chats/worktree-setup.
        portOffset: process.env.RELAY_PORT_OFFSET,
        ...data,
      }) + "\n",
    );
}
// "fixture relay <tool> <json>": calls one of Relay's own tools as the agent
// would, with the server Relay gave it, and answers what came back. Claude
// Code gets it as --mcp-config, Codex in its thread's config.
let codexRelayUrl;
async function callRelayTool(tool, input) {
  const relay = args.includes("--mcp-config")
    ? JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers?.relay
    : codexRelayUrl && {
        url: codexRelayUrl,
        headers: { authorization: `Bearer ${process.env.RELAY_MCP_TOKEN}` },
      };
  if (!relay) return "No relay server.";
  const response = await fetch(relay.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...relay.headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: input },
    }),
  });
  const { result, error } = await response.json();
  if (error) return `Error: ${error.message}`;
  // A picture says what it is: a PNG's size sits in its header.
  const text = result.content
    .map((part) => {
      if (part.type === "text") return part.text;
      const png = Buffer.from(part.data, "base64");
      return `[${part.mimeType} ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}]`;
    })
    .join("\n");
  // Preserve preview tool payloads as code when echoing them into Markdown.
  // Clickable answer links are named separately by Relay.
  return ["open_preview", "screenshot", "console_errors"].includes(tool)
    ? "```\n" + text + "\n```"
    : text;
}
if (args.includes("--permission-prompt-tool")) {
  let approvalGranted = false,
    lateSteer = false,
    // A lead that waits for a steer, then reports its findings.
    leading = false;
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
    if (
      m.type === "control_request" &&
      m.request?.subtype === "side_question"
    ) {
      record({ provider: "claude", side: m.request });
      emit({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response: { response: `On the side: ${m.request.question}` },
        },
      });
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
    if (m.type === "user" && (m.priority === "next" || m.priority === "now")) {
      record({ provider: "claude", prompt: JSON.stringify(m) });
      // Like Claude Code: queue the steer, read it at the next step, answer it.
      // "now" cuts the running turn short first, with a result of its own.
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
        if (m.priority === "now" && !lateSteer)
          emit({
            type: "result",
            subtype: "success",
            uuid: "fixture-aborted",
            session_id: "fixture-claude",
            is_error: false,
            terminal_reason: "aborted_streaming",
            result: "Looking into it.",
            duration_ms: 1,
            duration_api_ms: 1,
            num_turns: 1,
            total_cost_usd: 0,
            usage: { input_tokens: 1, output_tokens: 1 },
            modelUsage: {},
            permission_denials: [],
          });
        lifecycle("started");
        emit({
          type: "stream_event",
          uuid: "fixture-event",
          session_id: "fixture-claude",
          event: { type: "message_start", message: { id: "fixture-steered" } },
        });
        lifecycle("completed");
        finish(leading ? leadAnswer : `Noted: ${m.message.content}`);
      }, 100);
      return;
    }
    if (m.type === "user" && typeof m.message.content === "string") {
      record({ provider: "claude", prompt: JSON.stringify(m) });
      // Like Claude Code's /compact: the boundary, then the summary as a synthetic user message.
      emit({
        type: "system",
        subtype: "compact_boundary",
        uuid: "fixture-boundary",
        session_id: "fixture-claude",
        compact_metadata: {
          trigger: "manual",
          pre_tokens: 9000,
          post_tokens: 900,
        },
      });
      emit({
        type: "user",
        uuid: "fixture-summary",
        session_id: "fixture-claude",
        parent_tool_use_id: null,
        isSynthetic: true,
        message: { role: "user", content: "Summary:\n1. Keep the old API." },
      });
      emit({
        type: "user",
        uuid: "fixture-compacted",
        session_id: "fixture-claude",
        parent_tool_use_id: null,
        isReplay: true,
        message: {
          role: "user",
          content: "<local-command-stdout>Compacted </local-command-stdout>",
        },
      });
      emit({
        type: "result",
        subtype: "success",
        uuid: "fixture-result",
        session_id: "fixture-claude",
        is_error: false,
        result: "",
        duration_ms: 1,
        duration_api_ms: 1,
        num_turns: 0,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      });
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
      } else if (text.includes("fixture relay ")) {
        const [, tool, input] = /fixture relay (\w+) (.*)/.exec(text);
        callRelayTool(tool, JSON.parse(input)).then(finish, (e) =>
          finish(`Failed: ${e.message}`),
        );
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
      } else if (text.startsWith("/code-review")) {
        finish("- **[P1] Queue reorder can drop a message** `src/queue.ts:3`");
      } else if (text.startsWith("You lead a deep review")) {
        leading = m.message.content[0].text.includes("fixture wait for steer");
        if (leading)
          emit({
            type: "stream_event",
            uuid: "fixture-event",
            session_id: "fixture-claude",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Checking the reports." },
            },
          });
        else finish(leadAnswer);
      } else if (text.includes("fixture background task")) {
        finish("Started the background task.");
        // Claude Code starts a turn by itself when the task ends; no user message comes first.
        setTimeout(
          () =>
            text.includes("fixture background task to steer")
              ? emit({
                  type: "stream_event",
                  uuid: "fixture-event",
                  session_id: "fixture-claude",
                  event: {
                    type: "content_block_delta",
                    index: 0,
                    delta: { type: "text_delta", text: "Looking into it." },
                  },
                })
              : finish("The background task finished."),
          300,
        );
      } else if (text.includes("fixture signed out")) {
        // As Claude Code ends a turn whose OAuth refresh failed.
        emit({
          type: "assistant",
          uuid: "fixture-assistant",
          session_id: "fixture-claude",
          parent_tool_use_id: null,
          error: "authentication_failed",
          message: {
            id: "fixture-message",
            role: "assistant",
            content: [
              {
                type: "text",
                text: "Failed to authenticate: OAuth session expired and could not be refreshed",
              },
            ],
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
        emit({
          type: "result",
          subtype: "success",
          uuid: "fixture-result",
          session_id: "fixture-claude",
          is_error: true,
          result: "",
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
          permission_denials: [],
        });
      } else finish("Claude found the same cache guard.");
    }
  });
} else if (args.includes("--print")) {
  let prompt = "";
  process.stdin.on("data", (d) => (prompt += d));
  process.stdin.on("end", () => {
    record({ provider: "claude", prompt });
    // As an account that can't use the model it was asked for.
    if (
      args[args.indexOf("--model") + 1] === process.env.RELAY_AGENT_REJECT_MODEL
    ) {
      process.stdout.write(
        JSON.stringify({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          result: "model not available",
        }) + "\n",
      );
      process.exit(1);
    }
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
  // "fixture codex steer": the turn stays open until a steer, then answers it.
  let awaitingSteer = false;
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
    else if (m.method === "experimentalFeature/enablement/set") {
      record({ features: m.params.enablement });
      send({ id: m.id, result: {} });
    }
    // Codex 0.160 reads a thread's goal; these threads set none.
    else if (m.method === "thread/goal/get")
      send({ id: m.id, result: { goal: null } });
    else if (
      m.method === "thread/start" ||
      m.method === "thread/resume" ||
      m.method === "thread/fork"
    ) {
      record({ provider: "codex", thread: m.params, method: m.method });
      codexRelayUrl = m.params.config?.["mcp_servers.relay.url"];
      send({
        id: m.id,
        result: {
          thread: { id: "fixture-thread" },
          model: "fixture-model",
          activePermissionProfile: { id: "relay-one-off" },
        },
      });
    } else if (m.method === "turn/start") {
      record({ provider: "codex", turn: m.params });
      planning = m.params.collaborationMode?.mode === "plan";
      awaitingSteer = m.params.input.some(
        (i) => i.type === "text" && i.text.includes("fixture codex steer"),
      );
      if (
        m.params.input.some(
          (i) => i.type === "text" && i.text.includes("fixture codex crash"),
        )
      ) {
        // As a CLI whose runtime can't load: dyld aborts it mid-turn.
        process.stderr.write("dyld: Library not loaded: libfixture.dylib\n");
        process.exit(134);
      }
      // Codex refusing the request itself, not failing the turn: its login is rejected.
      if (
        m.params.input.some(
          (i) =>
            i.type === "text" && i.text.includes("fixture codex refused login"),
        )
      ) {
        send({
          id: m.id,
          error: {
            code: -32603,
            message: "unexpected status 401 Unauthorized",
          },
        });
        return;
      }
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
      const asyncPrompt = m.params.input
        .filter((i) => i.type === "text")
        .at(-1)
        .text.split("\n")[0];
      if (asyncPrompt.includes("fixture async question")) {
        awaitingSteer = asyncPrompt.includes("live");
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-async-question",
              type: "agentMessage",
              phase: "commentary",
              delivery: "async",
              text: "Which visibility should I use? I'll keep checking the release while you decide.",
              questions: [
                {
                  title: "Which visibility should I use?",
                  options: ["Private while preparing", "Public now"],
                },
                { title: "Which account should own it?", options: null },
              ],
            },
          },
        });
        // A later tool proves asking didn't stop the turn.
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "after-question",
              type: "commandExecution",
              command: "git status --short",
              status: "completed",
              commandActions: [],
              aggregatedOutput: "",
              exitCode: 0,
            },
          },
        });
      }
      const titling = m.params.input[0].text;
      if (
        titling.startsWith("Generate a short title") ||
        titling.startsWith("This coding-agent thread already has the title")
      ) {
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-title",
              type: "agentMessage",
              phase: "final_answer",
              text: titling.startsWith("This coding-agent thread")
                ? '{"title":"Cache guard rework"}'
                : '{"title":"Cache guard behavior"}',
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
      // Relay's private note, when there is one, comes before the prompt.
      const said = m.params.input.filter((i) => i.type === "text").at(-1).text;
      // The plan runs out mid-turn: Codex says when the window lifts, in
      // seconds, then fails the turn. Only the request itself, not history
      // a later prompt repeats.
      const asked = said.split("\n")[0];
      const failTurn = (error, before) =>
        setTimeout(() => {
          if (before) send(before);
          send({
            method: "turn/completed",
            params: {
              threadId: "fixture-thread",
              turn: { id: "fixture-turn", status: "failed", error },
            },
          });
        }, turnMs);
      // The plan ran out between the last answer and the handoff note.
      if (
        process.env.RELAY_AGENT_NOTE_LIMIT &&
        asked.includes("is taking over this conversation")
      ) {
        failTurn({
          message: "You've hit your usage limit.",
          codexErrorInfo: "usageLimitExceeded",
          additionalDetails: null,
        });
        return;
      }
      if (asked.includes("fixture usage limit")) {
        failTurn(
          {
            message: "You've hit your usage limit.",
            codexErrorInfo: "usageLimitExceeded",
            additionalDetails: null,
          },
          asked.includes("fixture usage limit without reset")
            ? undefined
            : {
                method: "account/rateLimits/updated",
                params: {
                  rateLimits: {
                    primary: {
                      usedPercent: 100,
                      windowDurationMins: 300,
                      resetsAt: Math.floor(Date.now() / 1000) + 600,
                    },
                    secondary: null,
                  },
                },
              },
        );
        return;
      }
      // The provider's own error envelope, as Codex passes it on.
      if (asked.includes("fixture error envelope")) {
        failTurn({
          message:
            "unexpected status 400 Bad Request: " +
            JSON.stringify({
              type: "error",
              status: 400,
              error: {
                type: "invalid_request_error",
                message:
                  "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
              },
            }),
          codexErrorInfo: null,
          additionalDetails: null,
        });
        return;
      }
      // Codex's login expired or was revoked.
      if (asked.includes("fixture codex signed out")) {
        failTurn({
          message: "Your access token could not be refreshed.",
          codexErrorInfo: "unauthorized",
          additionalDetails: null,
        });
        return;
      }
      if (said.includes("fixture relay ")) {
        const [, tool, input] = /fixture relay (\w+) (.*)/.exec(said);
        const answer = (text) => {
          const item = {
            id: "fixture-relay",
            type: "agentMessage",
            phase: "final_answer",
          };
          send({
            method: "item/started",
            params: { threadId: "fixture-thread", item },
          });
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: "fixture-thread",
              itemId: item.id,
              delta: text,
            },
          });
          send({
            method: "item/completed",
            params: { threadId: "fixture-thread", item: { ...item, text } },
          });
          send({
            method: "turn/completed",
            params: {
              threadId: "fixture-thread",
              turn: { id: "fixture-turn", status: "completed" },
            },
          });
        };
        callRelayTool(tool, JSON.parse(input)).then(answer, (e) =>
          answer(`Failed: ${e.message}`),
        );
        return;
      }
      const echo = said.indexOf("fixture echo:");
      const answer =
        (echo >= 0 ? said.slice(echo + "fixture echo:".length).trim() : null) ??
        Object.entries({
          "fixture followup findings": [
            "Found two new issues: `F12` and `F13`.",
            "```relay-findings",
            JSON.stringify({
              findings: [
                {
                  ...queueFinding,
                  id: "F12",
                  title: "A busy supervisor is incorrectly treated as dead",
                  reviewers: [],
                },
                {
                  ...queueFinding,
                  id: "F13",
                  title:
                    "Read-only snapshot directories prevent staging cleanup",
                  reviewers: [],
                },
              ],
              dropped: [],
            }),
            "```",
          ].join("\n"),
          // A review whose focus asks for it reports two findings.
          "fixture two findings": twoFindings,
          "You lead a deep review": leadAnswer,
          "fixture edit files":
            "Added `src/guard.ts`; `src/cache.ts:1` needed no change.",
          "fixture long link": "See `src/long.ts:250`.",
          "fixture pr links":
            "See `src/lib/cache.ts`, `src/components/file-60.tsx` and `src/nowhere.ts`.",
        }).find(([prompt]) => said.includes(prompt))?.[1] ??
        "The cache guard prevents duplicate requests.";
      // An Ultraplan lead in Plan mode answers the council with a plan.
      if (planning && said.includes("The council is back")) {
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-plan",
              type: "plan",
              text: "## Proposed plan\n\n1. Retry with backoff.\n2. Cap the attempts.",
            },
          },
        });
      }
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
        // A change nothing reports, as `rm -rf` or a formatter would leave.
        if (said.includes("and a stray file"))
          fs.writeFileSync(path.join(m.params.cwd, "stray.md"), "Stray.\n");
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
      // A real manual worktree, credited through the normal command activity.
      const madeWorktree = /fixture make worktree (\{[^\n]+\})/.exec(said)?.[1];
      if (madeWorktree) {
        const { folder, branch } = JSON.parse(madeWorktree);
        require("node:child_process").execFileSync(
          "git",
          ["worktree", "add", "-q", "-b", branch, folder, "HEAD"],
          { cwd: m.params.cwd },
        );
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-manual-worktree",
              type: "commandExecution",
              command: `git worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(folder)} HEAD`,
              status: "completed",
              commandActions: [],
              aggregatedOutput: "",
              exitCode: 0,
            },
          },
        });
      }
      // Leaves the checkout on another branch, as landing one in main does.
      const switchTo = /fixture switch branch to (\S+)/.exec(said)?.[1];
      if (switchTo)
        require("node:child_process").execFileSync(
          "git",
          switchTo === "detached"
            ? ["switch", "-q", "--detach"]
            : ["switch", "-q", switchTo],
          { cwd: m.params.cwd },
        );
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
        if (streamed) return streamLong();
        send({
          method: "item/agentMessage/delta",
          params: {
            threadId: "fixture-thread",
            itemId: "fixture-answer",
            delta: answer,
          },
        });
      }, 100);
      // A long answer in small pieces, the way a real one streams, so a test
      // can scroll the thread while it grows.
      const streamed = said.includes("fixture stream long");
      function streamLong() {
        // About 45 s of streaming, still going when a slow CI runner has
        // finished scrolling around in it.
        const text = Array.from({ length: 240 }, (_, i) =>
          i % 7 === 3
            ? "```ts\n" +
              Array.from(
                { length: 6 },
                (_, l) => `const line${l} = ${i} * ${l};`,
              ).join("\n") +
              "\n```"
            : i % 5 === 1
              ? "- first point\n- second point\n- third point"
              : `Paragraph ${i}. The cache guard keeps requests from piling up while the answer grows, one piece after another.`,
        ).join("\n\n");
        const pieces = text.match(/[\s\S]{1,12}/g);
        let at = 0;
        const timer = setInterval(() => {
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: "fixture-thread",
              itemId: "fixture-answer",
              delta: pieces[at++],
            },
          });
          if (at < pieces.length) return;
          clearInterval(timer);
          send({
            method: "item/completed",
            params: {
              threadId: "fixture-thread",
              item: {
                id: "fixture-answer",
                type: "agentMessage",
                phase: "final_answer",
                text,
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
        }, 25);
      }
      if (
        !streamed &&
        !awaitingSteer &&
        !m.params.input[0].text.includes("wait for cancellation")
      )
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
        }, turnMs);
    } else if (m.method === "review/start") {
      // Codex's own review hands its result back as one item.
      record({ provider: "codex", review: m.params });
      send({
        id: m.id,
        result: {
          turn: { id: "fixture-review" },
          reviewThreadId: "fixture-thread",
        },
      });
      send({
        method: "turn/started",
        params: { threadId: "fixture-thread", turn: { id: "fixture-review" } },
      });
      setTimeout(() => {
        send({
          method: "item/completed",
          params: {
            threadId: "fixture-thread",
            item: {
              id: "fixture-review-exit",
              type: "exitedReviewMode",
              review:
                "- [P1] Queue reorder can drop a message — src/queue.ts:3",
            },
          },
        });
        send({
          method: "turn/completed",
          params: {
            threadId: "fixture-thread",
            turn: { id: "fixture-review", status: "completed" },
          },
        });
      }, 300);
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
      if (awaitingSteer) {
        awaitingSteer = false;
        const text = m.params.input[0].text;
        setTimeout(
          () => {
            send({
              method: "item/started",
              params: {
                threadId: "fixture-thread",
                item: {
                  id: "fixture-steer",
                  type: "userMessage",
                  clientId: m.params.clientUserMessageId ?? null,
                  content: m.params.input,
                },
              },
            });
            send({
              method: "item/completed",
              params: {
                threadId: "fixture-thread",
                item: {
                  id: "fixture-steered-answer",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "Noted: " + text,
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
          },
          Number(process.env.RELAY_FIXTURE_STEER_DELAY ?? 0),
        );
      }
    } else if (m.method === "turn/interrupt") {
      record({ interrupt: m.params });
      // Real agents take a while to wind down after being stopped.
      setTimeout(
        () => {
          send({ id: m.id, result: {} });
          send({
            method: "turn/completed",
            params: {
              threadId: "fixture-thread",
              turn: { status: "interrupted" },
            },
          });
        },
        Number(process.env.RELAY_FIXTURE_STOP_DELAY ?? 0),
      );
    } else
      send({
        id: m.id,
        error: { message: "Unexpected fixture method: " + m.method },
      });
  });
}
