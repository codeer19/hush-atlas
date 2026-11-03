export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="17.5" stroke="currentColor" opacity="0.22" />
      <path
        d="M20 2.5A17.5 17.5 0 0 1 37.5 20"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M20 9A11 11 0 0 1 31 20"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.75"
      />
      <path
        d="M20 15.5A4.5 4.5 0 0 1 24.5 20"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.5"
      />
      <circle cx="20" cy="20" r="1.8" fill="var(--amber)" />
    </svg>
  );
}
