/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Exception, Event as BrowserEvent } from '@sentry/browser';
import { Event } from '@sentry/types';
import { FilterOpts } from './models/FilterOpts';
import { Transform } from './models/Transform';

// Note: Not RFC compliant but generally accepted, as per w3c, https://www.w3.org/TR/2012/WD-html-markup-20120329/input.email.html.
export const EMAIL_REGEX =
  /[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*/gi;
export const TOKENREGEX = /[a-fA-F0-9]{32,}/gi;
export const FILTERED = '[Filtered]';
export const URIENCODEDFILTERED = encodeURIComponent(FILTERED);

export function filterSentryEvent(
  event: Event | BrowserEvent,
  opts: Partial<FilterOpts>
) {
  if (
    event == undefined ||
    (opts.ignoreKnownErrors && Number.isInteger(event.tags?.errno))
  ) {
    // if the 'errno' is a Number, then it is a known error.
    // In the future this could log the errors into StatsD or somewhere else.
    // See https://github.com/mozilla/fxa/issues/2298 for details.
    return null;
  }

  removeRequestData(event, opts);
  limitStackTrace(event, opts);
  sanitizeQueryParams(event, opts);
  sanitizePII(event, opts);

  return event;
}

function removeRequestData(event: Event, opts: Partial<FilterOpts>) {
  if (opts.requestData && event?.request?.data) {
    delete event.request?.data;
  }
}

function sanitizePII(event: Event, opts: Partial<FilterOpts>) {
  let filters = [
    opts.tokens ? (x: string) => x.replace(TOKENREGEX, FILTERED) : null,
    opts.emails ? (x: string) => x.replace(EMAIL_REGEX, FILTERED) : null,
  ];

  event.message = filterObject(event.message, 0, 2, filters);
  event.breadcrumbs = filterObject(event.breadcrumbs, 0, 4, filters);

  if (event.tags) {
    event.tags.url = filterObject(event.tags?.url, 0, 2, filters);
  }

  if (event.request) {
    event.request.url = filterObject(event.request.url, 0, 2, filters);
    event.request.headers = filterObject(event.request.headers, 0, 2, filters);

    // Use URI Encoded replacement for query string
    filters = [
      opts.tokens
        ? (x: string) => x.replace(TOKENREGEX, URIENCODEDFILTERED)
        : null,
      opts.emails
        ? (x: string) => x.replace(EMAIL_REGEX, URIENCODEDFILTERED)
        : null,
    ];
    event.request.query_string = filterObject(
      event.request.query_string,
      0,
      3,
      filters
    );
  }
}

function sanitizeQueryParams(event: Event, opts: Partial<FilterOpts>) {
  if (opts.allowedQueryParams) {
    if (event.request?.url) {
      event.request.url = filterQueryParams(
        event.request.url,
        opts.allowedQueryParams
      );
    }
    if (event.request?.headers?.Referer) {
      event.request.headers.Referer = filterQueryParams(
        event.request.headers.Referer,
        opts.allowedQueryParams
      );
    }
    event.exception?.values?.forEach((exp) => {
      exp?.stacktrace?.frames?.forEach((frame) => {
        if (frame.abs_path) {
          frame.abs_path = filterQueryParams(
            frame.abs_path,
            opts.allowedQueryParams
          );
        }
      });
    });
  }
}

function limitStackTrace(event: Event, opts: Partial<FilterOpts>) {
  if (opts.stackTraceLimit && event.exception) {
    event.exception.values?.forEach((x: Exception) => {
      if (x?.stacktrace?.frames?.length) {
        x.stacktrace.frames.length =
          opts.stackTraceLimit || x.stacktrace.frames.length;
      }
    });
  }
}

export function filterObject(
  obj: any | undefined,
  depth: number,
  maxDepth: number,
  filters: Array<Transform>
) {
  if (obj == undefined || depth > maxDepth || filters.length == 0) {
    // no-op
  } else if (typeof obj === 'string') {
    console.log('before filters', obj);
    filters.forEach((x) => {
      if (x) {
        obj = x(obj);
      }
    });
  } else if (typeof obj === 'object') {
    depth++;
    for (const key of Object.keys(obj)) {
      console.log('working on ', key, obj[key]);
      obj[key] = filterObject(obj[key], depth, maxDepth, filters);
      console.log('resulted in ', key, obj[key]);
    }
  }
  return obj;
}

export function filterQueryParams(
  url: string,
  allowedQueryParameters?: string[]
) {
  if (!allowedQueryParameters || allowedQueryParameters.length === 0) {
    return url;
  }

  const startOfParams = url.indexOf('?');
  if (startOfParams === -1) {
    return url;
  }

  const params = new URLSearchParams(url.substring(startOfParams + 1));

  for (const key of params.keys()) {
    // if the param is a PII (not allowed) then reset the value.
    if (!allowedQueryParameters.includes(key)) {
      params.set(key, 'VALUE');
    }
  }

  return url.substring(0, startOfParams + 1) + params.toString();
}
