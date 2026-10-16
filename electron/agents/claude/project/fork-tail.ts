// A forked skill's work only reaches the stream once it ends, as a replay.
// Until then Claude Code writes it to the subagent's own transcript, so Relay
// reads that to show what it is doing.
import { access, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SDKMessage } from "./sdk";
import { forkId, forkStart } from "../forks";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** A transcript line as the frame the stream would have carried, under the fork's row. */
function frameOf(line: string, parent: string): SDKMessage | undefined {
  let entry: { type?: unknown; message?: unknown; uuid?: unknown };
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (entry.type !== "assistant" && entry.type !== "user") return undefined;
  if (!entry.message || typeof entry.message !== "object") return undefined;
  return {
    type: entry.type,
    message: entry.message,
    parent_tool_use_id: parent,
    uuid: entry.uuid,
  } as SDKMessage;
}

export class ForkTails {
  private tails = new Map<string, () => void>();
  /** Each session's folder under `<home>/projects`, once found. */
  private folders = new Map<string, string>();

  constructor(
    /** The config folder of the account the session runs as. */
    private home: () => string,
    private onFrame: (frame: SDKMessage) => void,
    private every = 1000,
  ) {}

  observe(message: SDKMessage) {
    const fork = forkStart(message);
    if (fork) return this.follow(fork.task_id, fork.session_id);
    // Its replay follows its end and carries everything; reading on would only repeat it.
    if (
      message.type === "system" &&
      (message.subtype === "task_notification" ||
        (message.subtype === "task_updated" &&
          ["completed", "failed", "killed"].includes(
            message.patch.status ?? "",
          )))
    )
      this.tails.get(message.task_id)?.();
  }

  close() {
    for (const stop of this.tails.values()) stop();
  }

  private follow(taskId: string, sessionId: string) {
    if (this.tails.has(taskId)) return;
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let file: string | undefined;
    let offset = 0;
    const live = () => !stopped;
    const tick = async () => {
      try {
        file ??= await this.find(sessionId, taskId);
        if (file) offset = await this.read(file, offset, taskId, live);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn("Could not follow a forked skill's transcript:", error);
          return stop();
        }
      }
      if (stopped) return;
      timer = setTimeout(tick, this.every);
      timer.unref?.();
    };
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      this.tails.delete(taskId);
    };
    this.tails.set(taskId, stop);
    void tick();
  }

  private async find(sessionId: string, taskId: string) {
    let folder = this.folders.get(sessionId);
    if (!folder) {
      // The folder is named after the session's working directory, in a way
      // only Claude Code knows; its own transcript says which one it is.
      const projects = join(this.home(), "projects");
      const dirs = await readdir(projects);
      const found = await Promise.all(
        dirs.map((dir) => exists(join(projects, dir, `${sessionId}.jsonl`))),
      );
      const at = found.indexOf(true);
      if (at < 0) return undefined;
      folder = join(projects, dirs[at]!);
      this.folders.set(sessionId, folder);
    }
    const file = join(folder, sessionId, "subagents", `agent-${taskId}.jsonl`);
    return (await exists(file)) ? file : undefined;
  }

  /** Hands on each whole line written since `offset`; returns where it stopped. */
  private async read(
    file: string,
    offset: number,
    taskId: string,
    live: () => boolean,
  ) {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      if (size <= offset) return offset;
      const buffer = Buffer.alloc(size - offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const end = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
      if (end < 0) return offset;
      const parent = forkId(taskId);
      for (const line of buffer.subarray(0, end).toString("utf8").split("\n")) {
        // Stopped mid-read: the replay is coming, and a call it finished mustn't run again.
        if (!live()) break;
        const frame = frameOf(line, parent);
        if (frame) this.onFrame(frame);
      }
      return offset + end + 1;
    } finally {
      await handle.close();
    }
  }
}
