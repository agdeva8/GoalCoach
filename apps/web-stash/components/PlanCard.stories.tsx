import { createElement } from 'react';
import { PlanCard } from './PlanCard';
import type { Goal } from '@goalcoach/db';

const sample: Goal = {
  id: 'g1',
  user_id: 'u1',
  title: 'Ship phase 1',
  horizon: 'week',
  status: 'active',
  created_at: '2026-09-22T00:00:00Z',
  updated_at: '2026-09-22T00:00:00Z',
};

export default {
  title: 'Components/PlanCard',
  render: () => createElement(PlanCard, { goal: sample }),
};
