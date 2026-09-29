import { createElement } from 'react';
import { ChatThread } from './ChatThread';

export default {
  title: 'Components/ChatThread',
  render: () => createElement(ChatThread, { persona: 'Coach' }),
};
