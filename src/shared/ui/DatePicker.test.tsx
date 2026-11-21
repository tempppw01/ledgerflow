import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'datePicker.ariaLabel': '选择日期',
        'datePicker.dialogLabel': '日期选择器',
        'datePicker.placeholder': '选择日期',
        'datePicker.prevMonth': '上个月',
        'datePicker.nextMonth': '下个月',
        'datePicker.today': '今天',
        'datePicker.clear': '清除'
      };
      return translations[key] ?? key;
    }
  })
}));

describe('DatePicker', () => {
  it('renders and opens when the i18n instance is unavailable', async () => {
    const user = userEvent.setup();

    render(<DatePicker value="2026-11-08" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '选择日期' }));

    expect(screen.getByRole('dialog', { name: '日期选择器' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText(/2026/)).toBeInTheDocument();
  });

  it('打开时焦点落在当前选中日,并支持方向键/PageUp/Home 在日期间移动', async () => {
    const user = userEvent.setup();

    render(<DatePicker value="2026-11-11" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '选择日期' }));

    const cell = (date: string) =>
      within(screen.getByRole('dialog')).getByRole('button', { name: date });
    const active = () => document.activeElement?.getAttribute('aria-label');

    // 打开即聚焦选中日
    await waitFor(() => expect(active()).toBe('2026-11-11'));

    await user.keyboard('{ArrowRight}');
    expect(active()).toBe('2026-11-12');

    await user.keyboard('{ArrowDown}');
    expect(active()).toBe('2026-11-19');

    await user.keyboard('{ArrowLeft}');
    expect(active()).toBe('2026-11-18');

    await user.keyboard('{ArrowUp}');
    expect(active()).toBe('2026-11-11');

    // 2026-11-11 是周三,Home 回到本周一、End 到本周日
    await user.keyboard('{Home}');
    expect(active()).toBe('2026-11-09');
    await user.keyboard('{End}');
    expect(active()).toBe('2026-11-15');

    // PageDown 往后一个月,同一天
    await user.keyboard('{PageDown}');
    await waitFor(() => expect(active()).toBe('2026-12-15'));

    await user.keyboard('{PageUp}');
    await waitFor(() => expect(active()).toBe('2026-11-15'));

    // 移出当前月时能翻月并落到正确的那一天
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(active()).toBe('2026-11-18'));
    expect(cell('2026-11-18')).toBeInTheDocument();
  });

  it('Escape 关闭弹层并把焦点还给触发按钮', async () => {
    const user = userEvent.setup();

    render(<DatePicker value="2026-11-11" onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '选择日期' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('越过 min/max 边界时停在最近的可用日,而不是静默不动', async () => {
    const user = userEvent.setup();

    // 最小可选 2026-11-10:11-10 之前的日期被禁用。
    render(<DatePicker value="2026-11-11" min="2026-11-10" onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '选择日期' }));
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-11-11')
    );

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-11-10');

    // 再往左就越界了:停在 11-10,而不是失焦或被禁用格吞掉
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-11-10');
  });
});
