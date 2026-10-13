import { Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { mortgageLeadSchema, type MortgageBank, type MortgageLead, type Paginated } from '@evtap/shared';
import { Database, InjectDb } from '../../db/db.module';
import { listings, mortgageLeads } from '../../db/schema';
import { AuthUser, CurrentUser, Public } from '../../common/decorators';
import { AppError, notFound } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { iso } from '../../common/util';
import { ZodPipe } from '../../common/zod.pipe';

/** Partner banks (indicative AZN mortgage terms; leads are forwarded to the bank's mortgage desk). */
export const MORTGAGE_BANKS: MortgageBank[] = [
  { code: 'KAPITAL', name: 'Kapital Bank', logoUrl: null, annualRate: 8, maxTermYears: 25, minDownPaymentPercent: 15 },
  { code: 'PASHA', name: 'PAŞA Bank', logoUrl: null, annualRate: 10.5, maxTermYears: 20, minDownPaymentPercent: 20 },
  { code: 'ABB', name: 'ABB (Azərbaycan Beynəlxalq Bankı)', logoUrl: null, annualRate: 9, maxTermYears: 25, minDownPaymentPercent: 15 },
  { code: 'RESPUBLIKA', name: 'Bank Respublika', logoUrl: null, annualRate: 11, maxTermYears: 20, minDownPaymentPercent: 20 },
  { code: 'UNIBANK', name: 'Unibank', logoUrl: null, annualRate: 12, maxTermYears: 15, minDownPaymentPercent: 25 },
];

type LeadRow = typeof mortgageLeads.$inferSelect;
export const toLeadDto = (r: LeadRow): MortgageLead => ({
  id: r.id, name: r.name, phone: r.phone, listingId: r.listingId, price: r.price, downPayment: r.downPayment, termYears: r.termYears,
  bankCode: r.bankCode, status: r.status as MortgageLead['status'], createdAt: iso(r.createdAt)!,
});

@Injectable()
export class MortgageService {
  constructor(@InjectDb() private readonly db: Database) {}

  banks() {
    return MORTGAGE_BANKS;
  }

  async createLead(userId: string | null, input: z.output<typeof mortgageLeadSchema>) {
    if (input.downPayment >= input.price) throw new AppError('VALIDATION_ERROR', 'downPayment must be less than price');
    if (input.bankCode && !MORTGAGE_BANKS.some((b) => b.code === input.bankCode)) throw new AppError('VALIDATION_ERROR', 'Unknown bankCode');
    if (input.listingId) {
      const [l] = await this.db.select({ id: listings.id }).from(listings).where(eq(listings.id, input.listingId));
      if (!l) throw notFound('Listing');
    }
    const [row] = await this.db
      .insert(mortgageLeads)
      .values({ userId, name: input.name, phone: input.phone, listingId: input.listingId ?? null, price: input.price, downPayment: input.downPayment, termYears: input.termYears, bankCode: input.bankCode ?? null })
      .returning({ id: mortgageLeads.id });
    return { id: row.id };
  }

  async list(status: string | undefined, page: number, pageSize: number): Promise<Paginated<MortgageLead>> {
    const where = status ? eq(mortgageLeads.status, status) : undefined;
    const { limit, offset } = pageArgs(page, pageSize);
    const rows = await this.db.select().from(mortgageLeads).where(where).orderBy(desc(mortgageLeads.createdAt)).limit(limit).offset(offset);
    const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` }).from(mortgageLeads).where(where);
    return paginated(rows.map(toLeadDto), c, page, pageSize);
  }

  async setStatus(id: string, status: string): Promise<MortgageLead> {
    const [row] = await this.db.update(mortgageLeads).set({ status }).where(and(eq(mortgageLeads.id, id))).returning();
    if (!row) throw notFound('Mortgage lead');
    return toLeadDto(row);
  }
}

@ApiTags('mortgage')
@Controller('mortgage')
export class MortgageController {
  constructor(private readonly mortgage: MortgageService) {}

  @Public()
  @Get('banks')
  banks() {
    return this.mortgage.banks();
  }

  @Public()
  @Post('leads')
  lead(@Body(new ZodPipe(mortgageLeadSchema)) body: z.output<typeof mortgageLeadSchema>, @CurrentUser() user?: AuthUser) {
    return this.mortgage.createLead(user?.id ?? null, body);
  }
}

@Module({ controllers: [MortgageController], providers: [MortgageService], exports: [MortgageService] })
export class MortgageModule {}
