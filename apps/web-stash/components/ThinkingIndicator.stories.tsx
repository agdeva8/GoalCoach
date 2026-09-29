import { createElement } from 'react';
import { ThinkingIndicator } from './ThinkingIndicator';

export default {
  title: 'Components/ThinkingIndicator',
  render: () =>
    createElement(ThinkingIndicator, {
      startedAt: Date.now() - 3000,
      persona: 'Coach',
    }),
};
