import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  adminListingQuerySchema, adminUserQuerySchema, adminUserUpdateSchema, bannerSchema, cmsPageSchema, paginationSchema, rejectSchema,
  updateListingSchema, walletAdjustSchema,
} from '@evtap/shared';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../../common/decorators';
import { AppError } from '../../common/errors';
import { onlyProvided, UuidParam } from '../../common/params';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { AgenciesService } from '../agencies/agencies.service';
import { ContentService } from '../content/content.service';
import { MortgageService } from '../mortgage/mortgage.module';
import { AdminListingsService } from './admin-listings.service';
import { AdminUsersService } from './admin-users.service';

const boolQ = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : undefined), z.boolean().optional());
const adminListingUpdateSchema = updateListingSchema.extend({ isVerified: z.boolean().optional() });
const promoteSchema = z.object({ serviceCode: z.string().min(1) });
const statusPageSchema = (statuses: [string, ...string[]]) => paginationSchema.extend({ status: z.enum(statuses).optional() });
const reportsQuery = statusPageSchema(['OPEN', 'RESOLVED', 'DISMISSED']);
const leadsQuery = statusPageSchema(['NEW', 'SENT_TO_BANK', 'CLOSED']);
const agenciesQuery = paginationSchema.extend({ q: z.string().trim().max(100).optional(), verified: boolQ });
const auditQuery = paginationSchema.extend({ entity: z.string().max(40).optional(), actorId: z.string().uuid().optional() });

@ApiTags('admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin/listings')
export class AdminListingsController {
  constructor(private readonly svc: AdminListingsService) {}

  @Get()
  list(@Query(new ZodPipe(adminListingQuerySchema)) q: z.output<typeof adminListingQuerySchema>) {
    return this.svc.list(q);
  }

  @Get(':id')
  detail(@UuidParam() id: string, @CurrentUser() user: AuthUser) {
    return this.svc.detail(id, user);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@UuidParam() id: string, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.svc.approve(id, user, ip);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@UuidParam() id: string, @Body(new ZodPipe(rejectSchema)) body: z.output<typeof rejectSchema>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.svc.reject(id, body.reason, user, ip);
  }

  @Post(':id/block')
  @HttpCode(200)
  block(@UuidParam() id: string, @Body(new ZodPipe(rejectSchema)) body: z.output<typeof rejectSchema>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.svc.block(id, body.reason, user, ip);
  }

  @Patch(':id')
  update(@UuidParam() id: string, @Body(new ZodPipe(adminListingUpdateSchema)) body: z.output<typeof adminListingUpdateSchema>, @Body() raw: unknown, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.svc.update(id, onlyProvided(body, raw), user, ip);
  }

