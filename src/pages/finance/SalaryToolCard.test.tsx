import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SalaryToolCard } from './SalaryToolCard';

/*
 * 「错误要关联到出错的字段」。
 *
 * 这两块原来只有一句顶部的 role="alert":读屏用户逐字段 Tab 过去时听不到任何提示,
 * 只有碰巧经过那句话才知道哪里错了。模型层已经给出"是哪几个字段错了"
 * (salaryCalculator.test.ts 钉着),这里钉的是**接线**:
 * 属性有没有真的挂到对应的输入框上、有没有挂错。
 */
const inputs = (container: HTMLElement) =>
  container.querySelectorAll<HTMLInputElement>('label.finance-salary-field input');

describe('SalaryToolCard 的错误关联到字段', () => {
  it('清空「月薪」时只有它被标错,并指向对应的错误消息', () => {
    const { container } = render(<SalaryToolCard />);
    const [salary, workingDays, dailyHours] = inputs(container);

    // 初值填好时什么都不该标
    expect(salary).not.toHaveAttribute('aria-invalid');
    expect(salary).not.toHaveAttribute('aria-describedby');

    fireEvent.change(salary, { target: { value: '' } });

    expect(salary).toHaveAttribute('aria-invalid', 'true');
    expect(salary).toHaveAttribute('aria-describedby', 'salary-input-error');
    expect(container.querySelector('#salary-input-error')?.textContent).toContain('请先填写月薪');

    // 另外两个字段是好的,不能被一起标红 —— 挂错字段比不挂更糟
    expect(workingDays).not.toHaveAttribute('aria-invalid');
    expect(dailyHours).not.toHaveAttribute('aria-invalid');
  });

  it('三个都空时三个都标错(提示说的就是三个)', () => {
    const { container } = render(<SalaryToolCard />);
    const [salary, workingDays, dailyHours] = inputs(container);

    fireEvent.change(salary, { target: { value: '' } });
    fireEvent.change(workingDays, { target: { value: '' } });
    fireEvent.change(dailyHours, { target: { value: '' } });

    [salary, workingDays, dailyHours].forEach((input) => {
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', 'salary-input-error');
    });
  });

  it('加班时长自己出错时才标它;错误指向上方字段时不标它', () => {
    const { container } = render(<SalaryToolCard />);
    const [salary, , , overtime] = inputs(container);

    // 基础输入没填完:错误指的是上面的字段,加班框不该被标红
    fireEvent.change(salary, { target: { value: '' } });
    expect(overtime).not.toHaveAttribute('aria-invalid');

    // 基础输入正常、加班时长非法:这次才是它的错
    fireEvent.change(salary, { target: { value: '12000' } });
    fireEvent.change(overtime, { target: { value: '99' } });

    expect(overtime).toHaveAttribute('aria-invalid', 'true');
    expect(overtime).toHaveAttribute('aria-describedby', 'overtime-input-error');
    expect(container.querySelector('#overtime-input-error')?.textContent).toContain('加班时长');
  });
});
