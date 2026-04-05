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

// ── Price Lock local persistence (until server returns it on stock) ─────────
const PRICE_LOCK_KEY = 'liquor-manager-price-locks';
function getPriceLocks(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(PRICE_LOCK_KEY) ?? '[]')) }
  catch { return new Set() }
}
export function setPriceLockLocal(barcode: string, locked: boolean) {
  const locks = getPriceLocks()
  if (locked) locks.add(barcode); else locks.delete(barcode)
  localStorage.setItem(PRICE_LOCK_KEY, JSON.stringify([...locks]))
}
export function isPriceLockedLocal(barcode: string): boolean {
  return getPriceLocks().has(barcode)
}

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

export async function jarvisPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`JARVISmart ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function jarvisPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'PUT',
    headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`JARVISmart ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function jarvisDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'DELETE',
    headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`JARVISmart ${res.status}: ${text}`);
  }
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
  OrderCode: string | null;
  PriceLocked?: boolean;
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
  orderCode: string | null;
  priceLocked: boolean;
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
    orderCode:      s.OrderCode ?? null,
    priceLocked:    s.PriceLocked ?? isPriceLockedLocal(s.barcode ?? ''),
  }));
}

export async function searchItems(query: string, limit = 20): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const raw = await jarvisFetch<{ items: RawStockItem[]; count: number }>(
    `/api/pos/search?${params}`
  );
  return {
    items: raw.items.map(s => ({
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
      orderCode:      s.OrderCode ?? null,
      priceLocked:    s.PriceLocked ?? isPriceLockedLocal(s.barcode ?? ''),
    })),
    total: raw.count,
  };
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

// ── Price & Sales tracking ──────────────────────────────────────────────────

export interface PriceCheck {
  RegSellPrice: number;
  PrevSellPrice: number;
  [key: string]: unknown;
}

export interface PriceHistoryEntry {
  date: string;
  oldPrice: number;
  newPrice: number;
  changedBy: string;  // "host" = Metcash/ALM, "system" = scheduled promo, "manual" = POS operator
  [key: string]: unknown;
}

export interface DailySale {
  date: string;
  qty: number;
  revenue: number;
  cost: number;
  gp: number;
}

export interface ItemSalesData {
  itemCode: string;
  barcode: string;
  description: string;
  department: string;
  currentSellPrice: number;
  prevSellPrice: number;
  avgCost: number;
  period: string;
  summary: {
    totalQty: number;
    totalRevenue: number;
    daysWithSales: number;
    avgDailyQty: number;
    avgDailyRevenue: number;
  };
  dailySales: DailySale[];
}

export async function getItemPrice(itemCode: string): Promise<PriceCheck> {
  return jarvisFetch<PriceCheck>(`/api/pos/price/${encodeURIComponent(itemCode)}`);
}

export async function getPriceHistory(itemCode: string, months = 6): Promise<PriceHistoryEntry[]> {
  const raw = await jarvisFetch<{ history: PriceHistoryEntry[] } | PriceHistoryEntry[]>(
    `/api/pos/price-history/${encodeURIComponent(itemCode)}?months=${months}`
  );
  return Array.isArray(raw) ? raw : raw.history;
}

export async function getItemSales(itemCode: string, days = 90): Promise<ItemSalesData> {
  return jarvisFetch<ItemSalesData>(`/api/pos/item-sales/${encodeURIComponent(itemCode)}?days=${days}`);
}

export interface RecentPriceChange {
  itemCode: string;
  barcode: string | null;
  description: string;
  department: string;
  oldPrice: number;
  newPrice: number;
  changeDate: string;
  changedBy: string;
}

interface RawPriceChangeItem {
  itemCode: string;
  barcode: string | null;
  description: string;
  department: string;
  date: string;
  changedBy: string;
  source: string;
  prevSellPrice: number;
  currentRegSellPrice: number;
  sellChanged: boolean;
  // Additional fields we don't map
  [key: string]: unknown;
}

