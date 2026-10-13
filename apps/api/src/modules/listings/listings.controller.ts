import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  availabilityUpdateSchema, createListingSchema, isoDate, LISTING_STATUSES, listingSearchSchema, listingStatusActionSchema, paginationSchema,
  reportListingSchema, updateListingSchema, DEAL_TYPES,
} from '@evtap/shared';
import { AuthUser, CurrentUser, Public } from '../../common/decorators';
import { onlyProvided, UuidParam } from '../../common/params';
import { ZodPipe } from '../../common/zod.pipe';
import { ListingsService } from './listings.service';

const featuredSchema = z.object({
  kind: z.enum(['vip', 'premium']).default('vip'),
  dealType: z.enum(DEAL_TYPES as [string, ...string[]]).optional(),
  cityId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
const availabilityQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const myListingsSchema = paginationSchema.extend({ status: z.enum(LISTING_STATUSES as [string, ...string[]]).optional() });

@ApiTags('listings')
@ApiBearerAuth()
@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get('listings')
  search(@Query(new ZodPipe(listingSearchSchema)) q: z.output<typeof listingSearchSchema>) {
    return this.listings.search(q);
  }

  @Public()
  @Get('listings/featured')
  featured(@Query(new ZodPipe(featuredSchema)) q: z.output<typeof featuredSchema>) {
    return this.listings.featured(q.kind, q);
  }

  @Public()
  @Get('listings/map')
  map(@Query(new ZodPipe(listingSearchSchema)) q: z.output<typeof listingSearchSchema>) {
    return this.listings.mapPoints(q);
  }

  @Get('me/listings')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(myListingsSchema)) q: z.output<typeof myListingsSchema>) {
    return this.listings.myListings(user.id, q.status, q.page, q.pageSize);
  }

  @Public()
  @Get('listings/:id')
  detail(@UuidParam() id: string, @CurrentUser() user?: AuthUser) {
    return this.listings.getDetail(id, user, { countView: true });
  }

  @Public()
  @Post('listings/:id/phone')
  @HttpCode(200)
  phone(@UuidParam() id: string, @CurrentUser() user?: AuthUser) {
    return this.listings.revealPhone(id, user);
  }

  @Public()
  @Get('listings/:id/similar')
  similar(@UuidParam() id: string) {
    return this.listings.similar(id);
  }

  @Public()
  @Get('listings/:id/reviews')
  reviews(@UuidParam() id: string, @Query(new ZodPipe(paginationSchema)) q: z.output<typeof paginationSchema>) {
    return this.listings.reviews(id, q.page, q.pageSize);
  }

  @Public()
  @Get('listings/:id/availability')
  availability(@UuidParam() id: string, @Query(new ZodPipe(availabilityQuerySchema)) q: z.output<typeof availabilityQuerySchema>) {
    return this.listings.getAvailability(id, q.from, q.to);
  }

  @Put('listings/:id/availability')
  setAvailability(@UuidParam() id: string, @CurrentUser() user: AuthUser, @Body(new ZodPipe(availabilityUpdateSchema)) body: z.output<typeof availabilityUpdateSchema>) {
    return this.listings.setAvailability(id, user, body.blockedDates);
  }

  @Get('listings/:id/stats')
  stats(@UuidParam() id: string, @CurrentUser() user: AuthUser) {
    return this.listings.stats(id, user);
  }

  @Post('listings')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createListingSchema)) body: z.output<typeof createListingSchema>) {
    return this.listings.create(user, body);
  }

  @Patch('listings/:id')
  update(@UuidParam() id: string, @CurrentUser() user: AuthUser, @Body(new ZodPipe(updateListingSchema)) body: z.output<typeof updateListingSchema>, @Body() raw: unknown) {
    return this.listings.update(id, user, onlyProvided(body, raw));
  }

  @Post('listings/:id/actions')
  @HttpCode(200)
  action(@UuidParam() id: string, @CurrentUser() user: AuthUser, @Body(new ZodPipe(listingStatusActionSchema)) body: z.output<typeof listingStatusActionSchema>) {
    return this.listings.action(id, user, body.action);
  }

  @Delete('listings/:id')
  remove(@UuidParam() id: string, @CurrentUser() user: AuthUser) {
    return this.listings.remove(id, user);
  }

  @Public()
  @Post('listings/:id/report')
  @HttpCode(200)
  report(@UuidParam() id: string, @Body(new ZodPipe(reportListingSchema)) body: z.output<typeof reportListingSchema>, @CurrentUser() user?: AuthUser) {
    return this.listings.report(id, user, body.reason, body.comment);
  }
}
