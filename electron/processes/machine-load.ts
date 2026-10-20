import type { MachineLoad } from "../../shared/processes";
import { MachineCpu, memoryNow } from "../perf/snapshot";

/** How long a memory reading lasts: on macOS it's a `sysctl` run, and memory moves slowly. */
const memoryFor = 10_000;

/** The whole computer's CPU and memory, for the Running card. */
export class MachineLoads {
  private cpu = new MachineCpu();
  private memory?: { at: number; done: Promise<{ usedMb: number; totalMb: number }> };

  async read(): Promise<MachineLoad> {
    const now = Date.now();
    if (!this.memory || now - this.memory.at > memoryFor)
      this.memory = {
        at: now,
        done: memoryNow().then((m) => ({
          usedMb: m.totalMb - m.freeMb,
          totalMb: m.totalMb,
        })),
      };
    const cpu = this.cpu.read();
    return { ...(cpu === undefined ? {} : { cpu }), ...(await this.memory.done) };
  }
}
