import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExchangeConverter } from './ExchangeConverter';
import type { ExchangeRate } from '../model/types';

const mockRates: ExchangeRate[] = [
  { code: 'USD', name: '美元', rate: 0.14 },
  { code: 'EUR', name: '欧元', rate: 0.13 },
  { code: 'JPY', name: '日元', rate: 21.5 }
];

describe('ExchangeConverter', () => {
  it('应渲染换算器并显示结果', () => {
    render(<ExchangeConverter rates={mockRates} base="CNY" />);

    expect(screen.getByText('💱 货币换算')).toBeTruthy();
    expect(screen.getByLabelText('换算结果').textContent).toContain('0.1400');
  });

  it('交换按钮应互换 from/to 货币', () => {
    render(<ExchangeConverter rates={mockRates} base="CNY" />);

    const swapBtn = screen.getByTitle('交换货币');
    fireEvent.click(swapBtn);

    const result = screen.getByLabelText('换算结果').textContent;
    expect(result).toMatch(/7\.1429/);
  });

  it('计算器键盘可输入表达式并实时换算', () => {
    render(<ExchangeConverter rates={mockRates} base="CNY" />);

    fireEvent.click(screen.getByRole('button', { name: 'C' }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: '=' }));

    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByLabelText('换算结果').textContent).toContain('2.1000');
  });

  it('应保持简单键盘，仅支持加减乘除', () => {
    render(<ExchangeConverter rates={mockRates} base="CNY" />);

    expect(screen.queryByRole('button', { name: '√x' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'x²' })).toBeNull();
    expect(screen.queryByRole('button', { name: '1/x' })).toBeNull();
    expect(screen.queryByRole('button', { name: '±' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'C' }));
    fireEvent.click(screen.getByRole('button', { name: '8' }));
    fireEvent.click(screen.getByRole('button', { name: '÷' }));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: '=' }));

    expect(screen.getByText('2', { selector: '.exchange-calculator-screen' })).toBeTruthy();
  });

  it('支持电脑键盘直接输入和计算', () => {
    render(<ExchangeConverter rates={mockRates} base="CNY" />);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: '0' });
    fireEvent.keyDown(window, { key: '+' });
    fireEvent.keyDown(window, { key: '5' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(screen.getByText('15', { selector: '.exchange-calculator-screen' })).toBeTruthy();
    expect(screen.getByLabelText('换算结果').textContent).toContain('2.1000');
  });

  it('支持退格和删除键控制计算器', () => {
    render(<ExchangeConverter rates={mockRates} base="CNY" />);

    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: '9' });
    fireEvent.keyDown(window, { key: '8' });
    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(screen.getByText('9', { selector: '.exchange-calculator-screen' })).toBeTruthy();
  });
});
