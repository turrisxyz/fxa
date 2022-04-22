/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const Joi = require('joi');
const createBackendServiceAPI = require('./backendService');
const config = require('../config');
const localizeTimestamp = require('fxa-shared').l10n.localizeTimestamp({
  supportedLanguages: config.get('i18n').supportedLanguages,
  defaultLanguage: config.get('i18n').defaultLanguage,
});
const serviceName = 'customs';

module.exports = function (log, error, statsd) {
  const CustomsAPI = createBackendServiceAPI(
    log,
    config,
    serviceName,
    {
      check: {
        path: '/check',
        method: 'POST',
        validate: {
          payload: {
            email: Joi.string().required(),
            ip: Joi.string().required(),
            action: Joi.string().required(),
            headers: Joi.object().optional(),
            query: Joi.object().optional(),
            payload: Joi.object().optional(),
          },
          response: {
            block: Joi.boolean().required(),
            blockReason: Joi.string().optional(),
            suspect: Joi.boolean().optional(),
            unblock: Joi.boolean().optional(),
            retryAfter: Joi.number().optional(),
          },
        },
      },

      checkAuthenticated: {
        path: '/checkAuthenticated',
        method: 'POST',
        validate: {
          payload: {
            ip: Joi.string().required(),
            action: Joi.string().required(),
            uid: Joi.string().required(),
          },
          response: {
            block: Joi.boolean().required(),
            blockReason: Joi.string().optional(),
            retryAfter: Joi.number().optional(),
          },
        },
      },

      checkIpOnly: {
        path: '/checkIpOnly',
        method: 'POST',
        validate: {
          payload: {
            ip: Joi.string().required(),
            action: Joi.string().required(),
          },
          response: {
            block: Joi.boolean().required(),
            blockReason: Joi.string().optional(),
            suspect: Joi.boolean().optional(),
            unblock: Joi.boolean().optional(),
            retryAfter: Joi.number().optional(),
          },
        },
      },

      failedLoginAttempt: {
        path: '/failedLoginAttempt',
        method: 'POST',
        validate: {
          payload: {
            email: Joi.string().required(),
            ip: Joi.string().required(),
            errno: Joi.number().required(),
          },
          response: {},
        },
      },

      passwordReset: {
        path: '/passwordReset',
        method: 'POST',
        validate: {
          payload: {
            email: Joi.string().required(),
          },
          response: {},
        },
      },
    },
    statsd
  );

  // Perform a deep clone of payload and remove user password.
  function sanitizePayload(payload) {
    if (!payload) {
      return;
    }

    const clonePayload = Object.assign({}, payload);

    const fieldsToOmit = ['authPW', 'oldAuthPW', 'paymentToken'];
    for (const name of fieldsToOmit) {
      if (clonePayload[name]) {
        delete clonePayload[name];
      }
    }

    return clonePayload;
  }

  function Customs(url) {
    if (url === 'none') {
      const noblock = async function () {
        return { block: false };
      };
      const noop = async function () {};
      this.api = {
        check: noblock,
        checkAuthenticated: noblock,
        checkIpOnly: noblock,
        failedLoginAttempt: noop,
        passwordReset: noop,
        close: noop,
      };
    } else {
      this.api = new CustomsAPI(url, { timeout: 3000 });
    }
  }

  Customs.prototype.check = async function (request, email, action) {
    const result = await this.api.check({
      ip: request.app.clientAddress,
      email: email,
      action: action,
      headers: request.headers,
      query: request.query,
      payload: sanitizePayload(request.payload),
    });

    optionallyReportStatsD('request.check', action, result);

    return handleCustomsResult(request, result);
  };

  function optionallyReportStatsD(name, action, options = {}) {
    if (statsd) {
      const { block, unblock, suspect, blockReason } = options;

      // The action and block values will always be reported, all others are optional
      const tags = { action, block };

      if (options.unblock !== undefined) {
        tags['unblock'] = unblock;
      }

      if (options.suspect !== undefined) {
        tags['suspect'] = suspect;
      }

      if (options.blockReason !== undefined) {
        tags['blockReason'] = blockReason;
      }

      statsd.increment(`${serviceName}.${name}`, tags);
    }
  }

  // Annotate the request and/or throw an error
  // based on the check result returned by customs-server.
  function handleCustomsResult(request, result) {
    if (result.suspect) {
      request.app.isSuspiciousRequest = true;
    }

    if (result.block) {
      // Log a flow event that the user got blocked.
      request.emitMetricsEvent('customs.blocked');

      const unblock = !!result.unblock;

      if (result.retryAfter) {
        // Create a localized retryAfterLocalized value from retryAfter.
        // For example '713' becomes '12 minutes' in English.
        const retryAfterLocalized = localizeTimestamp.format(
          Date.now() + result.retryAfter * 1000,
          request.headers['accept-language']
        );

        throw error.tooManyRequests(
          result.retryAfter,
          retryAfterLocalized,
          unblock
        );
      }

      throw error.requestBlocked(unblock);
    }
  }

  Customs.prototype.checkAuthenticated = async function (request, uid, action) {
    const result = await this.api.checkAuthenticated({
      action: action,
      ip: request.app.clientAddress,
      uid: uid,
    });

    optionallyReportStatsD('request.checkAuthenticated', action, result);

    return handleCustomsResult(request, result);
  };

  Customs.prototype.checkIpOnly = async function (request, action) {
    const result = await this.api.checkIpOnly({
      ip: request.app.clientAddress,
      action: action,
    });

    optionallyReportStatsD('request.checkIpOnly', action, result);

    return handleCustomsResult(request, result);
  };

  Customs.prototype.flag = async function (ip, info) {
    const email = info.email;
    const errno = info.errno || error.ERRNO.UNEXPECTED_ERROR;
    // There's no useful information in the HTTP response, ignore it.
    await this.api.failedLoginAttempt({
      ip: ip,
      email: email,
      errno: errno,
    });
  };

  Customs.prototype.reset = async function (email) {
    // There's no useful information in the HTTP response, ignore it.
    await this.api.passwordReset({
      email: email,
    });
  };

  Customs.prototype.close = function () {
    return this.api.close();
  };

  return Customs;
};
