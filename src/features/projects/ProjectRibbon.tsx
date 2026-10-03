import { useId } from "react";
import "./projects.css";

/**
 * A marker underline in the palette of Relay's mark: one gently arched stroke
 * with rounded ends and a darker lower lip, easing off at the tail.
 */
export function ProjectRibbon() {
  const id = useId();
  const sweep =
    "M6 15.2 C78 7.6 160 7 234.5 12.6 C237.8 12.9 237.6 16.2 234.2 16 C160 11.8 78 12.8 6.4 20.2 C2.2 20.4 2 15.6 6 15.2 Z";
  // The darker lower lip, like the underside showing on the mark's folds.
  const underside =
    "M6.4 20.2 C78 12.8 160 11.8 234.2 16 C160 10.2 78 11.2 6.4 18.4 Z";
  return (
    <svg
      className="project-name-ribbon"
      viewBox="0 0 240 24"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${id}-face`}
          gradientUnits="userSpaceOnUse"
          x1="4"
          y1="18"
          x2="238"
          y2="12"
        >
          <stop offset="0" className="ribbon-stop-light" />
          <stop offset="0.4" className="ribbon-stop-mid" />
          <stop offset="1" className="ribbon-stop-end" />
        </linearGradient>
        <linearGradient
          id={`${id}-under`}
          gradientUnits="userSpaceOnUse"
          x1="10"
          y1="0"
          x2="232"
          y2="0"
        >
          <stop offset="0" className="ribbon-stop-back" stopOpacity="0" />
          <stop offset="0.5" className="ribbon-stop-back" stopOpacity="0.8" />
          <stop offset="1" className="ribbon-stop-back" stopOpacity="0" />
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
        <path d={underside} fill={`url(#${id}-under)`} />
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
