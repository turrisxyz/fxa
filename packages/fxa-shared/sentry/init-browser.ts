import * as Sentry from '@sentry/browser';
import { FilterOpts, TagOpts, SentryInitializationOpts } from '.';
import { FxaSentry } from './init';
import { FxaSentryOpts } from './models/FxaSentryOpts';

export class FxaSentryForBrowser extends FxaSentry {
  public static init(opts: FxaSentryOpts) {
    return new FxaSentryForBrowser(opts);
  }

  private constructor(opts: FxaSentryOpts) {
    super(opts);
    if (opts.init.dsn) {
      Sentry.init({
        ...opts.init,
        beforeSend: this.beforeSend,
      });
    }
  }
}
