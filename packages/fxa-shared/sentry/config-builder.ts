import { ILogger } from '../log';
import { SentryConfigOpts } from './models/SentryConfigOpts';

export function buildSentryConfig(config: SentryConfigOpts, log: ILogger) {
  if (log) {
    checkSentryConfig(config, log);
  }

  const opts = {
    dsn: config.sentry.dsn,
    release: config.release || config.version,
    environment: config.env || config.environment,
    sampleRate: config.sentry.sampleRate,
    tracesSampleRate: config.sentry.tracesSampleRate,
    clientName: config.sentry.clientName,
    serverName: config.sentry.serverName,
    // Experimental
    tracingOrigins: ['localhost', '*.mozaws.net'],
  };

  return opts;
}

function checkSentryConfig(config: SentryConfigOpts, log: ILogger) {
  if (!config.env && !config.environment) {
    log.error('config missing either environment or env.');
  }
  if (!config.release && !config.version) {
    log.error('config missing either release or version.');
  }

  if (!config.sentry?.dsn) {
    log.error('config missing sentry.dsn.');
    throw new Error('Missing sentry dsn!!');
  } else {
    log.trace('config for sentry.dsn proivded. sentry enabled!');
  }

  if (!config.sentry?.sampleRate) {
    log.error('config missing sentry.sampleRate');
  }
  if (!config.sentry?.tracesSampleRate) {
    log.error('config missing sentry.tracesSampleRate');
  }
  if (!config.sentry.clientName && !config.sentry.serverName) {
    log.error('config missing either sentry.clientName or sentry.serverName');
  }
}
