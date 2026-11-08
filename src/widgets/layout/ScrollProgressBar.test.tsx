import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { ScrollProgressBar } from './ScrollProgressBar';

function ScrollProgressHarness() {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <div data-testid="scroll-container" ref={scrollRef}>
        <div style={{ height: 1200 }} />
      </div>
      <ScrollProgressBar targetRef={scrollRef} />
    </div>
  );
}

describe('ScrollProgressBar', () => {
  it('reflects the scroll ratio and hides at the top of the page', async () => {
    const { getByTestId } = render(<ScrollProgressHarness />);
    const container = getByTestId('scroll-container');
    const bar = document.querySelector<HTMLElement>('.scroll-progress-bar');

    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      value: 250,
      writable: true
    });

    fireEvent.scroll(container);

    await waitFor(() => {
      expect(bar?.style.transform).toBe('scaleX(0.25)');
      expect(bar?.style.opacity).toBe('1');
    });

    container.scrollTop = 0;
    fireEvent.scroll(container);

    await waitFor(() => {
      expect(bar?.style.transform).toBe('scaleX(0)');
      expect(bar?.style.opacity).toBe('0');
    });
  });
});
