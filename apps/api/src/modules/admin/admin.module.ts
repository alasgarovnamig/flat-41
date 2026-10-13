import { Module } from '@nestjs/common';
import { AgenciesModule } from '../agencies/agencies.module';
import { ContentModule } from '../content/content.module';
import { ListingsModule } from '../listings/listings.module';
import { MortgageModule } from '../mortgage/mortgage.module';
import { AdminListingsService } from './admin-listings.service';
import { AdminListingsController, AdminMiscController, AdminUsersController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Back-office endpoints for the marketplace: listings moderation, users, agencies, reports, banners, CMS pages,
 * mortgage leads and the audit log. Money admin endpoints (payments, bookings, subscriptions, catalog, settings,
 * revenue stats) live in their own modules; dashboard stats live in StatsModule.
 */
@Module({
  imports: [ListingsModule, AgenciesModule, ContentModule, MortgageModule],
  controllers: [AdminListingsController, AdminUsersController, AdminMiscController],
  providers: [AdminListingsService, AdminUsersService],
})
export class AdminModule {}
