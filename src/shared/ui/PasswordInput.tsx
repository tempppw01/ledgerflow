import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { EYE_ICON_URL, EYE_OFF_ICON_URL } from '../config/brandAssets';
import { cn } from '../lib/cn';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  containerClassName?: string;
  toggleClassName?: string;
  compactMask?: boolean;
  showLabel?: string;
  hideLabel?: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  props,
  ref
) {
  const {
    className,
    containerClassName,
    toggleClassName,
    compactMask = false,
    disabled,
    onChange,
    readOnly,
    value,
    showLabel = '显示内容',
    hideLabel = '隐藏内容',
    ...rest
  } = props;
  const [visible, setVisible] = useState(false);
  const nextLabel = visible ? hideLabel : showLabel;
  const hasValue = value != null && value !== '';
  const isCompactMaskVisible = compactMask && !visible && hasValue;

  return (
    <div className={cn('password-input-row', containerClassName)}>
      <input
        {...rest}
        ref={ref}
        className={className}
        disabled={disabled}
        readOnly={readOnly || isCompactMaskVisible}
        value={isCompactMaskVisible ? '••••••••' : value}
        type={visible ? 'text' : 'password'}
        onChange={onChange}
      />
      <button
        type="button"
        className={cn('password-input-toggle', toggleClassName)}
        aria-label={nextLabel}
        title={nextLabel}
        disabled={disabled}
        onClick={() => setVisible((prev) => !prev)}
      >
        <img
          src={visible ? EYE_OFF_ICON_URL : EYE_ICON_URL}
          alt=""
          aria-hidden="true"
          className="password-input-toggle-icon"
        />
      </button>
    </div>
  );
});

PasswordInput.displayName = 'PasswordInput';
