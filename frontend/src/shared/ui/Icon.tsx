import type { ReactNode } from 'react'

const icons = {
  waveform: <><path d="M4 9v6m4-10v14m4-11v8m4-13v18m4-12v6" /></>,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  book: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1zm0 0v14" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 7h14M5 17h14" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
  activity: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
  arrowUpRight: <><path d="M7 17 17 7M7 7h10v10" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  checklist: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 3 3 5-6" /></>,
  chart: <><path d="M5 20v-5m5 5V9m5 11V12m5 8V4" strokeWidth="2.4" /></>,
  scales: <><path d="M12 4v16m-5 0h10M4 8h16M6 8l-3 6a3 3 0 0 0 6 0L6 8Zm12 0-3 6a3 3 0 0 0 6 0l-3-6Z" /></>,
  pause: <><path d="M9 5v14m6-14v14" strokeWidth="2.8" /></>,
  minus: <><path d="M6 12h12" /></>,
  chevron: <><path d="m9 6 6 6-6 6" /></>,
  down: <><path d="m6 9 6 6 6-6" /></>,
  chat: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.4-3A7.5 7.5 0 1 1 20 11.5Z" /><path d="M9 11.5h6" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 1.5" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  file: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6" /></>,
  flag: <><path d="M5 21V4m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" /></>,
  folder: <><path d="M3 7h7l2 2h9v10H3z" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5" /></>,
  link: <><path d="m10 13 4-4m-6 6-1 1a3 3 0 0 0 4 4l3-3a3 3 0 0 0 0-4m2-4 1-1a3 3 0 0 0-4-4l-3 3a3 3 0 0 0 0 4" /></>,
  phone: <><path d="m7 4 3 4-2 2a11 11 0 0 0 6 6l2-2 4 3-1 3C10 21 3 14 4 5z" /></>,
  play: <><path d="m9 5 11 7-11 7z" /></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5" /></>,
} satisfies Record<string, ReactNode>

export function Icon({ name, size = 18 }: { name: keyof typeof icons; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
}
