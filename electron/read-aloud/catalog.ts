import type { ReadAloudEngine } from "./engine";
import { readAloudEngines } from "./engines";

let engines: ReadAloudEngine[] | undefined;

/** The engines Relay offers; end-to-end tests add a fake one that plays a tone. */
export function engineList(): ReadAloudEngine[] {
  if (engines) return engines;
  const fake =
    process.env.RELAY_TEST_DATA && process.env.RELAY_TEST_READ_ALOUD_ENGINE;
  engines = fake
    ? [...readAloudEngines, require(fake).engine as ReadAloudEngine]
    : readAloudEngines;
  return engines;
}

export function engineById(id: string) {
  return engineList().find((e) => e.id === id);
}
