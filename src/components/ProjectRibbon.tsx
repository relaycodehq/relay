import { useId } from "react";

/** A curved stroke tapered at both ends in the same lavender palette as Relay's mark. */
export function ProjectRibbon() {
  const id = useId();
  const sweep =
    "M5 15.5 C62 10 148 9 234 5.5 C239 5.3 240 10.2 235.5 11 C150 15 72 19.5 7 20.5 C2 20.8 1 16 5 15.5 Z";
  return (
    <svg
      className="project-name-ribbon"
      viewBox="0 0 240 24"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" className="ribbon-stop-light" />
          <stop offset="0.46" className="ribbon-stop-mid" />
          <stop offset="1" className="ribbon-stop-end" />
        </linearGradient>
        <linearGradient id={`${id}-light`}>
          <stop stopColor="white" stopOpacity="0" />
          <stop offset="0.5" stopColor="white" stopOpacity="0.55" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={sweep} />
        </clipPath>
      </defs>
      <g className="project-ribbon-wave">
        <path d={sweep} fill={`url(#${id}-face)`} />
        <g clipPath={`url(#${id}-clip)`}>
          <rect
            className="project-ribbon-sheen"
            x="-80"
            y="0"
            width="75"
            height="24"
            fill={`url(#${id}-light)`}
          />
        </g>
      </g>
    </svg>
  );
}
