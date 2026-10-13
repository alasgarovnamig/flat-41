import { Module } from '@nestjs/common';
import { PromotionsModule } from '../promotions/promotions.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { CheckoutService } from './checkout.service';
import { ListingFulfilment } from './listing-fulfilment';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { paymentProviderProvider, PAYMENT_PROVIDER } from './providers';

/**
 * Payments engine + checkout + bank webhooks. Subscriptions and bookings import this module and register
 * their purpose handlers via `PaymentsService.registerHandler` (no circular imports).
 */
@Module({
  imports: [WalletModule, PromotionsModule],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [paymentProviderProvider, PaymentsService, CheckoutService, ListingFulfilment],
  exports: [PaymentsService, PAYMENT_PROVIDER, ListingFulfilment],
})
export class PaymentsModule {}
