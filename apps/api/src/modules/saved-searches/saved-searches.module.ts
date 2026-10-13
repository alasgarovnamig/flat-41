import { Body, Controller, Delete, Get, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { savedSearchSchema } from '@evtap/shared';
import { AuthUser, CurrentUser } from '../../common/decorators';
import { UuidParam } from '../../common/params';
import { ZodPipe } from '../../common/zod.pipe';
import { ListingsModule } from '../listings/listings.module';
import { SavedSearchesService } from './saved-searches.service';

@ApiTags('saved-searches')
@ApiBearerAuth()
@Controller('saved-searches')
export class SavedSearchesController {
  constructor(private readonly saved: SavedSearchesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.saved.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(savedSearchSchema)) body: z.output<typeof savedSearchSchema>) {
    return this.saved.create(user.id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @UuidParam() id: string) {
    return this.saved.remove(user.id, id);
  }
}

@Module({ imports: [ListingsModule], controllers: [SavedSearchesController], providers: [SavedSearchesService], exports: [SavedSearchesService] })
export class SavedSearchesModule {}
