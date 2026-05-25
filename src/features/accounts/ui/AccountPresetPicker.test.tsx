import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountPresetPicker } from './AccountPresetPicker';
import type { AccountPreset } from '../model/accountTypes';
import { ALIPAY_LOGO_URL } from '../../../shared/config/brandAssets';

const mockPresets: AccountPreset[] = [
  { name: '现金', type: 'cash', icon: '💵' },
  { name: '支付宝', type: 'virtual', icon: '📱', iconUrl: ALIPAY_LOGO_URL },
  { name: '招商银行', type: 'debit', icon: '🏦' }
];

describe('AccountPresetPicker', () => {
  it('点击预设应触发 onSelect 并传递正确的预设数据', () => {
    let selected: AccountPreset | null = null;
    render(<AccountPresetPicker presets={mockPresets} onSelect={(p) => (selected = p)} />);

    const cashBtn = screen.getByText('现金');
    expect(cashBtn).toBeTruthy();

    fireEvent.click(cashBtn);
    expect(selected).not.toBeNull();
    expect(selected!.name).toBe('现金');
    expect(selected!.type).toBe('cash');

    const alipayBtn = screen.getByText('支付宝');
    fireEvent.click(alipayBtn);
    expect(selected!.name).toBe('支付宝');
    expect(selected!.type).toBe('virtual');
    expect(document.querySelector('.account-preset-brand-icon')).toHaveAttribute('src', ALIPAY_LOGO_URL);
  });
});
