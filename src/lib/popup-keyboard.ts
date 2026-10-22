import { SETTINGS_PAGE } from "./settings-page";

const POPUPS =
  'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"]';
const INACTIVE = '[hidden], [inert], [aria-hidden="true"], [data-closed]';

/**
 * Surfaces that currently own the keyboard. ARIA roles describe accessible
 * content, not keyboard ownership: toasts and informational hover cards are
 * dialogs too. Mark those `data-shortcut-passive`; they only take the keyboard
 * when focus moves inside. Nested menus and dialogs still own their keys.
 * Settings callers exclude the page itself when deciding whether Escape leaves.
 */
export function keyboardPopups(includeSettings = true): Element[] {
  const selector = includeSettings ? `${POPUPS}, ${SETTINGS_PAGE}` : POPUPS;
  return [...document.querySelectorAll(selector)].filter((popup) => {
    if (popup.closest(INACTIVE)) return false;
    // Closed native dialogs can also carry an explicit ARIA role.
    if (popup.matches("dialog:not([open])")) return false;
    for (let el: Element | null = popup; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      )
        return false;
    }
    return (
      !popup.hasAttribute("data-shortcut-passive") ||
      popup.contains(document.activeElement)
    );
  });
}
