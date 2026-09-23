import type { PastedText } from "../../shared/pasted-texts";

// Pastes stay beside the draft text, so a reload keeps them attached.
const storageKey = (draftKey: string) => "pasted-texts:" + draftKey;

export function loadDraftPastes(draftKey: string): PastedText[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(draftKey)) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter(
          (p): p is PastedText =>
            !!p && Number.isInteger(p.n) && typeof p.text === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function saveDraftPastes(draftKey: string, pastes: PastedText[]) {
  if (pastes.length)
    localStorage.setItem(storageKey(draftKey), JSON.stringify(pastes));
  else localStorage.removeItem(storageKey(draftKey));
}
