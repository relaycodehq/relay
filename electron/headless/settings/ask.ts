import { createInterface, type Interface } from "node:readline/promises";
import { dim } from "../format";

/** Prompts on the terminal; scripts give values on the command line instead. */
export class Ask {
  constructor(private rl: Interface) {}

  async text(question: string) {
    return (await this.rl.question(`${question} `)).trim();
  }

  async yes(question: string, fallback: boolean) {
    const answer = (
      await this.rl.question(
        `${question} ${dim(fallback ? "[Y/n]" : "[y/N]")} `,
      )
    )
      .trim()
      .toLowerCase();
    return answer ? answer.startsWith("y") : fallback;
  }

  /** One of `options`, by number; undefined when left empty. */
  async pick<T>(question: string, options: { value: T; label: string }[]) {
    options.forEach((o, i) =>
      console.log(`  ${String(i + 1).padStart(2)}  ${o.label}`),
    );
    const answer = await this.text(
      `${question} ${dim("(number, empty to keep)")}`,
    );
    if (!answer) return undefined;
    const picked = options[Number(answer) - 1];
    if (!picked)
      throw new Error(`Choose a number from 1 to ${options.length}.`);
    return picked.value;
  }

  /** Typed without showing it, for tokens. */
  async secret(question: string) {
    process.stdout.write(`${question} `);
    const rl = this.rl as unknown as {
      _writeToOutput?: (text: string) => void;
    };
    const shown = rl._writeToOutput;
    rl._writeToOutput = () => {};
    try {
      return (await this.rl.question("")).trim();
    } finally {
      rl._writeToOutput = shown;
      process.stdout.write("\n");
    }
  }
}

export async function withAsk<T>(work: (ask: Ask) => Promise<T>) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    rl.close();
    process.stdout.write("\n");
    process.exit(130);
  });
  try {
    return await work(new Ask(rl));
  } finally {
    rl.close();
  }
}

/** A secret from stdin when it's piped, so it stays out of the shell's history. */
export async function piped() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
}
