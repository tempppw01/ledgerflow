interface AmountKeypadProps {
  onKey: (key: string) => void;
  className?: string;
  label?: string;
}

const DIGIT_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '.'];

export function AmountKeypad({ onKey, className = '', label = '金额键盘' }: AmountKeypadProps) {
  return (
    <div className={`amount-keypad ${className}`.trim()} role="group" aria-label={label}>
      <button type="button" className="amount-keypad-action is-clear" onClick={() => onKey('clear')}>
        C
      </button>
      <button
        type="button"
        className="amount-keypad-action is-backspace"
        onClick={() => onKey('backspace')}
        aria-label="退格"
        title="退格"
      >
        ⌫
      </button>
      <button type="button" className="amount-keypad-action" onClick={() => onKey('+')} aria-label="加">
        +
      </button>
      <button type="button" className="amount-keypad-action" onClick={() => onKey('-')} aria-label="减">
        −
      </button>
      {DIGIT_KEYS.map((key) => (
        <button key={key} type="button" className="amount-keypad-digit" onClick={() => onKey(key)}>
          {key}
        </button>
      ))}
      <button
        type="button"
        className="amount-keypad-confirm"
        onClick={() => onKey('=')}
        aria-label="计算结果"
      >
        =
      </button>
    </div>
  );
}
