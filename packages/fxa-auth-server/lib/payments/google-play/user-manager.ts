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
import { UserManagerShared } from 'fxa-shared/payments/google-play';
import Container from 'typedi';
import { AuthLogger } from '../../types';
import { PurchaseManager } from './purchase-manager';

/*
 * A class that allows looking up purchases registered to a particular user
 */
export class UserManager extends UserManagerShared {
  /*
   * This class is intended to be initialized by the library.
   * Library consumer should not initialize this class themselves.
   */
  constructor(
    purchasesDbRef: CollectionReference,
    purchaseManager: PurchaseManager
  ) {
    super(purchasesDbRef, purchaseManager, Container.get(AuthLogger));
  }
}
