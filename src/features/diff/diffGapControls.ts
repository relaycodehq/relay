/** Enhance Pierre's built-in controls through its public post-render hook.
 * Its own click handler performs expansion and preserves the virtual scroll anchor. */
export function labelDiffGapControls(node: HTMLElement) {
  const root = node.shadowRoot ?? node;
  for (const gap of root.querySelectorAll<HTMLElement>("[data-expand-index]")) {
    const countNode = gap.querySelector<HTMLElement>("[data-unmodified-lines]");
    const count = Number.parseInt(countNode?.textContent ?? "", 10);
    if (!Number.isFinite(count)) continue;
    if (countNode)
      countNode.textContent = `${count} unchanged ${count === 1 ? "line" : "lines"}`;
    for (const control of gap.querySelectorAll<HTMLElement>(
      "[data-expand-button], [data-unmodified-lines]",
    )) {
      const all = control.hasAttribute("data-expand-all-button");
      const edge = control.hasAttribute("data-expand-up")
        ? " from the upper edge"
        : control.hasAttribute("data-expand-down")
          ? " from the lower edge"
          : "";
      const label = all
        ? `Expand all ${count} unchanged lines`
        : `Show more unchanged lines${edge}`;
      control.setAttribute("role", "button");
      control.setAttribute("aria-label", label);
      control.title = all
        ? label
        : `${label} · Shift-click to expand the entire gap`;
      control.tabIndex = 0;
      control.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        control.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            composed: true,
            shiftKey: event.shiftKey,
          }),
        );
      };
    }
  }
}
