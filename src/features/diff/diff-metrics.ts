import type { CodeViewLayout, VirtualFileMetrics } from "@pierre/diffs";

/**
 * Row geometry the virtualiser uses for rows it has not measured. It must
 * agree with the CSS: `--diffs-line-height` in styles.css is the same
 * code-size + 10 sum, and the separator band is 32 px in diff-theme.ts.
 */
export function diffRowMetrics(codeSize: number): VirtualFileMetrics {
  return {
    hunkLineCount: 1,
    lineHeight: codeSize + 10,
    diffHeaderHeight: 32,
    hunkSeparatorHeight: 32,
    spacing: 0,
    paddingTop: 0,
    // The library paints an 8 px gap under every file's last line; leaving it
    // out makes long lists end beyond the reachable scroll range.
    paddingBottom: 8,
  };
}

/** Blank room under the last item: a third of the pane, or none. */
export function scrollPastEndSpace(
  viewportHeight: number,
  enabled: boolean,
): number {
  return enabled ? Math.round(viewportHeight / 3) : 0;
}

export function diffLayout(endSpace: number): CodeViewLayout {
  return { paddingTop: 0, gap: 0, paddingBottom: endSpace };
}
