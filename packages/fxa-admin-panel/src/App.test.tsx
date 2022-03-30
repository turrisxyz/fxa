/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import React from 'react';
import {
  createHistory,
  createMemorySource,
  LocationProvider,
} from '@reach/router';
import { render } from '@testing-library/react';
import App from './App';

const user = { user: { email: 'test', group: 'test', permissions: {} } };

export function renderWithRouter(
  ui: any,
  { route = '/', history = createHistory(createMemorySource(route)) } = {}
) {
  return {
    ...render(<LocationProvider {...{ history }}>{ui}</LocationProvider>),
    history,
  };
}

it('renders without imploding', () => {
  const { queryByTestId } = render(<App {...user} />);
  expect(queryByTestId('app')).toBeInTheDocument();
});

describe('App component', () => {
  it('routes to Admin Panel homepage', async () => {
    const {
      getByRole,
      history: { navigate },
    } = renderWithRouter(<App {...user} />, { route: '/' });

    await navigate('/');

    expect(getByRole('heading', { level: 1 })).toHaveTextContent('Firefox Accounts Admin Panel');
  });

  it('routes to AdminLogs', async () => {
    const {
      history,
      history: { navigate },
    } = renderWithRouter(<App {...user} />, { route: '/' });

    await navigate('/admin-logs');

    expect(history.location.pathname).toBe('/admin-logs');
  });

  it('routes to SiteStatus', async () => {
    const {
      history,
      history: { navigate },
    } = renderWithRouter(<App {...user} />, { route: '/' });

    await navigate('/site-status');

    expect(history.location.pathname).toBe('/site-status');
  });

  it('routes to Permissions', async () => {
    const {
      history,
      history: { navigate },
    } = renderWithRouter(<App {...user} />, { route: '/' });

    await navigate('/permissions');

    expect(history.location.pathname).toBe('/permissions');
  });


  it('routes to Account Search', async () => {
    const {
      history,
      history: { navigate },
    } = renderWithRouter(<App {...user} />, { route: '/' });

    await navigate('/account-search');

    expect(history.location.pathname).toBe('/account-search');
  });

  it('redirects to Account Search', async () => {
    const {
      getByRole,
      history: { navigate },
    } = renderWithRouter(<App {...user} />, { route: '/permissions' });

    await navigate('/');

    expect(getByRole('heading', { level: 2, name: 'Account Search' })).toBeInTheDocument();
  });
});
