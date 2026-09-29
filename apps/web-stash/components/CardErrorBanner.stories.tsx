import { createElement } from 'react';
import { CardErrorBanner } from './CardErrorBanner';

export default {
  title: 'Components/CardErrorBanner',
  render: () =>
    createElement(CardErrorBanner, {
      error: { kind: 'retryable', message: 'Could not load goals. Tap retry to try again.' },
      onRetry: () => {},
    }),
};
