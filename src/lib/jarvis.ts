// ═══════════════════════════════════════════════
// JARVISmart API Client
// Connects to the Smart Retail bridge at VITE_JARVIS_URL
// All requests authenticated with X-API-Key header
// ═══════════════════════════════════════════════

const DEFAULT_URL = 'https://api.jarvismart196410.uk';
const DEFAULT_KEY = 'jmart_sk_7f3a9c2e1b4d8f6a0e5c3b9d';

function getBaseUrl(): string {
  return localStorage.getItem('liquor-manager-jarvis-url') || (import.meta.env.VITE_JARVIS_URL as string) || DEFAULT_URL
}
function getApiKey(): string {
  return localStorage.getItem('liquor-manager-jarvis-key') || (import.meta.env.VITE_JARVIS_API_KEY as string) || DEFAULT_KEY
}

// Liquor department codes from Smart Retail POS
export const LIQUOR_DEPT_CODES = new Set([20, 21, 22, 23, 25]);
export const LIQUOR_DEPT_NAMES = new Set(['LIQUEURS', 'WINE', 'SPIRITS', 'LIQUOR/MISC', 'BEER']);

async function jarvisFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: {
      'X-API-Key': getApiKey(),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`JARVISmart ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Raw API shapes (actual JARVISmart response) ─────────────────────────────

interface RawPromoItem {
  itemCode: string;
  description: string;
  department: string;
  promoSellPrice: number;
  normalSellPrice: number;
  discountPercent: number;
  marginAtPromoPrice: number;
  promoCtnCost: number;
  normalCtnCost: number;
  promoUnitCost: number | null;
  normalUnitCost: number;
  ctnQty: number;
  costSavingPercent: number | null;
  startDate: string;
  endDate: string;
  daysLeft: number;
}

interface RawSalesSummary {
  period: string;
  dateFrom: string;
  dateTo: string;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  totalTransactions: number;
  avgBasketSize: number;
  normalSales: number;
  promotionSales: number;
}

interface RawDepartment {
  code: number;
  name: string;
  totalSales: number;
  totalCost: number;
  grossProfit: number;
  marginPercent: number | null;
  transactions: number;
  normalSales: number;
  promotionSales: number;
}

interface RawTopSeller {
  rank: number;
  itemCode: string;
  description: string;
  department: string;
  qtySold: number;
  revenue: number;
  cost: number;
}

interface RawStockItem {
  ItemCode: string;
  ItemDescription: string;
  QOH: number;
  MinOH: number;
  RegSellPrice: number;
  AvgCost: number;
  DepartmentName: string;
  DepartmentCode: number;
  OnOrder: number;
  IsOnReorder: boolean;
  AvgDayQty: number;
  AvgWeekQty: number;
  barcode: string | null;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface ConnectionStatus {
  connected: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface SalesSummary {
  period: string;
  totalRevenue: number;
  totalTransactions: number;
  totalCost: number;
  grossProfit: number;
  grossMarginPercent: number;
  avgBasketSize: number;
  normalSales: number;
  promotionSales: number;
}

export interface DepartmentBreakdown {
  code: number;
  department: string;
  sales: number;
  cost: number;
  grossProfit: number;
  marginPercent: number | null;
  transactions: number;
  normalSales: number;
  promotionSales: number;
}

export interface TopSeller {
  rank: number;
  itemCode: string;
  description: string;
  department: string;
  quantitySold: number;
  revenue: number;
  cost: number;
}

export interface StockItem {
  itemCode: string;
  barcode: string | null;
  description: string;
  department: string;
  departmentCode: number;
  onHand: number;
  reorderLevel: number;
  sellPrice: number;
  avgCost: number;
  onOrder: number;
  isOnReorder: boolean;
  avgDayQty: number;
  avgWeekQty: number;
}

export interface LivePromotion {
  itemCode: string;
  description: string;
  department: string;
  promoPrice: number;
  normalPrice: number;
  discountPercent: number;
  marginPercent: number;
  promoUnitCost: number | null;
  normalUnitCost: number;
  ctnQty: number;
  costSavingPercent: number | null;
  startDate: string;
  endDate: string;
  daysLeft: number;
}

export interface SearchResult {
  items: StockItem[];
  total: number;
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

// ── API Functions ─────────────────────────────────────────────────────────────

export async function checkConnection(): Promise<ConnectionStatus> {
  try {
    const data = await jarvisFetch<Omit<ConnectionStatus, 'connected'>>('/api/pos/health');
    return { connected: true, ...data };
  } catch (err) {
    return { connected: false, reason: (err as Error).message };
  }
}

export async function getSalesSummary(period: 'today' | 'week' | 'month' | string = 'today'): Promise<SalesSummary> {
  const raw = await jarvisFetch<RawSalesSummary>(`/api/pos/sales?period=${encodeURIComponent(period)}`);
  return {
    period:              raw.period,
    totalRevenue:        raw.totalRevenue,
    totalTransactions:   raw.totalTransactions,
    totalCost:           raw.totalCost,
    grossProfit:         raw.grossProfit,
    grossMarginPercent:  raw.grossMarginPercent,
    avgBasketSize:       raw.avgBasketSize,
    normalSales:         raw.normalSales,
    promotionSales:      raw.promotionSales,
  };
}

export async function getDepartmentBreakdown(period: 'today' | 'week' | 'month' | string = 'today'): Promise<DepartmentBreakdown[]> {
  const raw = await jarvisFetch<{ period: string; departments: RawDepartment[] }>(
    `/api/pos/departments?period=${encodeURIComponent(period)}`
  );
  return raw.departments.map(d => ({
    code:            d.code,
    department:      d.name,
    sales:           d.totalSales,
    cost:            d.totalCost,
    grossProfit:     d.grossProfit,
    marginPercent:   d.marginPercent,
    transactions:    d.transactions,
    normalSales:     d.normalSales,
    promotionSales:  d.promotionSales,
  }));
}

export async function getTopSellers(days = 7, limit = 20): Promise<TopSeller[]> {
  const raw = await jarvisFetch<{ period: string; items: RawTopSeller[] }>(
    `/api/pos/top-sellers?days=${days}&limit=${limit}`
  );
  return raw.items.map(t => ({
    rank:          t.rank,
    itemCode:      t.itemCode,
    description:   t.description,
    department:    t.department,
    quantitySold:  t.qtySold,
    revenue:       t.revenue,
    cost:          t.cost,
  }));
}

export async function getStockLevels(filters: StockFilters = {}): Promise<StockItem[]> {
  const params = new URLSearchParams();
  if (filters.department)              params.set('department', filters.department);
  if (filters.itemCode)                params.set('itemCode', filters.itemCode);
  if (filters.lowStock !== undefined)  params.set('lowStock', String(filters.lowStock));
  if (filters.limit !== undefined)     params.set('limit', String(filters.limit));
  const qs = params.toString();
  const raw = await jarvisFetch<{ items: RawStockItem[]; count: number }>(
    `/api/pos/stock${qs ? '?' + qs : ''}`
  );
  return raw.items.map(s => ({
    itemCode:       s.ItemCode,
    barcode:        s.barcode ?? null,
    description:    s.ItemDescription.trim(),
    department:     s.DepartmentName,
    departmentCode: s.DepartmentCode,
    onHand:         s.QOH,
    reorderLevel:   s.MinOH,
    sellPrice:      s.RegSellPrice,
    avgCost:        s.AvgCost,
    onOrder:        s.OnOrder,
    isOnReorder:    s.IsOnReorder,
    avgDayQty:      s.AvgDayQty,
    avgWeekQty:     s.AvgWeekQty,
  }));
}

export async function searchItems(query: string, limit = 20): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return jarvisFetch<SearchResult>(`/api/pos/search?${params}`);
}

export async function getPriceLookup(itemCode: string): Promise<unknown> {
  return jarvisFetch(`/api/pos/price/${encodeURIComponent(itemCode)}`);
}

export async function getPurchaseOrders(supplier?: string, opts: OrderOptions = {}): Promise<PurchaseOrder[]> {
  const params = new URLSearchParams();
  if (supplier)     params.set('supplier', supplier);
  if (opts.status)  params.set('status', opts.status);
  params.set('limit', String(opts.limit ?? 100));
  return jarvisFetch<PurchaseOrder[]>(`/api/pos/orders?${params}`);
}

const LIQUOR_DEPTS = ['BEER', 'WINE', 'SPIRITS', 'LIQUEURS', 'LIQUOR/MISC'];

export async function getPromotions(): Promise<{ items: LivePromotion[]; count: number; expiringSoonCount: number }> {
  const results = await Promise.all(
    LIQUOR_DEPTS.map(dept =>
      jarvisFetch<{ active: boolean; items: RawPromoItem[]; count: number; expiringSoonCount: number }>(
        `/api/pos/promotions?department=${encodeURIComponent(dept)}&limit=1000`
      )
    )
  );

  const allItems: LivePromotion[] = [];
  let expiringSoonCount = 0;

  for (const raw of results) {
    expiringSoonCount += raw.expiringSoonCount;
    for (const p of raw.items) {
      allItems.push({
        itemCode:         p.itemCode,
        description:      p.description.trim(),
        department:       p.department,
        promoPrice:       p.promoSellPrice,
        normalPrice:      p.normalSellPrice,
        discountPercent:  p.discountPercent,
        marginPercent:    p.marginAtPromoPrice,
        promoUnitCost:    p.promoUnitCost,
        normalUnitCost:   p.normalUnitCost,
        ctnQty:           p.ctnQty,
        costSavingPercent: p.costSavingPercent,
        startDate:        p.startDate,
        endDate:          p.endDate,
        daysLeft:         p.daysLeft,
      });
    }
  }

  return { items: allItems, count: allItems.length, expiringSoonCount };
}
