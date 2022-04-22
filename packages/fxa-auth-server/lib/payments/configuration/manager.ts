/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Container } from 'typedi';
import { AppConfig, AuthFirestore, AuthLogger } from '../../types';
import { PaymentConfigManagerShared } from 'fxa-shared/payments/configuration/manager';
export class PaymentConfigManager extends PaymentConfigManagerShared {
  constructor() {
    super(
      Container.get(AppConfig),
      Container.get(AuthFirestore),
      Container.get(AuthLogger)
    );
  }
}
