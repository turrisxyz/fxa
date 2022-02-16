/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert } from 'chai';
import { Event } from '@sentry/types';
import { setTag, filterObject, filterAndTag } from '../../sentry';

describe('filter object', () => {
  it('filters object', () => {
    let obj: any = {
      test: {
        value: 'target',
      },
    };

    filterObject(obj, 0, 2, [
      (x: string) => x.replace('target', 'test-target'),
    ]);

    assert.equal(obj.test.value, 'test-target');
  });

  it('filters string', () => {
    let obj: any = 'target';

    obj = filterObject(obj, 0, 2, [
      (x: string) => x.replace('target', 'test-target'),
    ]);

    assert.equal(obj, 'test-target');
  });

  it('applies multiple filters', () => {
    const obj: any = {
      test: {
        value: 'target',
      },
      test2: {
        value: 'target',
      },
    };

    filterObject(obj, 0, 2, [
      (x: string) => x.replace('target', 'test-target'),
      (x: string) => x.replace('target', 'test-target'),
    ]);

    assert.equal(obj.test.value, 'test-test-target');
    assert.equal(obj.test2.value, 'test-test-target');
  });

  it('stops at max depth', () => {
    let obj: any = {
      test: {
        test: {
          value: 'target',
        },
      },
    };

    filterObject(obj, 0, 1, [
      (x: string) => x.replace('target', 'test-target'),
    ]);

    assert.equal(obj.test.test.value, 'target');
  });

  it('handles arrays', () => {
    let obj: any = {
      test: {
        test: ['target-1', 'target-2'],
        test2: {
          test: ['target-3'],
        },
      },
    };

    filterObject(obj, 0, 4, [
      (x: string) => x.replace('target', 'test-target'),
    ]);

    assert.deepEqual(obj, {
      test: {
        test: ['test-target-1', 'test-target-2'],
        test2: {
          test: ['test-target-3'],
        },
      },
    });
  });
});

describe('set tags', () => {
  const eventKey = 'fxa.test';

  it('adds tag to applicable event', () => {
    let data: any = {};
    data = setTag(data, eventKey, 'test');

    assert.equal(data.tags?.[eventKey], 'test');
  });

  it('handles empty event', () => {
    let data: any = undefined;
    data = setTag(data, eventKey, 'test');

    assert.equal(data?.tags?.[eventKey], 'test');
  });

  it('handles undefined value', () => {
    let data: any = {};
    let test: any = undefined;
    data = setTag(data, eventKey, test);
    assert.equal(data?.tags?.[eventKey], undefined);
  });
});

describe('before send', () => {
  it('adds critical tag to applicable event', () => {
    let data: Event = {
      request: {
        url: 'https://example.com/a/123',
      },
    };
    data = filterAndTag(data);

    assert.equal(data.tags?.['fxa.endpoint.type'], 'critical');
  });

  it('does not add critical tag to no applicable event', () => {
    let data: Event = {
      request: {
        url: 'https://example.com/a-non-critical-endpoint',
      },
    };
    data = filterAndTag(data);

    assert.notExists(data.tags?.['fxa.endpoint.importance']);
  });

  it('handles empty event', () => {
    let data: Event = {};
    data = filterAndTag(data);

    assert.notExists(data?.tags?.['fxa.endpoint.importance']);
  });

  it('handles empty url', () => {
    let data: Event = {
      request: {
        url: undefined,
      },
    };
    data = filterAndTag(data);

    assert.notExists(data.tags?.['fxa.endpoint.importance']);
  });

  it('removes request data', () => {
    let data: Event = {
      request: {
        data: {
          foo: 'bar',
        },
      },
    };
    data = filterAndTag(data);

    assert.notExists(data.request?.data);
  });

  it('santizes query params', () => {
    let data: Event = {
      request: {
        url: 'http://localhost/app?baz=1&biz=2',
        headers: {
          Referer: 'http://foo.com/app?baz=1&biz=2',
        },
      },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  abs_path: 'node_modules/something.js',
                },
                {
                  abs_path: 'node_modules/something.js?foo=1&bar=2',
                },
              ],
            },
          },
        ],
      },
    };

    data = filterAndTag(data, undefined, {
      filters: {
        allowedQueryParams: ['baz'],
      },
    });

    assert.equal(data.request?.url, 'http://localhost/app?baz=1&biz=VALUE');
    assert.equal(
      data.request?.headers?.Referer,
      'http://foo.com/app?baz=1&biz=VALUE'
    );
    assert.equal(
      data.exception?.values?.[0].stacktrace?.frames?.[1].abs_path,
      'node_modules/something.js?foo=VALUE&bar=VALUE'
    );
  });

  it('limits stack frames', () => {
    let data: Event = {
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  abs_path: 'node_modules/something.js',
                },
                {
                  abs_path: 'node_modules/something.js?foo=1&bar=2',
                },
              ],
            },
          },
        ],
      },
    };

    filterAndTag(data, undefined, {
      filters: {
        stackTraceLimit: 1,
      },
    });

    assert.deepEqual(data.exception?.values?.[0].stacktrace?.frames, [
      {
        abs_path: 'node_modules/something.js',
      },
    ]);
  });

  it('scrubs PII', () => {
    let data: Event = {
      message: 'foo@bar.com is testing',
      breadcrumbs: [
        {
          message:
            'some token 12345678123456781234567812345678 for foo@bar.com',
          data: {
            test: 'foo@bar.com is testing',
          },
        },
      ],
      tags: {
        url: 'http://foo.com/app?id=12345678123456781234567812345678',
      },
      request: {
        url: 'http://foo.com/app?id=12345678123456781234567812345678',
        headers: {
          id: '12345678123456781234567812345678',
          email: 'foo@bar.com',
        },
        query_string: {
          id: '12345678123456781234567812345678',
          email: 'foo@bar.com',
        },
      },
    };

    data = filterAndTag(data, undefined, {});

    assert.deepEqual(data, {
      message: '[Filtered] is testing',
      breadcrumbs: [
        {
          message: 'some token [Filtered] for [Filtered]',
          data: {
            test: '[Filtered] is testing',
          },
        },
      ],
      tags: {
        url: 'http://foo.com/app?id=[Filtered]',
      },
      request: {
        url: 'http://foo.com/app?id=[Filtered]',
        headers: {
          id: '[Filtered]',
          email: '[Filtered]',
        },
        query_string: {
          id: '%5BFiltered%5D',
          email: '%5BFiltered%5D',
        },
      },
    });
  });
});
