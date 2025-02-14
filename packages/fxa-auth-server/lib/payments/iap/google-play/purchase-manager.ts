/**
 * Copyright 2018 Google LLC. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { CollectionReference } from '@google-cloud/firestore';
import { androidpublisher_v3 } from 'googleapis';
import Container from 'typedi';

import { AuthLogger } from '../../../types';
import {
  mergePurchaseWithFirestorePurchaseRecord,
  SubscriptionPurchase,
} from './subscription-purchase';
import {
  DeveloperNotification,
  NotificationType,
  PurchaseQueryError,
  PurchaseUpdateError,
  SkuType,
} from './types';

const REPLACED_PURCHASE_USERID_PLACEHOLDER = 'invalid';

/*
 * A class that provides user-purchase linking features
 */
export class PurchaseManager {
  private log: AuthLogger;

  /*
   * This class is intended to be initialized by the library.
   * Library consumer should not initialize this class themselves.
   */
  constructor(
    private purchasesDbRef: CollectionReference,
    private playDeveloperApiClient: androidpublisher_v3.Androidpublisher
  ) {
    this.log = Container.get(AuthLogger);
  }

  /*
   * Query a subscription purchase by its package name, product Id (sku) and purchase token.
   * The method queries Google Play Developer API to get the latest status of the purchase,
   * then merge it with purchase ownership info stored in the library's managed Firestore database,
   * then returns the merge information as a SubscriptionPurchase to its caller.
   *  - triggerNotificationType is only necessary if the purchase query action is triggered by a Realtime Developer notification
   */
  public async querySubscriptionPurchase(
    packageName: string,
    sku: string,
    purchaseToken: string,
    triggerNotificationType?: NotificationType
  ): Promise<SubscriptionPurchase> {
    // STEP 1. Query Play Developer API to verify the purchase token
    const apiResponse = await new Promise((resolve, reject) => {
      this.playDeveloperApiClient.purchases.subscriptions.get(
        {
          packageName: packageName,
          subscriptionId: sku,
          token: purchaseToken,
        },
        (err: any, result: any) => {
          if (err) {
            reject(this.convertPlayAPIErrorToLibraryError(err));
          } else {
            resolve(result.data);
          }
        }
      );
    });

    try {
      // STEP 2. Look up purchase records from Firestore which matches this purchase token
      const purchaseRecordDoc = await this.purchasesDbRef
        .doc(purchaseToken)
        .get();

      // Generate SubscriptionPurchase object from Firestore response
      const now = Date.now();
      const subscriptionPurchase = SubscriptionPurchase.fromApiResponse(
        apiResponse,
        packageName,
        purchaseToken,
        sku,
        now
      );

      // Store notificationType to database if queryPurchase was triggered by a realtime developer notification
      if (triggerNotificationType !== undefined) {
        subscriptionPurchase.latestNotificationType = triggerNotificationType;
      }

      // Convert subscriptionPurchase object to a format that to be stored in Firestore
      const firestoreObject = subscriptionPurchase.toFirestoreObject();

      if (purchaseRecordDoc.exists) {
        // STEP 3a. We have this purchase cached in Firestore. Update our cache with the newly received response from Google Play Developer API
        await purchaseRecordDoc.ref.update(firestoreObject);

        // STEP 4a. Merge other fields of our purchase record in Firestore (such as userId) with our SubscriptionPurchase object and return to caller.
        mergePurchaseWithFirestorePurchaseRecord(
          subscriptionPurchase,
          purchaseRecordDoc.data()
        );
        return subscriptionPurchase;
      } else {
        // STEP 3b. This is a brand-new subscription purchase. Just save the purchase record to Firestore
        await purchaseRecordDoc.ref.set(firestoreObject);

        if (subscriptionPurchase.linkedPurchaseToken) {
          // STEP 4b. This is a subscription purchase that replaced other subscriptions in the past. Let's disable the purchases that it has replaced.
          await this.disableReplacedSubscription(
            packageName,
            sku,
            subscriptionPurchase.linkedPurchaseToken
          );
        }

        // STEP 5. This is a brand-new subscription purchase. Just save the purchase record to Firestore and return an SubscriptionPurchase object with userId = null.
        return subscriptionPurchase;
      }
    } catch (err) {
      // Some unexpected error has occurred while interacting with Firestore.
      const libraryError = new Error(err.message);
      libraryError.name = PurchaseQueryError.OTHER_ERROR;
      throw libraryError;
    }
  }

