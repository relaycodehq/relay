import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** What every move that would drop an unsaved edit says instead. */
const LOCKED_MESSAGE = "Save or close the edited file first.";

/**
 * Held while an editor has unsaved changes (or is saving them): moving to
 * another thread, project or file would unmount it and lose them.
 */
export type NavigationLock = {
  locked: boolean;
  /**
   * Whether navigating has to wait, telling the user why when it does. Reads
   * the lock as it is now, so listeners set up long ago can call it.
   */
  blocked: (after?: string) => boolean;
  /** Holds the lock until the returned release is called. */
  hold: () => () => void;
};

const UNLOCKED: NavigationLock = {
  locked: false,
  blocked: () => false,
  hold: () => () => {},
};

const NavigationLockContext = createContext<NavigationLock>(UNLOCKED);

export const NavigationLockProvider = NavigationLockContext.Provider;

/** The lock for the shell to provide; `onBlocked` shows the message. */
export function useNavigationLockRoot(
  onBlocked: (message: string) => void,
): NavigationLock {
  const holders = useRef(0);
  const [locked, setLocked] = useState(false);
  const report = useRef(onBlocked);
  report.current = onBlocked;
  const blocked = useCallback((after?: string) => {
    if (!holders.current) return false;
    report.current(after ? `${LOCKED_MESSAGE} ${after}` : LOCKED_MESSAGE);
    return true;
  }, []);
  const hold = useCallback(() => {
    holders.current++;
    setLocked(true);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      holders.current--;
      setLocked(holders.current > 0);
    };
  }, []);
  return useMemo(() => ({ locked, blocked, hold }), [locked, blocked, hold]);
}

export const useNavigationLock = () => useContext(NavigationLockContext);

/** Holds the lock for as long as `active`, as an editor with unsaved changes. */
export function useHoldNavigation(active: boolean) {
  const { hold } = useNavigationLock();
  useEffect(() => {
    if (active) return hold();
  }, [active, hold]);
}
