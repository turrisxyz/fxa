/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Filtering options */
export type FilterOpts = {
  /** Should request data be removed from the sentry event. Defaults to true since request data can be quite large. */
  requestData?: boolean;
  /** Max number of lines to send for stack trace. */
  stackTraceLimit?: number;
  /** Should event be scrubbed for email like values. Defaults to true since emails should be private. */
  emails?: boolean;
  /** Should event be scrubbed for token like values. Defaults to true since tokens should be private. */
  tokens?: boolean;
  /** Only allow whitelisted query params */
  allowedQueryParams?: string[];
  /** If processing an event with a known errno, view this as an expected serverside error and forgo sending the event. */
  ignoreKnownErrors?: boolean;
};

export const defaultFilterOpts: FilterOpts = {
  requestData: true,
  emails: true,
  tokens: true,
  stackTraceLimit: 100,
  ignoreKnownErrors: false,
  allowedQueryParams: undefined,
};
