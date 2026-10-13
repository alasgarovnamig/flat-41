import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { changePasswordSchema, pushTokenSchema, updateMeSchema } from '@evtap/shared';
import { AuthUser, CurrentUser, Public } from '../../common/decorators';
import { UuidParam } from '../../common/params';
import { ZodPipe } from '../../common/zod.pipe';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(updateMeSchema)) body: z.output<typeof updateMeSchema>) {
    return this.users.updateMe(user.id, body);
  }

  @Post('me/password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changePasswordSchema)) body: z.output<typeof changePasswordSchema>) {
    return this.users.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Delete('me')
  deleteMe(@CurrentUser() user: AuthUser) {
    return this.users.deleteMe(user.id);
  }

  @Post('me/push-tokens')
  @HttpCode(200)
  addPushToken(@CurrentUser() user: AuthUser, @Body(new ZodPipe(pushTokenSchema)) body: z.output<typeof pushTokenSchema>) {
    return this.users.addPushToken(user.id, body.token, body.platform);
  }

  @Delete('me/push-tokens/:token')
  removePushToken(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.users.removePushToken(user.id, token);
  }

  @Public()
  @Get(':id')
  getPublic(@UuidParam() id: string) {
    return this.users.getPublicUser(id);
  }
}
