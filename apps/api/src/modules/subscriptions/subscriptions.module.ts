import { Controller, Get, HttpCode, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { paginationSchema } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.subs.me(user.id);
  }

  @Post('me/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser) {
    return this.subs.cancel(user.id);
  }

  @Post('me/resume')
  @HttpCode(200)
  resume(@CurrentUser() user: AuthUser) {
    return this.subs.resume(user.id);
  }
}

const adminSubQuery = paginationSchema.extend({ status: z.enum(['ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE']).optional() });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Roles('MODERATOR')
  @Get()
  list(@Query(new ZodPipe(adminSubQuery)) q: z.output<typeof adminSubQuery>) {
    return this.subs.adminList(q.status, q.page, q.pageSize);
  }
}

@Module({
  imports: [PaymentsModule],
  controllers: [SubscriptionsController, AdminSubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
