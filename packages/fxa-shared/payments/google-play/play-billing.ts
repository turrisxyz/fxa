/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { Firestore } from '@google-cloud/firestore';
import { Auth, google } from 'googleapis';
import { TypedCollectionReference } from 'typesafe-node-firestore';
import { ILogger } from '../../log';
import { PurchaseManagerShared } from './purchase-manager';
import { IapConfig } from './types';
import { UserManagerShared } from './user-manager';

export type PlayBillingConfig = {
  authFirestore: {
    prefix: string;
  };
  subscriptions: {
    playApiServiceAccount: {
      credentials: {
        client_email: string;
        private_key: string;
      };
      keyFilename: string;
    };
  };
};

export class PlayBillingShared {
  protected prefix: string;

  protected iapConfigDbRef: TypedCollectionReference<IapConfig>;

  public readonly userManager: UserManagerShared;

  public readonly purchaseManager: PurchaseManagerShared;

  constructor(
    config: PlayBillingConfig,
    protected readonly firestore: Firestore,
    protected readonly log: ILogger
  ) {
    this.prefix = `${config.authFirestore.prefix}iap-`;
    this.iapConfigDbRef = this.firestore.collection(
      `${config.authFirestore.prefix}iap-config`
    ) as TypedCollectionReference<IapConfig>;

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
    const purchasesDbRef = this.firestore.collection(
      `${this.prefix}play-purchases`
    );
    this.purchaseManager = new PurchaseManagerShared(
      purchasesDbRef,
      playDeveloperApiClient,
      log
    );
    this.userManager = new UserManagerShared(
      purchasesDbRef,
      this.purchaseManager,
      log
    );
  }

  /**
   * Fetch the Google plan object for Android client usage.
   */
  public async plans(appName: string) {
    // TODO: use a cached version of the iap config
    const doc = await this.iapConfigDbRef.doc(appName).get();
    if (doc.exists) {
      return doc.data()?.plans;
    } else {
      throw Error(`IAP Plans document does not exist for ${appName}`);
    }
  }

  /**
   * Fetch the Google Play packageName for the given appName.
   */
  public async packageName(appName: string) {
    // TODO: use a cached version of the iap config
    const doc = await this.iapConfigDbRef.doc(appName).get();
    if (doc.exists) {
      return doc.data()?.packageName;
    } else {
      throw Error(`IAP Plans document does not exist for ${appName}`);
    }
  }
}
