/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Joi = require('joi');
const db = require('../../db');
const notifyProfileUpdated = require('../../updates-queue');

const EMPTY = Object.create(null);

// We're pretty liberal with what's allowed in a display-name,
// but we exclude the following classes of characters:
//
//   \u0000-\u001F  - C0 (ascii) control characters
//   \u007F         - ascii DEL character
//   \u0080-\u009F  - C1 (ansi escape) control characters
//   \u2028-\u2029  - unicode line/paragraph separator
//   \uE000-\uF8FF  - BMP private use area
//   \uFFF9-\uFFFC  - unicode specials prior to the replacement character
//   \uFFFE-\uFFFF  - unicode this-is-not-a-character specials
//
// Note that the unicode replacement character \uFFFD is explicitly allowed,
// and clients may use it to replace other disallowed characters.
//
// We might tweak this list in future.

// eslint-disable-next-line no-control-regex
const ALLOWED_DISPLAY_NAME_CHARS = /^(?:[^\u0000-\u001F\u007F\u0080-\u009F\u2028-\u2029\uE000-\uF8FF\uFFF9-\uFFFC\uFFFE-\uFFFF])*$/;

module.exports = {
  auth: {
    strategy: 'oauth',
    scope: ['profile:display_name:write'],
  },
  validate: {
    payload: Joi.object({
      displayName: Joi.string()
        .max(256)
        .required()
        .allow('')
        .regex(ALLOWED_DISPLAY_NAME_CHARS),
    }),
  },
  handler: async function displayNamePost(req) {
    const uid = req.auth.credentials.user;
    return req.server.methods.profileCache.drop(uid).then(() => {
      const payload = req.payload;
      return db.setDisplayName(uid, payload.displayName).then(() => {
        notifyProfileUpdated(uid); // Don't wait on promise
        return EMPTY;
      });
    });
  },
};
