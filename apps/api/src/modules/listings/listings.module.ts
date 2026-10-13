import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ListingsController } from './listings.controller';
import { ListingsCron } from './listings.cron';
import { ListingsService } from './listings.service';

/**
 * Listings: search, detail, owner CRUD, availability, expiry cron.
 * Exports ListingsService (markListingFeePaid / markVerified / toCard) for the payments & bookings workstreams.
 * NOTE: `POST /listings/:id/apply-credit` is owned by the subscriptions (money) module.
 */
@Module({
  imports: [UsersModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingsCron],
  exports: [ListingsService],
})
export class ListingsModule {}
