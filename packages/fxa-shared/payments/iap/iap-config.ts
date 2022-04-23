/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { Firestore } from '@google-cloud/firestore';
import { TypedCollectionReference } from 'typesafe-node-firestore';
import { ILogger } from '../../log';
import { IapConfig } from './types';

export class IAPConfig {
  protected iapConfigDbRef: TypedCollectionReference<IapConfig>;
  protected prefix: string;

  constructor(
    protected readonly config: {
      authFirestore: {
        prefix: string;
      };
    },
    protected readonly firestore: Firestore,
    protected readonly log: ILogger
  ) {
    this.prefix = `${config.authFirestore.prefix}iap-`;
    this.iapConfigDbRef = this.firestore.collection(
      `${this.prefix}iap-config`
    ) as TypedCollectionReference<IapConfig>;
  }

  /**
   * Fetch the Play Store/App Store plans for Android/iOS client usage.
   */
  public async plans(appName: string) {
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

  /**
   * Fetch the App Store bundleId for the given appName.
   */
  public async getBundleId(appName: string) {
    // TODO: use a cached version of the iap config
    const doc = await this.iapConfigDbRef.doc(appName).get();
    if (doc.exists) {
      return doc.data()?.bundleId;
    } else {
      throw Error(`IAP Plans document does not exist for ${appName}`);
    }
  }
}
