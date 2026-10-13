import { Global, Injectable, Module } from '@nestjs/common';
import { Database, InjectDb } from '../../db/db.module';
import { auditLogs } from '../../db/schema';

/** Records admin / security-relevant actions. Call from every admin mutation. */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Database) {}
  async log(actorId: string | null, action: string, entity: string, entityId: string | null, data: Record<string, unknown> = {}, ip: string | null = null) {
    await this.db.insert(auditLogs).values({ actorId, action, entity, entityId, data, ip });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
