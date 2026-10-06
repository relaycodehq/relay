/**
 * Relay's look for the diff view, injected into each file's shadow root. It
 * sits in the library's last cascade layer, so it beats the bundled styles
 * without needing specificity. Colours come from Relay's palette variables;
 * the only library colours kept are the addition, deletion and modified
 * accents the syntax theme provides.
 */
export const DIFF_THEME_CSS = String.raw`
:host {
  --diffs-bg: var(--code-background);
  --relay-band: color-mix(in srgb, var(--code-background) 90%, var(--diffs-modified-base));
  --relay-band-rule: color-mix(in srgb, var(--diffs-modified-base) 22%, transparent);
  --relay-hover: color-mix(in srgb, var(--code-background) 90%, var(--code-foreground));
}

pre, code, [data-error-wrapper] {
  background-color: var(--code-background);
  color: var(--code-foreground);
  font-family: var(--font-mono);
}

[data-line] span:not([data-diff-span]) {
  background-color: transparent;
}

[data-content-buffer], [data-gutter-buffer="buffer"] {
  --diffs-line-bg: var(--code-background);
  background-color: var(--code-background);
  background-image: none;
}

[data-line], [data-no-newline] {
  &[data-line-type="change-addition"] { --diffs-computed-diff-line-bg: var(--diff-addition); }
  &[data-line-type="change-deletion"] { --diffs-computed-diff-line-bg: var(--diff-deletion); }
}
[data-column-number], [data-gutter-buffer] {
  &[data-line-type="change-addition"] {
    --diffs-computed-diff-line-bg: color-mix(in srgb, var(--diff-addition) 78%, var(--diffs-addition-base));
  }
  &[data-line-type="change-deletion"] {
    --diffs-computed-diff-line-bg: color-mix(in srgb, var(--diff-deletion) 78%, var(--diffs-deletion-base));
  }
}

:is([data-line], [data-line-annotation], [data-no-newline], [data-merge-conflict])[data-selected-line] {
  --diffs-computed-selected-line-bg: color-mix(in oklab, var(--code-background) 93%, var(--diffs-modified-base));
}
:is([data-column-number], [data-gutter-buffer])[data-selected-line] {
  --diffs-computed-selected-line-bg: light-dark(
    color-mix(in lab, var(--code-background) 93.6%, var(--diffs-modified-base)),
    color-mix(in lab, var(--code-background) 93%, var(--diffs-modified-base))
  );
}
[data-indicators="bars"] :is([data-column-number], [data-gutter-buffer="annotation"])[data-selected-line]::before {
  content: "";
  contain: strict;
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: var(--diffs-modified-base);
}

[data-separator="line-info"] {
  box-sizing: border-box;
  height: 32px;
  margin-block: 0;
  background-color: var(--relay-band);
  border-block: 1px solid var(--relay-band-rule);
  font-family: var(--font-sans);
}
[data-separator="line-info"] [data-separator-wrapper] {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100cqi;
  padding: 0 8px;
  font-size: 12px;
  line-height: normal;
  background: transparent;
  border-radius: 0;
}
[data-additions] [data-separator="line-info"] [data-separator-wrapper],
[data-content] [data-separator="line-info"] [data-separator-wrapper] {
  display: none;
}
[data-separator="line-info"] [data-expand-button] {
  flex: none;
  align-self: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--diffs-modified-base);
}
[data-separator="line-info"] [data-expand-all-button] {
  display: flex;
  width: auto;
  padding: 0 8px;
  white-space: nowrap;
}
[data-separator="line-info"] [data-separator-content] {
  flex: 1 1 auto;
  padding: 0 4px;
  border-radius: 0;
  background: transparent;
  text-decoration: none;
}
[data-separator="line-info"] [data-unmodified-lines] {
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
}
[data-separator="line-info"] :is([data-expand-button], [data-unmodified-lines]) {
  &:hover {
    background: var(--relay-hover);
    color: var(--code-foreground);
  }
  &:focus-visible {
    outline: 2px solid var(--diffs-modified-base);
    outline-offset: -2px;
  }
}

[data-diffs-header] {
  min-height: 32px;
  padding: 6px 12px 6px 8px;
  background-color: var(--code-background);
  color: var(--code-foreground);
  font: 12px var(--font-sans);
}

::highlight(relay-diff-find) {
  background-color: light-dark(#ffe17a, #6e5a10);
}
::highlight(relay-diff-find-current) {
  background-color: light-dark(#ff9f2e, #c77a12);
  color: light-dark(#000, #fff);
}

[data-diff], [data-file] {
  transition: opacity 200ms ease-out;
  @starting-style {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-diff], [data-file] {
    transition: none;
  }
}
`;
