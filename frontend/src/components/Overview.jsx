import { ArrowRight, ChevronRight, Sparkles, Target } from "lucide-react";
import TrackerCard from "./TrackerCard";
import { OverCommitmentIndicator } from "./TrackingDashboard";
import { useAuth } from "../context/AuthContext";

/**
 * Overview — the landing screen (formerly "Home").
 *
 * The old dashboard crammed everything (motivation, tracker, goals) into
 * one scroll. Overview splits the "what should I do right now?" surface
 * (Today) from the "what are my goals?" surface (Goals tab) and the
 * curated nudges (Motivation tab):
 *
 *   1. Greeting — time-aware hello with the user's name.
 *   2. Today at a glance — over-commitment + the TrackerCard.
 *   3. Goals preview — the first few active goals with a link to Goals.
 */
export default function Overview({ state, onOpenChat, onOpenToday, onOpenGoals }) {
  const { user } = useAuth();
  if (!state) {
    return (
      <div data-testid="overview-loading" className="px-4 sm:px-6 py-5 space-y-5 max-w-[820px] mx-auto w-full" aria-busy="true" aria-live="polite">
        <div className="gc-skeleton h-7 w-2/3 rounded-lg" />
        <div className="gc-skeleton h-28 w-full rounded-2xl" />
        <div className="gc-skeleton h-36 w-full rounded-2xl" />
      </div>
    );
  }
  const goals = (state?.goals || []).filter((g) => g.status !== "dropped");
  const preview = goals.slice(0, 3);

  const firstName = user?.name ? user.name.split(" ")[0] : null;
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const greeting = firstName ? `Good ${part}, ${firstName}` : `Good ${part}, guest`;

  return (
    <div data-testid="overview-view" className="px-4 sm:px-6 py-5 sm:py-6 space-y-7 max-w-[820px] mx-auto w-full">
      <header>
        <h2 className="text-[21px] sm:text-[24px] font-semibold tracking-tight text-[var(--text-primary)] leading-snug">
          {greeting}
        </h2>
        <p className="text-[14px] text-[var(--text-muted)] mt-1">Let's sort your life — together.</p>
      </header>

      {/* Today at a glance */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Today at a glance</h3>
          <button
            type="button"
            data-testid="overview-open-today"
            onClick={() => onOpenToday?.()}
            className="text-[13px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
          >
            Open today <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
        <OverCommitmentIndicator oc={state?.over_commitment} />
        <TrackerCard state={state} onOpenChat={onOpenChat} onOpenToday={onOpenToday} />
      </section>

      {/* Goals preview */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Your goals</h3>
          {goals.length > 0 && (
            <button
              type="button"
              data-testid="overview-open-goals"
              onClick={() => onOpenGoals?.()}
              className="text-[13px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
            >
              See all ({goals.length}) <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        {preview.length === 0 ? (
          <button
            type="button"
            data-testid="overview-empty-goals"
            onClick={() => onOpenGoals?.()}
            className="w-full rounded-2xl bg-[var(--bg-secondary)] p-5 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="h-10 w-10 rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-[var(--accent)]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-[var(--text-primary)]">No goals yet</div>
                <div className="text-[13px] text-[var(--text-secondary)]">Tap to add your first goal.</div>
              </div>
            </div>
          </button>
        ) : (
          <div className="rounded-2xl bg-[var(--bg-secondary)] overflow-hidden divide-y divide-[var(--border)]">
            {preview.map((g) => (
              <button
                key={g.id}
                type="button"
                data-testid={`overview-goal-${g.id}`}
                onClick={() => onOpenGoals?.()}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Target className="w-4 h-4 text-[var(--accent)] shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-[var(--text-primary)] truncate">{g.title}</div>
                  {g.target_date && (
                    <div className="text-[12px] text-[var(--text-muted)]">Target · {g.target_date}</div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
