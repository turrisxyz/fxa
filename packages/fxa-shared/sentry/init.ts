import { Event } from '@sentry/types';
import { FxaSentryOpts } from './models/FxaSentryOpts';
import { tagSentryEvent } from './tag';
import { filterSentryEvent } from './filter';
import { defaultTagOpts, TagOpts } from './models/TagOpts';
import { defaultFilterOpts, FilterOpts } from './models/FilterOpts';

export class FxaSentry {
  protected constructor(protected readonly opts: FxaSentryOpts) {
    this.checkOpts();
  }

  protected checkOpts() {
    if (!this.opts.init.release) {
      throw new Error('release not set');
    }
    if (!this.opts.init.environment) {
      throw new Error('environment not set');
    }
    if (!this.opts.init.name) {
      throw new Error('name not set');
    }
  }

  public beforeSend(event: any) {
    event = this.filter(event, this.opts.filters);
    event = this.tag(event, this.opts.tags);
    return event;
  }

  protected tag(event: Event, opts: TagOpts) {
    return tagSentryEvent(event, Object.assign({}, defaultTagOpts, opts));
  }

  protected filter(event: Event, opts: FilterOpts) {
    return filterSentryEvent(event, Object.assign({}, defaultFilterOpts, opts));
  }
}
