import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  Image as ImageIcon,
  FileText,
} from "lucide-react";

/**
 * The five Coach screens — one entry per distinct URL.
 *
 * Shared by the desktop tab strip (Coach.js) and the mobile nav drawer
 * (Header.js) so labels, icons and destinations can never drift apart.
 *
 * Routing note (Wave B decision #1, mechanism (a)): `/` is the Goals
 * screen — the canonical landing — and the other four ride on
 * `?panel=<key>` instead of their own pathname. Coach.js is keyed by
 * `location.pathname` (see App.js' ViewTransition comment), so keeping
 * the pathname constant across panel switches guarantees the page never
 * remounts: chat, dashboard data and scroll survive every switch, and
 * browser/system back still steps screen-by-screen because each switch
 * is a history push.
 */
export const SCREENS = [
  { key: "state", label: "Goals", to: "/", Icon: LayoutDashboard },
  { key: "today", label: "Today", to: "/?panel=today", Icon: CalendarDays },
  { key: "timeline", label: "Timeline", to: "/?panel=timeline", Icon: CalendarClock },
  { key: "memories", label: "Memories", to: "/?panel=memories", Icon: ImageIcon },
  { key: "sources", label: "Sources", to: "/?panel=sources", Icon: FileText },
];

export const SCREEN_BY_KEY = Object.fromEntries(SCREENS.map((s) => [s.key, s]));

/** Active screen key for a location search string. Unknown/absent → "state" (Goals). */
export function screenKeyFromSearch(search) {
  const key = new URLSearchParams(search).get("panel");
  return SCREEN_BY_KEY[key] ? key : "state";
}

/**
 * Search-params object for setSearchParams/Link that lands on a screen.
 * Goals gets `{}` so the canonical URL stays clean `/`, never `/?panel=state`.
 */
export function searchForScreen(key) {
  return key === "state" ? {} : { panel: key };
}
