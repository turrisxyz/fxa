import { ILogger } from '../log';
import { SentryConfigOpts } from './models/SentryConfigOpts';

const sentryEnvMap: Record<string, string> = {
  test: 'test',
  local: 'dev',
  dev: 'dev',
  ci: 'ci',
  stage: 'stage',
  prod: 'prod',
  production: 'prod',
  development: 'dev',
};

function toEnv(val: any) {
  if (typeof val === 'string') {
    return sentryEnvMap[val];
  }
  return '';
}

export function buildSentryConfig(config: SentryConfigOpts, log: ILogger) {
  if (log) {
    checkSentryConfig(config, log);
  }

  const opts = {
    dsn: config.sentry.dsn,
    release: config.release || config.version,
    environment: toEnv(config.sentry.env),
    sampleRate: config.sentry.sampleRate,
    tracesSampleRate: config.sentry.tracesSampleRate,
    clientName: config.sentry.clientName,
    serverName: config.sentry.serverName,
    fxaName: config.sentry.clientName || config.sentry.serverName,
    // Experimental
    tracingOrigins: ['localhost', '*.mozaws.net'],
  };

  return opts;
}

function checkSentryConfig(config: SentryConfigOpts, log: ILogger) {
  if (!config || !config.sentry || !config.sentry?.dsn) {
    log?.info(
      'sentry-config-builder',
      'config missing: sentry.dsn. sentry disabled.'
    );
    return;
  }

  log?.info('sentry-config-builder', 'sentry.dsn specified. sentry enabled!');

  if (!config.sentry.env) {
    raiseError('config missing either environment or env.');
  } else if (!toEnv(config.sentry.env)) {
    raiseError(
      `invalid config.env. ${config.sentry.env} options are: ${Object.keys(
        sentryEnvMap
      ).join(',')}`
    );
  } else {
    log?.info(
      'sentry-config-builder',
      'sentry targeting: ' + sentryEnvMap[config.sentry.env]
    );
  }

  if (!config.release && !config.version) {
    raiseError('config missing either release or version.');
  }

  if (!config.sentry?.sampleRate) {
    raiseError('config missing sentry.sampleRate');
  }
  if (!config.sentry?.tracesSampleRate) {
    raiseError('config missing sentry.tracesSampleRate');
  }
  if (!config.sentry.clientName && !config.sentry.serverName) {
    raiseError('config missing either sentry.clientName or sentry.serverName');
  }

  function raiseError(msg: string) {
    log?.warn('sentry-config-builder', msg);
    if (config.sentry?.strict) {
      throw new SentryConfigurationBuildError(msg);
    }
  }
}

class SentryConfigurationBuildError extends Error {}
