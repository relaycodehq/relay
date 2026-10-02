/** A write holding the gate: `run` does it and lets go, `release` lets go without it. */
export interface HeldWrite {
  /** Resolves to whether `work` went through; after a run or a release it doesn't start. */
  run(work: () => Promise<unknown>): Promise<boolean>;
  /** Lets the gate go if this write still holds it; safe to call again. */
  release(): void;
}

/**
 * Lets writes through one at a time. The hold is taken synchronously, so two
 * writes started before a re-render can't both pass, and a write can take it
 * before asking the user something and keep others out meanwhile.
 */
export function writeGate({
  onBusy,
  onError,
}: {
  onBusy: (busy: boolean) => void;
  /** A write starting clears it; one that fails sets it. */
  onError: (error: unknown) => void;
}) {
  let holder: object | undefined;
  /** Takes the gate for a write that starts later; undefined while another holds it. */
  function reserve(): HeldWrite | undefined {
    if (holder) return undefined;
    const self = {};
    holder = self;
    onBusy(true);
    function release() {
      if (holder !== self) return;
      holder = undefined;
      onBusy(false);
    }
    return {
      release,
      async run(work) {
        if (holder !== self) return false;
        onError(undefined);
        try {
          await work();
          return true;
        } catch (e) {
          onError(e);
          return false;
        } finally {
          release();
        }
      },
    };
  }
  return {
    reserve,
    /** Resolves to whether `work` went through; while another write is out it doesn't start. */
    run: (work: () => Promise<unknown>) =>
      reserve()?.run(work) ?? Promise.resolve(false),
  };
}
