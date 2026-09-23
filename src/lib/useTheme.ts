import { useAppearance } from "./appearance";

/** The colour mode on screen, for views that style light and dark apart. */
export const useTheme = () => useAppearance().palette.kind;
