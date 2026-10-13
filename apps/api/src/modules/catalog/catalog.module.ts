import { Body, Controller, Get, Module, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { planUpdateSchema, serviceUpdateSchema, settingsUpdateSchema, type PlatformSettings } from '@evtap/shared';
import { z } from 'zod';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../../common/decorators';
import { AppError, notFound } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Database, InjectDb } from '../../db/db.module';
import { plans, services } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get()
  get() {
    return this.settings.getCatalog();
  }
}

/** Admin: prices / durations / plans (`/admin/catalog`) and platform settings (`/admin/settings`). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminCatalogController {
  constructor(@InjectDb() private readonly db: Database, private readonly settings: SettingsService, private readonly audit: AuditService) {}

  @Roles('MODERATOR')
  @Get('catalog')
  catalog() {
    return this.settings.getCatalog(true);
  }

  @Roles('ADMIN')
  @Patch('catalog/services/:code')
  async updateService(
    @Param('code') code: string,
    @Body(new ZodPipe(serviceUpdateSchema)) body: z.output<typeof serviceUpdateSchema>,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    const [row] = await this.db.update(services).set(body).where(eq(services.code, code)).returning({ code: services.code });
    if (!row) throw notFound('Service');
    this.settings.invalidate();
    await this.audit.log(user.id, 'catalog.service.update', 'service', code, body, ip);
    return this.settings.getService(code);
  }

  @Roles('ADMIN')
  @Patch('catalog/plans/:code')
  async updatePlan(
    @Param('code') code: string,
    @Body(new ZodPipe(planUpdateSchema)) body: z.output<typeof planUpdateSchema>,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ) {
    const [row] = await this.db.update(plans).set(body).where(eq(plans.code, code)).returning({ code: plans.code });
    if (!row) throw notFound('Plan');
    this.settings.invalidate();
    await this.audit.log(user.id, 'catalog.plan.update', 'plan', code, body, ip);
    return this.settings.getPlan(code);
  }

  @Roles('ADMIN')
  @Get('settings')
  getSettings() {
    return this.settings.getSettings();
  }

  @Roles('ADMIN')
  @Patch('settings')
  async updateSettings(
    @Body(new ZodPipe(settingsUpdateSchema)) body: z.output<typeof settingsUpdateSchema>,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | null,
  ): Promise<PlatformSettings> {
    const current = await this.settings.getSettings();
    if ((body.minTopup ?? current.minTopup) > (body.maxTopup ?? current.maxTopup)) {
      throw new AppError('VALIDATION_ERROR', 'minTopup must not exceed maxTopup');
    }
    const next = await this.settings.updateSettings(body);
    await this.audit.log(user.id, 'settings.update', 'settings', 'platform', body, ip);
    return next;
  }
}

@Module({ controllers: [CatalogController, AdminCatalogController] })
export class CatalogModule {}
