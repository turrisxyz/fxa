import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { config as defaultConfig } from '../../../lib/config';
import { AppContext, defaultAppContext } from '../../../lib/AppContext';

import {
  MOCK_PLANS,
  MOCK_PROFILE,
  MOCK_CUSTOMER,
} from '../../../lib/test-utils';

import { SubscriptionSuccess } from './index';

afterEach(cleanup);

function assertRedirectForProduct(
  product_id: string,
  product_name: string,
  expectedUrl: string
) {
  const config = {
    ...defaultConfig,
    env: 'testing',
    productRedirectURLs: {
      '123doneProProduct': 'http://localhost:8080',
    },
  };
  const navigateToUrl = jest.fn();
  const appContextValue = { ...defaultAppContext, navigateToUrl, config };
  const selectedPlan = { ...MOCK_PLANS[0], product_id, product_name };
  const { getByTestId } = render(
    <AppContext.Provider value={appContextValue}>
      <SubscriptionSuccess
        {...{
          plan: selectedPlan,
          profile: MOCK_PROFILE,
          customer: MOCK_CUSTOMER,
          isMobile: false,
        }}
      />
    </AppContext.Provider>
  );
  expect(getByTestId('download-link').getAttribute('href')).toEqual(
    expectedUrl
  );
}

describe('SubscriptionSuccess', () => {
  it('performs a redirect to the expected URL for local product', () => {
    assertRedirectForProduct(
      '123doneProProduct',
      'local',
      `http://localhost:8080/?email=${encodeURIComponent(MOCK_PROFILE.email)}`
    );
  });

  it('performs a redirect to the default URL for unknown product', () => {
    assertRedirectForProduct(
      'beepBoop',
      'bazquux',
      `https://mozilla.org/?email=${encodeURIComponent(MOCK_PROFILE.email)}`
    );
  });

  it('renders the PlanDetails component on mobile', () => {
    const { queryByTestId } = render(
      <AppContext.Provider value={defaultAppContext}>
        <SubscriptionSuccess
          {...{
            plan: MOCK_PLANS[0],
            profile: MOCK_PROFILE,
            customer: MOCK_CUSTOMER,
            isMobile: true,
          }}
        />
      </AppContext.Provider>
    );

    const planDetails = queryByTestId('plan-details-component');
    expect(planDetails).toBeVisible();
  });

  it('renders the coupon form component when a coupon is present', () => {
    const { queryByTestId } = render(
      <AppContext.Provider value={defaultAppContext}>
        <SubscriptionSuccess
          {...{
            plan: MOCK_PLANS[0],
            profile: MOCK_PROFILE,
            customer: MOCK_CUSTOMER,
            isMobile: true,
            coupon: {
              promotionCode: 'Test',
              type: 'repeating',
              discountAmount: 10,
              valid: true,
            },
          }}
        />
      </AppContext.Provider>
    );

    const couponComponent = queryByTestId('coupon-component');
    expect(couponComponent).toBeVisible();
  });

  it('does not renders the coupon form component when a coupon is not present', () => {
    const { queryByTestId } = render(
      <AppContext.Provider value={defaultAppContext}>
        <SubscriptionSuccess
          {...{
            plan: MOCK_PLANS[0],
            profile: MOCK_PROFILE,
            customer: MOCK_CUSTOMER,
            isMobile: true,
          }}
        />
      </AppContext.Provider>
    );

    const couponComponent = queryByTestId('coupon-component');
    expect(couponComponent).not.toBeInTheDocument();
  });
});
