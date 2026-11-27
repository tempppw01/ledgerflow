import { useTFallback } from '../../../shared/lib/useTFallback';
import {
  formatCountdown,
  formatWindowMinute,
  resolveUsExtendedView,
  type UsExtendedSlot,
  type UsExtendedView
} from '../model/usExtendedSession';
import './us-extended-session.css';

/**
 * 美股盘前/盘后:标记 + 实时倒计时。
 *
 * 为什么单独做成组件、并且把 `now` 当 prop 传进来:
 *   1. 父级(GlobalMarketClock)本来就每秒重跑一次,倒计时**不需要**自己再开一个
 *      interval —— 多一个定时器只会多一处「组件卸载了还在 setState」的风险;
 *   2. 时间从外面进来,测试可以直接喂九个不同的时刻,不用 fake timers
 *      (fake timers 和 testing-library 的 waitFor 混在一起很容易假死)。
 *
 * 无障碍上的两个刻意的选择:
 *   · **不加 `aria-live`**:里面每秒都在变,加了就是每秒对读屏器念一次倒计时,
 *     那是最典型的"过度播报"。读屏用户移到这一段时会读到当时的值,这就够了。
 *   · 正在交易那一段带一个小圆点标记,但那只是视觉提示;状态本身用文字写着
 *     「进行中」,不靠颜色或圆点传达。
 */
export function UsExtendedSessionStrip({ now }: { now: Date }) {
  const tf = useTFallback();
  let view: UsExtendedView;
  try {
    view = resolveUsExtendedView(now);
  } catch {
    // Intl 在极端环境(缺少时区数据)下会抛。倒计时是锦上添花,不能因此把整个行情页打挂。
    return null;
  }

  const nameOf = (session: UsExtendedSlot['session']) =>
    session === 'pre'
      ? tf('investments.usExtended.pre', '盘前')
      : tf('investments.usExtended.after', '盘后');

  const labelOf = (slot: UsExtendedSlot) => {
    const time = formatCountdown(slot.countdownMs);
    if (slot.state === 'active') {
      return tf('investments.usExtended.active', '进行中 · 剩余 {time}').replace('{time}', time);
    }
    if (slot.state === 'today') {
      return tf('investments.usExtended.pendingToday', '距开始 {time}').replace('{time}', time);
    }
    return tf('investments.usExtended.pendingNext', '距下个{name} {time}')
      .replace('{name}', nameOf(slot.session))
      .replace('{time}', time);
  };

  return (
    <section
      className="us-extended"
      aria-label={tf('investments.usExtended.title', '美股盘前盘后倒计时')}
      data-testid="us-extended-session"
      data-active-session={view.activeSession ?? 'none'}
    >
      <div className="us-extended-head">
        <span className="us-extended-eyebrow">
          <span aria-hidden="true">🇺🇸</span>{' '}
          {tf('investments.usExtended.title', '美股盘前盘后倒计时')}
        </span>
        <span className="us-extended-hint">
          {tf('investments.usExtended.hint', '美东时间 · 盘前 04:00–09:30 · 盘后 16:00–20:00')}
        </span>
      </div>

      <ul className="us-extended-slots">
        {[view.pre, view.after].map((slot) => (
          <li
            key={slot.session}
            className={`us-extended-slot is-${slot.state}`}
            data-session={slot.session}
            data-state={slot.state}
          >
            <span className="us-extended-slot-head">
              <strong>{nameOf(slot.session)}</strong>
              <span className="us-extended-window">
                {formatWindowMinute(slot.startMinute)}–{formatWindowMinute(slot.endMinute)} ET
              </span>
            </span>
            <span className="us-extended-countdown">{labelOf(slot)}</span>
          </li>
        ))}
      </ul>

      {view.nextTradingDay ? (
        <p className="us-extended-note">
          {tf('investments.usExtended.weekendNote', '周末休市,两个倒计时都指向下个交易日')}
        </p>
      ) : null}
    </section>
  );
}
