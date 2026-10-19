// Icons aus dem Prototyp (docs/prototype), als React-Komponenten
import type { ReactNode, SVGProps } from 'react';

type IconProps = { size?: number } & SVGProps<SVGSVGElement>;

function Stroke({ size = 24, children, strokeWidth = 1.8, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconTasks = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </Stroke>
);
export const IconEvents = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7z" />
  </Stroke>
);
export const IconCalendar = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Stroke>
);
export const IconKnowledge = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 4h9a5 5 0 015 5v11H8a3 3 0 01-3-3z" />
    <path d="M5 17a3 3 0 013-3h11" />
  </Stroke>
);
export const IconProfile = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0114 0" />
  </Stroke>
);
export const IconBack = (p: IconProps) => (
  <Stroke strokeWidth={2} {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Stroke>
);
export const IconPlus = (p: IconProps) => (
  <Stroke strokeWidth={2.4} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Stroke>
);
export const IconClose = (p: IconProps) => (
  <Stroke strokeWidth={2} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Stroke>
);
export const IconBlocked = (p: IconProps) => (
  <Stroke strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M6.5 6.5l11 11" />
  </Stroke>
);
export const IconComment = (p: IconProps) => (
  <Stroke strokeWidth={2} {...p}>
    <path d="M5 5h14v10H10l-5 4z" />
  </Stroke>
);
export const IconEdit = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </Stroke>
);
export const IconSend = (p: IconProps) => (
  <Stroke strokeWidth={2.2} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Stroke>
);

export function IconBookmark({ filled, size = 20, ...rest }: IconProps & { filled: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d="M7 4h10v16l-5-3.5L7 20z" />
    </svg>
  );
}

export function IconMore({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function IconGoogle({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#5B7FFF"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 01-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"
      />
      <path
        fill="#3DD68C"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0012 22z"
      />
      <path fill="#F5B544" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 000 9.2z" />
      <path
        fill="#FF5D6C"
        d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 003.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"
      />
    </svg>
  );
}

/** Drive-Verzeichnis (P5): Ordner gefüllt, Dateien als Umriss */
export function IconFolder({ size = 22, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
      <path d="M3 6h7l2 2h9v11H3z" />
    </svg>
  );
}
export const IconFile = (p: IconProps) => (
  <Stroke size={22} {...p}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
  </Stroke>
);
export const IconLink = (p: IconProps) => (
  <Stroke size={18} strokeWidth={2} {...p}>
    <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
  </Stroke>
);
