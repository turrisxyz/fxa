export type SentryConfigOpts = {
  env?: string;
  environment?: string;
  release?: string;
  version?: string;
  sentry: {
    dsn: string;
    sampleRate: number;
    tracesSampleRate: number;
    clientName?: string;
    serverName?: string;
  };
};
