import { Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { BANNER_PLACEMENTS } from '@evtap/shared';
import { Public } from '../../common/decorators';
import { UuidParam } from '../../common/params';
import { ZodPipe } from '../../common/zod.pipe';
import { ContentService } from './content.service';

const bannerQuerySchema = z.object({ placement: z.enum(BANNER_PLACEMENTS as [string, ...string[]]).optional() });

@ApiTags('content')
@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('banners')
  banners(@Query(new ZodPipe(bannerQuerySchema)) q: z.output<typeof bannerQuerySchema>) {
    return this.content.activeBanners(q.placement);
  }

  @Public()
  @Post('banners/:id/click')
  @HttpCode(200)
  click(@UuidParam() id: string) {
    return this.content.click(id);
  }

  @Public()
  @Get('pages/:slug')
  page(@Param('slug') slug: string) {
    return this.content.page(slug);
  }
}

@Module({ controllers: [ContentController], providers: [ContentService], exports: [ContentService] })
export class ContentModule {}
