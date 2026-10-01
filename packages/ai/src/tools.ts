export const TOOLS = [
  {
    name: 'list_goals',
    description: 'Fetch the user active goals across all horizons.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_goal',
    description: 'Create a new goal for the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short goal title' },
        horizon: {
          type: 'string',
          enum: ['week', 'month', 'quarter', 'year', 'multi-year'],
        },
      },
      required: ['title', 'horizon'],
    },
  },
  {
    name: 'update_goal',
    description: 'Update a goal status or title.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal_id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['active', 'paused', 'completed', 'abandoned'],
        },
        title: { type: 'string' },
      },
      required: ['goal_id'],
    },
  },
  {
    name: 'log_reflection',
    description: 'Save a reflection tied to an optional goal and horizon.',
    input_schema: {
      type: 'object' as const,
      properties: {
        body: { type: 'string' },
        goal_id: { type: 'string' },
        horizon: {
          type: 'string',
          enum: ['week', 'month', 'quarter', 'year', 'multi-year'],
        },
      },
      required: ['body'],
    },
  },
  {
    name: 'search_threads',
    description: 'Search prior conversation history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['q'],
    },
  },
] as const;

export type ToolName = typeof TOOLS[number]['name'];
