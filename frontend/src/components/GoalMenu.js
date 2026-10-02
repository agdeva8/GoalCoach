import { Link, useLocation } from "react-router-dom";
import { ChevronDown, LayoutDashboard } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { SCREENS, screenKeyFromSearch } from "../constants/screens";

/**
 * GoalMenu — the navigation dropdown anchored to "Goals" (the canonical
 * landing screen). On mobile it replaces the old hamburger sheet; on
 * desktop it lives next to the active screen title as a complementary
 * jump-to entry. Goals is the default landing — the trigger always shows
 * "Goals" with a chevron, and the items are Today / Timeline / Sources /
 * Memories / Audit.
 *
 * Renders the same `SCREENS` data as the desktop tab strip (see
 * constants/screens.js), so labels, icons and destinations never drift.
 *
 * Per Iteration 9 — the avatar profile menu holds Settings / Theme /
 * About / Sign out (see Header.js); this menu holds the other screens.
 */
export default function GoalMenu({ align = "end", className = "" }) {
  const location = useLocation();
  const activeKey = screenKeyFromSearch(location.search);
  const activeScreen = SCREENS.find((s) => s.key === activeKey);
  // Goals (state) is the default landing — the trigger label is always
  // "Goals", not the active screen name. The dropdown items below show
  // the OTHER four so users can jump between them without a tab strip on
  // mobile.
  const triggerLabel = "Goals";
  const TriggerIcon = SCREENS[0].Icon; // LayoutDashboard
  const otherScreens = SCREENS.filter((s) => s.key !== "state");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="goal-menu-trigger"
        aria-label="Navigate to another screen"
        className={`inline-flex items-center gap-1.5 min-h-11 px-2.5 -mx-1 rounded text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${className}`}
      >
        <TriggerIcon className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
        <span>{triggerLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        data-testid="goal-menu-content"
        className="min-w-[200px]"
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] font-medium">
          Screens
        </DropdownMenuLabel>
        {/* "Goals" itself — always lands on the canonical landing / */}
        <DropdownMenuItem
          asChild
          data-testid="goal-menu-item-state"
        >
          <Link
            to="/"
            aria-current={activeKey === "state" ? "page" : undefined}
            className="flex items-center gap-2 cursor-pointer"
          >
            <LayoutDashboard className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
            <span className="flex-1">Goals</span>
            {activeKey === "state" && (
              <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                here
              </span>
            )}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {otherScreens.map((s) => {
          const Icon = s.Icon;
          const active = s.key === activeKey;
          return (
            <DropdownMenuItem
              key={s.key}
              asChild
              data-testid={`goal-menu-item-${s.key}`}
            >
              <Link
                to={s.to}
                aria-current={active ? "page" : undefined}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Icon className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                <span className="flex-1">{s.label}</span>
                {active && (
                  <span className="text-[10px] uppercase tracking-widest text-[var(--accent)]">
                    here
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          );
        })}
        {/* Show the active screen in the trigger region if it's one of
            the dropdown items (not Goals itself) — surface this so a
            user who navigated to e.g. Timeline can still tell they're
            on a non-default screen. */}
        {activeKey !== "state" && activeScreen && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
              You&apos;re on <span className="text-[var(--text-primary)]">{activeScreen.label}</span>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}