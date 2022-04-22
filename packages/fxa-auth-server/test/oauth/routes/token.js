/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { assert } = require('chai');

const CLIENT_SECRET =
  'b93ef8a8f3e553a430d7e5b904c6132b2722633af9f03128029201d24a97f2a8';
const CLIENT_ID = '98e6508e88680e1b';
const CODE = 'df6dcfe7bf6b54a65db5742cbcdce5c0a84a5da81a0bb6bdf5fc793eef041fc6';
const REFRESH_TOKEN = CODE;
const PKCE_CODE_VERIFIER = 'au3dqDz2dOB0_vSikXCUf4S8Gc-37dL-F7sGxtxpR3R';
const DISABLED_CLIENT_ID = 'd15ab1edd15ab1ed';
const NON_DISABLED_CLIENT_ID = '98e6508e88680e1a';

const route = require('../../../lib/routes/oauth/token')({
  log: {
    debug: () => {},
    warn: () => {},
  },
  oauthDB: {
    async getRefreshToken() {
      return null;
    },
    async getCode() {
      return null;
    },
  },
})[0];

function joiRequired(err, param) {
  assert.ok(err.isJoi);
  assert.ok(err.name, 'ValidationError');
  assert.equal(err.details[0].message, `"${param}" is required`);
}

function joiNotAllowed(err, param) {
  assert.ok(err.isJoi);
  assert.ok(err.name, 'ValidationError');
  assert.equal(err.details[0].message, `"${param}" is not allowed`);
}

describe('/token POST', function () {
  describe('input validation', () => {
    // route validation function
    async function v(req, ctx, cb) {
      if (typeof ctx === 'function' && !cb) {
        cb = ctx;
        ctx = undefined;
      }
      const validationSchema = route.config.validate.payload;
      await validationSchema.validateAsync(req, { context: ctx }, cb);
    }

    it('fails with no client_id', () => {
      v(
        {
          client_secret: CLIENT_SECRET,
          code: CODE,
        },
        (err) => {
          joiRequired(err, 'client_id');
        }
      );
    });

    it('valid client_secret scheme', () => {
      v(
        {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: CODE,
        },
        (err) => {
          assert.equal(err, null);
        }
      );
    });

    it('requires client_secret', () => {
      v(
        {
          client_id: CLIENT_ID,
          code: CODE,
        },
        (err) => {
          joiRequired(err, 'client_secret');
        }
      );
    });

    it('forbids client_id when authz header provided', () => {
      v(
        {
          client_id: CLIENT_ID,
        },
        {
          headers: {
            authorization: 'Basic ABCDEF',
          },
        },
        (err) => {
          joiNotAllowed(err, 'client_id');
        }
      );
    });

    it('forbids client_secret when authz header provided', () => {
      v(
        {
          client_secret: CLIENT_SECRET,
          code: CODE, // If we don't send `code`, then the missing `code` will fail validation first.
        },
        {
          headers: {
            authorization: 'Basic ABCDEF',
          },
        },
        (err) => {
          joiNotAllowed(err, 'client_secret');
        }
      );
    });

    describe('pkce', () => {
      it('accepts pkce code_verifier instead of client_secret', () => {
        v(
          {
            client_id: CLIENT_ID,
            code_verifier: PKCE_CODE_VERIFIER,
            code: CODE,
          },
          (err) => {
            assert.equal(err, null);

          }
        );
      });

      it('rejects pkce code_verifier that is too small', () => {
        const bad_code_verifier = PKCE_CODE_VERIFIER.substring(0, 32);
        v(
          {
            client_id: CLIENT_ID,
            code_verifier: bad_code_verifier,
            code: CODE,
          },
          (err) => {
            assert.ok(err.isJoi);
            assert.ok(err.name, 'ValidationError');
            assert.equal(
              err.details[0].message,
              // eslint-disable-next-line quotes
              `"code_verifier" length must be at least 43 characters long`
            ); // eslint-disable-line quotes

          }
        );
      });

      it('rejects pkce code_verifier that is too big', () => {
        const bad_code_verifier =
          PKCE_CODE_VERIFIER +
          PKCE_CODE_VERIFIER +
          PKCE_CODE_VERIFIER +
          PKCE_CODE_VERIFIER;
        v(
          {
            client_id: CLIENT_ID,
            code_verifier: bad_code_verifier,
            code: CODE,
          },
          (err) => {
            assert.ok(err.isJoi);
            assert.ok(err.name, 'ValidationError');
            assert.equal(
              err.details[0].message,
              // eslint-disable-next-line quotes
              `"code_verifier" length must be less than or equal to 128 characters long`
            ); // eslint-disable-line quotes

          }
        );
      });

      it('rejects pkce code_verifier that contains invalid characters', () => {
        const bad_code_verifier = PKCE_CODE_VERIFIER + ' :.';
        v(
          {
            client_id: CLIENT_ID,
            code_verifier: bad_code_verifier,
            code: CODE,
          },
          (err) => {
            assert.ok(err.isJoi);
            assert.ok(err.name, 'ValidationError');
            assert.equal(
              err.details[0].message,
              `"code_verifier" with value "${bad_code_verifier}" fails to match the required pattern: /^[A-Za-z0-9-_]+$/`
            );

          }
        );
      });
    });
  });

  describe('config handling', () => {
    const request = {
      headers: {},
      payload: {
        client_id: CLIENT_ID,
      },
    };

    it('allows clients that have not been disabled via config', async () => {
      request.payload.client_id = NON_DISABLED_CLIENT_ID;
      request.payload.grant_type = 'refresh_token';
      request.payload.refresh_token = REFRESH_TOKEN;
      try {
        await route.config.handler(request);
        assert.fail('should have errored');
      } catch (err) {
        // The request still fails, but it fails at the point where we check the token,
        // meaning that the client_id was allowed through the disabled filter.
        assert.equal(err.errno, 108); // Invalid token.
      }
    });

    it('allows code grants for clients that have been disabled via config', async () => {
      request.payload.client_id = DISABLED_CLIENT_ID;
      request.payload.grant_type = 'authorization_code';
      request.payload.code = CODE;
      try {
        await route.config.handler(request);
        assert.fail('should have errored');
      } catch (err) {
        // The request still fails, but it fails at the point where we check the code,
        // meaning that the client_id was allowed through the disabled filter.
        assert.equal(err.errno, 105);
      }
    });

    it('returns an error on refresh_token grants for clients that have been disabled via config', async () => {
      request.payload.client_id = DISABLED_CLIENT_ID;
      request.payload.grant_type = 'refresh_token';
      request.payload.refresh_token = REFRESH_TOKEN;
      try {
        await route.config.handler(request);
        assert.fail('should have errored');
      } catch (err) {
        assert.equal(err.output.statusCode, 503);
        assert.equal(err.errno, 202); // Disabled client.
      }
    });

    it('returns an error on fxa-credentials grants for clients that have been disabled via config', async () => {
      request.payload.client_id = DISABLED_CLIENT_ID;
      request.payload.grant_type = 'fxa-credentials';
      try {
        await route.config.handler(request);
        assert.fail('should have errored');
      } catch (err) {
        assert.equal(err.output.statusCode, 503);
        assert.equal(err.errno, 202); // Disabled client.
      }
    });
  });
});
