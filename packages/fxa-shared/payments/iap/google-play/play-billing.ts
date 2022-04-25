/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { Firestore } from '@google-cloud/firestore';
import { Auth, google } from 'googleapis';
import { ILogger } from '../../../log';
import { PurchaseManager } from './purchase-manager';
import { UserManager } from './user-manager';

export type PlayBillingConfigType = {
  authFirestore: any;
  subscriptions: any;
};

export class PlayBilling {
  protected prefix: string;
  public purchaseManager: PurchaseManager;
  public userManager: UserManager;

  constructor(
    protected readonly config: PlayBillingConfigType,
    protected readonly firestore: Firestore,
    protected readonly log: ILogger
  ) {
    console.log('PlayBilling GOT CONFIG', config.subscriptions);
    console.log('PlayBilling GOT firestore', firestore);
    console.log('PlayBilling GOT log', log);

    // Initialize Google Play Developer API client
    const playAccountConfig = config.subscriptions.playApiServiceAccount;
    const authConfig: Auth.JWTOptions = {
      email: playAccountConfig.credentials.client_email,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      ...(playAccountConfig.keyFilename
        ? { keyFile: playAccountConfig.keyFilename }
        : { key: playAccountConfig.credentials.private_key }),
    };
    const playDeveloperApiClient = google.androidpublisher({
      version: 'v3',
      auth: new Auth.JWT(authConfig),
    });
    this.prefix = `${config.authFirestore.prefix}iap-`;
    const purchasesDbRef = this.firestore.collection(
      `${this.prefix}play-purchases`
    );
    this.purchaseManager = new PurchaseManager(
      purchasesDbRef,
      playDeveloperApiClient,
      log
    );
    this.userManager = new UserManager(
      purchasesDbRef,
      this.purchaseManager,
      this.log
    );
  }
}
