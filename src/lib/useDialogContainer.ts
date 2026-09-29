import { useCallback, useState } from "react";

/**
 * Popups have to render inside a modal <dialog> to sit in its top layer. Put
 * `ref` on an element inside the component; `container` is its dialog, if any.
 */
export function useDialogContainer() {
  const [container, setContainer] = useState<HTMLElement>();
  const ref = useCallback(
    (el: HTMLElement | null) =>
      setContainer(el?.closest("dialog") ?? undefined),
    [],
  );
  return [ref, container] as const;
}
