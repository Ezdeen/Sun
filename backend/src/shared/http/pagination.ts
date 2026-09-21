/**
 * Pagination helpers (limit/offset style, capped).
 */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface PageParams {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePageParams(query: Record<string, unknown>): PageParams {
  const rawPage = Number.parseInt(String(query["page"] ?? "1"), 10);
  const rawSize = Number.parseInt(String(query["pageSize"] ?? String(DEFAULT_PAGE_SIZE)), 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  let pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? rawSize : DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
