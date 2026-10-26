import { execFile, execFileSync } from "node:child_process";
import { z } from "zod";
import type { GuestReach } from "../../shared/guest-share";
import { findTailscaleCli } from "../remote/tailscale";

/**
 * Puts the guest server on the internet with Tailscale Funnel, under its own
 * path on a port nothing else serves. Funnel turns on per port, so sharing
 * a port with someone's `tailscale serve` would publish theirs too.
 */
export const FUNNEL_PATH = "/relay-guest";
/** The ports Funnel allows, the ones least likely to be in use first. */
const FUNNEL_PORTS = [8443, 10000, 443] as const;

/** `stdout` alone is the JSON a `--json` command printed; `output` adds stderr's warnings, for telling the user. */
export interface FunnelResult {
  ok: boolean;
  stdout: string;
  output: string;
}

export interface FunnelRun {
  (args: string[], timeoutMs: number): Promise<FunnelResult>;
  /** The same, blocking, for as the process exits. */
  sync(args: string[]): void;
}

const handlersSchema = z.object({
  Handlers: z
    .record(z.string(), z.object({ Proxy: z.string().optional() }).loose())
    .nullish(),
});

const serveConfigSchema = z.object({
  TCP: z
    .record(z.string(), z.object({ HTTPS: z.boolean().optional() }).loose())
    .nullish(),
  Web: z.record(z.string(), handlersSchema.loose()).nullish(),
});

const serveStatusSchema = serveConfigSchema.extend({
  /** What a `tailscale serve` or `funnel` left running in a terminal serves, by session. */
  Foreground: z.record(z.string(), serveConfigSchema.loose()).nullish(),
});

const selfSchema = z.object({
  BackendState: z.string(),
  Self: z.object({ DNSName: z.string().optional() }).loose().nullish(),
});

export type ServeStatus = z.infer<typeof serveStatusSchema>;

/** What `tailscale funnel status --json` printed; undefined when it isn't that. */
export function serveStatusIn(stdout: string): ServeStatus | undefined {
  // An empty answer is an empty config.
  const parsed = serveStatusSchema.safeParse(safeJson(stdout.trim() || "{}"));
  return parsed.data;
}

/**
 * The first Funnel port with no config but ours; undefined when each serves
 * something else. Our path pointing at another server is another Relay's on
 * this computer, which is someone else's too.
 */
export function freeFunnelPort(
  status: ServeStatus,
  host: string,
  target: string,
) {
  const foreground = Object.values(status.Foreground ?? {});
  return FUNNEL_PORTS.find((port) => {
    const tcp = status.TCP?.[String(port)];
    if (tcp && !tcp.HTTPS) return false; // a raw TCP forwarder
    // Ours is only ever in the background, so anything in a terminal is someone else's.
    const inTerminal = foreground.some(
      (config) => config.TCP?.[String(port)] || config.Web?.[`${host}:${port}`],
    );
    if (inTerminal) return false;
    const handlers = Object.entries(
      status.Web?.[`${host}:${port}`]?.Handlers ?? {},
    );
    return handlers.every(
      ([path, handler]) => path === FUNNEL_PATH && handler.Proxy === target,
    );
  });
}

/** Tailscale's page for turning Funnel on, when its CLI printed one. */
export const fixUrlIn = (output: string) =>
  output.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];

export class Funnel {
  /** The port our path is on now, to take it off again. */
  private port?: number;
  /** Ports our path stayed on after taking it off failed, tried again as Relay exits. */
  private left = new Set<number>();

  constructor(private run: FunnelRun = runTailscale) {}

  /** Publishes `localPort` and says where guests reach it. */
  async open(localPort: number): Promise<GuestReach> {
    const self = await this.run(["status", "--json"], 5000);
    if (!self.ok && !self.output)
      return {
        public: false,
        reason: "Tailscale isn't installed on this computer.",
      };
    const parsed = selfSchema.safeParse(safeJson(self.stdout));
    const host = parsed.data?.Self?.DNSName?.replace(/\.$/, "");
    if (parsed.data?.BackendState !== "Running" || !host)
      return { public: false, reason: "Tailscale isn't connected." };
    // Without knowing what each port serves, any of them could publish someone's private app.
    const serve = await this.run(["funnel", "status", "--json"], 5000);
    const status = serve.ok ? serveStatusIn(serve.stdout) : undefined;
    if (!status)
      return {
        public: false,
        reason: "Couldn't read what Tailscale already serves on this computer.",
      };
    const target = `http://127.0.0.1:${localPort}`;
    const port = freeFunnelPort(status, host, target);
    if (!port)
      return {
        public: false,
        reason:
          "Every port Funnel allows (443, 8443, 10000) already serves something else.",
      };
    const on = await this.run(
      [
        "funnel",
        "--bg",
        "--yes",
        `--https=${port}`,
        `--set-path=${FUNNEL_PATH}`,
        target,
      ],
      20_000,
    );
    if (!on.ok)
      return {
        public: false,
        reason: funnelRefusal(on.output),
        ...(fixUrlIn(on.output) ? { fixUrl: fixUrlIn(on.output) } : {}),
      };
    this.port = port;
    this.left.delete(port);
    process.off("exit", this.closeAtExit);
    process.once("exit", this.closeAtExit);
    const origin = port === 443 ? `https://${host}` : `https://${host}:${port}`;
    return { public: true, url: `${origin}${FUNNEL_PATH}` };
  }

  /** Takes our path off; whatever else the port serves stays. */
  async close() {
    const port = this.port;
    if (!port) return;
    this.port = undefined;
    const off = await this.run(offArgs(port), 10_000);
    if (!off.ok) {
      // Left up, the route would publish whatever takes the local port next: tried again at exit.
      console.warn("Could not turn Tailscale Funnel off:", off.output);
      if (this.port !== port) this.left.add(port);
      return;
    }
    const nothingPublished = !this.port && !this.left.size;
    if (nothingPublished) process.off("exit", this.closeAtExit);
  }

  /** Quitting Relay ends every link, so nothing should stay published after it. */
  private closeAtExit = () => {
    const ports = new Set(this.left);
    if (this.port) ports.add(this.port);
    for (const port of ports) this.run.sync(offArgs(port));
  };
}

const offArgs = (port: number) => [
  "funnel",
  `--https=${port}`,
  `--set-path=${FUNNEL_PATH}`,
  "off",
];

function funnelRefusal(output: string) {
  if (fixUrlIn(output)) return "Funnel isn't turned on for this tailnet yet.";
  const line = output.trim().split("\n").find(Boolean);
  return line
    ? `Tailscale said: ${line}`
    : "Tailscale wouldn't open a public link.";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The CLI found by the last run, for the exit's blocking one. */
let foundCli: string | undefined;

const runTailscale: FunnelRun = Object.assign(
  async (args: string[], timeoutMs: number) => {
    const cli = (foundCli = await findTailscaleCli());
    if (!cli) return { ok: false, stdout: "", output: "" };
    return new Promise<FunnelResult>((resolve) =>
      execFile(
        cli,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) =>
          resolve({ ok: !error, stdout, output: `${stdout}${stderr}` }),
      ),
    );
  },
  {
    sync(args: string[]) {
      if (!foundCli) return;
      try {
        execFileSync(foundCli, args, {
          timeout: 3000,
          windowsHide: true,
          stdio: "ignore",
        });
      } catch (e) {
        console.warn("Could not turn Tailscale Funnel off:", e);
      }
    },
  },
);
