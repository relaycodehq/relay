// A Claude Code stand-in that answers slowly, a word at a time, so a test can
// restart Relay mid-answer. Each answer writes its pid to $SLOW_CLAUDE_LOG,
// so the test can tell a session that carried on from one started over.
const { appendFileSync } = require("node:fs");
const session_id = "fixture-slow-claude";
const words =
  "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(
    " ",
  );
let count = 0;
const emit = (value) =>
  process.stdout.write(
    JSON.stringify({ uuid: `slow-${++count}`, session_id, ...value }) + "\n",
  );
const stream = (event) =>
  emit({ type: "stream_event", parent_tool_use_id: null, event });
function answer() {
  if (process.env.SLOW_CLAUDE_LOG)
    appendFileSync(process.env.SLOW_CLAUDE_LOG, `${process.pid}\n`);
  emit({ type: "system", subtype: "init", model: "fixture", tools: [] });
  stream({ type: "message_start", message: { id: "slow-message", usage: {} } });
  stream({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  let at = 0;
  const next = () => {
    if (at < words.length) {
      stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: (at ? " " : "") + words[at++] },
      });
      return setTimeout(next, Number(process.env.SLOW_CLAUDE_MS ?? 250));
    }
    const text = words.join(" ");
    emit({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "slow-message",
        role: "assistant",
        content: [{ type: "text", text }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    emit({
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {},
      permission_denials: [],
    });
  };
  next();
}
require("node:readline")
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    const m = JSON.parse(line);
    if (m.type === "control_request") {
      emit({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response: {
            commands: [],
            // A list shaped like the real CLI's, for specs that need one.
            models: JSON.parse(process.env.SLOW_CLAUDE_MODELS ?? "[]"),
            output_style: "default",
            available_output_styles: [],
          },
        },
      });
      return;
    }
    if (m.type === "user") answer();
  })
  .on("close", () => process.exit(0));
