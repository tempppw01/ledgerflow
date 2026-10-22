import type { SVGProps } from 'react';

export type BudgetIconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

const shared: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: 'false'
};

export function BudgetSparkIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 11 10.1 9 12 3.5Z" />
      <path d="M18.5 4v3" />
      <path d="M17 5.5h3" />
    </svg>
  );
}

export function BudgetWalletIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M4 8a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2" />
      <path d="M4 8v10a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 1-2-2Z" />
      <path d="M16.5 13h.01" />
    </svg>
  );
}

export function BudgetGaugeIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M4.5 17a8 8 0 1 1 15 0" />
      <path d="m12 13 3.5-3.5" />
      <circle cx="12" cy="14" r="1.4" />
    </svg>
  );
}

export function BudgetAlertIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M10.3 4.2 2.6 17.4A1.6 1.6 0 0 0 4 19.7h16a1.6 1.6 0 0 0 1.4-2.3L13.7 4.2a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M12 9v4" />
      <path d="M12 16.2h.01" />
    </svg>
  );
}

export function BudgetTrendIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M4 17 10 11l3.5 3.5L20 8" />
      <path d="M15 8h5v5" />
    </svg>
  );
}

export function BudgetHistoryIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 8v4.3l3 1.7" />
    </svg>
  );
}

export function BudgetTargetIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

export function BudgetPiggyIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M14 6.5c4 0 6.5 2.6 6.5 6s-2.6 6-7 6H9a6 6 0 0 1-5.2-9L3 9l2.4 1.1A6.4 6.4 0 0 1 9 8.6" />
      <path d="M14 6.5V4.2c0-.8.7-1.4 1.5-1.4S17 3.4 17 4.2v2.6" />
      <path d="M16.5 10.5h.01" />
    </svg>
  );
}

export function BudgetCloseIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function BudgetChevronIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function BudgetRefreshIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4.5V11h-6.5" />
    </svg>
  );
}

export function BudgetCheckIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function BudgetEditIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 6 3 3" />
    </svg>
  );
}

export function BudgetCalendarIcon(props: BudgetIconProps) {
  return (
    <svg {...shared} {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  );
}
