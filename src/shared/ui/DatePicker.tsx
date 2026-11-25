import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDialogFocus } from '../lib/useDialogFocus';

type DatePickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
};

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder,
  ariaLabel,
  disabled = false,
  className = ''
}: DatePickerProps) {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => new Date(), []);
  const selected = parseDate(value);
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<CSSProperties>();
  const [viewDate, setViewDate] = useState(() => selected || today);
  const minDate = parseDate(min || '');
  const maxDate = parseDate(max || '');
  const resolvedPlaceholder = placeholder ?? t('datePicker.placeholder');
  const resolvedAriaLabel = ariaLabel ?? t('datePicker.ariaLabel');
  const resolvedLanguage = i18n?.resolvedLanguage ?? i18n?.language ?? 'zh-CN';
  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat(resolvedLanguage.startsWith('en') ? 'en-US' : 'zh-CN', {
        year: 'numeric',
        month: 'long'
      }).format(viewDate),
    [resolvedLanguage, viewDate]
  );

  useEffect(() => {
    const nextSelected = parseDate(value);
    if (nextSelected) setViewDate(nextSelected);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 32);
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      const estimatedHeight = 322;
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const top =
        spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove
          ? Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight - 12))
          : Math.max(12, rect.top - estimatedHeight - 8);
      setPopoverPosition({ top, left, width });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target))
        setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const days = useMemo(() => {
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const start = (first.getDay() + 6) % 7;
    const count = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const result: Date[] = [];
    for (let index = 0; index < start; index += 1) {
      result.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), index - start + 1));
    }
    for (let day = 1; day <= count; day += 1) {
      result.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
    }
    while (result.length < 42) {
      const last = result[result.length - 1];
      result.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    }
    return result;
  }, [viewDate]);

  const isDisabled = (date: Date) =>
    Boolean((minDate && date < minDate) || (maxDate && date > maxDate));

  // 弹层是 role="dialog":焦点收进来、Tab 留在里面、关闭还给触发按钮。
  useDialogFocus(open, popoverRef, () => setOpen(false));

  /**
   * 把焦点放到某一天;那天不在当前月就先翻月,等渲染完再聚焦。
   *
   * `step` 用来在越过 min/max 边界时找最近的可用日 —— 直接 focus 一个 disabled
   * 的格子是静默失败的(浏览器不会聚焦 disabled 按钮),表现就是「方向键按了没反应」。
   */
  const focusDay = useCallback(
    (target: Date, step = 0) => {
      let candidate = target;
      if (step !== 0) {
        let guard = 0;
        while (isDisabled(candidate) && guard < 400) {
          candidate = new Date(candidate);
          candidate.setDate(candidate.getDate() + step);
          guard += 1;
        }
      }
      if (isDisabled(candidate)) return;

      const key = formatDate(candidate);
      const find = () =>
        popoverRef.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`) ?? null;
      const node = find();
      if (node) {
        node.focus();
        return;
      }
      setViewDate(new Date(candidate.getFullYear(), candidate.getMonth(), 1));
      // 等这一轮渲染出新的月份再聚焦。用 setTimeout 而不是 requestAnimationFrame:
      // 无头/后台页面会把 rAF 挂起,焦点就永远不落下来(实测 Playwright 里如此)。
      window.setTimeout(() => find()?.focus(), 0);
    },
    // isDisabled 依赖 minDate / maxDate
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minDate, maxDate]
  );

  /**
   * 日期网格的键盘导航(ARIA date grid 的常用键位):
   * ←/→ 前后一天,↑/↓ 前后一周,PageUp/PageDown 前后一月,Home/End 本周首尾。
   * 之前这个弹层只处理了 Escape,方向键完全没反应。
   */
  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = (event.target as HTMLElement | null)?.getAttribute('data-date');
    if (!key) return;
    const current = parseDate(key) ?? selected ?? today;

    const move = (next: Date, step = 0) => {
      event.preventDefault();
      focusDay(next, step);
    };
    const addDays = (amount: number) => {
      const next = new Date(current);
      next.setDate(next.getDate() + amount);
      return next;
    };

    switch (event.key) {
      case 'ArrowLeft':
        move(addDays(-1), -1);
        break;
      case 'ArrowRight':
        move(addDays(1), 1);
        break;
      case 'ArrowUp':
        move(addDays(-7), -1);
        break;
      case 'ArrowDown':
        move(addDays(7), 1);
        break;
      case 'PageUp':
        move(new Date(current.getFullYear(), current.getMonth() - 1, current.getDate()), -1);
        break;
      case 'PageDown':
        move(new Date(current.getFullYear(), current.getMonth() + 1, current.getDate()), 1);
        break;
      case 'Home':
        // 一周从周一开始,和上面的 WEEKDAY_KEYS 一致。
        move(addDays(-((current.getDay() + 6) % 7)), -1);
        break;
      case 'End':
        move(addDays(6 - ((current.getDay() + 6) % 7)), 1);
        break;
      default:
        break;
    }
  };

  // 打开时把焦点放在当前选中日(空值则今天),比停在「上个月」按钮上更好用。
  // 依赖用字符串:selected 每次渲染都是新的 Date 对象,放进依赖会让这个 effect
  // 每次重渲染都重跑,翻月后焦点又被拽回原来的日子。
  const anchorKey = formatDate(selected || today);
  useEffect(() => {
    if (!open) return;
    const find = () =>
      popoverRef.current?.querySelector<HTMLButtonElement>(`[data-date="${anchorKey}"]`) ?? null;
    // 目标日通常已经在网格里,同步聚焦即可;需要翻月时才等一轮渲染。
    const node = find();
    if (node) {
      node.focus();
      return;
    }
    const timer = window.setTimeout(() => find()?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, anchorKey]);

  /*
   * WCAG 2.5.3(标签包含可见文字,A):没选日期时按钮上显示的是占位符,
   * 调用方常写成「筛选日期」「可选」,而 aria-label 是「选择日期」/「日期」这类用途说明,
   * 屏幕上的字在可访问名里找不到 —— 语音控制用户喊看到的字会匹配不到。
   * 所以两者不同时把占位符放到名字最前面。
   *
   * 只在**显示占位符**时这么做:已选日期时屏幕上那个日期是控件的"值"而不是标签,
   * 2.5.3 不要求把值塞进名字,塞了反而会让名字随值变来变去、更难用语音匹配。
   */
  const triggerVisibleText = selected
    ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`
    : resolvedPlaceholder;
  const triggerAccessibleName =
    !selected && resolvedPlaceholder && resolvedPlaceholder !== resolvedAriaLabel
      ? `${resolvedPlaceholder}, ${resolvedAriaLabel}`
      : resolvedAriaLabel;

  return (
    <div
      ref={rootRef}
      className={`lf-date-picker ${className}`.trim()}
      data-min-date={min || undefined}
      data-max-date={max || undefined}
    >
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`lf-date-trigger${open ? ' is-open' : ''}${!value ? ' is-empty' : ''}`}
        aria-label={triggerAccessibleName}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          {triggerVisibleText}
        </span>
        <span className="lf-date-icon" aria-hidden="true">
          ▣
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="lf-date-popover"
              style={popoverPosition}
              role="dialog"
              aria-label={t('datePicker.dialogLabel')}
            >
              <div className="lf-date-header">
                <button
                  type="button"
                  className="lf-date-nav"
                  aria-label={t('datePicker.prevMonth')}
                  onClick={() =>
                    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))
                  }
                >
                  ‹
                </button>
                <strong>{monthTitle}</strong>
                <button
                  type="button"
                  className="lf-date-nav"
                  aria-label={t('datePicker.nextMonth')}
                  onClick={() =>
                    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))
                  }
                >
                  ›
                </button>
              </div>
              <div className="lf-date-weekdays">
                {WEEKDAY_KEYS.map((day) => (
                  <span key={day}>{t(`datePicker.weekdays.${day}`)}</span>
                ))}
              </div>
              <div className="lf-date-grid" onKeyDown={handleGridKeyDown}>
                {days.map((date) => {
                  const dateValue = formatDate(date);
                  const outside = date.getMonth() !== viewDate.getMonth();
                  const active = dateValue === value;
                  const disabledDay = isDisabled(date);
                  return (
                    <button
                      type="button"
                      key={dateValue}
                      data-date={dateValue}
                      className={`lf-date-day${outside ? ' is-outside' : ''}${active ? ' is-selected' : ''}${!active && dateValue === formatDate(today) ? ' is-today' : ''}`}
                      disabled={disabledDay}
                      aria-label={dateValue}
                      aria-pressed={active}
                      onClick={() => {
                        onChange(dateValue);
                        setOpen(false);
                      }}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
              <div className="lf-date-actions">
                <button
                  type="button"
                  onClick={() => {
                    if (!isDisabled(today)) {
                      onChange(formatDate(today));
                      setViewDate(today);
                      setOpen(false);
                    }
                  }}
                >
                  {t('datePicker.today')}
                </button>
                {value ? (
                  <button
                    type="button"
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                    }}
                  >
                    {t('datePicker.clear')}
                  </button>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
