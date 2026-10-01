import { useLayoutEffect, useRef } from "react";

/**
 * Like the main thread: stays at the end of `column` as it grows, unless you
 * scrolled `scroll` up to read.
 */
export function useFollowEnd() {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (follow.current && scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    observer.observe(column.current!);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const e = scroll.current!;
    follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 40;
  };
  return { scroll, column, onScroll };
}
