/**
 * What the watcher asks beside a running Claude thread: is there one thing
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
ask: <one message the person could send Claude to act on it, written to Claude, or none>`;

const bar = `The bar is high. Speak up only when not knowing it costs them money, time, wasted work, a wrong result, or a decision they are in the middle of. Good reasons:
- A result that looks done but is not: tests weakened or skipped to pass, an error swallowed, a check removed, a requirement quietly dropped.
- A decision or tradeoff the agent made in passing that they would likely want a say in.
- A non-obvious fact or edge case that will surprise them later.
Not reasons: trivia, file layout, naming, what a file contains, anything they already asked about or discussed, anything that was the main point of an answer, anything you are not confident is true.
Pick "Heads up" for something about this session's work with an immediate cost; "You should know" for how something works that matters to their work.
When in doubt, answer learn: none.`;

const list = (items: string[]) =>
  items.length ? items.map((item) => `- ${item}`).join("\n") : "(none)";

export type CheckPromptInput = {
  /** Lines already shown in this thread, so the same point isn't made twice. */
  shown: string[];
  /** Topics the person said they already know. */
  known: string[];
};

/** A check on the thread itself, every few steps of the main agent. */
export function threadCheckPrompt({ shown, known }: CheckPromptInput) {
  return `You are a quiet observer beside this session. Do not call tools and do not continue the task. Look back over the session so far: is there one thing the person working with you should really know, that they very likely missed?

People don't read everything an agent writes. Something said in passing inside a long answer or between many tool calls counts as missed; something they asked about or replied to does not.

${bar}

Already shown to them, skip these:
${list(shown)}

They said they already know these:
${list(known)}

${shape}`;
}

/**
 * A check on one subagent's work. Its transcript isn't in this session, so
 * the digest carries what it was asked, what it said and what it changed.
 */
export function subagentCheckPrompt(
  input: CheckPromptInput & { task: string; digest: string },
) {
  return `You are a quiet observer beside this session. Do not call tools and do not continue the task. A subagent you started has been working on "${input.task}". Its own transcript is not in your context; here is what it did, cut short where long:

<subagent-run>
${input.digest}
</subagent-run>

Compare its work with what the person actually asked for in this session. Is there one thing they should really know about it, that its report to you would likely not say? The classic case is a subagent that made a check pass by weakening the check.

${bar}

Already shown to them, skip these:
${list(input.shown)}

They said they already know these:
${list(input.known)}

${shape}`;
}
