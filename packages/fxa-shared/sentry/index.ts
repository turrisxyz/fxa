export * from './tag';
export * from './config-builder';
export * from './models/SentryConfigOpts';

import Sentry from '@sentry/node';

/** Minimal type containing validation error fields that are used by routines. */
export type ValidationError = {
  details: {
    message: string;
    path: string[];
    type: string;
  }[];
};

/**
 * Format a Stripe product/plan metadata validation error message for
 * Sentry to include as much detail as possible about what metadata
 * failed validation and in what way.
 *
 * @param {string} planId
 * @param {string | import('@hapi/joi').ValidationError} error
 */
export function formatMetadataValidationErrorMessage(
  planId: string,
  error: ValidationError
) {
  let msg = `${planId} metadata invalid:`;
  if (typeof error === 'string') {
    msg = `${msg} ${error}`;
  } else {
    msg = `${msg}${error.details
      .map(({ message }) => ` ${message};`)
      .join('')}`;
  }
  return msg;
}

/**
 * Report a validation error to Sentry with validation details.
 *
 * @param {*} message
 * @param {string | import('@hapi/joi').ValidationError} error
 */
export function reportValidationError(
  message: any,
  error: ValidationError | string
) {
  const details: any = {};
  if (typeof error === 'string') {
    details.error = error;
  } else {
    for (const errorItem of error.details) {
      const key = errorItem.path.join('.');
      details[key] = {
        message: errorItem.message,
        type: errorItem.type,
      };
    }
  }

  Sentry.withScope((scope) => {
    scope.setContext('validationError', details);
    Sentry.captureMessage(message, Sentry.Severity.Error);
  });
}
