/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import {
  AbbrevPlayPurchase,
  GooglePlaySubscription,
  MozillaSubscriptionTypes,
} from '../../subscriptions/types';
import { SubscriptionPurchase } from './subscription-purchase';
import { UserManagerShared } from './user-manager';

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

export interface IPlaySubscriptionsStripeHelper {
  addPriceInfoToAbbrevPlayPurchases(
    iapSubscribedGooglePlayAbbrevPlayPurchases: any
  ): Promise<
    (AbbrevPlayPurchase & {
      product_id: string;
      product_name: string;
      price_id: string;
    })[]
  >;
}

export interface IPlaySubscriptionsPlayBilling {
  userManager: UserManagerShared;
}

// TODO move this when we add support for Apple IAP subscriptions
export interface SubscriptionsService<T> {
  getSubscriptions: (uid: string) => Promise<T[]>;
}

export type PlaySubscriptionsConfig = {
  subscriptions: {
    enabled: boolean;
  };
};

export class PlaySubscriptionsShared
  implements SubscriptionsService<GooglePlaySubscription>
{
  constructor(
    protected readonly playBilling?: IPlaySubscriptionsPlayBilling,
    protected readonly stripeHelper?: IPlaySubscriptionsStripeHelper
  ) {}

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
    return iapAbbrevPlayPurchasesWithStripeProductData.map((purchase: any) => ({
      ...purchase,
      _subscription_type: MozillaSubscriptionTypes.IAP_GOOGLE,
    }));
  }

  async getAbbrevPlayPurchases(uid: string) {
    if (!this.playBilling) {
      return [];
    }

    const allPurchases =
      await this.playBilling.userManager.queryCurrentSubscriptions(uid);
    const purchases = allPurchases.filter((purchase: any) =>
      purchase.isEntitlementActive()
    );

    return purchases.map(abbrevPlayPurchaseFromSubscriptionPurchase);
  }
}
