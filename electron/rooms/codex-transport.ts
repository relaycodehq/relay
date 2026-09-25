import * as PlatformError from "effect/PlatformError";
import { CodexAppServerRequestError } from "../vendor/t3code/codex/errors";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as Effect from "effect/Effect";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { makeCodexAppServerPatchedProtocol } from "../vendor/t3code/codex/protocol";
export interface CodexTransport {
  request(method: string, params: unknown): Promise<any>;
  notify(method: string, params?: unknown): Promise<void>;
}
// The vendor handles framing/decoding. This boundary only caps an unfinished frame
// so a malfunctioning provider cannot retain unlimited output in that parser.
async function* boundedOutput(source: AsyncIterable<Buffer>) {
  let bytes = 0;
  for await (const chunk of source) {
    let start = 0;
    for (
      let end = chunk.indexOf(10);
      end !== -1;
      end = chunk.indexOf(10, start)
    ) {
      bytes += end - start;
      if (bytes > 4 * 1024 * 1024)
        throw new Error("Codex response frame exceeds 4 MiB.");
      bytes = 0;
      start = end + 1;
    }
    bytes += chunk.length - start;
    if (bytes > 4 * 1024 * 1024)
      throw new Error("Codex response frame exceeds 4 MiB.");
    yield chunk;
  }
}
/** App-owned boundary. The JSON-RPC framing, ordering and request lifecycle live in pristine T3 source. */
export async function withCodexTransport<T>(
  child: ChildProcessWithoutNullStreams,
  onNotification: (method: string, params: any) => void,
  onError: (error: Error) => void,
  run: (transport: CodexTransport) => Promise<T>,
  onRequest?: (method: string, params: any) => Promise<unknown>,
): Promise<T> {
  let finished = false;
  // A failed write also emits `error`; unheard, it crashes the main process.
  child.stdin.on("error", (error) => {
    if (!finished)
      onError(new Error(`The Codex connection closed: ${error.message}`));
  });
  const platformError = (cause: unknown) =>
    PlatformError.systemError({
      _tag: "Unknown",
      module: "Codex",
      method: "stdio",
      cause,
    });
  const program = Effect.gen(function* () {
    const stdio = Stdio.make({
      args: Effect.succeed([]),
      stdin: Stream.fromAsyncIterable(
        boundedOutput(child.stdout),
        platformError,
      ),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Effect.tryPromise({
            try: () =>
              new Promise<void>((resolve, reject) =>
                child.stdin.write(chunk, (e) => (e ? reject(e) : resolve())),
              ),
            catch: platformError,
          }),
        ),
      stderr: () => Sink.drain,
    });
    const protocol = yield* makeCodexAppServerPatchedProtocol({
      stdio,
      onNotification: (notification) =>
        Effect.sync(() =>
          onNotification(notification.method, notification.params ?? {}),
        ),
      onRequest: (request) =>
        onRequest
          ? Effect.tryPromise({
              try: () => onRequest(request.method, request.params ?? {}),
              catch: (error) =>
                CodexAppServerRequestError.internalError(
                  error instanceof Error ? error.message : String(error),
                ),
            })
          : request.method.endsWith("requestApproval")
            ? Effect.succeed({ decision: "decline" })
            : Effect.fail(
                CodexAppServerRequestError.methodNotFound(request.method),
              ),
      onTermination: (error) =>
        Effect.sync(() => {
          if (!finished) onError(new Error(error.message));
        }),
    });
    return yield* Effect.tryPromise({
      try: async () => {
        try {
          return await run({
            request: (method, params) =>
              Effect.runPromise(
                protocol
                  .request(method, params)
                  .pipe(Effect.timeout("20 seconds")),
              ),
            notify: (method, params) =>
              Effect.runPromise(protocol.notify(method, params)),
          });
        } finally {
          finished = true;
          child.stdout.destroy();
          child.stdin.end();
        }
      },
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    });
  }).pipe(Effect.scoped);
  return Effect.runPromise(program);
}
