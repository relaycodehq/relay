/**
 * What the watcher asks beside a running Claude or Codex thread: is there one thing
 * the person would miss and regret? Almost always the answer is no.
 */

const shape = `Answer in exactly this shape, plain text, nothing before it:

learn: none

or, when something clears the bar:

learn: <one sentence, about 20 words, ending with a period: what they should know>
tag: <Heads up | You should know>
title: <3 to 7 words that state the takeaway>
- <plain-English point>
- <plain-English point>
(2 to 5 points, each one sentence; **bold** the one fact that matters most)
diff: <path of the file it is about, only when a short excerpt of a change proves the point>
\`\`\`
<up to 6 lines of that change, - for removed, + for added>
\`\`\`
ask: <one message the person could send you to act on it, written to you as the agent, or none>
said: <where you already told them this, copied word for word from your own message, or never>`;

const bar = `The bar is high. Speak up only when not knowing it costs them money, time, wasted work, a wrong result, or a decision they are in the middle of. Good reasons:
- A result that looks done but is not: tests weakened or skipped to pass, an error swallowed, a check removed, a requirement quietly dropped.
- A decision or tradeoff the agent made in passing that they would likely want a say in.
- A non-obvious fact or edge case that will surprise them later.
Not reasons:
- What the agent does with their latest message, or how it read it. They just wrote it and are about to see the reply; it only counts if the agent does the opposite of something that message says outright.
- The agent's plan or next steps as it announced them, how big or long the work is, or that it is still in progress. Judge what has been done, not what is about to be.
- Anything they asked about, replied to or decided themselves, anything the agent already told them plainly, and anything that was the main point of an answer.
- Trivia, file layout, naming, what a file contains, and anything you are not confident is true.
Would they do something differently once they knew it? If not, it is not worth saying.
Good: "The tests subagent made checkout.spec.ts pass by accepting any total instead of fixing the rounding." "The plan marks a failed setup as done, so it never runs again."
Not good: "Your follow-up was taken as the go-ahead, so the agent is building the whole plan." "This change touches many files." "The agent is about to edit the config."
Pick "Heads up" for something about this session's work with an immediate cost; "You should know" for how something works that matters to their work.
When in doubt, answer learn: none.`;

const list = (items: string[]) =>
  items.length ? items.map((item) => `- ${item}`).join("\n") : "(none)";

/** A subagent's work, for a look back: its transcript isn't in the session. */
export type SubagentRun = { task: string; digest: string };

export type CheckPromptInput = {
  /** Lines already shown in this thread, so the same point isn't made twice. */
  shown: string[];
  /** Notes this thread's person closed with "I know this". */
  topics: string[];
  /** Subagents that changed files this turn. */
  subagents?: SubagentRun[];
};

const runs = (subagents: SubagentRun[]) =>
  subagents.length
    ? `

Subagents you started changed files. Their own transcripts are not in your context; here is what each did, cut short where long:

${subagents.map((s) => `<subagent-run task="${s.task.replace(/"/g, "'")}">\n${s.digest}\n</subagent-run>`).join("\n\n")}

Compare their work with what the person actually asked for. The classic case is a subagent that made a check pass by weakening the check, which its report to you would likely not say.`
    : "";

/** One look back over a turn that just ended, its subagents' work included. */
export function threadCheckPrompt({
  shown,
  topics,
  subagents = [],
}: CheckPromptInput) {
  return `You are a quiet observer beside this session. Do not call tools and do not continue the task. The turn just ended: your last message is the answer the person is about to read. Look back over the turn: is there one thing they should really know, that they very likely missed?

People don't read everything an agent writes. Something said in passing between many tool calls, or buried deep in a long answer, counts as missed; something the answer tells them plainly, or that they asked about or replied to, does not.${runs(subagents)}

${bar}

Already shown to them in this thread. Skip these, and anything that only adds to the same point:
${list(shown)}

In this thread they told you they already know these. Each is a topic they closed: skip it and anything else about the same feature or decision, such as a further gap, edge case or consequence of it:
${list(topics)}

${shape}`;
}
