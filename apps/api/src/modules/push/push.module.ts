import { Module } from '@nestjs/common';
import { PushService } from './push.service';

/** Mobile push (Expo) for every notification — provider chosen by PUSH_PROVIDER (console | expo). */
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
