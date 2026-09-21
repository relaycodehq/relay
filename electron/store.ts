import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Account, Progress, WorkspaceState } from "../shared/types";
import type { AISettings } from "../shared/settings";
interface State {
  roomConnections?: Record<string, string>;
  roomJoins?: Record<string, string>;
  roomDeliveries?: Record<string, import("./rooms/service").RoomDelivery>;
  aiSettings?: AISettings;
  version: 1;
  account?: Account;
  encryptedToken?: string;
  credentialName?: import("./login-profile").CredentialName;
  folders: Record<string, string>;
  progress: Record<string, Progress>;
  workspaces?: Record<string, WorkspaceState>;
}
export class Store {
  private state: State = { version: 1, folders: {}, progress: {} };
  private queue: Promise<void> = Promise.resolve();
  private writeError: unknown;
  async flush() {
    await this.queue;
    if (this.writeError) throw this.writeError;
  }
  constructor(private dir: string) {}
  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(
        await readFile(join(this.dir, "state.json"), "utf8"),
      );
      if (parsed.version !== 1)
        throw new Error("Unsupported saved data version.");
      this.state = parsed;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Saved review data could not be read. It has been preserved; restore state.json from backup before continuing.",
        );
    }
  }
  get() {
    return this.state;
  }
  async update(fn: (s: State) => void) {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.state);
      fn(next);
      const tmp = join(this.dir, `state-${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
      await rename(tmp, join(this.dir, "state.json"));
      this.state = next;
      this.writeError = undefined;
    });
    this.queue = task.catch((error) => {
      this.writeError = error;
    });
    await task;
  }
}
