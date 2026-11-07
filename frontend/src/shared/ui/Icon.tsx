import type { ReactNode } from 'react'

const icons = {
  activity: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
  arrowUpRight: <><path d="M7 17 17 7M7 7h10v10" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
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
