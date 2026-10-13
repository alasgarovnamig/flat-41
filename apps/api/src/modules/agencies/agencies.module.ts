import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { addMemberSchema, agencySchema, paginationSchema } from '@evtap/shared';
import { AuthUser, CurrentUser, Public } from '../../common/decorators';
import { UuidParam } from '../../common/params';
import { ZodPipe } from '../../common/zod.pipe';
import { AgenciesService } from './agencies.service';

const listSchema = paginationSchema.extend({
  type: z.enum(['AGENCY', 'DEVELOPER']).optional(),
  cityId: z.string().optional(),
  q: z.string().trim().max(100).optional(),
});
const statsSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const updateSchema = agencySchema.partial();

@ApiTags('agencies')
@ApiBearerAuth()
@Controller('agencies')
export class AgenciesController {
  constructor(private readonly agencies: AgenciesService) {}

  @Public()
  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.output<typeof listSchema>) {
    return this.agencies.list(q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(agencySchema)) body: z.output<typeof agencySchema>) {
    return this.agencies.create(user.id, body);
  }

  // `me` routes are declared before `:slug` so they take precedence.
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.agencies.getMine(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(updateSchema)) body: z.output<typeof updateSchema>) {
    return this.agencies.updateMine(user.id, body);
  }

  @Get('me/members')
  members(@CurrentUser() user: AuthUser) {
    return this.agencies.members(user.id);
  }

  @Post('me/members')
  addMember(@CurrentUser() user: AuthUser, @Body(new ZodPipe(addMemberSchema)) body: z.output<typeof addMemberSchema>) {
    return this.agencies.addMember(user.id, body.login);
  }

  @Delete('me/members/:userId')
  removeMember(@CurrentUser() user: AuthUser, @UuidParam('userId') memberId: string) {
    return this.agencies.removeMember(user.id, memberId);
  }

  @Get('me/stats')
  stats(@CurrentUser() user: AuthUser, @Query(new ZodPipe(statsSchema)) q: z.output<typeof statsSchema>) {
    return this.agencies.stats(user.id, q.days);
  }

  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.agencies.bySlug(slug);
  }
}

@Module({ controllers: [AgenciesController], providers: [AgenciesService], exports: [AgenciesService] })
export class AgenciesModule {}
