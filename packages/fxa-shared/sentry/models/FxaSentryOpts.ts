import { SentryInitializationOpts } from './SentryInitializationOpts';

export type FxaSentryOpts = {
  init: SentryInitializationOpts;
  tags: TagOpts;
  filters: FilterOpts;
};
