import { readFile } from "node:fs/promises";
import type { AgentOptions } from "../types";
import { answerLimitError } from "../turn-kit";
import type { NativeClient } from "./client";
import { splitModel } from "./model-ids";
import { nativeUsage } from "./usage";

/** Text-only helpers use stateless generation; image helpers use an owned, tool-denied temporary session. */
export async function openCodeHelper(
  client: NativeClient,
  options: AgentOptions & { job: { kind: "helper"; instructions: string } },
) {
  const split = splitModel(options.choice.model);
  const model = split
    ? {
        providerID: split.providerID,
        id: split.modelID,
        ...(options.choice.reasoningEffort
          ? { variant: options.choice.reasoningEffort }
          : {}),
      }
    : undefined;
  const prompt = `${options.job.instructions}\n\n${options.prompt}`;
  if (!options.images?.length) {
    const answer = await client.generate.text(
      { prompt, model },
      { signal: options.signal },
    );
    const over = answerLimitError(answer.text.length);
    if (over) throw over;
    if (!answer.text.trim())
      throw new Error("OpenCode returned an empty helper answer.");
    options.onText(answer.text);
    return answer.text;
  }
  const files = await Promise.all(
    options.images.map(async (image) => ({
      uri: `data:${image.mimeType};base64,${(await readFile(image.path)).toString("base64")}`,
    })),
  );
  options.signal.throwIfAborted();
  const temporary = await client.session.create(
    {
      location: { directory: options.cwd },
      model,
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
      title: "Relay helper",
    },
    { signal: options.signal },
  );
  try {
    await client.session.prompt(
      { sessionID: temporary.id, text: prompt, files },
      { signal: options.signal },
    );
    await client.session.wait(
      { sessionID: temporary.id },
      { signal: options.signal },
    );
    const messages = await client.session.context(
      { sessionID: temporary.id },
      { signal: options.signal },
    );
    let answer = "";
    for (const message of messages)
      if (message.type === "assistant") {
        if (message.error)
          throw new Error(
            "OpenCode couldn't finish this helper job. Check its provider connection and try again.",
          );
        if (message.tokens)
          options.onUsage?.(
            nativeUsage(message.model, message.tokens, message.cost),
          );
        answer = message.content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n");
      }
    const over = answerLimitError(answer.length);
    if (over) throw over;
    if (!answer.trim())
      throw new Error("OpenCode returned an empty helper answer.");
    options.onText(answer);
    return answer;
  } finally {
    // Only the helper's own temporary session; saved thread sessions are never deleted here.
    await client.session.remove({ sessionID: temporary.id });
  }
}
