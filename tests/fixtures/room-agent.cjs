// Real subprocess transport; deterministic local provider for desktop integration tests.
const fs = require("node:fs");
const args = process.argv.slice(2);
const capture = process.env.RELAY_AGENT_CAPTURE;
function record(data) {
  if (capture)
    fs.appendFileSync(
      capture,
      JSON.stringify({ cwd: process.cwd(), args, ...data }) + "\n",
    );
}
if (args.includes("--print")) {
  let prompt = "";
  process.stdin.on("data", (d) => (prompt += d));
  process.stdin.on("end", () => {
    record({ provider: "claude", prompt });
    process.stdout.write(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: {
            type: "text_delta",
            text: "Claude found the same cache guard.",
          },
        },
      }) + "\n",
    );
    process.stdout.write(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Claude found the same cache guard.",
      }) + "\n",
    );
  });
} else {
  const rl = require("node:readline").createInterface({ input: process.stdin });
  const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  rl.on("line", (line) => {
    const m = JSON.parse(line);
    if (m.id === undefined) return;
    if (m.method === "initialize")
      send({ id: m.id, result: { userAgent: "fixture" } });
    else if (m.method === "config/read")
      send({ id: m.id, result: { config: {} } });
    else if (m.method === "thread/start") {
      record({ provider: "codex", thread: m.params });
      send({
        id: m.id,
        result: {
          thread: { id: "fixture-thread" },
          activePermissionProfile: { id: "review-relay-room" },
        },
      });
    } else if (m.method === "turn/start") {
      record({ provider: "codex", turn: m.params });
      send({ id: m.id, result: { turn: { id: "fixture-turn" } } });
      send({
        method: "turn/started",
        params: { threadId: "fixture-thread", turn: { id: "fixture-turn" } },
      });
      setTimeout(
        () =>
          send({
            method: "item/agentMessage/delta",
            params: {
              threadId: "fixture-thread",
              delta: "The cache guard prevents duplicate requests.",
            },
          }),
        100,
      );
      if (!m.params.input[0].text.includes("wait for cancellation"))
        setTimeout(
          () =>
            send({
              method: "turn/completed",
              params: {
                threadId: "fixture-thread",
                turn: { id: "fixture-turn", status: "completed" },
              },
            }),
          2600,
        );
    } else if (m.method === "turn/interrupt") {
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
