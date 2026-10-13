import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminBookingQuerySchema, bookingQuoteSchema, cancelBookingSchema, createBookingSchema, paginationSchema, reviewReplySchema, reviewSchema, BOOKING_STATUSES,
} from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PaymentsModule } from '../payments/payments.module';
import { WalletModule } from '../wallet/wallet.module';
import { BookingsService } from './bookings.service';

const uuidPipe = new ZodPipe(z.string().uuid());
const listQuery = paginationSchema.extend({ role: z.enum(['guest', 'host']).default('guest'), status: z.enum(BOOKING_STATUSES as [string, ...string[]]).optional() });
const adminCancelSchema = z.object({ reason: z.string().trim().min(1).max(500) });

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Public()
  @Post('quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(bookingQuoteSchema)) body: z.output<typeof bookingQuoteSchema>, @CurrentUser() user?: AuthUser) {
    return this.bookings.quote(body, user?.id);
  }

  @ApiBearerAuth()
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createBookingSchema)) body: z.output<typeof createBookingSchema>) {
    return this.bookings.create(user.id, body);
  }

  @ApiBearerAuth()
  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.output<typeof listQuery>) {
    return this.bookings.list(user.id, q.role, q.status, q.page, q.pageSize);
  }

  @ApiBearerAuth()
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string) {
    return this.bookings.get(user, id);
  }

  @ApiBearerAuth()
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(cancelBookingSchema)) body: z.output<typeof cancelBookingSchema>) {
    return this.bookings.cancel(user, id, body.reason);
  }

  @ApiBearerAuth()
  @Post(':id/review')
  review(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(reviewSchema)) body: z.output<typeof reviewSchema>) {
    return this.bookings.review(user.id, id, body);
  }
}

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post(':id/reply')
  @HttpCode(200)
  reply(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(reviewReplySchema)) body: z.output<typeof reviewReplySchema>) {
    return this.bookings.reply(user.id, id, body.reply);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService, private readonly audit: AuditService) {}

  @Roles('MODERATOR')
  @Get()
  list(@Query(new ZodPipe(adminBookingQuerySchema)) q: z.output<typeof adminBookingQuerySchema>) {
    return this.bookings.adminList(q);
  }

  /** Full refund to the guest regardless of timing. */
  @Roles('ADMIN')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(adminCancelSchema)) body: z.output<typeof adminCancelSchema>, @ClientIp() ip: string | null) {
    const b = await this.bookings.cancel(user, id, body.reason, true);
    await this.audit.log(user.id, 'booking.cancel', 'booking', id, { reason: body.reason, refundedAmount: b.refundedAmount }, ip);
    return b;
  }
}

@Module({
  imports: [PaymentsModule, WalletModule],
  controllers: [BookingsController, ReviewsController, AdminBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
