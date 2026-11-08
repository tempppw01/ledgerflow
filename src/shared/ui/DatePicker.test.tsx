import { render, screen, within } from '@testing-library/react';
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
});
