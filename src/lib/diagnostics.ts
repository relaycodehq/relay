import { useEffect, useState } from "react";
export function useContentHash(text: string | undefined) {
  const [value, setValue] = useState<{ text: string; hash: string }>();
  useEffect(() => {
    let current = true;
    if (text === undefined) {
      setValue(undefined);
      return;
    }
    void crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(text))
      .then((bytes) => {
        if (current)
          setValue({
            text,
            hash: Array.from(new Uint8Array(bytes), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
          });
      });
    return () => {
      current = false;
    };
  }, [text]);
  return value?.text === text ? value?.hash : undefined;
}
