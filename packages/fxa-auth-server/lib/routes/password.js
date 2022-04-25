/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

import PASSWORD_DOCS from '../../docs/swagger/password-api';
import DESCRIPTION from '../../docs/swagger/shared/descriptions';

const validators = require('./validators');
const HEX_STRING = validators.HEX_STRING;

const butil = require('../crypto/butil');
const error = require('../error');
const isA = require('@hapi/joi');
const random = require('../crypto/random');
const requestHelper = require('../routes/utils/request_helper');
const { emailsMatch } = require('fxa-shared').email.helpers;

const METRICS_CONTEXT_SCHEMA = require('../metrics/context').schema;

module.exports = function (
  log,
  db,
  Password,
  redirectDomain,
  mailer,
  verifierVersion,
  customs,
  signinUtils,
  push,
  config,
  oauth
) {
  const otpUtils = require('../../lib/routes/utils/otp')(log, config, db);

  function failVerifyAttempt(passwordForgotToken) {
    return passwordForgotToken.failAttempt()
      ? db.deletePasswordForgotToken(passwordForgotToken)
      : db.updatePasswordForgotToken(passwordForgotToken);
  }

  const routes = [
    {
      method: 'POST',
      path: '/password/change/start',
      options: {
        ...PASSWORD_DOCS.PASSWORD_CHANGE_START_POST,
        validate: {
          payload: isA
            .object({
              email: validators
                .email()
                .required()
                .description(DESCRIPTION.email),
              oldAuthPW: validators.authPW.description(DESCRIPTION.authPW),
            })
            .label('Password.changeStart_payload'),
        },
      },
      handler: async function (request) {
        log.begin('Password.changeStart', request);
        const form = request.payload;
        const oldAuthPW = form.oldAuthPW;

        return customs
          .check(request, form.email, 'passwordChange')
          .then(db.accountRecord.bind(db, form.email))
          .then(
            (emailRecord) => {
              const password = new Password(
                oldAuthPW,
                emailRecord.authSalt,
                emailRecord.verifierVersion
              );
              return signinUtils
                .checkPassword(emailRecord, password, request.app.clientAddress)
                .then((match) => {
                  if (!match) {
                    throw error.incorrectPassword(
                      emailRecord.email,
                      form.email
                    );
                  }
                  const password = new Password(
                    oldAuthPW,
                    emailRecord.authSalt,
                    emailRecord.verifierVersion
                  );
                  return password.unwrap(emailRecord.wrapWrapKb);
                })
                .then((wrapKb) => {
                  return db
                    .createKeyFetchToken({
                      uid: emailRecord.uid,
                      kA: emailRecord.kA,
                      wrapKb: wrapKb,
                      emailVerified: emailRecord.emailVerified,
                    })
                    .then((keyFetchToken) => {
                      return db
                        .createPasswordChangeToken({
                          uid: emailRecord.uid,
                        })
                        .then((passwordChangeToken) => {
                          return {
                            keyFetchToken: keyFetchToken,
                            passwordChangeToken: passwordChangeToken,
                          };
                        });
                    });
                });
            },
            (err) => {
              if (err.errno === error.ERRNO.ACCOUNT_UNKNOWN) {
                customs.flag(request.app.clientAddress, {
                  email: form.email,
                  errno: err.errno,
                });
              }
              throw err;
            }
          )
          .then((tokens) => {
            return {
              keyFetchToken: tokens.keyFetchToken.data,
              passwordChangeToken: tokens.passwordChangeToken.data,
              verified: tokens.keyFetchToken.emailVerified,
            };
          });
      },
    },
    {
      method: 'POST',
      path: '/password/change/finish',
      options: {
        ...PASSWORD_DOCS.PASSWORD_CHANGE_FINISH_POST,
        auth: {
          strategy: 'passwordChangeToken',
          payload: 'required',
        },
        validate: {
          query: isA.object({
            keys: isA.boolean().optional().description(DESCRIPTION.queryKeys),
          }),
          payload: isA
            .object({
              authPW: validators.authPW.description(DESCRIPTION.authPW),
              wrapKb: validators.wrapKb.description(DESCRIPTION.wrapKb),
              sessionToken: isA
                .string()
                .min(64)
                .max(64)
                .regex(HEX_STRING)
                .optional()
                .description(DESCRIPTION.sessionToken),
            })
            .label('Password.changeFinish_payload'),
        },
      },
      handler: async function (request) {
        log.begin('Password.changeFinish', request);
        const passwordChangeToken = request.auth.credentials;
        const authPW = request.payload.authPW;
        const wrapKb = request.payload.wrapKb;
        const sessionTokenId = request.payload.sessionToken;
        const wantsKeys = requestHelper.wantsKeys(request);
        const ip = request.app.clientAddress;
        let account,
          verifyHash,
          sessionToken,
          previousSessionToken,
          keyFetchToken,
          verifiedStatus,
          devicesToNotify,
          originatingDeviceId,
          hasTotp = false;

        return checkTotpToken()
          .then(getSessionVerificationStatus)
          .then(fetchDevicesToNotify)
          .then(changePassword)
          .then(notifyAccount)
          .then(createSessionToken)
          .then(verifySessionToken)
          .then(createKeyFetchToken)
          .then(createResponse);

        function checkTotpToken() {
          return otpUtils.hasTotpToken(passwordChangeToken).then((result) => {
            hasTotp = result;

            // Currently, users that have a TOTP token must specify a sessionTokenId to complete the
            // password change process. While the `sessionTokenId` is optional, we require it
            // in the case of TOTP because we want to check that session has been verified
            // by TOTP.
            if (result && !sessionTokenId) {
              throw error.unverifiedSession();
            }
          });
        }

        function getSessionVerificationStatus() {
          if (sessionTokenId) {
            return db.sessionToken(sessionTokenId).then((tokenData) => {
              previousSessionToken = tokenData;
              verifiedStatus = tokenData.tokenVerified;
              if (tokenData.deviceId) {
                originatingDeviceId = tokenData.deviceId;
              }

              if (hasTotp && tokenData.authenticatorAssuranceLevel <= 1) {
                throw error.unverifiedSession();
              }
            });
          } else {
            // Don't create a verified session unless they already had one.
            verifiedStatus = false;
            return Promise.resolve();
          }
        }

        function fetchDevicesToNotify() {
          // We fetch the devices to notify before changePassword() because
          // db.resetAccount() deletes all the devices saved in the account.
          return request.app.devices.then((devices) => {
            devicesToNotify = devices;
            // If the originating sessionToken belongs to a device,
            // do not send the notification to that device. It will
            // get informed about the change via WebChannel message.
            if (originatingDeviceId) {
              devicesToNotify = devicesToNotify.filter(
                (d) => d.id !== originatingDeviceId
              );
            }
          });
        }

        function changePassword() {
          let authSalt, password;
          return random
            .hex(32)
            .then((hex) => {
              authSalt = hex;
              password = new Password(authPW, authSalt, verifierVersion);
              return db.deletePasswordChangeToken(passwordChangeToken);
            })
            .then(() => {
              return password.verifyHash();
            })
            .then((hash) => {
              verifyHash = hash;
              return password.wrap(wrapKb);
            })
            .then((wrapWrapKb) => {
              // Reset account, delete all sessions and tokens
              return db.resetAccount(passwordChangeToken, {
                verifyHash: verifyHash,
                authSalt: authSalt,
                wrapWrapKb: wrapWrapKb,
                verifierVersion: password.version,
                keysHaveChanged: false,
              });
            })
            .then((result) => {
              return request
                .emitMetricsEvent('account.changedPassword', {
                  uid: passwordChangeToken.uid,
                })
                .then(() => {
                  return result;
                });
            });
        }

        function notifyAccount() {
          if (devicesToNotify) {
            // Notify the devices that the account has changed.
            push.notifyPasswordChanged(
              passwordChangeToken.uid,
              devicesToNotify
            );
          }

          return db
            .account(passwordChangeToken.uid)
            .then((accountData) => {
              account = accountData;

              log.notifyAttachedServices('passwordChange', request, {
                uid: passwordChangeToken.uid,
                generation: account.verifierSetAt,
              });
              return oauth.removePublicAndCanGrantTokens(
                passwordChangeToken.uid
              );
            })
            .then(() => {
              return db.accountEmails(passwordChangeToken.uid);
            })
            .then((emails) => {
              const geoData = request.app.geo;
              const {
                browser: uaBrowser,
                browserVersion: uaBrowserVersion,
                os: uaOS,
                osVersion: uaOSVersion,
                deviceType: uaDeviceType,
              } = request.app.ua;

              return mailer
                .sendPasswordChangedEmail(emails, account, {
                  acceptLanguage: request.app.acceptLanguage,
                  ip,
                  location: geoData.location,
                  timeZone: geoData.timeZone,
                  uaBrowser,
                  uaBrowserVersion,
                  uaOS,
                  uaOSVersion,
                  uaDeviceType,
                  uid: passwordChangeToken.uid,
                })
                .catch((e) => {
                  // If we couldn't email them, no big deal. Log
                  // and pretend everything worked.
                  log.trace(
                    'Password.changeFinish.sendPasswordChangedNotification.error',
                    {
                      error: e,
                    }
                  );
                });
            });
        }

        function createSessionToken() {
          return Promise.resolve()
            .then(() => {
              if (!verifiedStatus) {
                return random.hex(16);
              }
            })
            .then((maybeToken) => {
              const {
                browser: uaBrowser,
                browserVersion: uaBrowserVersion,
                os: uaOS,
                osVersion: uaOSVersion,
                deviceType: uaDeviceType,
                formFactor: uaFormFactor,
              } = request.app.ua;

              // Create a sessionToken with the verification status of the current session
              const sessionTokenOptions = {
                uid: account.uid,
                email: account.email,
                emailCode: account.emailCode,
                emailVerified: account.emailVerified,
                verifierSetAt: account.verifierSetAt,
                mustVerify: wantsKeys,
                tokenVerificationId: maybeToken,
                uaBrowser,
                uaBrowserVersion,
                uaOS,
                uaOSVersion,
                uaDeviceType,
                uaFormFactor,
              };

              return db.createSessionToken(sessionTokenOptions);
            })
            .then((result) => {
              sessionToken = result;
            });
        }

        function verifySessionToken() {
          if (
            sessionToken &&
            previousSessionToken &&
            previousSessionToken.verificationMethodValue
          ) {
            return db.verifyTokensWithMethod(
              sessionToken.id,
              previousSessionToken.verificationMethodValue
            );
          }
        }

        function createKeyFetchToken() {
          if (wantsKeys) {
            // Create a verified keyFetchToken. This is deliberately verified because we don't
            // want to perform an email confirmation loop.
            return db
              .createKeyFetchToken({
                uid: account.uid,
                kA: account.kA,
                wrapKb: wrapKb,
                emailVerified: account.emailVerified,
              })
              .then((result) => {
                keyFetchToken = result;
              });
          }
        }

        function createResponse() {
          // If no sessionToken, this could be a legacy client
          // attempting to change password, return legacy response.
          if (!sessionTokenId) {
            return {};
          }

          const response = {
            uid: sessionToken.uid,
            sessionToken: sessionToken.data,
            verified: sessionToken.emailVerified && sessionToken.tokenVerified,
            authAt: sessionToken.lastAuthAt(),
          };

          if (wantsKeys) {
            response.keyFetchToken = keyFetchToken.data;
          }

          return response;
        }
      },
    },
    {
      method: 'POST',
      path: '/password/forgot/send_code',
      options: {
        ...PASSWORD_DOCS.PASSWORD_FORGOT_SEND_CODE_POST,
        validate: {
          query: isA.object({
            service: validators.service.description(DESCRIPTION.serviceRP),
            keys: isA.boolean().optional(),
          }),
          payload: isA
            .object({
              email: validators
                .email()
                .required()
                .description(DESCRIPTION.emailRecovery),
              service: validators.service.description(DESCRIPTION.serviceRP),
              redirectTo: validators
                .redirectTo(redirectDomain)
                .optional()
                .description(DESCRIPTION.redirectTo),
              resume: isA
                .string()
                .max(2048)
                .optional()
                .description(DESCRIPTION.resume),
              metricsContext: METRICS_CONTEXT_SCHEMA,
            })
            .label('Password.forgotSend_payload'),
        },
        response: {
          schema: isA
            .object({
              passwordForgotToken: isA.string(),
              ttl: isA.number(),
              codeLength: isA.number(),
              tries: isA.number(),
            })
            .label('Password.forgotSend_response'),
        },
      },
      handler: async function (request) {
        log.begin('Password.forgotSend', request);
        const email = request.payload.email;
        const service = request.payload.service || request.query.service;
        const ip = request.app.clientAddress;

        request.validateMetricsContext();

        let flowCompleteSignal;
        if (requestHelper.wantsKeys(request)) {
          flowCompleteSignal = 'account.signed';
        } else {
          flowCompleteSignal = 'account.reset';
        }
        request.setMetricsFlowCompleteSignal(flowCompleteSignal);

        const { deviceId, flowId, flowBeginTime } = await request.app
          .metricsContext;

        let passwordForgotToken;

        return Promise.all([
          request.emitMetricsEvent('password.forgot.send_code.start'),
          customs.check(request, email, 'passwordForgotSendCode'),
        ])
          .then(db.accountRecord.bind(db, email))
          .then((accountRecord) => {
            if (
              !emailsMatch(accountRecord.primaryEmail.normalizedEmail, email)
            ) {
              throw error.cannotResetPasswordWithSecondaryEmail();
            }
            // The token constructor sets createdAt from its argument.
            // Clobber the timestamp to prevent prematurely expired tokens.
            accountRecord.createdAt = undefined;
            return db.createPasswordForgotToken(accountRecord);
          })
          .then((result) => {
            passwordForgotToken = result;
            return Promise.all([
              request.stashMetricsContext(passwordForgotToken),
              db.accountEmails(passwordForgotToken.uid),
            ]);
          })
          .then(([_, emails]) => {
            const geoData = request.app.geo;
            const {
              browser: uaBrowser,
              browserVersion: uaBrowserVersion,
              os: uaOS,
              osVersion: uaOSVersion,
              deviceType: uaDeviceType,
            } = request.app.ua;

            return mailer.sendRecoveryEmail(emails, passwordForgotToken, {
              emailToHashWith: passwordForgotToken.email,
              token: passwordForgotToken.data,
              code: passwordForgotToken.passCode,
              service: service,
              redirectTo: request.payload.redirectTo,
              resume: request.payload.resume,
              acceptLanguage: request.app.acceptLanguage,
              deviceId,
              flowId,
              flowBeginTime,
              ip,
              location: geoData.location,
              timeZone: geoData.timeZone,
              uaBrowser,
              uaBrowserVersion,
              uaOS,
              uaOSVersion,
              uaDeviceType,
              uid: passwordForgotToken.uid,
            });
          })
          .then(() =>
            request.emitMetricsEvent('password.forgot.send_code.completed')
          )
          .then(() => ({
            passwordForgotToken: passwordForgotToken.data,
            ttl: passwordForgotToken.ttl(),
            codeLength: passwordForgotToken.passCode.length,
            tries: passwordForgotToken.tries,
          }));
      },
    },
    {
      method: 'POST',
      path: '/password/forgot/resend_code',
      options: {
        ...PASSWORD_DOCS.PASSWORD_FORGOT_RESEND_CODE_POST,
        auth: {
          strategy: 'passwordForgotToken',
          payload: 'required',
        },
        validate: {
          query: isA.object({
            service: validators.service.description(DESCRIPTION.serviceRP),
          }),
          payload: isA
            .object({
              email: validators
                .email()
                .required()
                .description(DESCRIPTION.emailRecovery),
              service: validators.service.description(DESCRIPTION.serviceRP),
              redirectTo: validators
                .redirectTo(redirectDomain)
                .optional()
                .description(DESCRIPTION.redirectTo),
              resume: isA
                .string()
                .max(2048)
                .optional()
                .description(DESCRIPTION.resume),
            })
            .label('Password.forgotResend_payload'),
        },
        response: {
          schema: isA
            .object({
              passwordForgotToken: isA.string(),
              ttl: isA.number(),
              codeLength: isA.number(),
              tries: isA.number(),
            })
            .label('Password.forgotResend_response'),
        },
      },
      handler: async function (request) {
        log.begin('Password.forgotResend', request);
        const passwordForgotToken = request.auth.credentials;
        const service = request.payload.service || request.query.service;
        const ip = request.app.clientAddress;

        const { deviceId, flowId, flowBeginTime } = await request.app
          .metricsContext;

        return Promise.all([
          request.emitMetricsEvent('password.forgot.resend_code.start'),
          customs.check(
            request,
            passwordForgotToken.email,
            'passwordForgotResendCode'
          ),
        ])
          .then(() => {
            return db.accountEmails(passwordForgotToken.uid).then((emails) => {
              const geoData = request.app.geo;
              const {
                browser: uaBrowser,
                browserVersion: uaBrowserVersion,
                os: uaOS,
                osVersion: uaOSVersion,
                deviceType: uaDeviceType,
              } = request.app.ua;

              return mailer.sendRecoveryEmail(emails, passwordForgotToken, {
                code: passwordForgotToken.passCode,
                emailToHashWith: passwordForgotToken.email,
                token: passwordForgotToken.data,
                service,
                redirectTo: request.payload.redirectTo,
                resume: request.payload.resume,
                acceptLanguage: request.app.acceptLanguage,
                deviceId,
                flowId,
                flowBeginTime,
                ip,
                location: geoData.location,
                timeZone: geoData.timeZone,
                uaBrowser,
                uaBrowserVersion,
                uaOS,
                uaOSVersion,
                uaDeviceType,
                uid: passwordForgotToken.uid,
              });
            });
          })
          .then(() => {
            return request.emitMetricsEvent(
              'password.forgot.resend_code.completed'
            );
          })
          .then(() => {
            return {
              passwordForgotToken: passwordForgotToken.data,
              ttl: passwordForgotToken.ttl(),
              codeLength: passwordForgotToken.passCode.length,
              tries: passwordForgotToken.tries,
            };
          });
      },
    },
    {
      method: 'POST',
      path: '/password/forgot/verify_code',
      options: {
        ...PASSWORD_DOCS.PASSWORD_FORGOT_VERIFY_CODE_POST,
        auth: {
          strategy: 'passwordForgotToken',
          payload: 'required',
        },
        validate: {
          payload: isA
            .object({
              code: isA
                .string()
                .min(32)
                .max(32)
                .regex(HEX_STRING)
                .required()
                .description(DESCRIPTION.codeRecovery),
              accountResetWithRecoveryKey: isA.boolean().optional(),
            })
            .label('Password.forgotVerify_payload'),
        },
        response: {
          schema: isA
            .object({
              accountResetToken: isA.string(),
            })
            .label('Password.forgotVerify_response'),
        },
      },
      handler: async function (request) {
        log.begin('Password.forgotVerify', request);
        const passwordForgotToken = request.auth.credentials;
        const code = request.payload.code;
        const accountResetWithRecoveryKey =
          request.payload.accountResetWithRecoveryKey;

        const { deviceId, flowId, flowBeginTime } = await request.app
          .metricsContext;

        let accountResetToken;

        return Promise.all([
          request.emitMetricsEvent('password.forgot.verify_code.start'),
          customs.check(
            request,
            passwordForgotToken.email,
            'passwordForgotVerifyCode'
          ),
        ])
          .then(() => {
            if (
              butil.buffersAreEqual(passwordForgotToken.passCode, code) &&
              passwordForgotToken.ttl() > 0
            ) {
              return db.forgotPasswordVerified(passwordForgotToken);
            }

            return failVerifyAttempt(passwordForgotToken).then(() => {
              throw error.invalidVerificationCode({
                tries: passwordForgotToken.tries,
                ttl: passwordForgotToken.ttl(),
              });
            });
          })
          .then((result) => {
            accountResetToken = result;
            return Promise.all([
              request.propagateMetricsContext(
                passwordForgotToken,
                accountResetToken
              ),
              db.accountEmails(passwordForgotToken.uid),
            ]);
          })
          .then(([_, emails]) => {
            if (accountResetWithRecoveryKey) {
              // To prevent multiple password change emails being sent to a user,
              // we check for a flag to see if this is a reset using an account recovery key.
              // If it is, then the notification email will be sent in `/account/reset`
              return Promise.resolve();
            }

            return mailer.sendPasswordResetEmail(emails, passwordForgotToken, {
              code,
              acceptLanguage: request.app.acceptLanguage,
              deviceId,
              flowId,
              flowBeginTime,
              uid: passwordForgotToken.uid,
            });
          })
          .then(() =>
            request.emitMetricsEvent('password.forgot.verify_code.completed')
          )
          .then(() => ({
            accountResetToken: accountResetToken.data,
          }));
      },
    },
    {
      method: 'GET',
      path: '/password/forgot/status',
      options: {
        ...PASSWORD_DOCS.PASSWORD_FORGOT_STATUS_GET,
        auth: {
          strategy: 'passwordForgotToken',
        },
        response: {
          schema: isA
            .object({
              tries: isA.number(),
              ttl: isA.number(),
            })
            .label('Password.forgotStatus_response'),
        },
      },
      handler: async function (request) {
        log.begin('Password.forgotStatus', request);
        const passwordForgotToken = request.auth.credentials;
        return {
          tries: passwordForgotToken.tries,
          ttl: passwordForgotToken.ttl(),
        };
      },
    },
  ];

  return routes;
};
