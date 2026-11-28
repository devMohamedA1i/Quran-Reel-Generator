import { useEffect } from 'react';

/**
 * Traps vertical wheel scrolling strictly inside a scrollable element so
 * scrolling never leaks to the outer page while the pointer is inside it.
 */
export function useContainWheel(ref, deps = []) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollTop += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
}
