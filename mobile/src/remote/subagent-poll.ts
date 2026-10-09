/** Starts one conditional-read loop; stopping invalidates an in-flight answer too. */
export function pollSubagents(
  request: (current: () => boolean) => Promise<boolean>,
  again: boolean,
) {
  let live = true;
  let timer: ReturnType<typeof setTimeout>;
  let delay = 5000;
  const go = async () => {
    try {
      const changed = await request(() => live);
      delay = changed ? 5000 : Math.min(delay * 2, 20_000);
    } catch {
      delay = Math.min(delay * 2, 60_000);
    }
    if (live && again) timer = setTimeout(go, delay);
  };
  void go();
  return () => {
    live = false;
    clearTimeout(timer);
  };
}
