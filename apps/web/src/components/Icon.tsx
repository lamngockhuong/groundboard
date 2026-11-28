/** Stroke icons drawn inline, so the page loads no icon font and makes no request. */
const PATHS = {
  logo: "M4 5h7v6H4zM13 13h7v6h-7zM7.5 11v4.5H13M16.5 13V8.5H11",
  download: "M12 4v11m0 0-4-4m4 4 4-4M5 19h14",
  image: "M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01",
  code: "m9 8-4 4 4 4m6-8 4 4-4 4",
  map: "M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5zM9 4v13.5m6-11v13.5",
  overview: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  screen: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  flow: "M6 4v6a4 4 0 0 0 4 4h8m-3-3 3 3-3 3M6 4a2 2 0 1 0 0 .01",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4-4",
  upload: "M12 16V5m0 0L8 9m4-4 4 4M5 15v4h14v-4",
  alert:
    "M12 9v4m0 4h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z",
  type: "M5 7V5h14v2M12 5v14m-3 0h6",
  back: "M15 6l-6 6 6 6",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  cursor: "M5 3l14 7-6 2-2 6z",
  api: "M9 4c-2 0-3 1-3 3v2c0 1-1 2-2 3 1 1 2 2 2 3v2c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2c0 1 1 2 2 3-1 1-2 2-2 3v2c0 2-1 3-3 3",
  database:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  move: "M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  reset: "M4 5v5h5M5.3 15a7.5 7.5 0 1 0 1.5-7.8L4 10",
  menu: "M4 6h16M4 12h16M4 18h16",
  sidebar: "M4 4h16v16H4zM9 4v16",
  panel: "M4 4h16v16H4zM15 4v16",
  split: "M3 4h10v16H3zM18 9v6M15 12h6",
  prev: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  historyBack: "M19 12H5m6-6-6 6 6 6",
  historyForward: "M5 12h14m-6-6 6 6-6 6",
  play: "M8 5v14l11-7z",
  pause: "M8 5v14M16 5v14",
  present: "M3 4h18v12H3zM8 20h8M12 16v4M10 7.5v5l4-2.5z",
  chevronDown: "m6 9 6 6 6-6",
  chevronUp: "m6 15 6-6 6 6",
  close: "M6 6l12 12M18 6 6 18",
  tag: "M3.5 12.5V4h8.5l8.5 8.5-8 8zM8 8h.01",
  layers: "m12 3 9 5-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5",
  settings: "M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4",
  tabNew: "M3 20V8h6V5h7v3h5v12zM12 11v6M9 14h6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  copy: "M9 9h10v11H9zM15 9V4H5v11h4",
  /** Two lifelines and the messages between them. */
  sequence: "M6 3v18M18 3v18M6 8h12m-3-2 3 2-3 2M18 15H6m3-2-3 2 3 2",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
