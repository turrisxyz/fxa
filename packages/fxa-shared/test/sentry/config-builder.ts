import { assert } from 'chai';
import { buildSentryConfig, SentryConfigOpts } from '../../sentry';
import Sinon, { SinonSpiedInstance } from 'sinon';
import { ILogger } from '../../log';

describe('config-builder', () => {
  const emptyLogger: ILogger = {
    info: function (...args: any): void {},
    trace: function (...args: any): void {},
    warn: function (...args: any): void {},
    error: function (...args: any): void {},
    debug: function (...args: any): void {},
  };
  let loggerSpy: SinonSpiedInstance<ILogger>;

  beforeEach(() => {
    loggerSpy = Sinon.spy(emptyLogger);
  });
  afterEach(() => {
    loggerSpy;
  });

  const testConfig: SentryConfigOpts = {
    release: '1.0.1',
    version: '1.0.2',
    sentry: {
      dsn: 'https://foo.sentry.io',
      env: 'test',
      sampleRate: 1,
      tracesSampleRate: 1,
      serverName: 'fxa-shared-test',
      clientName: 'fxa-shared-client-test',
    },
  };

  it('builds', () => {
    const config = buildSentryConfig(testConfig, console);
    assert.exists(config);
  });

  it('picks correct defaults', () => {
    const config = buildSentryConfig(testConfig, console);
    assert.equal(config.environment, testConfig.sentry.env);
    assert.equal(config.release, testConfig.release);
    assert.equal(config.fxaName, testConfig.sentry.clientName);
  });

  it('falls back', () => {
    const clone = Object.assign({}, testConfig);
    delete clone.sentry.clientName;
    delete clone.release;

    const config = buildSentryConfig(clone, console);

    assert.equal(config.release, testConfig.version);
    assert.equal(config.fxaName, testConfig.sentry.serverName);
  });

  it('warns about missing config', () => {
    const clone = Object.assign({}, testConfig);
    clone.sentry.dsn = '';

    const config = buildSentryConfig(clone, console);
  });

  it('errors on missing dsn', () => {
    const clone = Object.assign({}, testConfig);
    clone.sentry.strict = true;
    clone.sentry.dsn = '';

    assert.throws(() => {
      buildSentryConfig(clone, console);
    }, 'config missing sentry.dsn.');
  });

  it('errors on bad environment', () => {
    const clone = Object.assign({}, testConfig);
    clone.sentry.strict = true;
    clone.sentry.env = 'xyz';

    assert.throws(() => {
      buildSentryConfig(clone, console);
    }, 'config missing either environment or env.');
  });

  it('errors on missing release', () => {
    const clone = Object.assign({}, testConfig);
    clone.sentry.strict = true;
    delete clone.release;
    delete clone.version;

    assert.throws(() => {
      buildSentryConfig(clone, console);
    }, 'config missing either release or version.');
  });

  it('errors on missing sampleRate', () => {
    const clone = Object.assign({}, testConfig);
    clone.sentry.strict = true;
    delete clone.sentry.sampleRate;

    assert.throws(() => {
      buildSentryConfig(clone, console);
    }, 'sentry.sampleRate');
  });

  it('can use mozlogger', () => {
    const mozlog = require('mozlog')({
      app: 'fxa-shared-test',
      level: 'trace',
    });
    const logger = mozlog.logger('fxa-shared-testing');
    const config = buildSentryConfig(testConfig, logger);

    assert.exists(config);
  });

  it('can use console logger', () => {
    const config = buildSentryConfig(testConfig, console);
    assert.exists(config);
  });
});
