import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { applyCreditSchema } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { PromotionsService } from './promotions.service';

export const uuidPipe = new ZodPipe(z.string().uuid());

/** Lives under /listings but belongs to the money workstream (spends subscription credits). */
@ApiTags('listings')
@ApiBearerAuth()
@Controller('listings')
export class ListingCreditsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Post(':id/apply-credit')
  @HttpCode(200)
  applyCredit(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(applyCreditSchema)) body: z.output<typeof applyCreditSchema>) {
    return this.promotions.applyCredit(user.id, id, body.credit);
  }
}

@Module({ controllers: [ListingCreditsController], providers: [PromotionsService], exports: [PromotionsService] })
export class PromotionsModule {}
