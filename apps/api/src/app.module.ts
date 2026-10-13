import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter } from './common/exception.filter';
import { DbModule } from './db/db.module';
// core
import { AuditModule } from './modules/audit/audit.service';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.controller';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SmsModule } from './modules/sms/sms.service';
// marketplace (listings, users, agencies, content, admin)
import { AdminModule } from './modules/admin/admin.module';
import { AgenciesModule } from './modules/agencies/agencies.module';
import { ContentModule } from './modules/content/content.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { ListingsModule } from './modules/listings/listings.module';
import { LocationsModule } from './modules/locations/locations.module';
import { MortgageModule } from './modules/mortgage/mortgage.module';
import { SavedSearchesModule } from './modules/saved-searches/saved-searches.module';
import { StatsModule } from './modules/stats/stats.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
// money (payments, wallet, subscriptions, promotions, bookings)
import { BookingsModule } from './modules/bookings/bookings.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { WalletModule } from './modules/wallet/wallet.module';
// communication (messaging, realtime, push)
import { MessagingModule } from './modules/messaging/messaging.module';
import { PushModule } from './modules/push/push.module';
import { RealtimeModule } from './modules/realtime/realtime.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DbModule,
    AuditModule,
    SettingsModule,
    SmsModule,
    NotificationsModule,
    AuthModule,
    HealthModule,

    UsersModule,
    LocationsModule,
    UploadsModule,
    ListingsModule,
    FavoritesModule,
    SavedSearchesModule,
    AgenciesModule,
    MortgageModule,
    ContentModule,
    StatsModule,
    AdminModule,

    CatalogModule,
    WalletModule,
    PaymentsModule,
    PromotionsModule,
    SubscriptionsModule,
    BookingsModule,

    MessagingModule,
    RealtimeModule,
    PushModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
