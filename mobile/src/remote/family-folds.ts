// How the user left each started-threads family in Activity, kept past
// switching to Projects and back, and past a restart.
import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseFamilyFolds, withFamilyFold, type FamilyFolds } from "../../../shared/family-folds";

const key = "relay-family-folds";

let folds: FamilyFolds = {};
const listeners = new Set<() => void>();

void AsyncStorage.getItem(key)
  .then((saved) => {
    if (!saved) return;
    // A fold made while the read went on is newer than the saved one.
    folds = { ...parseFamilyFolds(JSON.parse(saved)), ...folds };
    listeners.forEach((l) => l());
  })
  .catch(() => {});

export function foldFamily(lead: string, open: boolean) {
  folds = withFamilyFold(folds, lead, open);
  listeners.forEach((l) => l());
  void AsyncStorage.setItem(key, JSON.stringify(folds)).catch(() => {});
}

/** Each family's fold by its lead's id; one never toggled is missing. */
export const useFamilyFolds = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => folds,
  );
