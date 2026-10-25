import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "relay-replay-unicode-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("records split UTF-8 characters exactly as the raw agent output", async () => {
  const child = join(root, "child.cjs"),
    recordings = join(root, "recordings");
  await mkdir(recordings);
  await writeFile(
    child,
    `
    const bytes = Buffer.from(JSON.stringify({text: "😀"}) + "\\n");
    const at = bytes.indexOf(Buffer.from("😀")) + 2;
    process.stdout.write(bytes.subarray(0, at));
    process.stdin.once("data", () => {
      process.stdout.write(bytes.subarray(at));
      process.stdin.once("data", () => process.exit(0));
    });
  `,
  );
  const tee = spawn(
    process.execPath,
    [resolve("tests/fixtures/replay-tee.cjs"), child],
    {
      env: {
        ...process.env,
        RELAY_REPLAY_REAL: process.execPath,
        RELAY_REPLAY_OUT: recordings,
        RELAY_REPLAY_AGENT: "sample",
        RELAY_REPLAY_VERSION: "test",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const chunks: Buffer[] = [];
  let resumed = false;
  tee.stdout.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
    if (!resumed) {
      resumed = true;
      tee.stdin.write("continue\n");
    } else if (Buffer.concat(chunks).includes(10)) {
      // Exit only after the tee has received both pieces, with no timing assumption.
      tee.stdin.end("done\n");
    }
  });
  expect((await once(tee, "close"))[0]).toBe(0);
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
    text: "😀",
  });
  const files = await readdir(recordings);
  const entries = (await readFile(join(recordings, files[0]), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { dir?: string; line?: string });
  expect(
    entries.filter((e) => e.dir === "in").map((e) => JSON.parse(e.line!)),
  ).toEqual([{ text: "😀" }]);
});

it("matches a replay request whose method is split inside a UTF-8 character", async () => {
  const agent = resolve("tests/fixtures/replay-agent.cjs");
  await writeFile(
    join(root, "01.jsonl"),
    [
      { meta: { agent: "sample", args: [] } },
      {
        t: 0,
        dir: "out",
        line: JSON.stringify({ id: 1, method: "sample/😀" }),
      },
      { t: 1, dir: "in", line: JSON.stringify({ id: 1, result: "okay" }) },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n",
  );
  const wrapper = join(root, "input.cjs");
  await writeFile(
    wrapper,
    `
    const { PassThrough } = require("node:stream");
    const input = new PassThrough();
    Object.defineProperty(process, "stdin", {value: input});
    process.argv = [process.execPath, ${JSON.stringify(agent)}];
    require(${JSON.stringify(agent)});
    const bytes = Buffer.from(JSON.stringify({id: 17, method: "sample/😀"}) + "\\n");
    const at = bytes.indexOf(Buffer.from("😀")) + 2;
    input.write(bytes.subarray(0, at));
    setImmediate(() => input.end(bytes.subarray(at)));
  `,
  );
  const replay = spawn(process.execPath, [wrapper], {
    env: {
      ...process.env,
      RELAY_REPLAY_AGENT: "sample",
      RELAY_REPLAY_DIR: root,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  replay.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  expect((await once(replay, "close"))[0]).toBe(0);
  expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
    id: 17,
    result: "okay",
  });
});
