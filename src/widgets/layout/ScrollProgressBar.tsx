import { useEffect, useRef, type RefObject } from 'react';

interface ScrollProgressBarProps<T extends HTMLElement> {
  targetRef: RefObject<T | null>;
}

function getAnimationFrameApi() {
  if (typeof window.requestAnimationFrame === 'function') {
    return {
      request: window.requestAnimationFrame.bind(window),
      cancel: window.cancelAnimationFrame.bind(window)
    };
  }

  return {
    request(callback: FrameRequestCallback) {
      return window.setTimeout(() => callback(performance.now()), 16);
    },
    cancel(id: number) {
      window.clearTimeout(id);
    }
  };
}

export function ScrollProgressBar<T extends HTMLElement>({
  targetRef
}: ScrollProgressBarProps<T>) {
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = targetRef.current;
    const bar = barRef.current;
    if (!container || !bar) return;

    const frameApi = getAnimationFrameApi();
    let frameId = 0;

    const update = () => {
      frameId = 0;
      const scrollRange = Math.max(container.scrollHeight - container.clientHeight, 0);
      const progress =
        scrollRange > 0 ? Math.min(Math.max(container.scrollTop / scrollRange, 0), 1) : 0;

      bar.style.transform = `scaleX(${progress})`;
      bar.style.opacity = progress > 0.001 ? '1' : '0';
    };

    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = frameApi.request(update);
    };

    container.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(container);
    Array.from(container.children).forEach((child) => resizeObserver?.observe(child));

    update();

    return () => {
      if (frameId) frameApi.cancel(frameId);
      container.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [targetRef]);

  return (
    <div className="scroll-progress" aria-hidden="true">
      <span ref={barRef} className="scroll-progress-bar" />
    </div>
  );
}
