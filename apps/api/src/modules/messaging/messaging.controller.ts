import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { messageListQuerySchema, paginationSchema, sendMessageSchema, startConversationSchema } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { MessagingService } from './messaging.service';

@ApiTags('messaging')
@ApiBearerAuth()
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(paginationSchema)) q: z.output<typeof paginationSchema>) {
    return this.messaging.list(user.id, q.page, q.pageSize);
  }

  @Post()
  start(@CurrentUser() user: AuthUser, @Body(new ZodPipe(startConversationSchema)) body: z.output<typeof startConversationSchema>) {
    return this.messaging.start(user.id, body.listingId, body.message);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.messaging.unreadCount(user.id);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(messageListQuerySchema)) q: z.output<typeof messageListQuerySchema>,
  ) {
    return this.messaging.messages(user.id, id, q.before, q.limit);
  }

  @Post(':id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sendMessageSchema)) body: z.output<typeof sendMessageSchema>) {
    return this.messaging.send(user.id, id, body.body);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.markRead(user.id, id);
  }
}
