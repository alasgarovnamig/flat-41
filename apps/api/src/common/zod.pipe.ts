import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates & transforms input with a zod schema from @evtap/shared.
 * Usage: `@Body(new ZodPipe(createListingSchema)) body: CreateListingParsed`
 *        `@Query(new ZodPipe(listingSearchSchema)) q: ListingSearchParsed`
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      });
    }
    return r.data;
  }
}
