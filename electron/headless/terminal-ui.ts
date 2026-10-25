// The `relay` command's layout: sections of aligned rows, a spinner while
// something runs, yes/no questions answered with the arrow keys, and blocks
// it takes back once they've served, like a pairing code once a device is
// in. Piped, or on a terminal that can't move the cursor, it prints the same
// rows without the questions, the spinner or the taking back.
import { accent, bold, dim, green, red, yellow } from "./format";

const labelWidth = 13;
const visible = (text: string) =>
  [...text.replace(/\x1b\[[0-9;]*m/g, "")].length;

type Mark = "ok" | "warn" | "fail" | "off";

const marks: Record<Mark, string> = {
  ok: green("✓"),
  warn: yellow("!"),
  fail: red("✗"),
  off: dim("·"),
};

export const section = (title: string) => `\n ${bold(title)}`;

/** `   ✓ Label        detail`, labels padded so details line up; `off` greys it all. */
export function row(mark: Mark, label: string, detail = "") {
  const padded =
    label + " ".repeat(Math.max(1, labelWidth - visible(label)));
  return mark === "off"
    ? `   ${marks.off} ${dim(`${padded}${detail}`.trimEnd())}`
    : `   ${marks[mark]} ${`${padded}${detail}`.trimEnd()}`;
}

/** `text` with every line moved right by `by` spaces. */
export const indent = (text: string, by: number) =>
  text
    .split("\n")
    .map((line) => " ".repeat(by) + line)
    .join("\n");

interface Output {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

interface Input {
  isTTY?: boolean;
  setRawMode?(raw: boolean): unknown;
  on(event: "data", listener: (data: Buffer | string) => void): unknown;
  off(event: "data", listener: (data: Buffer | string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const hideCursor = "\x1b[?25l",
  showCursor = "\x1b[?25h";

export class Screen {
  /** Rows written so far, so a block can be taken back. */
  private rows = 0;
  private hidden = false;
  private guarded = false;

  constructor(
    private out: Output = process.stdout,
    private input: Input = process.stdin,
    /** Questions may be asked; off with --yes. */
    private interactive = true,
  ) {}

  /** The cursor can move: spinners turn and blocks can be taken back. */
  get live() {
    return !!this.out.isTTY && process.env.TERM !== "dumb";
  }

  print(text = "") {
    this.out.write(`${text}\n`);
    const width = this.out.columns || 80;
    for (const line of text.split("\n"))
      this.rows += Math.max(1, Math.ceil(visible(line) / width));
  }

  /** Where a block starts; `take` erases everything printed after it. */
  mark() {
    return this.rows;
  }

  take(mark: number) {
    const count = this.rows - mark;
    if (!this.live || count <= 0) return;
    this.out.write(`\x1b[${count}F\x1b[0J`);
    this.rows = mark;
  }

  /** A turning `label` on its own row until stopped; nothing when not live. */
  spin(label: string) {
    if (!this.live) return { stop() {} };
    let frame = 0;
    const draw = () =>
      this.out.write(
        `\r\x1b[2K   ${accent(frames[frame++ % frames.length]!)} ${label}`,
      );
    this.cursor(false);
    draw();
    const timer = setInterval(draw, 80);
    return {
      stop: () => {
        clearInterval(timer);
        this.out.write("\r\x1b[2K");
        this.cursor(true);
      },
    };
  }

  /**
   * A yes/no question on one row, picked with ← → (or y and n) and Enter;
   * it goes once answered, for the row saying what came of it. `fallback`
   * when it can't be asked.
   */
  ask(question: string, fallback: boolean): Promise<boolean> {
    const input = this.input;
    if (!this.interactive || !this.live || !input.isTTY || !input.setRawMode)
      return Promise.resolve(fallback);
    let yes = fallback;
    const draw = () =>
      this.out.write(
        `\r\x1b[2K   ${accent("?")} ${question}   ${yes ? accent("› Yes") : dim("  Yes")}  ${yes ? dim("  No") : accent("› No")}`,
      );
    this.cursor(false);
    draw();
    return new Promise((done) => {
      const finish = (answer: boolean) => {
        input.off("data", key);
        input.setRawMode!(false);
        input.pause();
        this.out.write("\r\x1b[2K");
        this.cursor(true);
        done(answer);
      };
      const key = (data: Buffer | string) => {
        const k = data.toString();
        if (k === "\x03") {
          finish(fallback);
          this.out.write("\n");
          process.exit(130);
        }
        if (k === "\r" || k === "\n") return finish(yes);
        if (/^y$/i.test(k)) return finish(true);
        if (/^n$/i.test(k)) return finish(false);
        if (k === "\x1b[D" || k === "\x1b[C" || k === "\t" || k === " ") {
          yes = !yes;
          draw();
        }
      };
      input.setRawMode!(true);
      input.resume();
      input.on("data", key);
    });
  }

  private cursor(show: boolean) {
    if (show === !this.hidden) return;
    this.hidden = !show;
    this.out.write(show ? showCursor : hideCursor);
    if (show || this.guarded) return;
    // A Ctrl-C mid-spin leaves the terminal its cursor.
    this.guarded = true;
    process.once("exit", () => this.hidden && this.out.write(showCursor));
  }
}
