import type { Paginated } from '@evtap/shared';

export const pageArgs = (page = 1, pageSize = 20) => ({ limit: pageSize, offset: (page - 1) * pageSize });
export const paginated = <T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> => ({ items, total, page, pageSize });
