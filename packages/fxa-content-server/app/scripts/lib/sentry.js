/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import Logger from './logger';
import * as Sentry from '@sentry/browser';
import { filterAndTag, filterQueryParams } from 'fxa-shared/sentry';

var ALLOWED_QUERY_PARAMETERS = [
  'automatedBrowser',
  'client_id',
  'context',
  'entrypoint',
  'keys',
  'redirect_uri',
  'scope',
  'service',
  'setting',
  'style',
];

/**
 * function that gets called before data gets sent to error metrics
 *
 * @param {Object} data
 *  Error object data
 * @returns {Object} data
 *  Modified error object data
 * @private
 */
function beforeSend(data, hint) {
  return filterAndTag(data, {
    tags: {
      name: 'fxa-content',
    },
    filters: {
      ignoreKnownErrors: true,
      allowedQueryParams: ALLOWED_QUERY_PARAMETERS,
    },
  });
}

/**
 * Exception fields that are imported as tags
 */
const exceptionTags = ['code', 'context', 'errno', 'namespace', 'status'];

/**
 * Creates a SentryMetrics object that starts up Sentry/browser
 *
 * Read more at https://docs.sentry.io/platforms/javascript
 *
 * @param {String} dsn
 * @param {String} [release] - content server release version
 * @constructor
 */
function SentryMetrics(dsn, release, environment, name) {
  this._logger = new Logger();
  this._release = release;

  if (!dsn) {
    this._logger.error('No Sentry dsn provided');
    return;
  }

  try {
    Sentry.init({
      release,
      dsn,
      environment,
      beforeSend,
    });
  } catch (e) {
    this._logger.error(e);
  }
}

SentryMetrics.prototype = {
  /**
   * Capture an exception. Error fields listed in exceptionTags
   * will be added as tags to the sentry data.
   *
   * @param {Error} err
   */
  captureException(err) {
    Sentry.withScope(function (scope) {
      exceptionTags.forEach(function (tagName) {
        if (tagName in err) {
          scope.setTag(tagName, err[tagName]);
        }
      });
      Sentry.captureException(err);
    });
  },

  // Private functions, exposed for testing
  __beforeSend: beforeSend,
  __cleanUpQueryParam: filterQueryParams,
};

export default SentryMetrics;
