export default function MeteorIcon({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21 14 10" />
    <path d="M4 14.5 9 9.5" opacity=".55" />
    <path d="M9.5 20 14.5 15" opacity=".55" />
    <circle cx="17" cy="7" r="3" />
  </svg>;
}
