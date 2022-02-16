import { init, Integrations, configureScope, Handlers } from '@sentry/node';
import { ExtraErrorData } from '@sentry/integrations';
import { FxaSentry } from './init';
import { captureException } from '@sentry/browser';
import { FxaSentryOpts } from './models/FxaSentryOpts';

// Note take from auth server, will be used univerally now
export const extraDefaults = {
  normalizeDepth: 6,
  integrations: [
    new Integrations.LinkedErrors({ key: 'jse_cause' }),
    new ExtraErrorData({ depth: 5 }),
  ],
  // https://docs.sentry.io/platforms/node/configuration/options/#max-value-length
  maxValueLength: 500,
};

export class FxaSentryForNode extends FxaSentry {
  public static init(opts: FxaSentryOpts) {
    new FxaSentryForNode(opts);
  }

  public static get Handlers() {
    return Handlers;
  }

  public static setProcessScope(processName: string) {
    configureScope((scope) => {
      scope.setTag('process', processName);
    });
  }

  public static captureErr(err: any) {
    let exception = '';
    if (err && err.stack) {
      try {
        exception = err.stack.split('\n')[0];
      } catch (e) {
        // ignore bad stack frames
      }
    }

    captureException(err, {
      extra: {
        exception,
      },
    });
  }

  private constructor(opts: FxaSentryOpts) {
    super(opts);
    if (opts.init.dsn) {
      init({
        ...opts.init,
        ...extraDefaults,
        beforeSend: this.beforeSend,
      });
    }
  }
}
