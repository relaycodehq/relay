/** "Scratchpad" written out in pen, then underlined with a quick scribble. */
export function ScratchpadWord() {
  return (
    <span className="scratchpad-word">
      <span className="scratchpad-ink">Scratchpad</span>
      <svg
        className="scratchpad-underline"
        viewBox="0 0 200 14"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          pathLength={1}
          d="M4 7 C 60 3, 140 9, 196 4 C 150 8, 90 11, 34 12"
        />
      </svg>
    </span>
  );
}
