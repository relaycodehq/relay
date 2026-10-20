import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFile } from "node:fs/promises";

/** OpenCode's local connection API, with fake credentials and manually completed browser attempts. */
export async function openCodeAuthFixture(authFile?: string) {
  const calls: {
    method: string;
    path: string;
    directory: string | null;
    body: any;
    authorization?: string;
  }[] = [];
  const attempts = new Map<
    string,
    "pending" | "complete" | "expired" | "failed"
  >();
  const controls = {
    password: "fixture-local-password",
    failure: 0,
    echo: "",
    mode: "auto" as "auto" | "code",
    connected: false,
  };
  const complete = async () => {
    controls.connected = true;
    for (const [id, state] of attempts)
      if (state === "pending") attempts.set(id, "complete");
    if (authFile) await writeFile(authFile, "connected");
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : undefined;
    calls.push({
      method: req.method!,
      path: url.pathname,
      directory: url.searchParams.get("location[directory]"),
      body,
      authorization: req.headers.authorization,
    });
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (
      req.headers.authorization !==
      "Basic " + Buffer.from(`opencode:${controls.password}`).toString("base64")
    )
      return json({ error: "local auth refused" }, 401);
    if (controls.failure)
      return json({ error: controls.echo }, controls.failure);
    if (url.pathname === "/api/integration")
      return json({
        data: [
          {
            id: "opencode",
            name: "OpenCode Console",
            connections: controls.connected
              ? [{ id: "saved", secret: "must-not-reach-ui" }]
              : [],
            methods: [
              { type: "key", label: "API key (service account)" },
              {
                type: "oauth",
                id: "device",
                label: "OpenCode Console account",
                form: [
                  {
                    type: "string",
                    key: "server",
                    hidden: true,
                    default: "https://example.invalid/console",
                  },
                ],
              },
            ],
          },
          {
            id: "openrouter",
            name: "OpenRouter",
            connections: [],
            methods: [{ type: "key" }],
          },
        ],
      });
    if (req.method === "POST" && url.pathname.endsWith("/connect/key")) {
      await complete();
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "POST" && url.pathname.endsWith("/connect/oauth")) {
      const attemptID = `attempt-${attempts.size + 1}`;
      attempts.set(attemptID, "pending");
      return json({
        data: {
          attemptID,
          url: "https://example.invalid/authorize?user_code=SAMPLE-123",
          instructions: "Sample sign-in: enter SAMPLE-123 in your browser.",
          mode: controls.mode,
          time: { expires: Date.now() + 300_000 },
        },
      });
    }
    const match = /\/connect\/oauth\/([^/]+)(\/complete)?$/.exec(url.pathname);
    if (match) {
      if (req.method === "DELETE") {
        attempts.delete(match[1]);
        res.writeHead(204);
        return res.end();
      }
      if (req.method === "POST" && match[2]) {
        await complete();
        res.writeHead(204);
        return res.end();
      }
      return json({
        data: {
          status: attempts.get(match[1]) ?? "expired",
          time: { expires: Date.now() + 300_000 },
        },
      });
    }
    json({ message: "Not found" }, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    attempts,
    controls,
    complete,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