  @Roles('ADMIN')
  @Post(':id/promote')
  @HttpCode(200)
  promote(@UuidParam() id: string, @Body(new ZodPipe(promoteSchema)) body: z.output<typeof promoteSchema>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.svc.promote(id, body.serviceCode, user, ip);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get()
  list(@Query(new ZodPipe(adminUserQuerySchema)) q: z.output<typeof adminUserQuerySchema>) {
    return this.svc.list(q);
  }

  @Get(':id')
  detail(@UuidParam() id: string) {
    return this.svc.detail(id);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@UuidParam() id: string, @Body(new ZodPipe(adminUserUpdateSchema)) body: z.output<typeof adminUserUpdateSchema>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.svc.update(id, body, user, ip);
  }

  @Roles('ADMIN')
  @Post(':id/wallet-adjust')
  @HttpCode(200)
  walletAdjust(@UuidParam() id: string, @Body(new ZodPipe(walletAdjustSchema)) body: z.output<typeof walletAdjustSchema>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.svc.walletAdjust(id, body.amount, body.reason, user, ip);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('MODERATOR')
@Controller('admin')
export class AdminMiscController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly agencies: AgenciesService,
    private readonly content: ContentService,
    private readonly mortgage: MortgageService,
    private readonly audit: AuditService,
  ) {}

  // ───────── Agencies ─────────
  @Get('agencies')
  agenciesList(@Query(new ZodPipe(agenciesQuery)) q: z.output<typeof agenciesQuery>) {
    return this.agencies.list(q);
  }

  @Patch('agencies/:id')
  async agencyVerify(@UuidParam() id: string, @Body(new ZodPipe(z.object({ verified: z.boolean() }))) body: { verified: boolean }, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    const a = await this.agencies.setVerified(id, body.verified);
    await this.audit.log(user.id, 'agency.verify', 'agency', id, body, ip);
    return a;
  }

  // ───────── Reports ─────────
  @Get('reports')
  reports(@Query(new ZodPipe(reportsQuery)) q: z.output<typeof reportsQuery>) {
    return this.users.reports(q.status, q.page, q.pageSize);
  }

  @Patch('reports/:id')
  resolveReport(@UuidParam() id: string, @Body(new ZodPipe(z.object({ status: z.enum(['RESOLVED', 'DISMISSED']) }))) body: { status: 'RESOLVED' | 'DISMISSED' }, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    return this.users.resolveReport(id, body.status, user, ip);
  }

  // ───────── Banners ─────────
  @Get('banners')
  banners() {
    return this.content.allBanners();
  }

  @Roles('ADMIN')
  @Post('banners')
  async createBanner(@Body(new ZodPipe(bannerSchema)) body: z.output<typeof bannerSchema>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    const b = await this.content.createBanner(body);
    await this.audit.log(user.id, 'banner.create', 'banner', b.id, { title: b.title, placement: b.placement }, ip);
    return b;
  }

  @Roles('ADMIN')
  @Patch('banners/:id')
  async updateBanner(@UuidParam() id: string, @Body(new ZodPipe(bannerSchema.partial())) parsed: z.output<ReturnType<typeof bannerSchema.partial>>, @Body() raw: unknown, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    const body = onlyProvided(parsed, raw);
    const b = await this.content.updateBanner(id, body);
    await this.audit.log(user.id, 'banner.update', 'banner', id, { fields: Object.keys(body) }, ip);
    return b;
  }

  @Roles('ADMIN')
  @Delete('banners/:id')
  async deleteBanner(@UuidParam() id: string, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    const r = await this.content.deleteBanner(id);
    await this.audit.log(user.id, 'banner.delete', 'banner', id, {}, ip);
    return r;
  }

  // ───────── CMS pages ─────────
  @Get('pages')
  pages() {
    return this.content.pages();
  }

  @Roles('ADMIN')
  @Put('pages/:slug')
  async upsertPage(@Param('slug') slug: string, @Body(new ZodPipe(cmsPageSchema.partial({ slug: true }))) body: z.output<typeof cmsPageSchema>, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    if (!/^[a-z0-9-]+$/.test(slug) || (body.slug && body.slug !== slug)) throw new AppError('VALIDATION_ERROR', 'slug mismatch or invalid');
    const p = await this.content.upsertPage(slug, body);
    await this.audit.log(user.id, 'page.upsert', 'page', slug, {}, ip);
    return p;
  }

  @Roles('ADMIN')
  @Delete('pages/:slug')
  async deletePage(@Param('slug') slug: string, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    const r = await this.content.deletePage(slug);
    await this.audit.log(user.id, 'page.delete', 'page', slug, {}, ip);
    return r;
  }

  // ───────── Mortgage leads ─────────
  @Get('mortgage-leads')
  leads(@Query(new ZodPipe(leadsQuery)) q: z.output<typeof leadsQuery>) {
    return this.mortgage.list(q.status, q.page, q.pageSize);
  }

  @Patch('mortgage-leads/:id')
  async leadStatus(@UuidParam() id: string, @Body(new ZodPipe(z.object({ status: z.enum(['NEW', 'SENT_TO_BANK', 'CLOSED']) }))) body: { status: string }, @CurrentUser() user: AuthUser, @ClientIp() ip: string | null) {
    const l = await this.mortgage.setStatus(id, body.status);
    await this.audit.log(user.id, 'mortgage_lead.update', 'mortgage_lead', id, body, ip);
    return l;
  }

  // ───────── Audit log ─────────
  @Roles('ADMIN')
  @Get('audit-logs')
  auditLogs(@Query(new ZodPipe(auditQuery)) q: z.output<typeof auditQuery>) {
    return this.users.auditLogs(q);
  }
}
