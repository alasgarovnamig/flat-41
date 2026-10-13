import { Global, Module } from '@nestjs/common';
import { QuotaService, SettingsService } from './settings.service';

@Global()
@Module({ providers: [SettingsService, QuotaService], exports: [SettingsService, QuotaService] })
export class SettingsModule {}
