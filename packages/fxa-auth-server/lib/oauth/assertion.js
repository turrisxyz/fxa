/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use stict';

/* Utilities for verifing signed identity assertions.
 *
 * This service accepts two different kinds of identity assertions
 * for authenticating the caller:
 *
 *  - A JWT, signed by one of a fixed set of trusted server-side secret
 *    HMAC keys.
 *  - A BrowserID assertion bundle, signed via BrowserID's public key
 *    discovery mechanisms.
 *
 * The former is much simpler and easier to verify, so much so that
 * we do it inline in the server process. The later is much more
 * complicated and we need to call out to an external verifier process.
 * We hope to eventually phase out support for BrowserID assertions.
 *
 */

const Joi = require('joi');
const validators = require('./validators');

const OauthError = require('./error');
const config = require('../../config');
const { verifyJWT } = require('../../lib/serverJWT');

const HEX_STRING = /^[0-9a-f]+$/;

// FxA sends several custom claims, ref
// https://github.com/mozilla/fxa/blob/main/packages/fxa-auth-server/docs/api.md#post-certificatesign
const CLAIMS_SCHEMA = Joi.object({
  uid: Joi.string().length(32).regex(HEX_STRING).required(),
  'fxa-generation': Joi.number().integer().min(0).required(),
  'fxa-verifiedEmail': Joi.string().max(255).required(),
  'fxa-lastAuthAt': Joi.number().integer().min(0).required(),
  iat: Joi.number().integer().min(0).optional(),
  'fxa-tokenVerified': Joi.boolean().optional(),
  'fxa-sessionTokenId': validators.sessionTokenId.optional(),
  'fxa-amr': Joi.array().items(Joi.string().alphanum()).optional(),
  'fxa-aal': Joi.number().integer().min(0).max(3).optional(),
  'fxa-profileChangedAt': Joi.number().integer().min(0).optional(),
  'fxa-keysChangedAt': Joi.number().integer().min(0).optional(),
}).options({ stripUnknown: true });

const AUDIENCE = config.get('oauthServer.audience');
const ALLOWED_ISSUER = config.get('oauthServer.browserid.issuer');

const request = require('request').defaults({
  url: config.get('oauthServer.browserid.verificationUrl'),
  pool: {
    maxSockets: config.get('oauthServer.browserid.maxSockets'),
  },
});

function error(assertion, msg, val) {
  throw OauthError.invalidAssertion();
}

// Verify a BrowserID assertion,
// by posting to an external verifier service.

async function verifyBrowserID(assertion) {
  const [res, body] = await new Promise((resolve, reject) => {
    request(
      {
        method: 'POST',
        json: {
          assertion: assertion,
          audience: AUDIENCE,
        },
      },
      (err, res, body) => {
        if (err) {
          return reject(err);
        }
        resolve([res, body]);
      }
    );
  });

  if (!res || !body || body.status !== 'okay') {
    return error(assertion, 'non-okay response', body);
  }

  const email = body.email;
  const parts = email.split('@');
  if (parts.length !== 2 || parts[1] !== ALLOWED_ISSUER) {
    return error(assertion, 'invalid email', email);
  }
  if (body.issuer !== ALLOWED_ISSUER) {
    return error(assertion, 'invalid issuer', body.issuer);
  }
  const uid = parts[0];

  const claims = body.idpClaims || {};
  claims.uid = uid;
  return claims;
}

module.exports = async function verifyAssertion(assertion) {
  // We can differentiate between JWTs and BrowserID assertions
  // because the former cannot contain "~" while the later always do.
  let claims;
  if (/~/.test(assertion)) {
    claims = await verifyBrowserID(assertion);
  } else {
    try {
      claims = await verifyJWT(
        assertion,
        AUDIENCE,
        ALLOWED_ISSUER,
        config.get('oauthServer.authServerSecrets'),
        error
      );
      claims.uid = claims.sub;
    } catch (err) {
      return error(assertion, err.message);
    }
  }
  try {
    return await CLAIMS_SCHEMA.validateAsync(claims);
  } catch (err) {
    return error(assertion, err, claims);
  }
};
