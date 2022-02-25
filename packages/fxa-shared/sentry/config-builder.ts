import { ILogger } from '../log';
import { SentryConfigOpts } from './models/SentryConfigOpts';

const validSentryEnvs = ['local', 'test', 'ci', 'dev', 'stage', 'prod'];

export function buildSentryConfig(config: SentryConfigOpts, log: ILogger) {
  if (log) {
    checkSentryConfig(config, log);
  }

  const opts = {
    dsn: config.sentry.dsn,
    release: config.release || config.version,
    environment: config.sentry.env,
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
  if (!config.sentry?.dsn) {
    raiseError('config missing sentry.dsn.');
  } else {
    log.info('sentry enabled!');
  }

  if (!config.env) {
    raiseError('config missing either environment or env.');
  } else if (!(config.env in validSentryEnvs)) {
    raiseError('invalid config.env. options are: ' + validSentryEnvs.join(','));
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
    log.error(msg);
    if (config.sentry.strict) {
      throw new SentryConfigurationBuildError(msg);
    }
  }
}

class SentryConfigurationBuildError extends Error {}
