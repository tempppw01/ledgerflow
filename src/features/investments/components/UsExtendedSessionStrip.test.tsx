import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../../i18n';
import { UsExtendedSessionStrip } from './UsExtendedSessionStrip';

/**
 * 盘前/盘后倒计时的展示层。
 *
 * 时间点一律用 UTC 字符串给出,注释标出对应的美东时间 —— 断言不依赖测试机时区。
 * 这里只关心"给人看到什么",判定逻辑本身在 usExtendedSession.test.ts 里。
 */
const at = (iso: string) => new Date(iso);

describe('UsExtendedSessionStrip', () => {
  it('盘前进行中:该段标成进行中并倒计时到 09:30,盘后显示距开始', () => {
    // 周五 05:00 ET —— 盘前 04:00–09:30 正在进行
    render(<UsExtendedSessionStrip now={at('2026-11-27T10:00:00Z')} />);

    const strip = screen.getByTestId('us-extended-session');
    expect(strip).toHaveAttribute('data-active-session', 'pre');

    const pre = strip.querySelector('[data-session="pre"]');
    expect(pre).toHaveAttribute('data-state', 'active');
    expect(pre).toHaveTextContent('盘前');
    expect(pre).toHaveTextContent('04:00–09:30 ET');
    // 距 09:30 还有 4 小时 30 分
    expect(pre).toHaveTextContent('进行中 · 剩余 04:30:00');

    const after = strip.querySelector('[data-session="after"]');
    expect(after).toHaveAttribute('data-state', 'today');
    expect(after).toHaveTextContent('16:00–20:00 ET');
    // 距 16:00 还有 11 小时
    expect(after).toHaveTextContent('距开始 11:00:00');
  });

  it('盘后进行中:盘后标成进行中', () => {
    // 周五 18:00 ET
    render(<UsExtendedSessionStrip now={at('2026-11-27T23:00:00Z')} />);

    const strip = screen.getByTestId('us-extended-session');
    expect(strip).toHaveAttribute('data-active-session', 'after');
    const after = strip.querySelector('[data-session="after"]');
    expect(after).toHaveAttribute('data-state', 'active');
    expect(after).toHaveTextContent('进行中 · 剩余 02:00:00');
  });

  it('常规时段:两段都不是进行中,盘前指向下个交易日', () => {
    // 周一 10:00 ET
    render(<UsExtendedSessionStrip now={at('2026-11-30T15:00:00Z')} />);

    const strip = screen.getByTestId('us-extended-session');
    expect(strip).toHaveAttribute('data-active-session', 'none');

    const pre = strip.querySelector('[data-session="pre"]');
    expect(pre).toHaveAttribute('data-state', 'later');
    // 明天 04:00 = 18 小时
    expect(pre).toHaveTextContent('距下个盘前 18:00:00');

    const after = strip.querySelector('[data-session="after"]');
    expect(after).toHaveAttribute('data-state', 'today');
    expect(after).toHaveTextContent('距开始 06:00:00');
  });

  it('周末给出说明:两个倒计时指向下个交易日', () => {
    // 周六 13:00 ET
    render(<UsExtendedSessionStrip now={at('2026-11-28T18:00:00Z')} />);

    expect(screen.getByTestId('us-extended-session')).toHaveTextContent(
      '周末休市,两个倒计时都指向下个交易日'
    );
    // 周六 13:00 → 周一 04:00 = 39 小时
    const pre = screen.getByTestId('us-extended-session').querySelector('[data-session="pre"]');
    expect(pre).toHaveTextContent('距下个盘前 39:00:00');
  });

  it('常规时段里不出现「周末休市」说明', () => {
    render(<UsExtendedSessionStrip now={at('2026-11-30T15:00:00Z')} />);
    expect(screen.getByTestId('us-extended-session')).not.toHaveTextContent('周末休市');
  });

  it('倒计时是纯文本,不放 aria-live(否则读屏器每秒被念一次)', () => {
    const { container } = render(<UsExtendedSessionStrip now={at('2026-11-27T10:00:00Z')} />);
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[role="timer"]')).toBeNull();
    // 状态用文字写着「进行中」,不依赖圆点或颜色
    expect(screen.getByTestId('us-extended-session')).toHaveTextContent('进行中');
  });
});
