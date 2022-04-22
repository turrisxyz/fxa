/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PlayBillingShared } from 'fxa-shared/payments/google-play/play-billing';
import { Container } from 'typedi';
import { AppConfig, AuthFirestore, AuthLogger } from '../../types';

export class PlayBilling extends PlayBillingShared {
  constructor() {
    const config = Container.get(AppConfig);
    super(config, Container.get(AuthFirestore), Container.get(AuthLogger));
  }
}
