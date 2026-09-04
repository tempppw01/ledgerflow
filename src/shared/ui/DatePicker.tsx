import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

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

function monthTitle(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = '选择日期',
  ariaLabel = '选择日期',
  disabled = false,
  className = ''
}: DatePickerProps) {
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

  useEffect(() => {
    if (selected) setViewDate(selected);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 32);
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      const estimatedHeight = 360;
      const top = rect.bottom + 8 + estimatedHeight <= window.innerHeight ? rect.bottom + 8 : Math.max(16, rect.top - estimatedHeight - 8);
      setPopoverPosition({ top, left, width });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
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

  const isDisabled = (date: Date) => Boolean((minDate && date < minDate) || (maxDate && date > maxDate));
  return (
    <div ref={rootRef} className={`lf-date-picker ${className}`.trim()}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`lf-date-trigger${open ? ' is-open' : ''}${!value ? ' is-empty' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}` : placeholder}</span>
        <span className="lf-date-icon" aria-hidden="true">▣</span>
      </button>
      {open ? createPortal(
        <div ref={popoverRef} className="lf-date-popover" style={popoverPosition} role="dialog" aria-label="日期选择器">
          <div className="lf-date-header">
            <button type="button" className="lf-date-nav" aria-label="上个月" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>‹</button>
            <strong>{monthTitle(viewDate)}</strong>
            <button type="button" className="lf-date-nav" aria-label="下个月" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>›</button>
          </div>
          <div className="lf-date-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="lf-date-grid">
            {days.map((date) => {
              const dateValue = formatDate(date);
              const outside = date.getMonth() !== viewDate.getMonth();
              const active = dateValue === value;
              const disabledDay = isDisabled(date);
              return (
                <button
                  type="button"
                  key={dateValue}
                  className={`lf-date-day${outside ? ' is-outside' : ''}${active ? ' is-selected' : ''}${!active && dateValue === formatDate(today) ? ' is-today' : ''}`}
                  disabled={disabledDay}
                  aria-label={dateValue}
                  aria-pressed={active}
                  onClick={() => { onChange(dateValue); setOpen(false); }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="lf-date-actions">
            <button type="button" onClick={() => { if (!isDisabled(today)) { onChange(formatDate(today)); setViewDate(today); setOpen(false); } }}>今天</button>
            {value ? <button type="button" onClick={() => { onChange(''); setOpen(false); }}>清除</button> : null}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
