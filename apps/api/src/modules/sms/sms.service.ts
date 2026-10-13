import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { config } from '../../config';

/** Provider interface so a real SMS gateway (LSIM, Twilio, Infobip…) can be plugged in later. */
export interface SmsProvider { send(phone: string, text: string): Promise<void> }

class ConsoleSmsProvider implements SmsProvider {
  private readonly log = new Logger('SMS');
  async send(phone: string, text: string) {
    this.log.log(`→ ${phone}: ${text}`);
  }
}

@Injectable()
export class SmsService {
  private readonly provider: SmsProvider;
  constructor() {
    switch (config.sms.provider) {
      default:
        this.provider = new ConsoleSmsProvider();
    }
  }
  send(phone: string, text: string) {
    return this.provider.send(phone, text);
  }
}

@Global()
@Module({ providers: [SmsService], exports: [SmsService] })
export class SmsModule {}
