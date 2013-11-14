/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var Hoek = require('hapi').utils;
var Boom = require('hapi').error

var DEFAULTS = {
  message: 'Unspecified error',
  info: 'https://github.com/mozilla/picl-idp/blob/master/docs/api.md#response-format'
}

var TOO_LARGE = /^Payload (?:content length|size) greater than maximum allowed/

// Wrap an object into a Boom error response.
//
// If the object does not have an 'errno' attribute, this function
// tries to intuit the appropriate details of the error.  It's ugly
// but it's better than monkey-patching e.g. the Hawk auth lib to
// send errors in the desired format.
//
// If the object does not have a 'code' attribute, this function determines
// the appropriate HTTP status code based on its 'errno' attribute.

Boom.wrap = function (srcObject) {
  // Merge object properties with defaults.
  // The source object might be an Error instance whose 'message' property
  // is non-enumerable, so we have to special-case that one.
  var object = Hoek.applyToDefaults(DEFAULTS, srcObject)
  if (srcObject.hasOwnProperty('message')) {
    object.message = srcObject.message
  }

  // Intuit an errno for the error, if it doesn't have one.
  if (typeof object.errno === 'undefined') {
    if (object.code === 401) {
      // These are common errors generated by Hawk auth lib.
      if (object.message === 'Unknown credentials') {
        object = Boom.invalidToken().response.payload
      } else if (object.message === 'Invalid credentials') {
        object = Boom.invalidToken().response.payload
      } else if (object.message === 'Stale timestamp') {
        object = Boom.invalidTimestamp().response.payload
      } else if (object.message === 'Invalid nonce') {
        object = Boom.invalidNonce().response.payload
      } else {
        object = Boom.invalidSignature().response.payload
      }
    }
    else if (object.code === 400) {
      if (TOO_LARGE.test(object.message)) {
        object = Boom.requestBodyTooLarge().response.payload
      }
    }
  }

  // Intuit a status code for the error, if it doesn't have one.
  if (typeof object.code === 'undefined') {
    if ([109, 110, 111].indexOf(object.errno) !== -1) {
      object.code = 401
    } else {
      object.code = 400
    }
  }

  // If we weren't able to identify a specific type of error,
  // default to a generic "unspecified error" response.
  if (typeof object.errno === 'undefined') {
    object.errno = 999;
  }

  // Now we can safely boomify it.
  var b = new Boom(object.code, object.message)
  Hoek.merge(b.response.payload, object);
  return b
}


// Helper functions for creating particular response types.

Boom.accountExists = function (email) {
  return Boom.wrap({
    code: 400,
    errno: 101,
    message: 'Account already exists',
    email: email
  })
}

Boom.unknownAccount = function (email) {
  return Boom.wrap({
    code: 400,
    errno: 102,
    message: 'Unknown account',
    email: email
  })
}

Boom.incorrectPassword = function () {
  return Boom.wrap({
    code: 400,
    errno: 103,
    message: 'Incorrect password'
  })
}

Boom.unverifiedAccount = function () {
  return Boom.wrap({
    code: 400,
    errno: 104,
    message: 'Unverified account'
  })
}

Boom.invalidVerificationCode = function (details) {
  return Boom.wrap(Hoek.merge({
    code: 400,
    errno: 105,
    message: 'Invalid verification code'
  }, details));
}

Boom.invalidRequestBody = function () {
  return Boom.wrap({
    code: 400,
    errno: 106,
    message: 'Invalid JSON in request body'
  })
}

Boom.invalidRequestParameter = function (param) {
  return Boom.wrap({
    code: 400,
    errno: 107,
    message: 'Invalid parameter in request body' + (param ? ': ' + param : ''),
    param: param
  })
}

Boom.missingRequestParameter = function (param) {
  return Boom.wrap({
    code: 400,
    errno: 108,
    message: 'Missing parameter in request body' + (param ? ': ' + param : ''),
    param: param
  })
}

Boom.invalidSignature = function () {
  return Boom.wrap({
    code: 401,
    errno: 109,
    message: 'Invalid request signature'
  })
}

Boom.invalidToken = function () {
  return Boom.wrap({
    code: 401,
    errno: 110,
    message: 'Invalid authentication token in request signature'
  })
}

Boom.invalidTimestamp = function () {
  return Boom.wrap({
    code: 401,
    errno: 111,
    message: 'Invalid timestamp in request signature',
    serverTime: Math.floor(+new Date() / 1000)
  })
}

Boom.invalidNonce = function () {
  return Boom.wrap({
    code: 401,
    errno: 115,
    message: 'Invalid nonce in request signature'
  })
}

Boom.missingContentLength = function () {
  return Boom.wrap({
    code: 411,
    errno: 112,
    message: 'Missing content-length header'
  })
}

Boom.requestBodyTooLarge = function () {
  return Boom.wrap({
    code: 413,
    errno: 113,
    message: 'Request body too large'
  })
}

Boom.tooManyRequests = function () {
  return Boom.wrap({
    code: 429,
    errno: 114,
    message: 'Client has sent too many requests'
  })
}

Boom.serviceUnavailable = function () {
  return Boom.wrap({
    code: 503,
    errno: 201,
    message: 'Service unavailable'
  })
}

module.exports = Boom
