import { Global, Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.service';
import { PushModule } from '../push/push.module';
import { BroadcastService } from './broadcast.service';
import { AdminNotificationsController, NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  // MailModule is @Global — imported here so app.module stays untouched.
  imports: [PushModule, MailModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, BroadcastService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
