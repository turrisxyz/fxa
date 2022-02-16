/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as Sentry from '@sentry/browser';
import Logger from './logger';
import { filterAndTag } from '../sentry';

// HACK: allow tests to stub this function from Sentry
// https://stackoverflow.com/questions/35240469/how-to-mock-the-imports-of-an-es6-module
export const _Sentry = {
  captureException: Sentry.captureException,
};

const ALLOWED_QUERY_PARAMETERS = [
  'automatedBrowser',
  'client_id',
  'context',
  'entrypoint',
  'keys',
  'migration',
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
function beforeSend(tags: any, data: SentryEvent): SentryEvent {
  data = filterAndTag(data, undefined, {
    tags,
    filters: {
      allowedQueryParams: ALLOWED_QUERY_PARAMETERS,
    },
  });
  return data;
}

/**
 * Exception fields that are imported as tags
 */
const exceptionTags = ['code', 'context', 'errno', 'namespace', 'status'];

interface SentryMetrics {
  _logger: Logger;
  configure: (arg0: string, arg1?: string) => void;
  captureException: (arg0: Error) => void;
  __beforeSend: (arg0: Sentry.Event) => Sentry.Event;
  __cleanUpQueryParam: (arg0: string) => string;
}

/**
 * Creates a SentryMetrics singleton object that starts up Sentry/browser.
 *
 * This must be configured with the `configure` method before use.
 *
 * Read more at https://docs.sentry.io/platforms/javascript
 *
 * @constructor
 */
const SentryMetrics = function (this: SentryMetrics) {
  this._logger = new Logger();
} as any as new () => SentryMetrics;

SentryMetrics.prototype = {
  /**
   * Configure the SentryMetrics instance for this singleton.
   *
   * @param {String} dsn
   * @param {String} [release] - settings release version
   */
  configure(dsn: string, release: string, environment: string, name: string) {
    this._logger.info('release: ' + release);
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
        beforeSend(event: Sentry.Event) {
          return filterAndTag(event, {
            tags: {
              name,
            },
            filters: {
              allowedQueryParams: ALLOWED_QUERY_PARAMETERS,
            },
          });
        },
      });
    } catch (e) {
      this._logger.error(e);
    }
  },
  /**
   * Capture an exception. Error fields listed in exceptionTags
   * will be added as tags to the sentry data.
   *
   * @param {Error} err
   */
  captureException(err: Error) {
    Sentry.withScope((scope: Sentry.Scope) => {
      exceptionTags.forEach((tagName) => {
        if (tagName in err) {
          scope.setTag(
            tagName,
            (
              err as {
                [key: string]: any;
              }
            )[tagName]
          );
        }
      });
      _Sentry.captureException(err);
    });
  },

  // Private functions, exposed for testing
  __beforeSend: beforeSend,
  __cleanUpQueryParam: cleanUpQueryParam,
};

const sentryMetrics = new SentryMetrics();

export default sentryMetrics;
