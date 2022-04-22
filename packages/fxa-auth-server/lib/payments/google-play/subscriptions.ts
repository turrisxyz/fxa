/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { PlaySubscriptionsShared } from 'fxa-shared/payments/google-play/subscriptions';
import Container from 'typedi';

import { internalValidationError } from '../../../lib/error';
import { AppConfig } from '../../types';
import { StripeHelper } from '../stripe';
import { PlayBilling } from './play-billing';

export class PlaySubscriptions extends PlaySubscriptionsShared {
  constructor() {
    const config = Container.get(AppConfig);
    if (!config.subscriptions.enabled) {
      throw internalValidationError(
        'PlaySubscriptions',
        {},
        new Error(
          'Trying to new up PlaySubscriptions while subscriptions are disabled.  Check your dependency graph.'
        )
      );
    }

    super(
      Container.has(PlayBilling) ? Container.get(PlayBilling) : undefined,
      Container.has(StripeHelper) ? Container.get(StripeHelper) : undefined
    );
  }
}
