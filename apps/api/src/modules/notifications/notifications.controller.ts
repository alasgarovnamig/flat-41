import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { broadcastSchema, paginationSchema } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { BroadcastService } from './broadcast.service';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema)) q: z.output<typeof paginationSchema>) {
    return this.notifications.list(user.id, q.page, q.pageSize);
  }

  // declared before ':id/read' so "read-all" is never captured as an id
  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.id, id);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly broadcasts: BroadcastService) {}

  @Roles('ADMIN')
  @Post('broadcast')
  @HttpCode(200)
  broadcast(@CurrentUser() user: AuthUser, @Body(new ZodPipe(broadcastSchema)) body: z.output<typeof broadcastSchema>, @ClientIp() ip: string | null) {
    return this.broadcasts.broadcast(user.id, body, ip);
  }
}
