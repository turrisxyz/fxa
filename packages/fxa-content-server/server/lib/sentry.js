/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const config = require('./configuration');
const SENTRY_SERVER_ERRORS_DSN = config.get('sentry.server_errors_dsn');
const STACKTRACE_FRAME_LENGTH = 10;
const RELEASE = require('../../package.json').version;
const { FxaSentryForNode } = require('fxa-shared/sentry');

const fxaSentry = FxaSentryForNode.init(
  {
    dsn: SENTRY_SERVER_ERRORS_DSN,
    release: RELEASE,
    environment: config.get('env'),
    name: 'fxa-content-server',
  },
  {
    filters: {
      trimStackTrace: STACKTRACE_FRAME_LENGTH,
    },
  }
);

module.exports = {
  _eventFilter: fxaSentry.beforeSend, // exported for testing purposes
  Handlers: FxaSentryForNode.Handlers,
};
