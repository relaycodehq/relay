import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { release } from "node:os";
import { createInterface } from "node:readline";
import type { MessagePortMain } from "electron";
import type { DictationEvent, DictationRequest } from "../../shared/dictation";

/** macOS 26 is Darwin 25: the first with SpeechAnalyzer. */
export function appleSpeechAvailable(helper: string) {
  return (
    process.platform === "darwin" &&
    Number(release().split(".")[0]) >= 25 &&
    existsSync(helper)
  );
}

type HelperEvent =
  | { type: "installing" | "ready" }
  | { type: "text"; settled: string; tentative: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

/**
 * Speaks the engine port's language for macOS's own speech engine: each
 * dictation is a run of `apple-speech`, fed samples on stdin. The model
 * lives in the system, so there's nothing to load or unload here.
 */
export function serveAppleSpeech(port: MessagePortMain, helper: string) {
  const send = (event: DictationEvent) => port.postMessage(event);
  let current: { id: number; child: ChildProcess; stopping: boolean } | undefined;
  const end = (cancel: boolean) => {
    if (!current) return;
    if (cancel) current.child.kill();
    current = undefined;
  };

  send({ type: "ready" });
  port.on("message", ({ data }) => {
    const request = data as DictationRequest | null;
    if (!request) return;
    if (request.type === "start") {
      end(true);
      const child = spawn(helper, [], { stdio: ["pipe", "pipe", "pipe"] });
      const session = { id: request.id, child, stopping: false };
      current = session;
      let failed = false,
        stderr = "";
      const fail = (message: string) => {
        if (failed) return;
        failed = true;
        send({ type: "error", id: session.id, message });
        if (current === session) end(true);
      };
      child.stdin!.on("error", () => {});
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      createInterface({ input: child.stdout! }).on("line", (line) => {
        let event: HelperEvent;
        try {
          event = JSON.parse(line) as HelperEvent;
        } catch {
          return;
        }
        if (event.type === "text")
          send({
            type: "text",
            id: session.id,
            settled: event.settled,
            tentative: event.tentative,
          });
        else if (event.type === "final") {
          if (session.stopping)
            send({ type: "final", id: session.id, text: event.text });
        } else if (event.type === "error") fail(event.message);
      });
      child.on("error", (error) => fail(error.message));
      child.on("exit", (code, signal) => {
        if (current === session) current = undefined;
        if (code && !signal)
          fail(stderr.trim() || `macOS's speech engine stopped (${code}).`);
      });
      return;
    }
    if (!current || request.id !== current.id) return;
    if (request.type === "audio") {
      const { samples } = request;
      current.child.stdin!.write(
        Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
      );
    } else if (request.type === "cancel") end(true);
    else if (request.type === "stop") {
      current.stopping = true;
      current.child.stdin!.end();
      end(false);
    }
  });
  port.on("close", () => end(true));
  port.start();
}
