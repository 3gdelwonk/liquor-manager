// ═══════════════════════════════════════════════
// JARVISmart API Client
// Connects to the Smart Retail bridge at VITE_JARVIS_URL
// All requests authenticated with X-API-Key header
// ═══════════════════════════════════════════════

const BASE_URL = import.meta.env.VITE_JARVIS_URL as string;
const API_KEY  = import.meta.env.VITE_JARVIS_API_KEY as string;

async function jarvisFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`JARVISmart ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────

export interface ConnectionStatus {
  connected: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface StockItem {
  itemCode: string;
  description: string;
  department?: string;
  onHand: number;
  reorderLevel?: number;
  [key: string]: unknown;
}

export interface SearchResult {
  items: StockItem[];
  total: number;
  [key: string]: unknown;
}

export interface SalesSummary {
  period: string;
  totalSales: number;
  totalItems: number;
  [key: string]: unknown;
}

export interface TopSeller {
  itemCode: string;
  description: string;
  quantitySold: number;
  revenue: number;
  [key: string]: unknown;
}

export interface DepartmentBreakdown {
  department: string;
  sales: number;
  items: number;
  [key: string]: unknown;
}

export interface PurchaseOrder {
  orderId: string;
  supplier: string;
  status: string;
  [key: string]: unknown;
}

export interface StockFilters {
  department?: string;
  itemCode?: string;
  lowStock?: boolean;
  limit?: number;
}

export interface OrderOptions {
  status?: string;
  limit?: number;
}

// ── API Functions ──────────────────────────────

export async function checkConnection(): Promise<ConnectionStatus> {
  try {
    const data = await jarvisFetch<Omit<ConnectionStatus, 'connected'>>('/api/pos/status');
    return { connected: true, ...data };
  } catch (err) {
    return { connected: false, reason: (err as Error).message };
  }
}

export async function getStockLevels(filters: StockFilters = {}): Promise<StockItem[]> {
  const params = new URLSearchParams();
  if (filters.department) params.set('department', filters.department);
  if (filters.itemCode)   params.set('itemCode', filters.itemCode);
  if (filters.lowStock !== undefined) params.set('lowStock', String(filters.lowStock));
  if (filters.limit !== undefined)    params.set('limit', String(filters.limit));
  const qs = params.toString();
  return jarvisFetch<StockItem[]>(`/api/pos/stock${qs ? '?' + qs : ''}`);
}

export async function searchItems(query: string, limit = 20): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return jarvisFetch<SearchResult>(`/api/pos/search?${params}`);
}

export async function getPriceLookup(itemCode: string): Promise<unknown> {
  return jarvisFetch(`/api/pos/price/${encodeURIComponent(itemCode)}`);
}

export async function getSalesSummary(period: 'today' | 'week' | 'month' | string = 'today'): Promise<SalesSummary> {
  return jarvisFetch<SalesSummary>(`/api/pos/sales?period=${encodeURIComponent(period)}`);
}

export async function getTopSellers(days = 7, limit = 20): Promise<TopSeller[]> {
  return jarvisFetch<TopSeller[]>(`/api/pos/top-sellers?days=${days}&limit=${limit}`);
}

export async function getDepartmentBreakdown(period: 'today' | 'week' | 'month' | string = 'today'): Promise<DepartmentBreakdown[]> {
  return jarvisFetch<DepartmentBreakdown[]>(`/api/pos/departments?period=${encodeURIComponent(period)}`);
}

export async function getPurchaseOrders(supplier?: string, opts: OrderOptions = {}): Promise<PurchaseOrder[]> {
  const params = new URLSearchParams();
  if (supplier)     params.set('supplier', supplier);
  if (opts.status)  params.set('status', opts.status);
  params.set('limit', String(opts.limit ?? 100));
  return jarvisFetch<PurchaseOrder[]>(`/api/pos/orders?${params}`);
}
