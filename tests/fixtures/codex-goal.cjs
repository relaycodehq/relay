// `codex app-server` with goals as 0.160 runs them: a goal set active on an
// idle thread starts a turn, and while it stays active each finished turn is
// followed at once by the next, until the goal is met after
// RELAY_GOAL_TURNS turns. RELAY_GOAL holds the goal the thread starts with;
// turn RELAY_GOAL_FAIL_TURN fails, leaving the goal as it was; every request
// goes to RELAY_GOAL_LOG, in order.
const fs = require("node:fs");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\n");
const threadId = "thread";
const turns = Number(process.env.RELAY_GOAL_TURNS ?? 3);
const turnMs = Number(process.env.RELAY_GOAL_TURN_MS ?? 40);
const failTurn = Number(process.env.RELAY_GOAL_FAIL_TURN ?? 0);
let goal = process.env.RELAY_GOAL ? JSON.parse(process.env.RELAY_GOAL) : null;
let turn = 0,
  running = null;
const notifyGoal = () =>
  send({
    method: "thread/goal/updated",
    params: { threadId, turnId: running, goal },
  });
function startTurn() {
  turn++;
  const id = "turn-" + turn;
  running = id;
  send({ method: "turn/started", params: { threadId, turn: { id } } });
  setTimeout(() => {
    if (running !== id) return;
    if (turn === failTurn) {
      running = null;
      return send({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            id,
            status: "failed",
            error: { message: "You've hit your usage limit." },
          },
        },
      });
    }
    send({
      method: "item/completed",
      params: {
        threadId,
        item: {
          id: "a" + turn,
          type: "agentMessage",
          phase: "final_answer",
          text: "Turn " + turn + " done.",
        },
      },
    });
    if (goal && goal.status === "active") {
      goal.tokensUsed = turn * 1000;
      if (turn >= turns) goal.status = "complete";
      notifyGoal();
    }
    running = null;
    send({
      method: "turn/completed",
      params: { threadId, turn: { id, status: "completed" } },
    });
    if (goal && goal.status === "active") setTimeout(startTurn, 5);
  }, turnMs);
  return id;
}
require("node:readline")
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    const m = JSON.parse(line);
    if (m.id === undefined) return;
    if (process.env.RELAY_GOAL_LOG)
      fs.appendFileSync(
        process.env.RELAY_GOAL_LOG,
        JSON.stringify({ method: m.method, params: m.params }) + "\n",
      );
    const reply = (result) => send({ id: m.id, result });
    if (m.method === "initialize") return reply({});
    if (m.method === "config/read") return reply({ config: {} });
    if (m.method === "thread/start" || m.method === "thread/resume")
      return reply({
        thread: { id: threadId },
        model: "gpt-6-astra",
        reasoningEffort: "high",
      });
    if (m.method === "thread/goal/get") return reply({ goal });
    if (m.method === "thread/goal/clear") {
      const cleared = !!goal;
      goal = null;
      send({ method: "thread/goal/cleared", params: { threadId } });
      return reply({ cleared });
    }
    if (m.method === "thread/goal/set") {
      const wasActive = goal && goal.status === "active";
      goal = {
        threadId,
        objective: m.params.objective ?? goal.objective,
        status: m.params.status,
        tokenBudget: null,
        tokensUsed: goal?.tokensUsed ?? 0,
        timeUsedSeconds: goal?.timeUsedSeconds ?? 0,
      };
      reply({ goal });
      notifyGoal();
      if (goal.status === "active" && !wasActive && !running)
        setTimeout(startTurn, 5);
      return;
    }
    if (m.method === "turn/start") return reply({ turn: { id: startTurn() } });
    if (m.method === "turn/interrupt") {
      const id = running;
      running = null;
      reply({});
      if (id)
        send({
          method: "turn/completed",
          params: { threadId, turn: { id, status: "interrupted" } },
        });
      return;
    }
    send({ id: m.id, error: { code: -32601, message: "Not a goal method." } });
  });
