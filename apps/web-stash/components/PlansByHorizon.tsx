import { PlanCard } from '@/components/PlanCard';
import { bucketGoalsByHorizon, type Goal, type Horizon } from '@goalcoach/db';

// The five horizons the product surfaces today, in the order the design doc
// enumerates them (broadest last). Every horizon renders a section whether or
// not it holds goals, so an empty area reads as "nothing here yet" instead of
// silently vanishing (Review Focus 3).
const HORIZON_ORDER: Horizon[] = ['week', 'month', 'quarter', 'year', 'multi-year'];

const HORIZON_LABEL: Record<Horizon, string> = {
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
  'multi-year': 'Multi-year',
};

const EMPTY_COPY = 'No goals here yet. Set one up in chat.';

// Presentational: takes the user's goals and groups them by horizon. Pure
// server component, no interactivity, so it stays trivially testable.
export function PlansByHorizon({ goals }: { goals: Goal[] }) {
  const byHorizon = bucketGoalsByHorizon(goals);

  return (
    <div data-plans-by-horizon>
      {HORIZON_ORDER.map((horizon) => {
        const items = byHorizon[horizon];
        return (
          <section key={horizon} data-horizon-section={horizon}>
            <h2 data-horizon-title={horizon}>
              {HORIZON_LABEL[horizon]} · {items.length} {items.length === 1 ? 'goal' : 'goals'}
            </h2>
            {items.length === 0 ? (
              <p
                data-empty-horizon={horizon}
                aria-label={`Empty state for ${horizon} horizon`}
              >
                {EMPTY_COPY}
              </p>
            ) : (
              items.map((g) => <PlanCard key={g.id} goal={g} />)
            )}
          </section>
        );
      })}
    </div>
  );
}
