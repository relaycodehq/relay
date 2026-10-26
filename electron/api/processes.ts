import { MachineLoads } from "../processes";
import { type Handlers } from "./context";

/** The whole computer's load, for the Running card. */
export function processHandlers() {
  const machine = new MachineLoads();
  return {
    machineLoad: () => machine.read(),
  } satisfies Handlers;
}
