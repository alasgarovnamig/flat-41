import { Body, Controller, Get, HttpCode, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { checkoutSchema, paginationSchema } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../../common/decorators';
import { AppError } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { CheckoutParsed, CheckoutService } from './checkout.service';
import { buildClientReturn, PaymentsService } from './payments.service';
import { InvalidSignatureError } from './providers';

const uuidPipe = new ZodPipe(z.string().uuid());

@ApiTags('payments')
@Controller()
export class PaymentsController {
  private readonly log = new Logger('PaymentsWebhook');
  constructor(private readonly checkoutService: CheckoutService, private readonly payments: PaymentsService) {}

  @ApiBearerAuth()
  @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body(new ZodPipe(checkoutSchema)) body: CheckoutParsed) {
    return this.checkoutService.checkout(user.id, body);
  }

  @ApiBearerAuth()
  @Get('payments')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema)) q: z.output<typeof paginationSchema>) {
    return this.payments.list(user.id, q.page, q.pageSize);
  }

  @ApiBearerAuth()
  @Get('payments/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string) {
    return this.payments.getOwn(user.id, id);
  }

  /** Signed bank callback (docs/MOCKBANK.md → Webhooks). `:provider` = mockbank today. */
  @Public()
  @SkipThrottle()
  @Post('payments/webhook/:provider')
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    if (provider !== this.payments.provider.name) throw new AppError('NOT_FOUND', 'Unknown payment provider', 404);
    let event;
    try {
      event = this.payments.provider.verifyWebhook(req.headers, req.rawBody ?? Buffer.alloc(0));
    } catch (e) {
      if (e instanceof InvalidSignatureError) {
        this.log.warn(`Rejected webhook: ${e.message}`);
        throw new AppError('INVALID_SIGNATURE', 'Invalid webhook signature', 401);
      }
      throw new AppError('VALIDATION_ERROR', (e as Error).message, 400);
    }
    await this.payments.applyProviderOrder(event.order);
    return { ok: true as const };
  }

  /** Browser comes back from the bank → finalise → 302 to the client returnUrl?paymentId=..&status=.. */
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Get('payments/return/:provider')
  async return(@Param('provider') provider: string, @Query('paymentId') paymentId: string | undefined, @Res() res: Response) {
    const p = await this.payments.handleReturn(provider, paymentId);
    if (!p) return res.redirect(302, buildClientReturn(null, paymentId ?? '', 'FAILED'));
    return res.redirect(302, buildClientReturn(p.returnUrl, p.id, p.status));
  }
}
