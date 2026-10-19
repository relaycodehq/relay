// WSL stops a distribution 15 s after the last Windows program using it
// exits, and the Relay working in it with it. While this Relay works with a
// Relay in WSL, a `wsl.exe ... sleep` holds the distribution up. It runs in
// the agent host, beside the agents, so it outlives this Relay's restarts as
// they do: a real Quit ends it with them, and a host Relay never comes back
// to lets it go at its idle limit. The pipe the bridge runs over holds it
// too; this covers the seconds a restart leaves it without one.
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { z } from "zod";
import { HostedChild } from "../agent-host/child";
import { foundSessions, inAgentHost, savedMeta } from "../agents";

const savedHold = z.object({
  provider: z.literal("wsl-hold"),
  distro: z.string(),
});

export class WslHolders {
  private held = new Map<string, HostedChild | ChildProcess>();
  private reattached?: Promise<void>;
  private stopped = new Set<(distro: string) => void>();

  /** Called when a held distribution stops by itself (`wsl --shutdown`), not by `release`. */
  onStopped(listener: (distro: string) => void) {
    this.stopped.add(listener);
  }

  /** Holds the distribution up from now until `release`, or until it stops by itself. */
  async hold(distro: string) {
    await this.reattach();
    if (this.held.has(distro)) return;
    const spec = {
      command: "wsl.exe",
      args: ["-d", distro, "--exec", "sleep", "infinity"],
      cwd: homedir(),
      // The host spawns with this env alone; wsl.exe needs PATH and SystemRoot.
      env: { ...process.env } as Record<string, string>,
      group: false,
    };
    const hosted = await inAgentHost("WSL's keep-alive", (hosts) =>
      hosts.openProcess({
        key: `wsl-hold:${distro}`,
        meta: { provider: "wsl-hold", distro } satisfies z.infer<
          typeof savedHold
        >,
        process: spec,
      }),
    );
    // Without the host, held from here: until Relay restarts, at least.
    const child = hosted
      ? new HostedChild(hosted)
      : spawn(spec.command, spec.args, {
          stdio: "ignore",
          windowsHide: true,
        });
    if (child instanceof HostedChild) child.release();
    this.follow(distro, child);
  }

  /** Lets the distribution go: WSL stops it once nothing else uses it. */
  release(distro: string) {
    const child = this.held.get(distro);
    this.held.delete(distro);
    if (child instanceof HostedChild) child.hosted.close();
    else child?.kill();
  }

  /** The distributions held now; after a restart, the ones held before it. */
  async heldDistros() {
    await this.reattach();
    return new Set(this.held.keys());
  }

  /** Relay is quitting: every distribution goes. */
  releaseAll() {
    for (const distro of [...this.held.keys()]) this.release(distro);
  }

  /** Takes back the holds the agent host kept while Relay restarted. */
  reattach() {
    this.reattached ??= (async () => {
      for (const found of await foundSessions("wsl-hold", "process")) {
        const saved = found.info.ended
          ? undefined
          : savedMeta(found, savedHold);
        if (!saved || this.held.has(saved.distro)) {
          found.close();
          continue;
        }
        const child = new HostedChild(found.attachProcess());
        child.release();
        this.follow(saved.distro, child);
      }
    })().catch((e) => console.warn("Couldn't take back WSL's keep-alive:", e));
    return this.reattached;
  }

  private follow(distro: string, child: HostedChild | ChildProcess) {
    this.held.set(distro, child);
    // Stopped by `wsl --shutdown` or the distribution ending: the next use holds it again.
    child.once("exit", () => {
      if (this.held.get(distro) !== child) return;
      this.held.delete(distro);
      if (child instanceof HostedChild) child.hosted.close();
      for (const listener of this.stopped) listener(distro);
    });
  }
}