  /*
   * There are situations that a subscription is replaced by another subscription.
   * For example, an user signs up for a subscription (tokenA), cancel its and re-signups (tokenB)
   * We must disable the subscription linked to tokenA because it has been replaced by tokenB.
   * If failed to do so, there's chance that a malicious user can have a single purchase registered to multiple user accounts.
   *
   * This method is used to disable a replaced subscription. It's not intended to be used from outside of the library.
   */
  private async disableReplacedSubscription(
    packageName: string,
    sku: string,
    purchaseToken: string
  ): Promise<void> {
    this.log.info('Disabling purchase token', { purchaseToken });

    // STEP 1: Lookup the purchase record in Firestore
    const purchaseRecordDoc = await this.purchasesDbRef
      .doc(purchaseToken)
      .get();

    if (purchaseRecordDoc.exists) {
      // Purchase record found in Firestore. Check if it has been disabled.
      if (purchaseRecordDoc.data()?.replacedByAnotherPurchase) {
        // The old purchase has been replaced. We don't need to take further action
        return;
      } else {
        // STEP 2a: Old purchase found in cache, so we disable it
        await purchaseRecordDoc.ref.update({
          replacedByAnotherPurchase: true,
          userId: REPLACED_PURCHASE_USERID_PLACEHOLDER,
        });
        return;
      }
    } else {
      // Purchase record not found in Firestore. We'll try to fetch purchase detail from Play Developer API to backfill the missing cache
      const apiResponse = await new Promise((resolve, reject) => {
        this.playDeveloperApiClient.purchases.subscriptions.get(
          {
            packageName: packageName,
            subscriptionId: sku,
            token: purchaseToken,
          },
          (err: any, result: any) => {
            if (err) {
              this.log.warn('backfill_fetch_error', {
                message:
                  'Error fetching purchase data from Play Developer API to backfilled missing purchase record in Firestore. ',
                errorMessage: err.message,
              });
              // We only log an warning to as there is chance that backfilling is impossible.
              // For example: after a subscription upgrade, the new token has linkedPurchaseToken to be the token before upgrade.
              // We can't tell the sku of the purchase before upgrade from the old token itself, so we can't query Play Developer API
              // to backfill our cache.
              resolve(null);
            } else {
              resolve(result.data);
            }
          }
        );
      });

      if (apiResponse) {
        // STEP 2b. Parse the response from Google Play Developer API and store the purchase detail
        const now = Date.now();
        const subscriptionPurchase = SubscriptionPurchase.fromApiResponse(
          apiResponse,
          packageName,
          purchaseToken,
          sku,
          now
        );
        subscriptionPurchase.replacedByAnotherPurchase = true; // Mark the purchase as already being replaced by other purchase.
        subscriptionPurchase.userId = REPLACED_PURCHASE_USERID_PLACEHOLDER;
        const firestoreObject = subscriptionPurchase.toFirestoreObject();
        await purchaseRecordDoc.ref.set(firestoreObject);

        // STEP 3. If this purchase has also replaced another purchase, repeating from STEP 1 with the older token
        if (subscriptionPurchase.linkedPurchaseToken) {
          await this.disableReplacedSubscription(
            packageName,
            sku,
            subscriptionPurchase.linkedPurchaseToken
          );
        }
      }
    }
  }

  /*
   * Force register a purchase to an user.
   * This method is not intended to be called from outside of the library.
   */
  private async forceRegisterToUserAccount(
    purchaseToken: string,
    userId: string
  ): Promise<void> {
    try {
      await this.purchasesDbRef.doc(purchaseToken).update({ userId: userId });
    } catch (err) {
      const libraryError = new Error(err.message);
      libraryError.name = PurchaseUpdateError.OTHER_ERROR;
      throw libraryError;
    }
  }

