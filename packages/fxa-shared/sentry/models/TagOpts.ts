/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Tagging options */
export type TagOpts = {
  /** The name of the service being monitored by sentry */
  name?: string;

  /** Tags endpoints as critical based off master list of endpoints. */
  criticalEndpoints?: boolean;
};

export const defaultTagOpts: TagOpts = {
  criticalEndpoints: true,
  name: undefined,
};
