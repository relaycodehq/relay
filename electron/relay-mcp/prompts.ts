// The prompts Relay offers next to its tools; Claude Code lists them as
// slash commands, like /mcp__relay__report_relay_problem.

interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

interface RelayPrompt {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  text(args: Record<string, string>): string;
}

const prompts: RelayPrompt[] = [
  {
    name: "report_relay_problem",
    title: "Report a problem with Relay",
    description:
      "Write up a bug in Relay, or a feature you'd like, and open Relay's report page with it.",
    arguments: [
      {
        name: "what",
        description: "What went wrong, or what you'd like, in your own words.",
      },
    ],
    text: ({ what }) =>
      [
        "I want to report something about Relay itself, the app this thread runs in, not the project we work on.",
        what?.trim()
          ? `In my words: ${what.trim()}`
          : "Ask me what happened if this conversation doesn't already make it clear.",
        "Write it up from what I told you and what this thread saw: what I did, what happened, what I expected, exact error messages, which agent and model. Don't guess at causes in Relay's code unless you looked. Then call report_relay_problem with it; Relay adds its version, the system and its log, and I send it myself from the page it opens.",
      ].join("\n\n"),
  },
];

/** What prompts/list returns. */
export const relayPromptList = prompts.map(({ text: _, ...rest }) => rest);

/** What prompts/get returns, or undefined for a prompt Relay doesn't have. */
export function relayPrompt(name: unknown, args: unknown) {
  const prompt = prompts.find((p) => p.name === name);
  if (!prompt) return undefined;
  const given: Record<string, string> = {};
  if (args && typeof args === "object")
    for (const [key, value] of Object.entries(args))
      if (typeof value === "string") given[key] = value;
  return {
    description: prompt.description,
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: prompt.text(given) },
      },
    ],
  };
}
