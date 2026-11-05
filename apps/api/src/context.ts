import type { Config } from './config.js';
import type { PaymentProvider } from './payments/types.js';
import type { SessionService } from './sessions/service.js';

export interface AppContext {
  config: Config;
  payment: PaymentProvider;
  sessions: SessionService;
  isAllowedReturnUrl: (url: string) => boolean;
}
