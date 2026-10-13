import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { paginationSchema } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.wallet.get(user.id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema)) q: z.output<typeof paginationSchema>) {
    return this.wallet.transactions(user.id, q.page, q.pageSize);
  }
}

@Module({ controllers: [WalletController], providers: [WalletService], exports: [WalletService] })
export class WalletModule {}
