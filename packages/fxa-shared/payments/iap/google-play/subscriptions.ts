/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { Inject } from '@nestjs/common';
import {
  AbbrevPlayPurchase,
  GooglePlaySubscription,
  MozillaSubscriptionTypes,
} from '../../../subscriptions/types';

import { StripeHelper } from '../../stripe';
import { PlayBilling } from './play-billing';
import { SubscriptionPurchase } from './subscription-purchase';

// TODO move this when we add support for Apple IAP subscriptions
export interface SubscriptionsService<T> {
  getSubscriptions: (uid: string) => Promise<T[]>;
}

/**
 * Extract an AbbrevPlayPurchase from a SubscriptionPurchase
 */
export function abbrevPlayPurchaseFromSubscriptionPurchase(
  purchase: SubscriptionPurchase
): AbbrevPlayPurchase {
  return {
    auto_renewing: purchase.autoRenewing,
    expiry_time_millis: purchase.expiryTimeMillis,
    package_name: purchase.packageName,
    sku: purchase.sku,
    ...(purchase.cancelReason && { cancel_reason: purchase.cancelReason }),
  };
}

export class PlaySubscriptionsError {
  constructor(
    public readonly op: string,
    public readonly data: any,
    public readonly error: Error
  ) {}
}

export type PlaySubscriptionsConfigType = {
  subscriptions: {
    enabled: boolean;
  };
};

export class PlaySubscriptions
  implements SubscriptionsService<GooglePlaySubscription>
{
  constructor(
    @Inject('APP_CONFIG')
    protected readonly config: PlaySubscriptionsConfigType,
    protected readonly playBilling?: PlayBilling,
    protected readonly stripeHelper?: StripeHelper
  ) {
    console.log('PlaySubscriptions GOT CONFIG', config.subscriptions);

    if (!config.subscriptions.enabled) {
      throw new PlaySubscriptionsError(
        'PlaySubscriptions',
        {},
        new Error(
          'Trying to new up PlaySubscriptions while subscriptions are disabled.  Check your dependency graph.'
        )
      );
    }
  }

  async getAbbrevPlayPurchases(uid: string) {
    if (!this.playBilling) {
      return [];
    }

    const allPurchases =
      await this.playBilling.userManager.queryCurrentSubscriptions(uid);
    const purchases = allPurchases.filter((purchase) =>
      purchase.isEntitlementActive()
    );

    return purchases.map(abbrevPlayPurchaseFromSubscriptionPurchase);
  }

  /**
   * Gets all active Google Play subscriptions for the given user id
   */
  async getSubscriptions(uid: string): Promise<GooglePlaySubscription[]> {
    if (!this.stripeHelper) {
      return [];
    }
    const iapSubscribedGooglePlayAbbrevPlayPurchases =
      await this.getAbbrevPlayPurchases(uid);
    const iapAbbrevPlayPurchasesWithStripeProductData =
      await this.stripeHelper.addPriceInfoToAbbrevPlayPurchases(
        iapSubscribedGooglePlayAbbrevPlayPurchases
      );
    return iapAbbrevPlayPurchasesWithStripeProductData.map((purchase) => ({
      ...purchase,
      _subscription_type: MozillaSubscriptionTypes.IAP_GOOGLE,
    }));
  }
}
