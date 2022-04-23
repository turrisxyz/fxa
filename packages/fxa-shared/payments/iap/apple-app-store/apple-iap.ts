/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { Firestore } from '@google-cloud/firestore';
import { ILogger } from '../../../log';
import { Container } from 'typedi';

import { AppStoreHelper } from './app-store-helper';
import { PurchaseManager } from './purchase-manager';

export class AppleIAP {
  protected prefix: string;

  public purchaseManager: PurchaseManager;
  constructor(
    protected readonly config: {
      authFirestore: {
        prefix: string;
      };
      subscriptions: {
        appStore: {
          sandbox: boolean;
          credentials: any;
        };
      };
    },
    protected readonly firestore: Firestore,
    protected readonly log: ILogger
  ) {
    const appStoreHelper = new AppStoreHelper(config, log);

    this.prefix = `${config.authFirestore.prefix}iap-`;
    const purchasesDbRef = this.firestore.collection(
      `${this.prefix}app-store-purchases`
    );
    this.purchaseManager = new PurchaseManager(
      purchasesDbRef,
      appStoreHelper,
      log
    );
  }
}