export async function getRecentPriceChanges(since: string, excludeHost = true): Promise<RecentPriceChange[]> {
  const params = new URLSearchParams({ since });
  if (excludeHost) params.set('excludeHost', 'true');
  const raw = await jarvisFetch<{ items: RawPriceChangeItem[] } | { changes: RecentPriceChange[] } | RecentPriceChange[]>(
    `/api/pos/recent-price-changes?${params}`
  );

  // Handle different response shapes from the API
  if (Array.isArray(raw)) return raw;
  if ('changes' in raw) return raw.changes;

  // Map raw items to our interface, filter to actual sell price changes
  // Check both sellChanged flag AND actual price difference (prevSellPrice vs currentRegSellPrice)
  const mapped = raw.items
    .filter(item => {
      const priceChanged = item.sellChanged || Math.abs(item.prevSellPrice - item.currentRegSellPrice) > 0.001
      const sourceOk = excludeHost ? item.source === 'manual' : true
      return priceChanged && sourceOk
    })
    .map(item => ({
      itemCode: item.itemCode,
      barcode: item.barcode,
      description: item.description,
      department: item.department,
      oldPrice: item.prevSellPrice,
      newPrice: item.currentRegSellPrice,
      changeDate: item.date,
      changedBy: item.changedBy,
    }));

  // Deduplicate by itemCode, keep the most recent entry
  const seen = new Map<string, RecentPriceChange>();
  for (const item of mapped) {
    if (!seen.has(item.itemCode) || new Date(item.changeDate) > new Date(seen.get(item.itemCode)!.changeDate)) {
      seen.set(item.itemCode, item);
    }
  }
  return Array.from(seen.values());
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

// ── Cloud Status ─────────────────────────────────────────────────────────────

export interface CloudStatus {
  loggedIn: boolean;
  tokenAge?: string;
  lastRenewal?: string;
  renewsIn?: string;
  expiresIn?: string;
  workingHours?: boolean;
  schedule?: string;
  currentHour?: string;
  loginInProgress?: boolean;
  message?: string;
}

export async function getCloudStatus(): Promise<CloudStatus> {
  try {
    const raw = await jarvisFetch<Record<string, unknown>>('/api/pos-actions/status');
    return {
      loggedIn: !!(raw.hasToken ?? raw.loggedIn ?? raw.connected),
      tokenAge: raw.tokenAge as string | undefined,
      lastRenewal: raw.lastRenewal as string | undefined,
      renewsIn: raw.renewsIn as string | undefined,
      expiresIn: raw.expiresIn as string | undefined,
      workingHours: raw.workingHours as boolean | undefined,
      schedule: raw.schedule as string | undefined,
      currentHour: raw.currentHour as string | undefined,
      loginInProgress: raw.loginInProgress as boolean | undefined,
      message: raw.message as string | undefined,
    };
  } catch {
    return { loggedIn: false, message: 'Cannot reach POS cloud' };
  }
}

// ── Order & POS Status ───────────────────────────────────────────────────────

export interface SupplierInfo {
  supplierName: string;
  supplierId: number;
  orderCode: string | null;
  orderCodeRaw: string | null;
  supplierRef: string | null;
  ctnCost: number;
  ctnQty: number;
  unitCost: number;
  minOrderQty: number;
  isPrimary: boolean;
  lastOrdered: string | null;
  lastReceived: string | null;
  lastReceivedCost: number | null;
}

export interface OrderInfo {
  itemCode: string;
  description: string;
  barcode: string | null;
  sellPrice: number;
  qoh: number;
  suppliers: SupplierInfo[];
  // Convenience: primary supplier fields (computed)
  supplier?: string;
  orderCode?: string | null;
  orderCodeRaw?: string | null;
  unitCost?: number;
  cartonQty?: number;
  cartonCost?: number;
}

export interface PosStatus {
  barcode: string;
  needsFullSend?: boolean;
  activePromo?: boolean;
  lastSent?: string;
  [key: string]: unknown;
}

export async function getOrderInfo(itemCode: string): Promise<OrderInfo> {
  const raw = await jarvisFetch<OrderInfo>(`/api/pos/order-info/${encodeURIComponent(itemCode)}`);
  // Populate convenience fields from primary supplier
  const primary = raw.suppliers?.find(s => s.isPrimary) ?? raw.suppliers?.[0];
  if (primary) {
    raw.supplier = primary.supplierName;
    raw.orderCode = primary.orderCode;
    raw.orderCodeRaw = primary.orderCodeRaw;
    raw.unitCost = primary.unitCost;
    raw.cartonQty = primary.ctnQty;
    raw.cartonCost = primary.ctnCost;
  }
  return raw;
}

export async function getPosStatus(barcode: string): Promise<PosStatus> {
  return jarvisFetch<PosStatus>(`/api/pos/pos-status/${encodeURIComponent(barcode)}`);
}

// ── Stock Locations ──────────────────────────────────────────────────────────

export interface StockLocation {
  id: number;
  aisle: string;
  bay: string;
  description?: string;
  active: boolean;
  [key: string]: unknown;
}

export interface ItemLocation {
  locationId: number;
  aisle: string;
  bay: string;
  description?: string;
  [key: string]: unknown;
}

export async function getLocations(): Promise<StockLocation[]> {
  const raw = await jarvisFetch<StockLocation[] | { locations: StockLocation[] }>('/api/pos/locations');
  return Array.isArray(raw) ? raw : raw.locations;
}

export async function getItemLocations(itemCode: string): Promise<ItemLocation[]> {
  const raw = await jarvisFetch<ItemLocation[] | { locations: ItemLocation[] }>(
    `/api/pos/locations/item/${encodeURIComponent(itemCode)}`
  );
  return Array.isArray(raw) ? raw : raw.locations;
}

// ── Department List ──────────────────────────────────────────────────────────

export interface Department {
  code: number;
  name: string;
  [key: string]: unknown;
}

export async function getDepartmentList(): Promise<Department[]> {
  const raw = await jarvisFetch<Department[] | { departments: Department[] }>('/api/pos/department-list');
  return Array.isArray(raw) ? raw : raw.departments;
}

// ── Printers & Label Queue ──────────────────────────────────────────────────

export interface Printer {
  id: number;
  name: string;
  networkPath: string;
  isLabel: boolean;
  isReport: boolean;
  queueId: string;
  queueRunning: boolean;
}

export interface LabelQueueItem {
  barcode: string;
  itemCode: string;
  description: string;
  sellPrice: number;
  normalPrice: number;
  count: number;
  printerId: number | null;
  batchId: string;
  createdBy: string;
  createdAt: string;
}

export async function getPrinters(): Promise<Printer[]> {
  return jarvisFetch<Printer[]>('/api/pos/printers');
}

export async function getLabelQueue(): Promise<{ pending: number; items: LabelQueueItem[] }> {
  return jarvisFetch<{ pending: number; items: LabelQueueItem[] }>('/api/pos/label-queue');
}

// ── SerpApi Intelligence ─────────────────────────────────────────────────────

export interface ShoppingResult {
  title: string;
  price?: string;
  source?: string;
  link?: string;
  thumbnail?: string;
  [key: string]: unknown;
}

export interface ResearchResult {
  knowledgeGraph?: Record<string, unknown>;
  peopleAlsoAsk?: { question: string; snippet?: string }[];
  [key: string]: unknown;
}

export async function getShoppingComparison(query: string): Promise<ShoppingResult[]> {
  const params = new URLSearchParams({ q: query });
  const raw = await jarvisFetch<ShoppingResult[] | { results: ShoppingResult[] }>(
    `/api/pos/serpapi/shopping?${params}`
  );
  return Array.isArray(raw) ? raw : raw.results;
}

export async function getProductResearch(query: string): Promise<ResearchResult> {
  const params = new URLSearchParams({ q: query });
  return jarvisFetch<ResearchResult>(`/api/pos/serpapi/research?${params}`);
}

// ── Online Prices ────────────────────────────────────────────────────────────

export interface OnlinePrice {
  title: string;
  price?: string;
  source?: string;
  link?: string;
  [key: string]: unknown;
}

export async function getOnlinePrices(query: string): Promise<OnlinePrice[]> {
  const params = new URLSearchParams({ q: query });
  const raw = await jarvisFetch<OnlinePrice[] | { results: OnlinePrice[] }>(
    `/api/pos/online-prices?${params}`
  );
  return Array.isArray(raw) ? raw : raw.results;
}
