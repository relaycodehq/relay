import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRemote } from "../remote/RemoteProvider";
import { ThemeContext, builtIn, fromDesktop } from "./theme";

/**
 * computer: the desktop's theme and mode. phone: its theme, following the
 * phone's light or dark. light/dark: its theme in that mode.
 */
export type ThemePreference = "computer" | "phone" | "light" | "dark";
const key = "relay-theme";

const Preference = createContext<{
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}>({ preference: "computer", setPreference: () => {} });

export const useThemePreference = () => useContext(Preference);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const appearance = useRemote().overview?.appearance;
  const [preference, setPreference] = useState<ThemePreference>("computer");
  useEffect(() => {
    void AsyncStorage.getItem(key).then((saved) => {
      if (saved === "computer" || saved === "phone" || saved === "light" || saved === "dark")
        setPreference(saved);
    });
  }, []);
  const palette = useMemo(() => {
    const kind =
      preference === "light" || preference === "dark"
        ? preference
        : preference === "computer" && appearance && appearance.mode !== "system"
          ? appearance.mode
          : scheme;
    return appearance ? fromDesktop(appearance[kind]) : builtIn[kind];
  }, [preference, appearance, scheme]);
  const value = useMemo(
    () => ({
      preference,
      setPreference: (p: ThemePreference) => {
        setPreference(p);
        void AsyncStorage.setItem(key, p);
      },
    }),
    [preference],
  );
  return (
    <Preference.Provider value={value}>
      <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>
    </Preference.Provider>
  );
}
