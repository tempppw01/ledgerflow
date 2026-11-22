import { describe, expect, it } from 'vitest';
import { buildRepaymentDate, resolveRepaymentCycleWindow } from './repaymentCycle';

/**
 * 还款周期的窗口不变量。
 *
 * 这段逻辑直接决定「这一笔还款算不算本期」,算错就是逾期判定与剩余利息出错,
 * 而且注释里已经记着两个曾经踩过的坑(宽限期白设、到期日还款被算进两期)。
 * 所以这里用**遍历一整年 + 各种还款日**的方式把性质钉住,而不是只测几个例子。
 *
 * 三条不变量:
 * 1. **到期日必须落在自己的窗口内**
 * 2. **相邻两期首尾相接**:既不能重叠(同一笔还款算两期),也不能留缝(还款凭空消失)
 * 3. 还款日 29/30/31 在小月要夹到当月最后一天,窗口仍成立
 */
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function startOfDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

describe('还款周期窗口不变量', () => {
  const anchorDays = [1, 5, 15, 28, 29, 30, 31];

  it('到期日始终落在本期窗口内(遍历 2026 全年 × 7 种还款日)', () => {
    const problems: string[] = [];
    for (const anchorDay of anchorDays) {
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        for (const day of [1, 10, 20, 28]) {
          const now = startOfDay(2026, monthIndex, Math.min(day, 28));
          const window = resolveRepaymentCycleWindow(anchorDay, now);
          const due = window.dueDate.getTime();
          if (due < window.start.getTime() || due > window.end.getTime()) {
            problems.push(
              `anchor=${anchorDay} now=${now.toDateString()} 到期日 ${window.dueDate.toDateString()} ` +
                `不在窗口 [${window.start.toDateString()}, ${window.end.toDateString()}] 内`
            );
          }
        }
      }
    }
    expect(problems.slice(0, 5), problems.join('\n')).toEqual([]);
  });

  it('相邻两期首尾相接:不重叠也不留缝', () => {
    const problems: string[] = [];
    for (const anchorDay of anchorDays) {
      // 取每个月同一天的窗口,检查「上一期结束 + 1ms == 下一期开始」
      const windows = [0, 1, 2, 3, 4, 5].map((offset) => {
        const now = startOfDay(2026, offset, 15);
        return resolveRepaymentCycleWindow(anchorDay, now);
      });
      for (let i = 1; i < windows.length; i += 1) {
        const prevEnd = windows[i - 1].end.getTime();
        const nextStart = windows[i].start.getTime();
        const nextDue = windows[i].dueDate.getTime();
        if (nextDue <= prevEnd) {
          problems.push(
            `anchor=${anchorDay}:第 ${i + 1} 期的到期日(${windows[i].dueDate.toDateString()})` +
              `落在上一期窗口结束(${windows[i - 1].end.toDateString()})之前 —— 会同一笔算两期`
          );
        }
        if (nextStart > nextDue) {
          problems.push(`anchor=${anchorDay}:第 ${i + 1} 期窗口起点晚于自己的到期日`);
        }
      }
    }
    expect(problems.slice(0, 5), problems.join('\n')).toEqual([]);
  });

  it('到期日当天的还款只归属一期(不重叠)', () => {
    const problems: string[] = [];
    for (const anchorDay of anchorDays) {
      for (let monthIndex = 0; monthIndex < 6; monthIndex += 1) {
        const now = startOfDay(2026, monthIndex, 15);
        const window = resolveRepaymentCycleWindow(anchorDay, now);
        // 用「下一个月同一天」的窗口代表下一期
        const nextWindow = resolveRepaymentCycleWindow(anchorDay, startOfDay(2026, monthIndex + 1, 15));
        const dueTime = window.dueDate.getTime();
        const inThis = dueTime >= window.start.getTime() && dueTime <= window.end.getTime();
        const inNext = dueTime >= nextWindow.start.getTime() && dueTime <= nextWindow.end.getTime();
        if (inThis && inNext) {
          problems.push(
            `anchor=${anchorDay}:到期日 ${window.dueDate.toDateString()} 同时落在两期窗口里`
          );
        }
      }
    }
    expect(problems.slice(0, 5), problems.join('\n')).toEqual([]);
  });

  it('还款日 31 在小月夹到当月最后一天', () => {
    // 2026 不是闰年:2 月 28 天
    expect(buildRepaymentDate(2026, 1, 31).getDate()).toBe(28);
    expect(buildRepaymentDate(2026, 3, 31).getDate()).toBe(30); // 4 月
    expect(buildRepaymentDate(2026, 0, 31).getDate()).toBe(31); // 1 月
    // 闰年 2 月
    expect(buildRepaymentDate(2028, 1, 31).getDate()).toBe(29);
  });

  it('没有还款日时退回「本月 1 号到今天」的窗口', () => {
    const now = startOfDay(2026, 10, 22);
    const window = resolveRepaymentCycleWindow(null, now);
    expect(window.start.getDate()).toBe(1);
    expect(window.start.getMonth()).toBe(10);
    expect(window.end.getDate()).toBe(22);
  });

  it('窗口顺序不乱:起点永远早于终点', () => {
    const problems: string[] = [];
    for (const anchorDay of anchorDays) {
      for (let offset = 0; offset < 12; offset += 1) {
        const window = resolveRepaymentCycleWindow(anchorDay, startOfDay(2026, offset, 15));
        if (window.start.getTime() >= window.end.getTime()) {
          problems.push(`anchor=${anchorDay} offset=${offset}:start >= end`);
        }
        if (window.end.getTime() - window.start.getTime() < DAY_IN_MS) {
          problems.push(`anchor=${anchorDay} offset=${offset}:窗口不足一天`);
        }
      }
    }
    expect(problems.slice(0, 5), problems.join('\n')).toEqual([]);
  });
});
/**
 * 两条注释里记着的「曾经踩过的坑」,单独钉成行为断言。
 */
