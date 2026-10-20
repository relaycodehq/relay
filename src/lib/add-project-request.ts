const ADD_PROJECT = "relay:add-project";

/**
 * Opens the add-project palette from a feature the shell hands no way there;
 * with `computerId`, on the folders of that paired computer.
 */
export function requestAddProject(computerId?: string) {
  window.dispatchEvent(new CustomEvent(ADD_PROJECT, { detail: computerId }));
}

/** The shell's side of `requestAddProject`; returns the unsubscribe. */
export function onAddProjectRequest(open: (computerId?: string) => void) {
  const listener = (event: Event) =>
    open((event as CustomEvent<string | undefined>).detail);
  window.addEventListener(ADD_PROJECT, listener);
  return () => window.removeEventListener(ADD_PROJECT, listener);
}
