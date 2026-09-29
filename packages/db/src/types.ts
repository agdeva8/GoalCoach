export type Horizon = 'week' | 'month' | 'quarter' | 'year' | 'multi-year';
export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';
export type ThreadRole = 'user' | 'assistant' | 'system';
export type FeedbackSentiment = 'up' | 'down';

export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  horizon: Horizon;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
}

export interface Reflection {
  id: string;
  user_id: string;
  body: string;
  goal_id: string | null;
  horizon: Horizon | null;
  created_at: string;
}

export interface Thread {
  id: string;
  user_id: string;
  role: ThreadRole;
  content: string;
  created_at: string;
}

export interface Feedback {
  id: string;
  user_id: string;
  message_id: string | null;
  sentiment: FeedbackSentiment;
  comment: string | null;
  created_at: string;
}

export type AreaKey = 'career' | 'health' | 'relationships' | 'finance' | 'learning' | 'fun';

export interface Area {
  key: AreaKey;
  label: string;
  color: string;
}

export interface UserAreaPreference {
  user_id: string;
  area_key: AreaKey;
  selected_at: string;
}
