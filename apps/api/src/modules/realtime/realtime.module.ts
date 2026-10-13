import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { RealtimeGateway } from './realtime.gateway';

/** socket.io gateway at /ws — see REALTIME in @evtap/shared. */
@Module({
  imports: [MessagingModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
