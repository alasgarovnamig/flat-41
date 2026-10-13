import type { Provider } from '@nestjs/common';
import { config } from '../../../config';
import { MockBankProvider } from './mockbank.provider';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider';

export * from './payment-provider';

/** Registry of available acquirers. Adding a real bank = one class + one line here + PAYMENT_PROVIDER env. */
const FACTORIES: Record<string, () => PaymentProvider> = {
  mockbank: () => new MockBankProvider(config.payments.mockbank),
};

export const createPaymentProvider = (name = config.payments.provider): PaymentProvider => {
  const factory = FACTORIES[name];
  if (!factory) throw new Error(`Unknown PAYMENT_PROVIDER "${name}". Available: ${Object.keys(FACTORIES).join(', ')}`);
  return factory();
};

export const paymentProviderProvider: Provider = { provide: PAYMENT_PROVIDER, useFactory: () => createPaymentProvider() };
