import { useEffect, useMemo, useState, type Ref } from "react";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewProps,
  type ControlledCodeViewProps,
  type UncontrolledCodeViewProps,
} from "@pierre/diffs/react";
import { useTypography } from "../../lib/typography";
import { diffLayout, diffRowMetrics, scrollPastEndSpace } from "./diff-metrics";
import { DIFF_THEME_CSS } from "./diff-theme";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

/** The view owns the stylesheet, row metrics and layout; callers set the rest. */
export type DiffCodeViewOptions<LAnnotation> = Omit<
  NonNullable<CodeViewProps<LAnnotation, undefined>["options"]>,
  "unsafeCSS" | "itemMetrics" | "layout"
>;

type OwnProps<LAnnotation> = {
  options?: DiffCodeViewOptions<LAnnotation>;
  /** The viewer handle (scrollTo, selection, item updates). */
  viewerRef?: Ref<CodeViewHandle<LAnnotation, undefined>>;
  /** CSS added after the shared theme inside each shadow root; it wins ties. */
  unsafeCSSExtra?: string;
  /** Leave a third of the pane blank under the last item. */
  scrollPastEnd?: boolean;
  /** The view needs the scroll container itself. */
  containerRef?: never;
};

type Passthrough<P> = Omit<P, "options" | "containerRef">;

export type DiffCodeViewProps<LAnnotation> = (
  | Passthrough<ControlledCodeViewProps<LAnnotation, undefined>>
  | Passthrough<UncontrolledCodeViewProps<LAnnotation, undefined>>
) &
  OwnProps<LAnnotation>;

/** Relay's themed, virtualised code and diff view. */
export function DiffCodeView<LAnnotation = undefined>(
  props: DiffCodeViewProps<LAnnotation>,
) {
  return (
    <DiffWorkerPoolProvider>
      <ThemedView {...props} />
    </DiffWorkerPoolProvider>
  );
}

function ThemedView<LAnnotation>({
  options,
  viewerRef,
  unsafeCSSExtra,
  scrollPastEnd = false,
  className,
  containerRef: _ignored,
  ...rest
}: DiffCodeViewProps<LAnnotation>) {
  const { codeSize } = useTypography();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const endSpace = useEndSpace(container, scrollPastEnd);

  const fullOptions = useMemo(
    () => ({
      ...options,
      unsafeCSS: unsafeCSSExtra
        ? `${DIFF_THEME_CSS}\n${unsafeCSSExtra}`
        : DIFF_THEME_CSS,
      itemMetrics: diffRowMetrics(codeSize),
      layout: diffLayout(endSpace),
    }),
    [options, unsafeCSSExtra, codeSize, endSpace],
  );

  const viewProps = {
    ...rest,
    options: fullOptions,
    containerRef: setContainer,
    className: className
      ? `diff-render-surface ${className}`
      : "diff-render-surface",
  } as CodeViewProps<LAnnotation, undefined>;

  return <CodeView<LAnnotation> {...viewProps} ref={viewerRef} />;
}

function useEndSpace(element: HTMLElement | null, enabled: boolean) {
  const [space, setSpace] = useState(0);
  useEffect(() => {
    if (!element || !enabled) {
      setSpace(0);
      return;
    }
    const measure = () =>
      setSpace(scrollPastEndSpace(element.clientHeight, true));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, enabled]);
  return space;
}
