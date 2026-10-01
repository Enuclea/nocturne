import { useId } from 'react';

export default function Logo({ size = 40 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <defs>
      <mask id={`${id}-crescent`}><rect width="40" height="40" fill="#fff" /><circle cx="16.9" cy="16.9" r="9.3" fill="#000" /></mask>
      <linearGradient id={`${id}-glow`} x1="12" y1="30" x2="31" y2="13" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#b99c6c" /><stop offset="1" stopColor="#f0dcb4" /></linearGradient>
    </defs>
    <path d="M35.35 17.84A15.5 15.5 0 1 1 33.14 11.79" stroke="currentColor" strokeWidth=".9" strokeLinecap="round" opacity=".55" />
    <circle cx="34.57" cy="14.7" r="1.35" fill="currentColor" />
    <circle cx="20" cy="20" r="10.8" fill={`url(#${id}-glow)`} mask={`url(#${id}-crescent)`} />
    <path d="M15.2 11.6 15.85 14.15 18.4 14.8 15.85 15.45 15.2 18 14.55 15.45 12 14.8 14.55 14.15Z" fill="currentColor" />
  </svg>;
}
