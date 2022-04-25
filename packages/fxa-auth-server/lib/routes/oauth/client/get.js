/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import MISC_DOCS from '../../../../docs/swagger/misc-api';

const hex = require('buf').to.hex;
const Joi = require('@hapi/joi');

const AppError = require('../../../oauth/error');
const validators = require('../../../oauth/validators');

module.exports = ({ log, oauthDB }) => ({
  method: 'GET',
  path: '/client/{client_id}',
  config: {
    ...MISC_DOCS.CLIENT_CLIENTID_GET,
    cors: { origin: 'ignore' },
    validate: {
      params: {
        client_id: validators.clientId.required(),
      },
    },
    response: {
      schema: Joi.object({
        id: validators.clientId,
        name: Joi.string().required(),
        trusted: Joi.boolean().required(),
        image_uri: Joi.any(),
        redirect_uri: Joi.string().required().allow(''),
      }).label('Oauth.clientId_response'),
    },
    handler: async function requestInfoEndpoint(req) {
      const params = req.params;

      return oauthDB
        .getClient(Buffer.from(params.client_id, 'hex'))
        .then(function (client) {
          if (!client) {
            log.debug('notFound', { id: params.client_id });
            throw AppError.unknownClient(params.client_id);
          } else {
            return {
              id: hex(client.id),
              name: client.name,
              trusted: client.trusted,
              image_uri: client.imageUri,
              redirect_uri: client.redirectUri,
            };
          }
        });
    },
  },
});