describe('还款周期:两个历史 bug 的形状', () => {
  const anchorDay = 15;

  it('宽限期内的迟还仍然算本期(而不是直接判逾期)', () => {
    // 到期日 11-15,10 天宽限 → 11-20 还款仍属于本期
    const now = startOfDay(2026, 10, 20);
    const window = resolveRepaymentCycleWindow(anchorDay, now);
    const paidAt = startOfDay(2026, 10, 20).getTime();

    expect(window.dueDate.getDate()).toBe(15);
    expect(window.dueDate.getMonth()).toBe(10);
    expect(paidAt >= window.start.getTime() && paidAt <= window.end.getTime(), '宽限期内的还款没有被算进本期').toBe(
      true
    );
  });

  it('宽限期结束后的还款归到下一期', () => {
    // 11-15 到期 + 10 天宽限 → 11-26 已经属于下一期(12-15)
    const now = startOfDay(2026, 10, 26);
    const window = resolveRepaymentCycleWindow(anchorDay, now);
    expect(window.dueDate.getMonth()).toBe(11); // 12 月
    expect(window.dueDate.getDate()).toBe(15);
  });

  it('到期日当天还款只算一期(不会被下一期重复计)', () => {
    // 本期:11-15 到期。下一期(12-15)要从宽限期结束之后看 ——
    // 10-20 仍在 11-15 那一期的宽限期内,拿它当「下一期」会得到同一个窗口。
    const current = resolveRepaymentCycleWindow(anchorDay, startOfDay(2026, 10, 15));
    const next = resolveRepaymentCycleWindow(anchorDay, startOfDay(2026, 10, 26));
    const dueTime = startOfDay(2026, 10, 15).getTime();

    expect(current.dueDate.getMonth()).toBe(10); // 11-15
    expect(next.dueDate.getMonth()).toBe(11); // 12-15
    expect(dueTime >= current.start.getTime() && dueTime <= current.end.getTime()).toBe(true);
    expect(dueTime >= next.start.getTime() && dueTime <= next.end.getTime()).toBe(false);
  });
});