  /**
   * Get a purchase record from Firestore.
   */
  public async getPurchase(purchaseToken: string) {
    const purchaseRecordDoc = await this.purchasesDbRef
      .doc(purchaseToken)
      .get();
    if (purchaseRecordDoc.exists) {
      return SubscriptionPurchase.fromFirestoreObject(purchaseRecordDoc.data());
    }
    return;
  }

  /*
   * Register a purchase (both one-time product and recurring subscription) to a user.
   * It's intended to be exposed to Android app to verify purchases made in the app.
   *
   * Note: `skuType` is not currently used as there's no immediate use-case for one-time
   * purchases. The original sample implementation has additional logic supporting it
   * that can be re-incorporated here if needed.
   */
  async registerToUserAccount(
    packageName: string,
    sku: string,
    purchaseToken: string,
    skuType: SkuType,
    userId: string
  ): Promise<SubscriptionPurchase> {
    // The original Google Play sample code did not use Google API efficiency
    // guidelines, the updated version here checks our local Firestore record
    // first to determine if we've seen the token before, and if not, it will
    // query Play Developer API to verify the purchase.
    // https://developer.android.com/google/play/developer-api#subscriptions

    // STEP 1. Check if the purchase record is already in Firestore
    let purchase = await this.getPurchase(purchaseToken);
    if (!purchase) {
      // STEP 1b. Query Play Developer API to verify the purchase
      try {
        purchase = await this.querySubscriptionPurchase(
          packageName,
          sku,
          purchaseToken
        );
      } catch (err) {
        // Error when attempt to query purchase. Return invalid token to caller.
        const libraryError = new Error(err.message);
        libraryError.name = PurchaseUpdateError.INVALID_TOKEN;
        throw libraryError;
      }
    }

    // STEP 2. Check if the purchase is registerable.
    if (!purchase.isRegisterable()) {
      const libraryError = new Error('Purchase is not registerable');
      libraryError.name = PurchaseUpdateError.INVALID_TOKEN;
      throw libraryError;
    }

    // STEP 3. Check if the purchase has been registered to an user. If it is, then return conflict error to our caller.
    if (purchase.userId === userId) {
      // Purchase record already registered to the target user. We'll do nothing.
      return purchase;
    } else if (purchase.userId) {
      this.log.info('purchase already registered', { purchase });
      // Purchase record already registered to different user. Return 'conflict' to caller
      const libraryError = new Error(
        'Purchase has been registered to another user'
      );
      libraryError.name = PurchaseUpdateError.CONFLICT;
      throw libraryError;
    }

    // STEP 3: Register purchase to the user
    await this.forceRegisterToUserAccount(purchaseToken, userId);

    return purchase;
  }

  async processDeveloperNotification(
    packageName: string,
    notification: DeveloperNotification
  ): Promise<SubscriptionPurchase | null> {
    // Type-guard for a real-time developer notification.
    const subscriptionNotification = notification.subscriptionNotification;
    if (!subscriptionNotification) {
      return null;
    }
    if (
      subscriptionNotification.notificationType !==
      NotificationType.SUBSCRIPTION_PURCHASED
    ) {
      // We can safely ignore SUBSCRIPTION_PURCHASED because with new subscription, our Android app will send the same token to server for verification
      // For other type of notification, we query Play Developer API to update our purchase record cache in Firestore
      return this.querySubscriptionPurchase(
        packageName,
        subscriptionNotification.subscriptionId,
        subscriptionNotification.purchaseToken,
        subscriptionNotification.notificationType
      );
    }

    return null;
  }

  private convertPlayAPIErrorToLibraryError(playError: any): Error {
    const libraryError = new Error(playError.message);
    if (playError.code === 404) {
      libraryError.name = PurchaseQueryError.INVALID_TOKEN;
    } else {
      // Unexpected error occurred. It's likely an issue with Service Account
      libraryError.name = PurchaseQueryError.OTHER_ERROR;
      this.log.error('convertPlayAPIErrorToLibraryError', {
        message:
          'Unexpected error when querying Google Play Developer API. Please check if you use a correct service account',
      });
    }
    return libraryError;
  }
}
