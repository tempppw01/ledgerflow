import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExchangePage } from './ExchangePage';

vi.mock('../api/exchangeClient', () => ({
  fetchLatestRates: vi.fn(async () => ({
    date: '2026-01-01',
    rates: { CNY: 1, USD: 0.14, EUR: 0.13 }
  }))
}));

vi.mock('../model/cache', () => ({
  readCache: vi.fn(() => null),
  writeCache: vi.fn()
}));

/**
 * jsdom 里 getBoundingClientRect 恒为 0。必须在**挂载前**桩掉:
 * 组件挂载时的 clamp 会按"容器宽 0"把左栏压到最小宽,之后再补测量也回不来了 ——
 * 第一版就是这么写的,于是测出来的起点是 320 而不是默认的 420。
 */
function stubLayoutWidth(width: number) {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this instanceof HTMLElement && this.classList.contains('exchange-layout')) {
      return {
        width,
        height: 800,
        top: 0,
        left: 0,
        right: width,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect;
    }
    return original.call(this);
  });
}

/*
 * WCAG 2.1.1(键盘可达):这个分隔条原来连 tabIndex 都没有 —— 键盘用户完全改不了两栏宽度。
 * 测试按"值有没有变"断言,而不是"能不能聚焦":能聚焦但按不动,功能一样是不可达的。
 */
describe('ExchangePage 分隔条键盘可达(WCAG 2.1.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubLayoutWidth(1200);
  });

  const renderPage = async () => {
    render(
      <MemoryRouter>
        <ExchangePage />
      </MemoryRouter>
    );
    await screen.findByRole('separator', { name: /调整汇率换算器与汇率数据宽度/ });
  };

  it('分隔条可聚焦,并报告当前值与上下限', async () => {
    await renderPage();

    const divider = screen.getByRole('separator', { name: /调整汇率换算器与汇率数据宽度/ });
    expect(divider).toHaveAttribute('tabindex', '0');

    const min = Number(divider.getAttribute('aria-valuemin'));
    const max = Number(divider.getAttribute('aria-valuemax'));
    const now = Number(divider.getAttribute('aria-valuenow'));
    expect(min).toBe(320);
    // 1200 - 420(右栏最小宽)= 780,必须真的用上量到的宽度,而不是退化成 min。
    expect(max).toBe(780);
    expect(now).toBe(420);
  });

  it('箭头键 / Shift 粗档 / Home / End 都能改宽度,并在两端夹住', async () => {
    await renderPage();

    const divider = screen.getByRole('separator', { name: /调整汇率换算器与汇率数据宽度/ });
    const value = () => Number(divider.getAttribute('aria-valuenow'));

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(value()).toBe(420 + 16);

    fireEvent.keyDown(divider, { key: 'ArrowRight', shiftKey: true });
    expect(value()).toBe(420 + 16 + 48);

    fireEvent.keyDown(divider, { key: 'End' });
    expect(value()).toBe(780);

    // 到顶以后继续往右不能再涨(夹在 max)
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(value()).toBe(780);

    fireEvent.keyDown(divider, { key: 'Home' });
    expect(value()).toBe(320);

    // 到底以后继续往左也不能再降
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(value()).toBe(320);
  });

  /*
   * WCAG 2.5.7(拖拽移动,AA):分隔条两侧的 −/+ 按钮是**单指、非拖拽**入口。
   */
  it('两侧按钮能改宽度,并在边界禁用', async () => {
    await renderPage();

    const divider = screen.getByRole('separator', { name: /调整汇率换算器与汇率数据宽度/ });
    const value = () => Number(divider.getAttribute('aria-valuenow'));
    const max = Number(divider.getAttribute('aria-valuemax'));
    const min = Number(divider.getAttribute('aria-valuemin'));
    const widen = screen.getByRole('button', { name: '加宽汇率换算器' });
    const narrow = screen.getByRole('button', { name: '收窄汇率换算器' });

    expect(value()).toBe(420);

    fireEvent.click(widen);
    expect(value()).toBe(420 + 16);
    fireEvent.click(narrow);
    fireEvent.click(narrow);
    expect(value()).toBe(420 - 16);

    // 一路收窄到底:停在最小值,「收窄」自行禁用
    for (let i = 0; i < 30; i += 1) fireEvent.click(narrow);
    expect(value()).toBe(min);
    expect(narrow).toBeDisabled();
    expect(widen).not.toBeDisabled();

    // 一路加宽到顶
    for (let i = 0; i < 60; i += 1) fireEvent.click(widen);
    expect(value()).toBe(max);
    expect(widen).toBeDisabled();
  });
});
