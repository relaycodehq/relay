interface PowerEvents {
  on(event: "resume" | "unlock-screen", listener: () => void): unknown;
}

/**
 * Timers don't count the time a Mac sleeps, so what was armed for a clock
 * time (a resume after a limit, a message sent later) would fire as late as
 * the sleep was long. Arming again on wake works the delay out afresh.
 */
export function rearmOnWake(power: PowerEvents, rearm: () => void) {
  power.on("resume", rearm);
  power.on("unlock-screen", rearm);
}
