import { useEffect, useRef, useState } from "react";

const firstLine = (text: string) => text.split(/\r?\n/, 1)[0];

/**
 * The text the panel's fields hold. The host can start the find field with
 * the editor's selection, ask for the replace field, and ask for focus again
 * by changing `focusKey`.
 */
export function useFindFields(host: {
  initialQuery?: string;
  replace: boolean;
  focusKey?: number;
}) {
  const { initialQuery, replace, focusKey } = host;
  const findInput = useRef<HTMLInputElement>(null);
  const [find, setFind] = useState(() => firstLine(initialQuery ?? ""));
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(replace);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");

  useEffect(() => {
    findInput.current?.focus();
    findInput.current?.select();
  }, [focusKey, initialQuery]);
  useEffect(() => {
    if (initialQuery !== undefined) setFind(firstLine(initialQuery));
  }, [initialQuery, focusKey]);
  useEffect(() => {
    if (replace) setShowReplace(true);
  }, [replace, focusKey]);

  return {
    findInput,
    find,
    setFind,
    replacement,
    setReplacement,
    showReplace,
    setShowReplace,
    include,
    setInclude,
    exclude,
    setExclude,
  };
}

export type FindFields = ReturnType<typeof useFindFields>;
