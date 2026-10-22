import type { SVGProps } from 'react';

export type ChatIconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

const shared: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  focusable: 'false'
};

export function ChatUploadIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

export function ChatModelIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  );
}

export function ChatSendIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function ChatStopIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChatClearIcon(props: ChatIconProps) {
  return (
    <svg {...shared} data-icon="chat-clear" {...props}>
      <path d="M3.5 6.5h17" />
      <path d="M9.5 6.5v-1.8a1.7 1.7 0 0 1 1.7-1.7h1.6a1.7 1.7 0 0 1 1.7 1.7v1.8" />
      <path d="M5.8 6.5 6.8 19a2 2 0 0 0 2 1.8h6.4a2 2 0 0 0 2-1.8l1-12.5" />
    </svg>
  );
}

export function ChatGlobeIcon(props: ChatIconProps) {
  return (
    <svg {...shared} data-icon="chat-globe" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export function ChatGlobeOffIcon(props: ChatIconProps) {
  return (
    <svg {...shared} data-icon="chat-globe-off" {...props}>
      <path d="M10.114 4.462A14.5 14.5 0 0 1 12 2a10 10 0 0 1 9.313 13.643" />
      <path d="M15.557 15.556A14.5 14.5 0 0 1 12 22 10 10 0 0 1 4.929 4.929" />
      <path d="M15.892 10.234A14.5 14.5 0 0 0 12 2a10 10 0 0 0-3.643.687" />
      <path d="M17.656 12H22" />
      <path d="M19.071 19.071A10 10 0 0 1 12 22 14.5 14.5 0 0 1 8.44 8.45" />
      <path d="M2 12h10" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function ChatChevronsUpDownIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

export function ChatChevronsDownUpIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="m7 20 5-5 5 5" />
      <path d="m7 4 5 5 5-5" />
    </svg>
  );
}

export function ChatChevronUpIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

export function ChatThumbsUpIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
      <path d="M7 10v12" />
    </svg>
  );
}

export function ChatThumbsDownIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
      <path d="M17 14V2" />
    </svg>
  );
}

export function ChatCopyIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function ChatRotateCcwIcon(props: ChatIconProps) {
  return (
    <svg {...shared} {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
