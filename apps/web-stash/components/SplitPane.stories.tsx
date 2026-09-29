import { createElement } from 'react';
import { SplitPane } from './SplitPane';

export default {
  title: 'Components/SplitPane',
  render: () =>
    createElement(
      SplitPane,
      { left: createElement('div', null, 'Chat goes here'), right: createElement('div', null, 'Cards go here') }
    ),
};
