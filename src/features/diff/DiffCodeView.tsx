import {
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
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
  const steady = useSteadyOptions(options);
  const itemMetrics = useMemo(() => diffRowMetrics(codeSize), [codeSize]);
  const layout = useMemo(() => diffLayout(endSpace), [endSpace]);

  const fullOptions = useMemo(
    () => ({
      ...steady,
      unsafeCSS: unsafeCSSExtra
        ? `${DIFF_THEME_CSS}\n${unsafeCSSExtra}`
        : DIFF_THEME_CSS,
      itemMetrics,
      layout,
    }),
    [steady, unsafeCSSExtra, itemMetrics, layout],
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

/**
 * `options` keeping one identity until one of its values changes. Callers
 * write them inline, and Pierre redraws every line of the view whenever an
 * option's identity changes, so any re-render of a parent (a pane being
 * resized, a turn streaming) repainted the whole file. Functions stay the
 * same function and call the caller's latest one.
 */
function useSteadyOptions<T extends object>(options: T | undefined) {
  const latest = useRef(options);
  // Insertion effects run before any layout effect, so Pierre's renders in
  // its own layout effect already call the new functions.
  useInsertionEffect(() => {
    latest.current = options;
  });
  const [kept, keep] = useState(() => steadyFrom(options, latest));
  if (sameValues(kept.from, options)) return kept.options;
  const next = steadyFrom(options, latest);
  keep(next);
  return next.options;
}

function steadyFrom<T extends object>(
  options: T | undefined,
  latest: RefObject<T | undefined>,
) {
  const call =
    (key: string) =>
    (...args: unknown[]) => {
      const fn = (latest.current as Record<string, unknown> | undefined)?.[key];
      return typeof fn === "function" ? fn(...args) : undefined;
    };
  return {
    from: options,
    options:
      options &&
      (Object.fromEntries(
        Object.entries(options).map(([key, value]) => [
          key,
          typeof value === "function" ? call(key) : value,
        ]),
      ) as T),
  };
}

function sameValues(a: object | undefined, b: object | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every(
      (key) =>
        key in y &&
        (x[key] === y[key] ||
          (typeof x[key] === "function" && typeof y[key] === "function")),
    )
  );
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
