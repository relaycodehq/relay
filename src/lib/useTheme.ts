import { useEffect, useState } from "react";
function resolveTheme(): "light" | "dark" {
  const saved = document.documentElement.dataset.theme;
  return saved === "dark" ||
    (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark"
    : "light";
}
export function useTheme() {
  const [theme, setTheme] = useState(resolveTheme);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTheme(resolveTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);
  return theme;
}
