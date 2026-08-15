import { useEffect, useRef } from "react";

/**
 * Re-run `load` on an interval while the tab is visible so floor/distribution
 * views stay current without inventing a websocket.
 */
export function useLiveRefresh(load: () => void | Promise<unknown>, ms = 20000) {
  const saved = useRef(load);
  saved.current = load;

  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      saved.current();
    };
    const id = window.setInterval(tick, ms);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms]);
}
