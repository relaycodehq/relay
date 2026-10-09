import { useEffect, useState } from "react";
import { AppState } from "react-native";
import * as Clipboard from "expo-clipboard";

/**
 * Whether the clipboard holds an image, asked while `watching` and again when
 * it changes or the app comes back. `used` hides it until the next copy, so a
 * pasted image isn't offered twice.
 */
export function useClipboardImage(watching: boolean) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!watching) return;
    let live = true;
    const ask = () =>
      void Clipboard.hasImageAsync().then(
        (image) => live && setHas(image),
        () => {},
      );
    ask();
    const copied = Clipboard.addClipboardListener(({ contentTypes }) =>
      setHas(contentTypes.includes(Clipboard.ContentType.IMAGE)),
    );
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") ask();
    });
    return () => {
      live = false;
      copied.remove();
      back.remove();
    };
  }, [watching]);
  return { offered: watching && has, used: () => setHas(false) };
}
