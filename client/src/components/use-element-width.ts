import React from 'react';

/** Measures the currently mounted element, including elements that appear after a loading state. */
export function useElementWidth(initial: number): [React.RefCallback<HTMLDivElement>, number] {
  const [width, setWidth] = React.useState(initial);
  const nodeRef = React.useRef<HTMLDivElement | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  const ref = React.useCallback((node: HTMLDivElement | null) => {
    if (nodeRef.current === node) return;
    observerRef.current?.disconnect();
    observerRef.current = null;
    nodeRef.current = node;
    if (!node) return;

    const measuredWidth = node.getBoundingClientRect().width;
    if (measuredWidth > 0) setWidth(measuredWidth);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return [ref, width];
}
