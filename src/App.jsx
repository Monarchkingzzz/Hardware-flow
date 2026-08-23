import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, ShoppingCart, Package, Truck, Building2, Users, CreditCard,
  FileText, BookOpen, BarChart3, ShieldAlert, Lock, Search, Plus, X, Check,
  AlertTriangle, TrendingUp, TrendingDown, ChevronRight, Minus, Trash2,
  ArrowRight, Receipt as ReceiptIcon, Download, Eye, EyeOff, Calendar,
  Award, CheckCircle2, Sun, Moon,
  LogOut, Key, Coins, Edit3, Menu, Wifi, WifiOff, RefreshCw,
  Bell, BellRing, PhoneCall, Filter,
  FileSpreadsheet, History, SlidersHorizontal, ArrowDownRight, ArrowUpRight,
  FileDown, UploadCloud, CheckSquare, Info, ListFilter, Layers, Boxes, FileCheck
} from "lucide-react";
import {
  exportAuditLogPDF,
  exportInventoryPDF,
  exportReportCenterPDF,
  exportReceiptPDF,
  exportBestSellersPDF,
  exportReorderListPDF,
  exportQuotationPDF,
  exportQuotationsListPDF,
  exportInvoicePDF,
  exportCustomerStatementPDF
} from "./utils/pdfExport";
import { ToastContainer } from "./components/Toast";
import { LoginScreen, ForgotPasswordModal, ProfileModal, UserManagementModal } from "./components/Auth";
import { autoSyncDatabase, pullDatabaseFromSupabase, subscribeToSupabaseRealtime, getIsSyncing } from "./utils/supabaseClient";
import { hashPassword, sanitizeUserForSession, verifyActionPin, validateCustomerDebtRepayment, validateSupplierPayment } from "./utils/security";
import { useOnlineStatus, enqueueOfflineSale, syncOfflineQueue } from "./utils/offlineSync";
import { usePWAInstall } from "./utils/usePWAInstall";
import { downloadExcelTemplate, downloadCSVTemplate, parseProductFile } from "./utils/excelImport";

/* ---------------------------------------------------------------
   HardwareFlow — Business Management System
   Data persists via localStorage with automatic Supabase Cloud Sync.
   Design: Industrial ledger with Dark/Light theme & Full Auth.
---------------------------------------------------------------- */

const STORAGE_KEY = "hardwareflow-db-v1";
const AUTH_KEY = "hardwareflow-auth-session";
const THEME_KEY = "hardwareflow-theme";
const PAGE_KEY = "hardwareflow-active-page";

function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return "KSh " + v.toLocaleString("en-US");
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(date1, date2 = todayISO(0)) {
  if (!date1 || !date2) return false;
  return String(date1).slice(0, 10) === String(date2).slice(0, 10);
}

function isWithinRange(dateStr, startDate, endDate) {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}

function niceDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function uid(prefix) {
  return prefix + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

/* ---------- Single Unified Accurate Real-Time Stock Valuation Helper ---------- */
function getProductUnitCost(p) {
  if (!p) return 0;
  const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
  const buy = Number(p.buyPrice) || 0;
  if (buy > 0) return buy / factor;
  return Number(p.sellPrice) || 0;
}

function getProductStockValue(p) {
  if (!p) return 0;
  const stock = Math.max(0, Number(p.stock) || 0);
  return stock * getProductUnitCost(p);
}

function getInventoryMetrics(products = []) {
  let totalStockValue = 0;
  let totalUnits = 0;
  let lowStockCount = 0;

  products.forEach(p => {
    const stock = Math.max(0, Number(p.stock) || 0);
    const itemVal = getProductStockValue(p);
    totalUnits += stock;
    totalStockValue += itemVal;
    if (stock <= (Number(p.minStock) || 0)) {
      lowStockCount += 1;
    }
  });

  return {
    totalUnits,
    totalProducts: products.length,
    totalStockValue,
    lowStockCount,
  };
}

/* ---------- Product Ledger & Transaction History Helpers ---------- */
function getProductLedger(product) {
  if (!product) return [];
  const rawHistory = Array.isArray(product.history) ? product.history : [];
  if (rawHistory.length === 0) return [];

  let running = 0;
  return rawHistory.map((h, idx) => {
    const qty = Number(h.qty) || 0;
    const computedBalance = h.balance !== undefined ? Number(h.balance) : (running + qty);
    running = computedBalance;
    return {
      id: h.id || `h-${idx}`,
      date: h.date || todayISO(0),
      time: h.time || "",
      action: h.action || (qty > 0 ? "Receive Stock" : "Sale"),
      ref: h.ref || (h.action === "Sale" ? "POS" : h.action === "Opening Stock" ? "INIT" : "—"),
      qty: qty,
      balance: computedBalance,
      user: h.user || "Staff",
      reason: h.reason || h.notes || (h.action === "Opening Stock" ? "Opening stock balance" : ""),
    };
  });
}

function getProductLastSale(product, sales = []) {
  if (!product) return null;
  const relevant = (sales || []).filter(s => (s.items || []).some(it => it.productId === product.id));
  if (relevant.length > 0) {
    const sorted = [...relevant].sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
    return sorted[0];
  }
  const hist = (product.history || []).filter(h => h.action === "Sale" || Number(h.qty) < 0);
  if (hist.length > 0) {
    const sorted = [...hist].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return { date: sorted[0].date, invoiceNo: sorted[0].ref || "Sale" };
  }
  return null;
}

function getProductLastPurchase(product, purchases = []) {
  if (!product) return null;
  const relevant = (purchases || []).filter(p => (p.items || []).some(it => it.productId === product.id));
  if (relevant.length > 0) {
    const sorted = [...relevant].sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
    return sorted[0];
  }
  const hist = (product.history || []).filter(h => h.action === "Received" || h.action === "Receive Stock" || h.action === "Opening Stock");
  if (hist.length > 0) {
    const sorted = [...hist].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return { date: sorted[0].date, poNumber: sorted[0].ref || "Delivery" };
  }
  return null;
}

function buildSeed() {
  const users = [
    { id: "u1", username: "owner", password: "admin123", name: "Shop Owner", role: "owner", phone: "0722 000 111", pin: "7868" },
    { id: "u2", username: "cashier", password: "cashier123", name: "John — Cashier", role: "cashier", phone: "0722 000 222", pin: "1111" },
    { id: "u3", username: "store", password: "store123", name: "Mary — Storekeeper", role: "storekeeper", phone: "0722 000 333", pin: "2222" },
  ];

  const suppliers = [
    { id: "s1", name: "Bamburi & ABC Supplies", phone: "0722 100 200", terms: "Net 30", payments: [{ date: todayISO(-17), amount: 50000 }] },
    { id: "s2", name: "Doone Electricals", phone: "0733 400 500", terms: "Net 14", payments: [] },
    { id: "s3", name: "Steel & Nails Co", phone: "0711 800 900", terms: "Cash on delivery", payments: [] },
  ];

  const products = [
    {
      id: "p1", name: "Cement 50kg", category: "Cement & Building", brand: "Bamburi", sku: "CEM-001",
      description: "Portland all-purpose building cement for masonry & concrete work.",
      baseUnit: "bag", purchaseUnit: "bag", conversionFactor: 1,
      buyPrice: 650, sellPrice: 780, contractorPrice: 750, wholesalePrice: 730,
      minStock: 20, stock: 263, supplierId: "s1", location: "Main Store",
      history: [
        { id: "h1", date: todayISO(-21), time: "08:00", action: "Opening Stock", ref: "INIT-001", qty: 200, balance: 200, user: "Mary", reason: "Opening stock on hand" },
        { id: "h2", date: todayISO(-19), time: "10:14", action: "Sale", ref: "INV-1001", qty: -15, balance: 185, user: "John", reason: "Customer retail sale" },
        { id: "h3", date: todayISO(-17), time: "11:30", action: "Receive Stock", ref: "PO-1001", qty: 100, balance: 285, user: "Mary", reason: "Delivery from Bamburi" },
        { id: "h4", date: todayISO(-16), time: "14:20", action: "Sale", ref: "INV-1002", qty: -20, balance: 265, user: "John", reason: "Credit sale to ABC Construction" },
        { id: "h5", date: todayISO(-15), time: "16:45", action: "Adjustment", ref: "ADJ-1001", qty: -2, balance: 263, user: "Mary", reason: "Damage — Torn bags during handling" },
      ],
    },
    {
      id: "p2", name: "Electrical Cable 2.5mm", category: "Electrical", brand: "Doone", sku: "ELEC-010",
      description: "Single core pure copper conduit wiring cable (100m roll).",
      baseUnit: "metre", purchaseUnit: "roll", conversionFactor: 100,
      buyPrice: 8500, sellPrice: 110, contractorPrice: 100, wholesalePrice: 95,
      minStock: 200, stock: 385, supplierId: "s2", location: "Main Store",
      history: [
        { id: "h6", date: todayISO(-21), time: "08:00", action: "Opening Stock", ref: "INIT-002", qty: 400, balance: 400, user: "Mary", reason: "Opening stock" },
        { id: "h7", date: todayISO(-12), time: "14:30", action: "Sale", ref: "INV-2026-00449", qty: -15, balance: 385, user: "John", reason: "Customer sale" },
      ],
    },
    {
      id: "p3", name: "PVC Pipe 4-inch", category: "Plumbing", brand: "Kenpipe", sku: "PVC-004",
      description: "Heavy duty underground drainage and waste water PVC pipe (6m length).",
      baseUnit: "piece", purchaseUnit: "piece", conversionFactor: 1,
      buyPrice: 180, sellPrice: 250, contractorPrice: 230, wholesalePrice: 220,
      minStock: 15, stock: 100, supplierId: "s1", location: "Yard",
      history: [
        { id: "h8", date: todayISO(-21), time: "08:00", action: "Opening Stock", ref: "INIT-003", qty: 100, balance: 100, user: "Mary", reason: "Initial setup" },
      ],
    },
    {
      id: "p4", name: "Nails 4-inch", category: "Fasteners & Hardware", brand: "SteelCo", sku: "NAIL-004",
      description: "Timber construction wire nails for roofing & formwork.",
      baseUnit: "kg", purchaseUnit: "bag (25kg)", conversionFactor: 25,
      buyPrice: 3000, sellPrice: 150, contractorPrice: 145, wholesalePrice: 135,
      minStock: 50, stock: 67, supplierId: "s3", location: "Store",
      history: [
        { id: "h9", date: todayISO(-21), time: "08:00", action: "Opening Stock", ref: "INIT-004", qty: 75, balance: 75, user: "Mary", reason: "Opening stock" },
        { id: "h10", date: todayISO(-10), time: "09:30", action: "Sale", ref: "INV-2026-00451", qty: -8, balance: 67, user: "John", reason: "Cash sale" },
      ],
    },
    {
      id: "p5", name: "Gloss Paint 4L", category: "Paint & Finishes", brand: "Crown", sku: "PNT-004",
      description: "Brilliant white super gloss oil paint for wood & metal surfaces.",
      baseUnit: "tin", purchaseUnit: "carton (12)", conversionFactor: 12,
      buyPrice: 12000, sellPrice: 1450, contractorPrice: 1380, wholesalePrice: 1300,
      minStock: 24, stock: 16, supplierId: "s2", location: "Shop",
      history: [
        { id: "h11", date: todayISO(-21), time: "08:00", action: "Opening Stock", ref: "INIT-005", qty: 24, balance: 24, user: "Mary", reason: "Opening stock" },
        { id: "h12", date: todayISO(-6), time: "11:15", action: "Sale", ref: "INV-2026-00452", qty: -8, balance: 16, user: "John", reason: "Credit sale" },
      ],
    },
  ];

  const purchases = [
    {
      id: "po1",
      poNumber: "PO-1001",
      supplierId: "s1",
      supplierName: "Bamburi & ABC Supplies",
      date: todayISO(-20),
      time: "10:15",
      items: [{ productId: "p1", productName: "Cement 50kg", qty: 130, unit: "bag", unitPrice: 650, lineTotal: 84500 }],
      total: 85000,
      payment: "credit",
      receivedBy: "Mary",
      notes: "Bamburi building cement delivery",
    },
    {
      id: "po2",
      poNumber: "PO-1002",
      supplierId: "s1",
      supplierName: "Bamburi & ABC Supplies",
      date: todayISO(-12),
      time: "14:20",
      items: [
        { productId: "p1", productName: "Cement 50kg", qty: 80, unit: "bag", unitPrice: 650, lineTotal: 52000 },
        { productId: "p3", productName: "PVC Pipe 4-inch", qty: 44, unit: "piece", unitPrice: 180, lineTotal: 7920 },
      ],
      total: 60000,
      payment: "credit",
      receivedBy: "Mary",
      notes: "Building materials delivery",
    },
  ];

  const customers = [
    { id: "c1", name: "ABC Construction Ltd", phone: "0722 555 111", creditLimit: 500000, payments: [{ date: todayISO(-12), amount: 100000 }, { date: todayISO(0), amount: 25000 }] },
    { id: "c2", name: "John Builders", phone: "0733 555 222", creditLimit: 100000, payments: [{ date: todayISO(-3), amount: 20000 }] },
    { id: "c3", name: "XYZ Contractors", phone: "0711 555 333", creditLimit: 150000, payments: [{ date: todayISO(-40), amount: 15000 }] },
  ];

  const sales = [
    { id: uid("INV"), invoiceNo: "INV-2026-00410", date: todayISO(-15), time: "09:00", items: [{ productId: "p1", qty: 200, unitPrice: 750, unitCost: 650 }], total: 150000, cost: 130000, profit: 20000, payment: "credit", customerId: "c1", employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00415", date: todayISO(-8), time: "10:30", items: [{ productId: "p2", qty: 400, unitPrice: 100, unitCost: 85 }], total: 40000, cost: 34000, profit: 6000, payment: "credit", customerId: "c2", employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00418", date: todayISO(-35), time: "11:00", items: [{ productId: "p5", qty: 30, unitPrice: 1400, unitCost: 1000 }], total: 42000, cost: 30000, profit: 12000, payment: "credit", customerId: "c3", employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00448", date: todayISO(-2), time: "10:14", items: [{ productId: "p1", qty: 12, unitPrice: 780, unitCost: 650 }], total: 9360, cost: 7800, profit: 1560, payment: "cash", customerId: null, employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00449", date: todayISO(-1), time: "14:30", items: [{ productId: "p2", qty: 15, unitPrice: 110, unitCost: 85 }], total: 1650, cost: 1275, profit: 375, payment: "mpesa", customerId: null, employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00450", date: todayISO(0), time: "08:45", items: [{ productId: "p1", qty: 50, unitPrice: 750, unitCost: 650 }], total: 37500, cost: 32500, profit: 5000, payment: "credit", customerId: "c1", employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00451", date: todayISO(0), time: "09:30", items: [{ productId: "p3", qty: 20, unitPrice: 250, unitCost: 180 }, { productId: "p4", qty: 8, unitPrice: 150, unitCost: 120 }], total: 6200, cost: 4560, profit: 1640, payment: "mpesa", customerId: null, employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00452", date: todayISO(0), time: "11:15", items: [{ productId: "p2", qty: 200, unitPrice: 95, unitCost: 85 }, { productId: "p5", qty: 8, unitPrice: 1450, unitCost: 1000 }], total: 30600, cost: 21600, profit: 9000, payment: "credit", customerId: "c3", employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00453", date: todayISO(0), time: "13:40", items: [{ productId: "p1", qty: 13, unitPrice: 780, unitCost: 650 }], total: 10140, cost: 8450, profit: 1690, payment: "cash", customerId: null, employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00420", date: todayISO(-3), time: "09:10", items: [{ productId: "p1", qty: 300, unitPrice: 780, unitCost: 650 }], total: 234000, cost: 195000, profit: 39000, payment: "cash", customerId: null, employee: "John" },
    { id: uid("INV"), invoiceNo: "INV-2026-00421", date: todayISO(-4), time: "11:25", items: [{ productId: "p2", qty: 700, unitPrice: 110, unitCost: 85 }], total: 77000, cost: 59500, profit: 17500, payment: "mpesa", customerId: null, employee: "John" },
  ];

  const expenses = [
    { id: uid("EXP"), date: todayISO(0), category: "Transport", amount: 4200, description: "Delivery to customer site", payment: "cash" },
    { id: uid("EXP"), date: todayISO(-5), category: "Rent", amount: 50000, description: "Monthly shop rent", payment: "mpesa" },
    { id: uid("EXP"), date: todayISO(-2), category: "Salaries", amount: 180000, description: "Staff wages", payment: "mpesa" },
    { id: uid("EXP"), date: todayISO(-3), category: "Electricity", amount: 18200, description: "Power bill (KPLC)", payment: "mpesa" },
    { id: uid("EXP"), date: todayISO(-7), category: "Repairs", amount: 12000, description: "Forklift maintenance", payment: "cash" },
  ];

  const quotations = [
    { id: uid("QT"), number: "QT-1041", customerId: "c2", date: todayISO(-4), status: "sent",
      items: [{ productId: "p1", qty: 30, unitPrice: 750 }, { productId: "p3", qty: 10, unitPrice: 230 }] },
  ];

  const auditLog = [
    { id: uid("LOG"), time: todayISO(0) + " 13:40", user: "John", role: "Cashier", category: "Sale", action: "Sold 13 × Cement 50kg", detail: fmt(10140) + " (INV-2026-00453)", target: "Cement 50kg" },
    { id: uid("LOG"), time: todayISO(0) + " 11:15", user: "John", role: "Cashier", category: "Credit Sale", action: "Recorded credit sale for XYZ Contractors", detail: fmt(30600) + " (INV-2026-00452)", target: "XYZ Contractors" },
    { id: uid("LOG"), time: todayISO(0) + " 10:15", user: "Mary", role: "Storekeeper", category: "Stock Received", action: "Received 100 × Cement 50kg", detail: "from Bamburi & ABC Supplies", target: "Cement 50kg" },
    { id: uid("LOG"), time: todayISO(-1) + " 11:02", user: "Owner", role: "Owner", category: "Price Change", action: "Changed selling price — Cement 50kg", detail: "750 → 780 KSh", target: "Cement 50kg" },
    { id: uid("LOG"), time: todayISO(-1) + " 11:43", user: "Mary", role: "Storekeeper", category: "Adjustment", action: "Stock adjustment — Cement 50kg", detail: "-2 bags, reason: Damage — Torn bags during handling", target: "Cement 50kg" },
  ];

  return {
    users, products, suppliers, customers, sales, expenses, quotations, auditLog, purchases,
    invoiceSeq: 454, quoteSeq: 1042, poSeq: 2046, adjSeq: 1002,
  };
}

/* ---------- storage hook with real-time Supabase syncing ---------- */
function useDB() {
  const [db, setDb] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed.users || parsed.users.length === 0) {
          parsed.users = buildSeed().users;
        }
        if (!parsed.purchases) {
          parsed.purchases = buildSeed().purchases;
        }
        if (!parsed.adjSeq) {
          parsed.adjSeq = 1002;
        }
        return parsed;
      }
    } catch (error) {
      console.error("Failed to load HardwareFlow data from localStorage:", error);
    }
    const initialData = buildSeed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
    } catch (e) {
      console.error(e);
    }
    return initialData;
  });

  const [loading] = useState(false);
  const isInitialCloudSync = useRef(false);

  // 1. Initial background cloud pull on app launch & automatic cryptographic password migration
  useEffect(() => {
    if (!isInitialCloudSync.current && db) {
      isInitialCloudSync.current = true;
      (async () => {
        try {
          const cloudDb = await pullDatabaseFromSupabase();
          const hasCloudData = cloudDb && (
            (cloudDb.products && cloudDb.products.length > 0) ||
            (cloudDb.sales && cloudDb.sales.length > 0) ||
            (cloudDb.customers && cloudDb.customers.length > 0) ||
            (cloudDb.expenses && cloudDb.expenses.length > 0)
          );

          let targetDb = db;
          if (hasCloudData) {
            targetDb = cloudDb;
          }

          // Check if any users have unhashed legacy passwords or pins, and ensure owner recovery PIN is 7868
          let needsMigration = false;
          const upgradedUsers = await Promise.all(
            (targetDb.users || []).map(async (u) => {
              let updated = { ...u };
              if (u.password && !u.password.startsWith("pbkdf2:")) {
                updated.password = await hashPassword(u.password);
                needsMigration = true;
              }
              if (u.role === "owner" || u.username.toLowerCase() === "owner") {
                const { valid: is7868 } = await verifyPassword("7868", u.pin || "");
                if (!is7868) {
                  updated.pin = await hashPassword("7868");
                  needsMigration = true;
                }
              } else if (u.pin && !u.pin.startsWith("pbkdf2:")) {
                updated.pin = await hashPassword(u.pin);
                needsMigration = true;
              }
              return updated;
            })
          );

          if (needsMigration) {
            targetDb = { ...targetDb, users: upgradedUsers };
            console.log("[HardwareFlow Security] Upgraded credentials to salted PBKDF2-SHA256 hashes.");
          }

          setDb(targetDb);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(targetDb));

          if (!hasCloudData || needsMigration) {
            autoSyncDatabase(targetDb, 0);
          }
        } catch (err) {
          console.warn("[HardwareFlow] Initial Supabase cloud fetch notice:", err.message || err);
        }
      })();
    }
  }, [db]);

  // 2. Persist locally and push updates to Supabase immediately in real-time
  useEffect(() => {
    if (!db) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (error) {
      console.error("Failed to save HardwareFlow data to localStorage:", error);
    }
    // Push immediately to Supabase in real-time
    autoSyncDatabase(db, 50);
  }, [db]);

  // 3. Realtime Supabase Subscription: Listen for changes from other sessions/cloud
  useEffect(() => {
    let cloudPullTimeout = null;
    const unsubscribe = subscribeToSupabaseRealtime(async () => {
      // Avoid pulling our own echo while an active push is in flight
      if (getIsSyncing()) return;

      if (cloudPullTimeout) clearTimeout(cloudPullTimeout);
      cloudPullTimeout = setTimeout(async () => {
        try {
          if (getIsSyncing()) return;
          const cloudDb = await pullDatabaseFromSupabase();
          if (cloudDb && cloudDb.products && cloudDb.products.length > 0) {
            setDb(prevLocal => {
              if (!prevLocal) return cloudDb;

              // Non-destructive merge: preserve only unsynced offline items without resurrecting deleted items
              const cloudSaleInvoices = new Set((cloudDb.sales || []).map(s => s.invoiceNo || s.id));
              const pendingLocalSales = (prevLocal.sales || []).filter(s => s.offline === true && !cloudSaleInvoices.has(s.invoiceNo) && !cloudSaleInvoices.has(s.id));

              const cloudExpIds = new Set((cloudDb.expenses || []).map(e => e.id));
              const pendingLocalExpenses = (prevLocal.expenses || []).filter(e => e.offline === true && !cloudExpIds.has(e.id));

              const merged = {
                ...cloudDb,
                sales: [...pendingLocalSales, ...(cloudDb.sales || [])],
                expenses: [...pendingLocalExpenses, ...(cloudDb.expenses || [])],
                auditLog: cloudDb.auditLog || [],
                invoiceSeq: Math.max(cloudDb.invoiceSeq || 0, prevLocal.invoiceSeq || 0),
                quoteSeq: Math.max(cloudDb.quoteSeq || 0, prevLocal.quoteSeq || 0),
              };

              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
              } catch (e) {
                console.error(e);
              }
              return merged;
            });
          }
        } catch (err) {
          console.warn("[HardwareFlow] Realtime sync refresh notice:", err);
        }
      }, 300);
    });

    return () => {
      if (cloudPullTimeout) clearTimeout(cloudPullTimeout);
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  return [db, setDb, loading];
}

/* ---------- design tokens / global style ---------- */
const GlobalStyle = ({ theme }) => {
  const isDark = theme === "dark";
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
      
      .hf-root {
        --bg: ${isDark ? "#090B0E" : "#F0F1F4"};
        --surface: ${isDark ? "#12161F" : "#FFFFFF"};
        --surface-hover: ${isDark ? "#19202D" : "#FAFAFC"};
        --ink: ${isDark ? "#F1F5F9" : "#171B22"};
        --ink-soft: ${isDark ? "#94A3B8" : "#6B7280"};
        --ink-faint: ${isDark ? "#64748B" : "#9AA1AC"};
        --line: ${isDark ? "#242C3C" : "#E4E6EA"};
        --line-soft: ${isDark ? "#1B212D" : "#EEEFF2"};
        --table-header: ${isDark ? "#171C26" : "#FBFBFC"};
        --rust: #C1502F;
        --rust-dark: #9C3F25;
        --rust-tint: ${isDark ? "#2B1612" : "#FBEEE9"};
        --steel: ${isDark ? "#4B6B82" : "#33546B"};
        --green: ${isDark ? "#34D399" : "#2F8050"};
        --green-dark: #059669;
        --green-tint: ${isDark ? "#062817" : "#E7F5EC"};
        --amber: ${isDark ? "#FBBF24" : "#B4790F"};
        --amber-tint: ${isDark ? "#291E06" : "#FCF1DE"};
        --red: ${isDark ? "#F87171" : "#C13A2E"};
        --red-dark: #DC2626;
        --red-tint: ${isDark ? "#2B1110" : "#FBEAE8"};
        --tab-bg: ${isDark ? "#07080B" : "#14171D"};
        --shadow-sm: 0 1px 2px ${isDark ? "rgba(0,0,0,0.3)" : "rgba(20,24,30,0.05)"};
        --shadow-md: 0 4px 16px -4px ${isDark ? "rgba(0,0,0,0.4)" : "rgba(20,24,30,0.10)"};
        --shadow-lg: 0 20px 48px -12px ${isDark ? "rgba(0,0,0,0.6)" : "rgba(20,24,30,0.22)"};
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background: var(--bg);
        -webkit-font-smoothing: antialiased;
        transition: background .2s ease, color .2s ease;
        width: 100%;
        max-width: 100%;
        min-height: 100vh;
        box-sizing: border-box;
        overflow-x: hidden;
      }
      .hf-root .disp { font-family: 'Barlow Condensed', sans-serif; letter-spacing: 0.01em; }
      .hf-root .mono { font-family: 'IBM Plex Mono', monospace; font-feature-settings: "tnum"; }
      .hf-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 14px;
        box-shadow: var(--shadow-sm);
        transition: background .2s ease, border-color .2s ease;
      }
      .hf-ticket {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 14px;
        box-shadow: var(--shadow-sm);
        position: relative;
        transition: box-shadow .18s ease, transform .18s ease, background .2s ease;
      }
      .hf-ticket:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
      .hf-btn {
        font-weight: 600; font-size: 13.5px; border-radius: 9px;
        padding: 9px 16px; cursor: pointer; border: 1px solid transparent;
        display: inline-flex; align-items: center; gap: 6px;
        transition: filter .14s ease, transform .06s ease, box-shadow .14s ease, background .14s ease;
        font-family: 'Inter', sans-serif;
        user-select: none;
      }
      .hf-btn:active { transform: translateY(1px) scale(0.99); }
      .hf-btn:disabled { opacity: .45; cursor: not-allowed; }
      .hf-btn-primary { background: linear-gradient(180deg, #C7573A, var(--rust)); color: #fff; box-shadow: 0 1px 2px rgba(156,63,37,0.15), 0 6px 14px -6px rgba(193,80,47,0.55); }
      .hf-btn-primary:hover { filter: brightness(1.06); box-shadow: 0 1px 2px rgba(156,63,37,0.2), 0 10px 18px -6px rgba(193,80,47,0.6); }
      .hf-btn-ghost { background: ${isDark ? "#171D27" : "#fff"}; color: var(--ink); border-color: var(--line); }
      .hf-btn-ghost:hover { background: ${isDark ? "#212837" : "#F7F8F9"}; border-color: ${isDark ? "#3A455A" : "#D6D9DE"}; }
      .hf-btn-dark { background: ${isDark ? "#2A3344" : "var(--ink)"}; color: #fff; }
      .hf-btn-dark:hover { filter: brightness(1.15); }
      .hf-btn-danger { background: var(--red); color: #fff; }
      .hf-btn-danger:hover { filter: brightness(1.1); }
      .hf-input {
        border: 1.5px solid var(--line); border-radius: 9px; padding: 10px 12px;
        font-size: 14px; font-family: 'Inter', sans-serif; width: 100%;
        background: ${isDark ? "#0E1118" : "#fff"}; color: var(--ink);
        transition: border-color .14s ease, box-shadow .14s ease, background .14s ease;
        box-sizing: border-box;
      }
      .hf-input:focus { outline: none; border-color: var(--rust); box-shadow: 0 0 0 3.5px var(--rust-tint); }
      .hf-input:hover:not(:focus) { border-color: ${isDark ? "#3A455A" : "#C9CDD3"}; }
      .hf-input-with-left-icon {
        padding-left: 42px !important;
      }
      .hf-input-with-right-icon {
        padding-right: 42px !important;
      }
      .hf-input-with-both-icons {
        padding-left: 42px !important;
        padding-right: 42px !important;
      }
      .hf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .hf-table th {
        text-align: left; font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase;
        color: var(--ink-faint); font-weight: 700; padding: 12px 14px; border-bottom: 1.5px solid var(--line);
        background: var(--table-header);
      }
      .hf-table th:first-child { border-top-left-radius: 14px; }
      .hf-table th:last-child { border-top-right-radius: 14px; }
      .hf-table td { padding: 12px 14px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
      .hf-table tr:last-child td { border-bottom: none; }
      .hf-table tbody tr:hover td { background: var(--surface-hover); }
      .hf-pill { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; letter-spacing: .01em; }
      .hf-navitem {
        display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin: 1px 10px;
        color: ${isDark ? "#94A3B8" : "#A9B0BC"}; font-size: 13.5px; font-weight: 500; cursor: pointer;
        border-radius: 9px; transition: background .14s ease, color .14s ease;
      }
      .hf-navitem:hover { background: rgba(255,255,255,0.06); color: #fff; }
      .hf-navitem.active { background: var(--rust); color: #fff; box-shadow: 0 4px 14px -4px rgba(193,80,47,0.6); }
      .hf-navitem.locked { color: #565C68; }
      .hf-navitem.locked:hover { background: rgba(255,255,255,0.03); color: #7B8290; }
      .hf-kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-soft); font-weight: 700; }
      .hf-icon-circle { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .text-profit { color: var(--green) !important; }
      .text-loss { color: var(--red) !important; }

      /* Layout Containers */
      .hf-root {
        display: flex;
        flex-direction: row;
        width: 100%;
        max-width: 100%;
        min-height: 100vh;
        background: var(--bg);
        overflow-x: hidden;
        box-sizing: border-box;
      }
      .hf-sidebar {
        width: 240px;
        background: var(--tab-bg);
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        padding: 20px 0;
      }
      .hf-main-wrap {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        width: 100%;
        max-width: 100%;
        overflow-x: hidden;
        box-sizing: border-box;
      }
      .hf-main-content-wrap {
        flex: 1;
        overflow-y: auto;
        padding: 24px 32px;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        overflow-x: hidden;
      }

      /* Valuation Summary Banner */
      .hf-stock-banner {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-bottom: 20px;
      }

      /* Desktop vs Mobile component toggles */
      .hf-desktop-only { display: block !important; }
      .hf-mobile-only { display: none !important; }
      .hf-mobile-header { display: none !important; }
      .hf-mobile-bottomnav { display: none !important; }
      .hf-mobile-backdrop { display: none !important; }

      .hf-table-responsive {
        width: 100%;
        max-width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }

      /* Grid helpers */
      .hf-field-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      .hf-kpis-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 12px;
        margin-bottom: 22px;
      }

      .hf-cashbook-summary {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-bottom: 20px;
      }

      .hf-two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      /* Mobile & Tablet Full Screen Optimization (Screen width <= 1024px) */
      @media (max-width: 1024px) {
        .hf-desktop-only { display: none !important; }
        .hf-mobile-only { display: block !important; }

        .hf-root {
          flex-direction: column !important;
          width: 100% !important;
          min-width: 100% !important;
          min-height: 100vh !important;
          box-sizing: border-box !important;
          overflow-x: hidden !important;
        }

        .hf-mobile-header {
          display: flex !important;
          align-items: center;
          justify-content: space-between;
          padding: max(10px, env(safe-area-inset-top, 10px)) 14px 10px !important;
          background: var(--tab-bg);
          color: #fff;
          position: sticky;
          top: 0;
          z-index: 900;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 2px 10px rgba(0,0,0,0.25);
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }

        .hf-mobile-backdrop {
          display: block !important;
          position: fixed !important;
          inset: 0 !important;
          background: rgba(0,0,0,0.65) !important;
          backdrop-filter: blur(4px) !important;
          z-index: 1150 !important;
        }

        .hf-sidebar {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          bottom: 0 !important;
          width: min(85vw, 300px) !important;
          height: 100vh !important;
          height: 100dvh !important;
          z-index: 1200 !important;
          transform: translateX(-100%) !important;
          transition: transform .25s cubic-bezier(0.4, 0, 0.2, 1) !important;
          box-shadow: 0 0 40px rgba(0,0,0,0.7) !important;
          padding-top: max(20px, env(safe-area-inset-top, 20px)) !important;
          background: var(--tab-bg) !important;
        }
        .hf-sidebar.open {
          transform: translateX(0) !important;
        }

        .hf-desktop-topbar {
          display: none !important;
        }

        .hf-main-wrap {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
          overflow-x: hidden !important;
        }

        .hf-main-content-wrap {
          padding: 14px 14px calc(80px + env(safe-area-inset-bottom, 12px)) !important;
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
          -webkit-overflow-scrolling: touch !important;
          overflow-x: hidden !important;
        }

        .hf-mobile-bottomnav {
          display: flex !important;
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          height: calc(62px + env(safe-area-inset-bottom, 0px)) !important;
          padding-bottom: env(safe-area-inset-bottom, 0px) !important;
          background: var(--surface) !important;
          border-top: 1.5px solid var(--line) !important;
          z-index: 950 !important;
          justify-content: space-around !important;
          align-items: center !important;
          box-shadow: 0 -4px 20px rgba(0,0,0,0.12) !important;
        }

        .hf-bottom-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          flex: 1;
          height: 100%;
          color: var(--ink-soft);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          background: transparent;
          padding: 6px 0;
          -webkit-tap-highlight-color: transparent;
        }
        .hf-bottom-item.active {
          color: var(--rust) !important;
          font-weight: 700 !important;
        }

        .hf-stock-banner {
          grid-template-columns: 1fr !important;
          gap: 10px !important;
        }

        .hf-kpis-grid {
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 10px !important;
          margin-bottom: 18px !important;
        }

        .hf-cashbook-summary {
          grid-template-columns: 1fr !important;
          gap: 10px !important;
        }

        .hf-two-col {
          grid-template-columns: 1fr !important;
          gap: 14px !important;
        }

        .hf-field-grid {
          grid-template-columns: 1fr !important;
          gap: 12px !important;
        }

        .hf-ticket {
          padding: 14px 14px !important;
          min-height: 100px !important;
          height: auto !important;
        }

        .hf-card {
          border-radius: 14px !important;
        }

        .hf-btn {
          min-height: 44px !important;
          font-size: 14px !important;
        }

        .hf-input {
          font-size: 16px !important; /* Prevents auto-zoom in iOS Safari */
          min-height: 44px !important;
          padding-top: 10px !important;
          padding-bottom: 10px !important;
          padding-left: 14px;
          padding-right: 14px;
          box-sizing: border-box !important;
        }
        .hf-input.hf-input-with-left-icon,
        .hf-input-with-left-icon {
          padding-left: 42px !important;
        }
        .hf-input.hf-input-with-right-icon,
        .hf-input-with-right-icon {
          padding-right: 42px !important;
        }
        .hf-input.hf-input-with-both-icons,
        .hf-input-with-both-icons {
          padding-left: 42px !important;
          padding-right: 42px !important;
        }

        /* Mobile Modal Bottom Sheet */
        .hf-modal-card {
          width: 100% !important;
          max-width: 100% !important;
          max-height: 90vh !important;
          max-height: 90dvh !important;
          border-radius: 20px 20px 0 0 !important;
          margin-top: auto !important;
          padding: 20px 16px calc(24px + env(safe-area-inset-bottom, 12px)) !important;
        }
      }

      @media (max-width: 380px) {
        .hf-kpis-grid {
          grid-template-columns: 1fr !important;
          gap: 8px !important;
        }
      }
    `}</style>
  );
};

/* ---------- shared bits ---------- */
function Pill({ tone, children }) {
  const map = {
    green: { bg: "var(--green-tint)", c: "var(--green)" },
    amber: { bg: "var(--amber-tint)", c: "var(--amber)" },
    red: { bg: "var(--red-tint)", c: "var(--red)" },
    steel: { bg: "#E4EBEF", c: "#33546B" },
    ink: { bg: "#E9EAEC", c: "#1B222C" },
    purple: { bg: "#F3E8FF", c: "#7E22CE" },
  };
  const s = map[tone] || map.ink;
  return <span className="hf-pill" style={{ background: s.bg, color: s.c }}>{children}</span>;
}

function Locked({ label }) {
  return (
    <div className="hf-card" style={{ padding: 40, textAlign: "center", maxWidth: 420, margin: "60px auto" }}>
      <Lock size={26} color="#B23A2E" />
      <div className="disp" style={{ fontSize: 22, fontWeight: 700, marginTop: 12 }}>Owner access only</div>
      <div style={{ color: "var(--ink-soft)", fontSize: 13.5, marginTop: 6 }}>
        {label} is restricted to the business Owner. Sign in with Owner credentials to access this section.
      </div>
    </div>
  );
}

function priceFor(product, tier) {
  if (tier === "contractor" && product.contractorPrice) return product.contractorPrice;
  if (tier === "wholesale" && product.wholesalePrice) return product.wholesalePrice;
  return product.sellPrice;
}

/* ================= STORE SECURITY & PIN VERIFICATION MODAL ================= */
function PinVerificationModal({ isOpen, title, description, onSuccess, onCancel, db }) {
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen) return null;

  async function handleVerify(e) {
    if (e) e.preventDefault();
    setError("");
    if (!pin.trim()) {
      setError("Please enter the Store Security PIN.");
      return;
    }

    setIsVerifying(true);
    try {
      const isValid = await verifyActionPin(pin.trim(), db);
      if (isValid) {
        setPin("");
        setError("");
        onSuccess();
      } else {
        setError("Incorrect Store Security PIN. Check with shop owner.");
      }
    } catch (err) {
      console.error(err);
      setError("Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  }

  function handleKeypadPress(digit) {
    setError("");
    if (pin.length < 6) {
      setPin(prev => prev + digit);
    }
  }

  function handleBackspace() {
    setError("");
    setPin(prev => prev.slice(0, -1));
  }

  function handleClear() {
    setError("");
    setPin("");
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,12,16,0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 15000,
        padding: "16px",
      }}
      onClick={e => { e.stopPropagation(); onCancel(); }}
    >
      <div
        className="hf-card hf-modal-card"
        style={{
          width: 420,
          maxWidth: "96vw",
          maxHeight: "92vh",
          overflowY: "auto",
          padding: "22px 20px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          margin: "auto",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="disp" style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, color: "var(--rust)" }}>
            <Key size={18} /> {title || "Store PIN Verification"}
          </div>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onCancel(); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12, lineHeight: 1.4 }}>
          {description || "Enter the Master Store Security PIN to authorize this sensitive action."}
        </div>

        {error && (
          <div style={{ background: "var(--red-tint)", color: "var(--red)", border: "1px solid var(--red)", padding: "8px 10px", borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleVerify}>
          <div style={{ marginBottom: 12 }}>
            <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Enter Store Security PIN (4–6 digits)</div>
            <div style={{ position: "relative" }}>
              <input
                className="hf-input mono hf-input-with-right-icon"
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                style={{ paddingRight: 40, fontSize: 18, textAlign: "center", letterSpacing: "0.25em", fontWeight: 700 }}
                placeholder="••••"
                value={pin}
                onClick={e => e.stopPropagation()}
                onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
                autoFocus
              />
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setShowPin(!showPin); }}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)", padding: 4, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4, textAlign: "center" }}>
              Default: 7868 (Created / managed by the Shop Owner)
            </div>
          </div>

          {/* Touch-Friendly On-Screen Numpad for Mobile */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); handleKeypadPress(String(num)); }}
                  className="hf-btn hf-btn-ghost"
                  style={{
                    height: 42,
                    fontSize: 16,
                    fontWeight: 700,
                    justifyContent: "center",
                    borderRadius: 8,
                    background: "var(--surface-hover)",
                  }}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); handleClear(); }}
                className="hf-btn hf-btn-ghost"
                style={{ height: 42, fontSize: 12, fontWeight: 600, justifyContent: "center", borderRadius: 8, color: "var(--ink-soft)" }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); handleKeypadPress("0"); }}
                className="hf-btn hf-btn-ghost"
                style={{ height: 42, fontSize: 16, fontWeight: 700, justifyContent: "center", borderRadius: 8, background: "var(--surface-hover)" }}
              >
                0
              </button>
              <button
                type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); handleBackspace(); }}
                className="hf-btn hf-btn-ghost"
                style={{ height: 42, fontSize: 13, fontWeight: 600, justifyContent: "center", borderRadius: 8, color: "var(--red)" }}
              >
                ⌫ Del
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ justifyContent: "center", minHeight: 44 }}
              onClick={e => { e.stopPropagation(); onCancel(); }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="hf-btn hf-btn-primary"
              style={{ justifyContent: "center", minHeight: 44 }}
              disabled={isVerifying || !pin}
            >
              <Check size={16} /> {isVerifying ? "Verifying..." : "Authorize"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ================= DASHBOARD ================= */
function Dashboard({ db, role, notify }) {
  const [period, setPeriod] = useState("today"); // "today" | "week" | "month" | "all"
  const [bestSellerSort, setBestSellerSort] = useState("revenue"); // "revenue" | "profit" | "qty"

  const today = todayISO(0);
  const startOfWeek = todayISO(-7);
  const startOfMonth = today.slice(0, 8) + "01";

  // Filter transactions based on selected period
  const filteredSales = useMemo(() => {
    if (period === "today") return db.sales.filter(s => isSameDay(s.date, today));
    if (period === "week") return db.sales.filter(s => isWithinRange(s.date, startOfWeek, today));
    if (period === "month") return db.sales.filter(s => isWithinRange(s.date, startOfMonth, today));
    return db.sales;
  }, [db.sales, period, today, startOfWeek, startOfMonth]);

  const filteredExpenses = useMemo(() => {
    if (period === "today") return db.expenses.filter(e => isSameDay(e.date, today));
    if (period === "week") return db.expenses.filter(e => isWithinRange(e.date, startOfWeek, today));
    if (period === "month") return db.expenses.filter(e => isWithinRange(e.date, startOfMonth, today));
    return db.expenses;
  }, [db.expenses, period, today, startOfWeek, startOfMonth]);

  const debtsCollected = useMemo(() => {
    const allPayments = db.customers.flatMap(c => c.payments || []);
    if (period === "today") return allPayments.filter(p => isSameDay(p.date, today));
    if (period === "week") return allPayments.filter(p => isWithinRange(p.date, startOfWeek, today));
    if (period === "month") return allPayments.filter(p => isWithinRange(p.date, startOfMonth, today));
    return allPayments;
  }, [db.customers, period, today, startOfWeek, startOfMonth]);

  const revenuePeriod = filteredSales.reduce((a, s) => a + s.total, 0);
  const profitPeriod = filteredSales.reduce((a, s) => a + s.profit, 0);
  const expensesPeriod = filteredExpenses.reduce((a, e) => a + e.amount, 0);
  const net = profitPeriod - expensesPeriod;
  const debtsCollectedTotal = debtsCollected.reduce((a, p) => a + p.amount, 0);

  const custBalances = db.customers.map(c => ({ ...c, balance: customerBalance(db, c.id) }));
  const totalDebt = custBalances.reduce((a, c) => a + c.balance, 0);
  const overdue = custBalances.filter(c => c.balance > 0 && daysSinceLastActivity(db, c.id) > 25);

  const suppBalances = db.suppliers.map(s => ({ ...s, outstanding: supplierOutstanding(db, s.id) }));
  const totalSupplierBal = suppBalances.reduce((a, s) => a + s.outstanding, 0);

  const inventoryMetrics = useMemo(() => getInventoryMetrics(db.products), [db.products]);
  const lowStock = db.products.filter(p => p.stock <= p.minStock);
  const slowMoving = db.products.filter(p => !db.sales.some(s => s.items.some(i => i.productId === p.id) && s.date >= todayISO(-14)));

  const bestSellers = useMemo(() => {
    const counts = {};
    filteredSales.forEach(s => {
      s.items.forEach(it => {
        const p = db.products.find(prod => prod.id === it.productId);
        if (!p) return;
        if (!counts[p.id]) {
          counts[p.id] = { id: p.id, name: p.name, category: p.category, qty: 0, revenue: 0, profit: 0 };
        }
        counts[p.id].qty += it.qty;
        counts[p.id].revenue += it.qty * it.unitPrice;
        counts[p.id].profit += it.qty * (it.unitPrice - (it.unitCost || 0));
      });
    });
    return Object.values(counts);
  }, [filteredSales, db.products]);

  const sortedBestSellers = useMemo(() => {
    return [...bestSellers].sort((a, b) => {
      if (bestSellerSort === "profit") return b.profit - a.profit;
      if (bestSellerSort === "qty") return b.qty - a.qty;
      return b.revenue - a.revenue;
    });
  }, [bestSellers, bestSellerSort]);

  // Dynamic titles and subtitles based on active period
  let periodTitle = "Today's overview";
  let periodSubtitle = niceDate(today);
  let salesLabel = "Sales Today";
  let profitLabel = "Gross Profit Today";
  let expLabel = "Expenses Today";
  let netLabel = "Net Income Today";
  let debtsLabel = "Debts Collected Today";

  if (period === "week") {
    periodTitle = "Last 7 Days Overview";
    periodSubtitle = `${niceDate(startOfWeek)} — ${niceDate(today)}`;
    salesLabel = "Sales (7 Days)";
    profitLabel = "Gross Profit (7 Days)";
    expLabel = "Expenses (7 Days)";
    netLabel = "Net Income (7 Days)";
    debtsLabel = "Debts Collected (7 Days)";
  } else if (period === "month") {
    periodTitle = "This Month's Overview";
    periodSubtitle = `${niceDate(startOfMonth)} — ${niceDate(today)}`;
    salesLabel = "Sales (This Month)";
    profitLabel = "Gross Profit (This Month)";
    expLabel = "Expenses (This Month)";
    netLabel = "Net Income (This Month)";
    debtsLabel = "Debts Collected (This Month)";
  } else if (period === "all") {
    periodTitle = "All-Time Financial Overview";
    periodSubtitle = "Cumulative business lifetime";
    salesLabel = "Total Revenue";
    profitLabel = "Total Gross Profit";
    expLabel = "Total Expenses";
    netLabel = "Total Net Profit";
    debtsLabel = "Total Debts Collected";
  }

  let netTone = "green";
  let netValue = "+" + fmt(net);
  let netColor = "var(--green)";
  let netSub = "Profit margin positive";

  if (filteredSales.length === 0 && expensesPeriod === 0) {
    netTone = "ink";
    netValue = fmt(0);
    netColor = "var(--ink-soft)";
    netSub = "Break-even for period";
  } else if (net < 0) {
    netTone = "red";
    netValue = "-" + fmt(Math.abs(net));
    netColor = "var(--red)";
    netSub = "Expenses exceed margin";
  }

  const kpis = [
    {
      label: salesLabel,
      value: fmt(revenuePeriod),
      tone: "ink",
      icon: ReceiptIcon,
      rawVal: revenuePeriod,
      sub: period === "today" ? "Cash & M-Pesa volume" : "Period gross sales",
    },
    {
      label: profitLabel,
      value: (profitPeriod > 0 ? "+" : "") + fmt(profitPeriod),
      tone: "green",
      ownerOnly: true,
      icon: TrendingUp,
      valColor: "var(--green)",
      rawVal: profitPeriod,
      sub: period === "today" ? "Today's margin" : "Margin on period sales",
    },
    {
      label: expLabel,
      value: fmt(expensesPeriod),
      tone: "amber",
      ownerOnly: true,
      icon: TrendingDown,
      valColor: expensesPeriod > 0 ? "var(--amber)" : "var(--ink)",
      rawVal: expensesPeriod,
      sub: period === "today" ? "Today's outflows" : "Period cash outflows",
    },
    {
      label: netLabel,
      value: netValue,
      tone: netTone,
      ownerOnly: true,
      icon: BarChart3,
      valColor: netColor,
      rawVal: net,
      sub: netSub,
    },
    {
      label: debtsLabel,
      value: fmt(debtsCollectedTotal),
      tone: "green",
      icon: Coins,
      valColor: debtsCollectedTotal > 0 ? "var(--green)" : "var(--ink)",
      rawVal: debtsCollectedTotal,
      sub: period === "today" ? "Credit recoveries today" : "Total debt recovered",
    },
    {
      label: "Customer Debts",
      value: fmt(totalDebt),
      tone: totalDebt > 0 ? "red" : "steel",
      icon: Users,
      valColor: totalDebt > 0 ? "var(--red)" : "var(--ink)",
      rawVal: totalDebt,
      sub: "Outstanding credit balances",
    },
    {
      label: "Supplier Balances",
      value: fmt(totalSupplierBal),
      tone: totalSupplierBal > 0 ? "amber" : "steel",
      ownerOnly: true,
      icon: Building2,
      valColor: totalSupplierBal > 0 ? "var(--amber)" : "var(--ink)",
      rawVal: totalSupplierBal,
      sub: "Pending supplier dues",
    },
    {
      label: "Stock Value",
      value: fmt(inventoryMetrics.totalStockValue),
      tone: "ink",
      ownerOnly: true,
      icon: Package,
      rawVal: inventoryMetrics.totalStockValue,
      sub: `${inventoryMetrics.totalUnits.toLocaleString()} units · Live stock value`,
    },
  ];

  const toneColors = {
    ink: { bg: "var(--surface-hover)", c: "var(--ink)" },
    green: { bg: "var(--green-tint)", c: "var(--green)" },
    amber: { bg: "var(--amber-tint)", c: "var(--amber)" },
    red: { bg: "var(--red-tint)", c: "var(--red)" },
    steel: { bg: "#E7EEF2", c: "var(--steel)" },
  };

  function downloadBestSellersPDF() {
    exportBestSellersPDF({
      bestSellers: sortedBestSellers,
      totalRevenue: bestSellers.reduce((a, b) => a + b.revenue, 0),
      totalProfit: bestSellers.reduce((a, b) => a + b.profit, 0),
      sortBy: bestSellerSort,
    });
    notify("success", "Analytics PDF Exported", `Best-selling products report (${bestSellerSort.toUpperCase()}) downloaded.`);
  }

  return (
    <div>
      {/* Dashboard Top Header & Period Filter */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        <div style={{ minWidth: 0 }}>
          <div className="disp" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{periodTitle}</div>
          <div style={{ color: "var(--ink-soft)", fontSize: 12.5, marginTop: 2 }}>{periodSubtitle}</div>
        </div>

        {/* Period Selector Toggle */}
        <div style={{ display: "flex", background: "var(--surface-hover)", padding: 3, borderRadius: 10, border: "1px solid var(--line)", maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch", flexShrink: 0 }}>
          {[
            { key: "today", label: "Today" },
            { key: "week", label: "7 Days" },
            { key: "month", label: "This Month" },
            { key: "all", label: "All Time" },
          ].map(p => {
            const isActive = period === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  background: isActive ? "var(--rust)" : "transparent",
                  color: isActive ? "#FFFFFF" : "var(--ink)",
                  boxShadow: isActive ? "0 2px 6px rgba(193,80,47,0.3)" : "none",
                  transition: "all .15s ease",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI Cards Grid with Perfect Responsive Mobile and Desktop Layout */}
      <div className="hf-kpis-grid">
        {kpis.map((k, i) => {
          const hidden = k.ownerOnly && role !== "owner";
          const tc = toneColors[k.tone] || toneColors.ink;
          const Icon = k.icon;

          // Dynamically scale typography for large values (e.g. millions) so numbers fit perfectly
          const valStr = String(k.value || "");
          const fontSize = valStr.length > 15 ? 16 : valStr.length > 12 ? 18.5 : valStr.length > 10 ? 20.5 : 22.5;

          return (
            <div
              key={i}
              className="hf-ticket"
              style={{
                padding: "15px 16px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: 118,
                height: 118,
                boxSizing: "border-box",
              }}
            >
              {/* Top Row: Icon + Label */}
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <div className="hf-icon-circle" style={{ width: 30, height: 30, borderRadius: 8, background: tc.bg }}>
                  <Icon size={15} color={tc.c} />
                </div>
                <div
                  className="hf-kpi-label"
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={k.label}
                >
                  {k.label}
                </div>
              </div>

              {/* Bottom Row: Main Number + Subtitle */}
              {hidden ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#98A0AB", height: 42 }}>
                  <Lock size={14} /><span style={{ fontSize: 12.5, fontWeight: 600 }}>Owner only</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", minWidth: 0 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize,
                      fontWeight: 700,
                      color: k.valColor || "var(--ink)",
                      lineHeight: 1.15,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={k.value}
                  >
                    {k.value}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--ink-soft)",
                      marginTop: 3,
                      lineHeight: 1.2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={k.sub || ""}
                  >
                    {k.sub || "—"}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Best-Selling Products Section (OWNER ONLY) with Metric Filter Pills & PDF Download */}
      {role === "owner" && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div className="disp" style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <Award size={18} color="var(--rust)" />
                Best-Selling Products (Owner Analytics)
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                Rank products by sales volume, total monetary revenue, or profit contribution.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* Metric Ranking Toggle Pills */}
              <div style={{ display: "flex", gap: 4, background: "var(--surface-hover)", border: "1px solid var(--line)", padding: 3, borderRadius: 9 }}>
                <button
                  type="button"
                  onClick={() => setBestSellerSort("revenue")}
                  className="hf-btn"
                  style={{
                    padding: "5px 11px",
                    fontSize: 12,
                    background: bestSellerSort === "revenue" ? "var(--rust)" : "transparent",
                    color: bestSellerSort === "revenue" ? "#fff" : "var(--ink)",
                    boxShadow: bestSellerSort === "revenue" ? "var(--shadow-sm)" : "none",
                  }}
                  title="Rank by gross monetary revenue (KSh)"
                >
                  💰 Total Revenue
                </button>
                <button
                  type="button"
                  onClick={() => setBestSellerSort("profit")}
                  className="hf-btn"
                  style={{
                    padding: "5px 11px",
                    fontSize: 12,
                    background: bestSellerSort === "profit" ? "var(--green)" : "transparent",
                    color: bestSellerSort === "profit" ? "#fff" : "var(--ink)",
                    boxShadow: bestSellerSort === "profit" ? "var(--shadow-sm)" : "none",
                  }}
                  title="Rank by highest gross margin generated"
                >
                  📈 Gross Profit
                </button>
                <button
                  type="button"
                  onClick={() => setBestSellerSort("qty")}
                  className="hf-btn"
                  style={{
                    padding: "5px 11px",
                    fontSize: 12,
                    background: bestSellerSort === "qty" ? "var(--steel)" : "transparent",
                    color: bestSellerSort === "qty" ? "#fff" : "var(--ink)",
                    boxShadow: bestSellerSort === "qty" ? "var(--shadow-sm)" : "none",
                  }}
                  title="Rank by number of physical units sold"
                >
                  📦 Units Sold
                </button>
              </div>

              <button
                className="hf-btn hf-btn-ghost"
                style={{ padding: "6px 12px", fontSize: 12.5 }}
                onClick={downloadBestSellersPDF}
                title="Download PDF report of best-selling products analytics"
              >
                <Download size={14} /> Download PDF
              </button>
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hf-card hf-desktop-only" style={{ padding: 6, overflowX: "auto" }}>
            <table className="hf-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Rank</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th style={{ textAlign: "right", background: bestSellerSort === "qty" ? "var(--surface-hover)" : "transparent" }}>
                    Units Sold {bestSellerSort === "qty" && "▾"}
                  </th>
                  <th style={{ textAlign: "right", background: bestSellerSort === "revenue" ? "var(--surface-hover)" : "transparent" }}>
                    Total Revenue {bestSellerSort === "revenue" && "▾"}
                  </th>
                  <th style={{ textAlign: "right", background: bestSellerSort === "profit" ? "var(--surface-hover)" : "transparent" }}>
                    Gross Profit {bestSellerSort === "profit" && "▾"}
                  </th>
                  <th style={{ width: 140 }}>
                    {bestSellerSort === "profit" ? "Profit Share" : bestSellerSort === "qty" ? "Volume Share" : "Revenue Share"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedBestSellers.slice(0, 5).map((item, idx) => {
                  const topProduct = sortedBestSellers[0];
                  const maxMetric = topProduct
                    ? (bestSellerSort === "profit" ? topProduct.profit : bestSellerSort === "qty" ? topProduct.qty : topProduct.revenue) || 1
                    : 1;
                  const currentMetric = bestSellerSort === "profit" ? item.profit : bestSellerSort === "qty" ? item.qty : item.revenue;
                  const pct = maxMetric > 0 ? Math.round((currentMetric / maxMetric) * 100) : 0;
                  const barColor = bestSellerSort === "profit" ? "var(--green)" : bestSellerSort === "qty" ? "var(--steel)" : "var(--rust)";

                  return (
                    <tr key={item.id}>
                      <td>
                        <span style={{
                          display: "inline-flex", width: 24, height: 24, borderRadius: "50%",
                          background: idx === 0 ? "var(--rust)" : idx === 1 ? "#33546B" : "var(--line)",
                          color: idx < 2 ? "#fff" : "var(--ink)", fontWeight: 700, fontSize: 11,
                          alignItems: "center", justifyContent: "center"
                        }}>
                          #{idx + 1}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.name}</td>
                      <td>{item.category}</td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: bestSellerSort === "qty" ? 700 : 500 }}>
                        {item.qty.toLocaleString()} units
                      </td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: bestSellerSort === "revenue" ? 700 : 500 }}>
                        {fmt(item.revenue)}
                      </td>
                      <td className="mono text-profit" style={{ textAlign: "right", fontWeight: 700 }}>
                        {fmt(item.profit)}
                      </td>
                      <td>
                        <div style={{ background: "var(--line)", borderRadius: 6, height: 8, width: "100%", overflow: "hidden" }}>
                          <div style={{ background: barColor, height: "100%", width: `${pct}%`, borderRadius: 6 }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sortedBestSellers.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--ink-soft)", padding: 20 }}>
                      No product sales recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View (Sight-Friendly, Easy to Touch and Scroll) */}
          <div className="hf-mobile-only" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sortedBestSellers.slice(0, 5).map((item, idx) => {
              const topProduct = sortedBestSellers[0];
              const maxMetric = topProduct
                ? (bestSellerSort === "profit" ? topProduct.profit : bestSellerSort === "qty" ? topProduct.qty : topProduct.revenue) || 1
                : 1;
              const currentMetric = bestSellerSort === "profit" ? item.profit : bestSellerSort === "qty" ? item.qty : item.revenue;
              const pct = maxMetric > 0 ? Math.round((currentMetric / maxMetric) * 100) : 0;
              const barColor = bestSellerSort === "profit" ? "var(--green)" : bestSellerSort === "qty" ? "var(--steel)" : "var(--rust)";

              return (
                <div key={item.id} className="hf-card" style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        display: "inline-flex", width: 26, height: 26, borderRadius: "50%",
                        background: idx === 0 ? "var(--rust)" : idx === 1 ? "#33546B" : "var(--surface-hover)",
                        color: idx < 2 ? "#fff" : "var(--ink)", fontWeight: 700, fontSize: 12,
                        alignItems: "center", justifyContent: "center", border: "1px solid var(--line)"
                      }}>
                        #{idx + 1}
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{item.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{item.category}</div>
                      </div>
                    </div>
                    <Pill tone="steel">{item.qty.toLocaleString()} units</Pill>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, marginTop: 6, background: "var(--surface-hover)", padding: "8px 10px", borderRadius: 8 }}>
                    <div>
                      <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>Revenue: </span>
                      <strong className="mono" style={{ fontSize: 13.5 }}>{fmt(item.revenue)}</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>Profit: </span>
                      <strong className="mono text-profit" style={{ fontSize: 13.5 }}>{fmt(item.profit)}</strong>
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ background: "var(--line)", borderRadius: 6, height: 6, width: "100%", overflow: "hidden" }}>
                      <div style={{ background: barColor, height: "100%", width: `${pct}%`, borderRadius: 6 }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {sortedBestSellers.length === 0 && (
              <div className="hf-card" style={{ padding: 20, textAlign: "center", color: "var(--ink-soft)" }}>
                No product sales recorded yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Important Alerts */}
      <div className="disp" style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Important alerts</div>
      <div style={{ display: "grid", gap: 8 }}>
        {lowStock.length > 0 && (
          <AlertRow tone="red" text={`${lowStock.length} product${lowStock.length > 1 ? "s" : ""} below minimum stock`} sub={lowStock.slice(0,4).map(p=>p.name).join(", ")} />
        )}
        {overdue.length > 0 && (
          <AlertRow tone="red" text={`${overdue.length} overdue customer account${overdue.length > 1 ? "s" : ""}`} sub={overdue.map(c=>c.name).join(", ")} />
        )}
        {suppBalances.some(s => s.outstanding > 0) && role === "owner" && (
          <AlertRow tone="amber" text="Supplier balances outstanding" sub={suppBalances.filter(s=>s.outstanding>0).map(s=>s.name).join(", ")} />
        )}
        {slowMoving.length > 0 && (
          <AlertRow tone="amber" text={`${slowMoving.length} slow-moving product${slowMoving.length > 1 ? "s" : ""}`} sub={slowMoving.slice(0,4).map(p=>p.name).join(", ")} />
        )}
        {lowStock.length === 0 && overdue.length === 0 && slowMoving.length === 0 && (
          <div className="hf-card" style={{ padding: 16, color: "var(--ink-soft)", fontSize: 13.5 }}>No urgent issues right now.</div>
        )}
      </div>
    </div>
  );
}

function AlertRow({ tone, text, sub }) {
  const c = tone === "red" ? "var(--red)" : "var(--amber)";
  return (
    <div className="hf-card" style={{ padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start", borderLeft: `3px solid ${c}` }}>
      <AlertTriangle size={16} color={c} style={{ marginTop: 2, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{text}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

/* ---------- derived helpers ---------- */
function customerBalance(db, customerId) {
  const sold = (db?.sales || [])
    .filter(s => s.customerId === customerId && s.payment === "credit")
    .reduce((a, s) => a + Number(s.total || 0), 0);
  const cust = (db?.customers || []).find(c => c.id === customerId);
  const paid = (cust?.payments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
  return Math.max(0, Math.round(sold - paid));
}

function daysSinceLastActivity(db, customerId) {
  const cust = (db?.customers || []).find(c => c.id === customerId);
  const dates = [
    ...(db?.sales || []).filter(s => s.customerId === customerId).map(s => s.date),
    ...(cust?.payments || []).map(p => p.date),
  ];
  if (dates.length === 0) return 999;
  const latest = dates.sort().slice(-1)[0];
  return Math.round((new Date(todayISO(0)) - new Date(latest)) / 86400000);
}

function supplierOutstanding(db, supplierId) {
  let total = 0;
  (db?.products || []).filter(p => p.supplierId === supplierId).forEach(p => {
    (p.history || []).forEach(h => {
      if (h.action === "Received" || h.action === "Receive Stock") {
        const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
        const unitCost = Number(p.buyPrice) > 0 ? (Number(p.buyPrice) / factor) : 0;
        total += (Number(h.qty) || 0) * unitCost;
      }
    });
  });

  const supplier = (db?.suppliers || []).find(s => s.id === supplierId);
  const paidFromSupplier = (supplier?.payments || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);

  // Also include any payments in expenses that were recorded for this supplier
  const linkedExpenseIds = new Set((supplier?.payments || []).map(p => p.expenseId || p.id).filter(Boolean));
  const paidFromExpenses = (db?.expenses || [])
    .filter(e => e.category === "Supplier Payment" && e.supplierId === supplierId && !linkedExpenseIds.has(e.id))
    .reduce((a, e) => a + (Number(e.amount) || 0), 0);

  const totalPaid = paidFromSupplier + paidFromExpenses;
  return Math.max(0, Math.round(total - totalPaid));
}

function supplierTotalPurchases(db, supplierId) {
  let total = 0;
  (db?.products || []).filter(p => p.supplierId === supplierId).forEach(p => {
    (p.history || []).forEach(h => {
      if (h.action === "Received" || h.action === "Receive Stock") {
        const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
        const unitCost = Number(p.buyPrice) > 0 ? (Number(p.buyPrice) / factor) : 0;
        total += (Number(h.qty) || 0) * unitCost;
      }
    });
  });
  return Math.round(total);
}

/* ================= POINT OF SALE (POS) ================= */
function POS({ db, setDb, role, notify, currentUser }) {
  const [activeTab, setActiveTab] = useState("pos");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("retail");
  const [cart, setCart] = useState([]);
  const [payment, setPayment] = useState("cash"); // "cash" | "mpesa" | "bank" | "credit" | "split"
  const [customerId, setCustomerId] = useState("");
  const [splitCash, setSplitCash] = useState(0);
  const [receiptSale, setReceiptSale] = useState(null);

  // Custom / Auto Invoice # state
  const [useCustomInvoice, setUseCustomInvoice] = useState(false);
  const [customInvoiceNo, setCustomInvoiceNo] = useState("");

  // Store PIN Verification Modal for Deletions
  const [pinModal, setPinModal] = useState({
    isOpen: false,
    title: "",
    description: "",
    onSuccess: () => {},
  });

  // Offline Sync State
  const { isOnline, queuedCount, refreshQueueCount } = useOnlineStatus();
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);

  // Sales History Filter States
  const [histStartDate, setHistStartDate] = useState(todayISO(0));
  const [histEndDate, setHistEndDate] = useState(todayISO(0));
  const [histSearch, setHistSearch] = useState("");
  const [histPayment, setHistPayment] = useState("all");

  // Auto-sync offline sales when connectivity returns
  useEffect(() => {
    let active = true;
    if (isOnline && queuedCount > 0) {
      syncOfflineQueue(db, notify).then(() => {
        if (active) {
          refreshQueueCount();
        }
      });
    }
    return () => {
      active = false;
    };
  }, [isOnline, queuedCount, db, notify, refreshQueueCount]);

  const results = query.length > 0
    ? db.products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()))
    : [];

  function addToCart(p) {
    if ((p.stock || 0) <= 0) {
      notify("error", "Product Out of Stock", `Cannot add "${p.name}". Current available inventory is 0 ${p.baseUnit}.`);
      return;
    }
    setCart(c => {
      const existing = c.find(i => i.productId === p.id);
      if (existing) {
        const currentQty = Number(existing.qty) || 0;
        if (currentQty >= (p.stock || 0)) {
          notify("warning", "Stock Limit Reached", `Cannot add more. Only ${p.stock} ${p.baseUnit} of "${p.name}" available in stock.`);
          return c;
        }
        const newQty = currentQty + 1;
        return c.map(i => i.productId === p.id ? { ...i, qty: newQty, qtyInput: String(newQty) } : i);
      }
      return [...c, { productId: p.id, qty: 1, qtyInput: "1" }];
    });
    setQuery("");
  }

  function handleQtyChange(id, strVal) {
    setCart(c => c.map(i => {
      if (i.productId !== id) return i;
      const num = parseInt(strVal, 10);
      return {
        ...i,
        qtyInput: strVal,
        qty: isNaN(num) || num < 0 ? 0 : num,
      };
    }));
  }

  function handleQtyBlur(id) {
    const p = db.products.find(prod => prod.id === id);
    setCart(c => c.map(i => {
      if (i.productId !== id) return i;
      let num = parseInt(i.qtyInput, 10);
      if (isNaN(num) || num <= 0) {
        num = 1;
      }
      if (p && num > (p.stock || 0)) {
        notify("warning", "Quantity Exceeds Stock", `Adjusted quantity of "${p.name}" to max available stock (${p.stock} ${p.baseUnit}).`);
        num = Math.max(1, p.stock || 0);
      }
      return { ...i, qty: num, qtyInput: String(num) };
    }));
  }

  function incrementQty(id) {
    const p = db.products.find(prod => prod.id === id);
    setCart(c => c.map(i => {
      if (i.productId !== id) return i;
      const current = Number(i.qty) || 0;
      if (p && current >= (p.stock || 0)) {
        notify("warning", "Stock Limit Reached", `Only ${p.stock} ${p.baseUnit} of "${p.name}" available.`);
        return i;
      }
      const newQty = current + 1;
      return { ...i, qty: newQty, qtyInput: String(newQty) };
    }));
  }

  function decrementQty(id) {
    setCart(c => c.map(i => {
      if (i.productId !== id) return i;
      const current = Number(i.qty) || 1;
      if (current <= 1) return i;
      const newQty = current - 1;
      return { ...i, qty: newQty, qtyInput: String(newQty) };
    }));
  }

  function removeItem(id) {
    setCart(c => c.filter(i => i.productId !== id));
  }

  const lines = cart.map(i => {
    const p = db.products.find(pp => pp.id === i.productId);
    const unitPrice = priceFor(p, tier);
    const actualQty = Number(i.qty) || 0;
    const isExceeded = actualQty > (p?.stock || 0) || actualQty <= 0;
    return { ...i, product: p, unitPrice, lineTotal: unitPrice * actualQty, isExceeded };
  });

  const total = lines.reduce((a, l) => a + l.lineTotal, 0);
  const custAvailable = customerId ? (db.customers.find(c => c.id === customerId)?.creditLimit || 0) - customerBalance(db, customerId) : null;
  const hasStockError = lines.some(l => l.isExceeded);

  function triggerManualSync() {
    if (isSyncingOffline) return;
    setIsSyncingOffline(true);
    syncOfflineQueue(db, notify).finally(() => {
      setIsSyncingOffline(false);
      refreshQueueCount();
    });
  }

  function completeSale() {
    if (lines.length === 0) {
      notify("warning", "Cart is Empty", "Search and select products before checkout.");
      return;
    }
    const hasZero = lines.some(l => (Number(l.qty) || 0) <= 0);
    if (hasZero) {
      notify("error", "Invalid Quantity", "Please enter a valid quantity for all items in the cart.");
      return;
    }
    const overStockItems = lines.filter(l => (Number(l.qty) || 0) > (l.product?.stock || 0));
    if (overStockItems.length > 0) {
      const summary = overStockItems.map(l => `"${l.product?.name || 'Item'}" (Requested: ${l.qty}, In Stock: ${l.product?.stock || 0})`).join("; ");
      notify("error", "Insufficient Stock — Checkout Blocked", `Cannot complete sale. The following item(s) exceed available inventory: ${summary}. Please reduce quantity or receive stock.`);
      return;
    }
    if (payment === "split") {
      const splitNum = Number(splitCash);
      if (isNaN(splitNum) || splitNum <= 0 || splitNum >= total) {
        notify("error", "Invalid Split Payment Amount", `Cash portion must be greater than KSh 0 and less than total sale amount (${fmt(total)}). No transaction recorded.`);
        return;
      }
    }
    if (payment === "credit" && !customerId) {
      notify("error", "Customer Required", "Please select a registered customer for credit sales. No transaction recorded.");
      return;
    }
    if (payment === "credit" && custAvailable !== null && total > custAvailable) {
      if (!confirm(`This sale (${fmt(total)}) exceeds the customer's available credit limit (${fmt(custAvailable)}). Proceed anyway?`)) {
        return;
      }
    }

    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    const existingInvSeqs = (db.sales || []).map(s => {
      const m = String(s.invoiceNo || "").match(/\d+$/);
      return m ? parseInt(m[0], 10) : 0;
    });
    const nextSeqNum = Math.max(457, ...existingInvSeqs, Number(db.invoiceSeq) || 0) + 1;
    
    let resolvedInvoiceNo = `INV-2026-${String(nextSeqNum).padStart(5, "0")}`;
    if (useCustomInvoice && customInvoiceNo.trim()) {
      resolvedInvoiceNo = customInvoiceNo.trim().toUpperCase();
    }
    const saleDate = todayISO(0);

    const saleItems = lines.map(l => ({
      productId: l.product.id,
      qty: Number(l.qty),
      unitPrice: l.unitPrice,
      unitCost: l.product.buyPrice / (l.product.conversionFactor || 1)
    }));
    const cost = saleItems.reduce((a, i) => a + i.unitCost * i.qty, 0);
    const profit = total - cost;
    const employee = currentUser?.name || (role === "owner" ? "Owner" : "Cashier");

    const sale = {
      id: uid("INV"),
      invoiceNo: resolvedInvoiceNo,
      date: saleDate,
      time: timeStr,
      items: saleItems,
      total,
      cost,
      profit,
      payment,
      splitCash: payment === "split" ? splitCash : null,
      customerId: payment === "credit" ? customerId : (customerId || null),
      employee,
      offline: !navigator.onLine,
    };

    // Instant local stock reduction & persistence
    setDb(prev => {
      const products = prev.products.map(p => {
        const line = saleItems.find(i => i.productId === p.id);
        if (!line) return p;
        const newStock = (Number(p.stock) || 0) - line.qty;
        return {
          ...p,
          stock: newStock,
          history: [
            ...(p.history || []),
            {
              id: uid("H"),
              date: sale.date,
              time: timeStr,
              action: "Sale",
              ref: resolvedInvoiceNo,
              qty: -line.qty,
              balance: newStock,
              user: sale.employee,
              reason: payment === "credit" ? "Credit sale" : "Customer sale",
            }
          ],
        };
      });

      const allPrevInvSeqs = (prev.sales || []).map(s => {
        const m = String(s.invoiceNo || "").match(/\d+$/);
        return m ? parseInt(m[0], 10) : 0;
      });
      const resolvedSeq = Math.max(nextSeqNum, ...allPrevInvSeqs) + 1;

      return {
        ...prev,
        products,
        sales: [sale, ...prev.sales],
        invoiceSeq: resolvedSeq,
        auditLog: [
          {
            id: uid("LOG"),
            time: `${sale.date} ${timeStr}`,
            user: sale.employee,
            role: role === "owner" ? "Owner" : "Cashier",
            category: payment === "credit" ? "Credit Sale" : "Sale",
            action: `Sold ${saleItems.map(i=>i.qty).reduce((a,b)=>a+b,0)} item(s) — ${resolvedInvoiceNo}`,
            detail: `${fmt(total)} via ${payment.toUpperCase()}${!navigator.onLine ? " (Offline)" : ""}`,
            target: resolvedInvoiceNo,
          },
          ...prev.auditLog
        ],
      };
    });

    if (!navigator.onLine) {
      enqueueOfflineSale(sale);
      notify("info", "Sale Saved Locally (Offline Mode)", `${resolvedInvoiceNo} recorded instantly. Receipt generated & queued for cloud sync.`);
    } else {
      notify("success", "Sale Completed Successfully", `${resolvedInvoiceNo} · Total: ${fmt(total)} (${payment.toUpperCase()})`);
    }

    setReceiptSale(sale);
    setCart([]);
    setCustomerId("");
    setPayment("cash");
    setCustomInvoiceNo("");
    setUseCustomInvoice(false);
  }

  /* ---------- Delete Individual Sale (With PIN Verification & Stock Restoral) ---------- */
  function handleDeleteSale(saleToDelete) {
    setPinModal({
      isOpen: true,
      title: "Authorize Sale Deletion",
      description: `Enter Store Security PIN to remove invoice ${saleToDelete.invoiceNo} (${fmt(saleToDelete.total)}) and return all sold items back to inventory stock.`,
      onSuccess: () => {
        const timeStr = new Date().toTimeString().slice(0, 5);
        const today = todayISO(0);
        const operator = currentUser?.name || "Staff";

        setDb(prev => {
          // Restore items back to inventory stock and append ledger entries
          const products = prev.products.map(p => {
            const line = (saleToDelete.items || []).find(i => i.productId === p.id);
            if (!line) return p;
            const restoredStock = (Number(p.stock) || 0) + line.qty;
            return {
              ...p,
              stock: restoredStock,
              history: [
                ...(p.history || []),
                {
                  id: uid("H"),
                  date: today,
                  time: timeStr,
                  action: "Sale Deleted (Restock)",
                  ref: saleToDelete.invoiceNo,
                  qty: line.qty,
                  balance: restoredStock,
                  user: operator,
                  reason: `Sale ${saleToDelete.invoiceNo} deleted — Items returned to shelf`,
                }
              ]
            };
          });

          const updatedSales = (prev.sales || []).filter(s => s.id !== saleToDelete.id && s.invoiceNo !== saleToDelete.invoiceNo);

          const auditEntry = {
            id: uid("LOG"),
            time: `${today} ${timeStr}`,
            user: operator,
            role: currentUser?.role || "Staff",
            category: "Sale Deletion",
            action: `Deleted sale invoice ${saleToDelete.invoiceNo} (${fmt(saleToDelete.total)})`,
            detail: `Restored stock for ${(saleToDelete.items || []).length} item(s) — Verified via Store PIN`,
            target: saleToDelete.invoiceNo,
          };

          return {
            ...prev,
            products,
            sales: updatedSales,
            auditLog: [auditEntry, ...(prev.auditLog || [])],
          };
        });

        notify("success", "Sale Deleted & Stock Restored", `Invoice ${saleToDelete.invoiceNo} was removed and inventory levels were restocked.`);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  /* ---------- Delete / Clear All Sales History (With PIN Verification & Stock Restoral) ---------- */
  function handleClearAllSales() {
    if ((db.sales || []).length === 0) {
      notify("info", "No Sales Found", "Sales history is already empty.");
      return;
    }

    setPinModal({
      isOpen: true,
      title: "Authorize Clear All Sales History",
      description: `WARNING: Enter Store Security PIN to permanently delete all ${db.sales.length} sales records. All items will be restored to store inventory.`,
      onSuccess: () => {
        const timeStr = new Date().toTimeString().slice(0, 5);
        const today = todayISO(0);
        const operator = currentUser?.name || "Staff";

        setDb(prev => {
          // Accumulate restock quantities for all products
          const restockMap = {};
          (prev.sales || []).forEach(s => {
            (s.items || []).forEach(it => {
              restockMap[it.productId] = (restockMap[it.productId] || 0) + Number(it.qty || 0);
            });
          });

          const products = prev.products.map(p => {
            const addQty = restockMap[p.id] || 0;
            if (addQty === 0) return p;
            const newStock = (Number(p.stock) || 0) + addQty;
            return {
              ...p,
              stock: newStock,
              history: [
                ...(p.history || []),
                {
                  id: uid("H"),
                  date: today,
                  time: timeStr,
                  action: "Sale Deleted (Restock)",
                  ref: "BULK-CLEAR",
                  qty: addQty,
                  balance: newStock,
                  user: operator,
                  reason: `Bulk sales history cleared — Restocked ${addQty} ${p.baseUnit}`,
                }
              ]
            };
          });

          const auditEntry = {
            id: uid("LOG"),
            time: `${today} ${timeStr}`,
            user: operator,
            role: currentUser?.role || "Staff",
            category: "Bulk Sale Deletion",
            action: `Cleared all sales history (${(prev.sales || []).length} sales)`,
            detail: `All inventory quantities restored to shelves — Verified via Store PIN`,
            target: "All Sales History",
          };

          return {
            ...prev,
            products,
            sales: [],
            auditLog: [auditEntry, ...(prev.auditLog || [])],
          };
        });

        notify("success", "All Sales Cleared", "All sales history records have been deleted and store inventory restocked.");
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  const filteredSales = useMemo(() => {
    const q = histSearch.trim().toLowerCase();
    return db.sales.filter(s => {
      if (histStartDate && s.date < histStartDate) return false;
      if (histEndDate && s.date > histEndDate) return false;
      if (histPayment !== "all" && s.payment !== histPayment) return false;
      if (!q) return true;

      const cust = db.customers.find(c => c.id === s.customerId);
      const custName = cust?.name?.toLowerCase() || "";
      const invMatch = (s.invoiceNo || "").toLowerCase().includes(q);
      const empMatch = (s.employee || "").toLowerCase().includes(q);
      const itemMatch = (s.items || []).some(it => {
        const prod = db.products.find(p => p.id === it.productId);
        return prod?.name?.toLowerCase().includes(q) || prod?.sku?.toLowerCase().includes(q);
      });
      return invMatch || custName.includes(q) || empMatch || itemMatch;
    });
  }, [db.sales, db.customers, db.products, histStartDate, histEndDate, histSearch, histPayment]);

  const histTotalRevenue = filteredSales.reduce((a, s) => a + s.total, 0);
  const histTotalProfit = filteredSales.reduce((a, s) => a + s.profit, 0);

  if (receiptSale) {
    return <ReceiptView sale={receiptSale} db={db} onClose={() => setReceiptSale(null)} notify={notify} />;
  }

  return (
    <div>
      {/* Universal Store Security PIN Verification Modal */}
      <PinVerificationModal
        isOpen={pinModal.isOpen}
        title={pinModal.title}
        description={pinModal.description}
        onSuccess={pinModal.onSuccess}
        onCancel={() => setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} })}
        db={db}
      />

      {/* POS Top Bar: Tabs & Live Connectivity Status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, background: "var(--line)", padding: 3, borderRadius: 10 }}>
          <button
            onClick={() => setActiveTab("pos")}
            className="hf-btn"
            style={{
              padding: "7px 16px",
              background: activeTab === "pos" ? "var(--surface)" : "transparent",
              color: activeTab === "pos" ? "var(--ink)" : "var(--ink-soft)",
              boxShadow: activeTab === "pos" ? "var(--shadow-sm)" : "none",
            }}
          >
            <ShoppingCart size={15} /> Point of Sale
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className="hf-btn"
            style={{
              padding: "7px 16px",
              background: activeTab === "history" ? "var(--surface)" : "transparent",
              color: activeTab === "history" ? "var(--ink)" : "var(--ink-soft)",
              boxShadow: activeTab === "history" ? "var(--shadow-sm)" : "none",
            }}
          >
            <Calendar size={15} /> Sales History & Receipts
          </button>
        </div>

        {/* Live Connectivity Badge for Kenyan Network Reliability */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          padding: "6px 12px",
          borderRadius: 20,
          background: isOnline ? (queuedCount > 0 ? "var(--amber-tint)" : "var(--green-tint)") : "var(--red-tint)",
          color: isOnline ? (queuedCount > 0 ? "var(--amber)" : "var(--green)") : "var(--red)",
          border: `1px solid ${isOnline ? (queuedCount > 0 ? "var(--amber)" : "var(--green)") : "var(--red)"}`,
        }}>
          {isOnline ? (
            queuedCount > 0 ? (
              <>
                <RefreshCw size={13} style={{ animation: isSyncingOffline ? "spin 1s linear infinite" : "none" }} />
                <span>{queuedCount} offline sale(s) queued</span>
                <button
                  type="button"
                  onClick={triggerManualSync}
                  className="hf-btn"
                  style={{
                    padding: "2px 8px",
                    fontSize: 11,
                    background: "var(--amber)",
                    color: "#fff",
                    marginLeft: 4,
                    borderRadius: 6,
                    height: 22,
                  }}
                  disabled={isSyncingOffline}
                >
                  {isSyncingOffline ? "Syncing…" : "Sync Now"}
                </button>
              </>
            ) : (
              <>
                <Wifi size={13} />
                <span>Online · Cloud Synced</span>
              </>
            )
          ) : (
            <>
              <WifiOff size={13} />
              <span>Offline Mode (Local Storage active {queuedCount > 0 ? `· ${queuedCount} queued` : ""})</span>
            </>
          )}
        </div>
      </div>

      {activeTab === "pos" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18, alignItems: "flex-start" }}>
          <div>
            <div className="disp" style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>New Sale</div>
            <div style={{ position: "relative", marginBottom: 10 }}>
              <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)", pointerEvents: "none" }} />
              <input
                className="hf-input hf-input-with-left-icon"
                style={{ paddingLeft: 38 }}
                placeholder="Search product name or SKU to add to cart…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            {results.length > 0 && (
              <div className="hf-card" style={{ marginBottom: 14, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
                {results.map(p => {
                  const isOutOfStock = (p.stock || 0) <= 0;
                  return (
                    <div
                      key={p.id}
                      onClick={() => !isOutOfStock && addToCart(p)}
                      style={{
                        padding: "10px 14px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: isOutOfStock ? "not-allowed" : "pointer",
                        borderBottom: "1px solid var(--line)",
                        opacity: isOutOfStock ? 0.6 : 1,
                        background: isOutOfStock ? "var(--surface-hover)" : "transparent",
                      }}
                      onMouseEnter={e => { if (!isOutOfStock) e.currentTarget.style.background = "var(--surface-hover)"; }}
                      onMouseLeave={e => { if (!isOutOfStock) e.currentTarget.style.background = "transparent"; }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{p.name}</span>
                          {isOutOfStock && (
                            <span style={{ fontSize: 10.5, background: "var(--red-tint)", color: "var(--red)", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>
                              OUT OF STOCK
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                          Available: <strong style={{ color: isOutOfStock ? "var(--red)" : "var(--ink)" }}>{p.stock} {p.baseUnit}</strong> · Retail {fmt(p.sellPrice)}
                          {p.contractorPrice ? ` · Contractor ${fmt(p.contractorPrice)}` : ""}
                          {p.wholesalePrice ? ` · Wholesale ${fmt(p.wholesalePrice)}` : ""}
                        </div>
                      </div>
                      {!isOutOfStock && <Plus size={16} color="var(--rust)" />}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 1. Desktop Cart Table */}
            <div className="hf-card hf-desktop-only" style={{ padding: 4 }}>
              <table className="hf-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ width: 140 }}>Quantity</th>
                    <th>Unit price</th>
                    <th>Total</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: 28 }}>
                        Cart is empty — search a product above to add.
                      </td>
                    </tr>
                  )}
                  {lines.map(l => {
                    const stockCount = l.product?.stock || 0;
                    const isOver = (Number(l.qty) || 0) > stockCount;
                    const isZero = (Number(l.qty) || 0) <= 0;
                    return (
                      <tr key={l.productId} style={{ background: isOver ? "var(--red-tint)" : "transparent" }}>
                        <td>
                          <div style={{ fontWeight: 600, color: isOver ? "var(--red)" : "inherit" }}>{l.product?.name}</div>
                          <div style={{ fontSize: 11, color: isOver ? "var(--red)" : "var(--ink-soft)", display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                            <span>In Stock: <strong>{stockCount} {l.product?.baseUnit}</strong></span>
                            {isOver && <span style={{ fontWeight: 700, color: "var(--red)" }}>⚠ Exceeds available stock!</span>}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <button
                              className="hf-btn hf-btn-ghost"
                              style={{ padding: "3px 7px" }}
                              onClick={() => decrementQty(l.productId)}
                              type="button"
                            >
                              <Minus size={12} />
                            </button>
                            <input
                              className="hf-input mono"
                              style={{
                                width: 62,
                                textAlign: "center",
                                padding: "4px 4px",
                                fontWeight: 700,
                                border: isOver || isZero ? "1.5px solid var(--red)" : "1.5px solid var(--line)",
                                background: isOver || isZero ? "#FFF0F0" : "inherit",
                                color: isOver || isZero ? "var(--red)" : "inherit",
                              }}
                              type="number"
                              min="1"
                              max={stockCount}
                              value={l.qtyInput !== undefined ? l.qtyInput : l.qty}
                              onChange={e => handleQtyChange(l.productId, e.target.value)}
                              onBlur={() => handleQtyBlur(l.productId)}
                            />
                            <button
                              className="hf-btn hf-btn-ghost"
                              style={{ padding: "3px 7px" }}
                              onClick={() => incrementQty(l.productId)}
                              disabled={Number(l.qty) >= stockCount}
                              type="button"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="mono">{fmt(l.unitPrice)}</td>
                        <td className="mono" style={{ fontWeight: 700, color: isOver ? "var(--red)" : "var(--ink)" }}>{fmt(l.lineTotal)}</td>
                        <td>
                          <button
                            onClick={() => removeItem(l.productId)}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
                            title="Remove item from cart"
                          >
                            <Trash2 size={15} color="var(--red)" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 2. Mobile Cart Cards (Thumb-Friendly Touch Layout for Smartphones) */}
            <div className="hf-mobile-only" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lines.length === 0 && (
                <div className="hf-card" style={{ padding: 24, textAlign: "center", color: "var(--ink-soft)" }}>
                  Cart is empty — search a product above to add.
                </div>
              )}
              {lines.map(l => {
                const stockCount = l.product?.stock || 0;
                const isOver = (Number(l.qty) || 0) > stockCount;
                const isZero = (Number(l.qty) || 0) <= 0;

                return (
                  <div
                    key={l.productId}
                    className="hf-card"
                    style={{
                      padding: "12px",
                      borderLeft: isOver ? "4px solid var(--red)" : "1px solid var(--line)",
                      background: isOver ? "var(--red-tint)" : "var(--surface)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14.5, color: isOver ? "var(--red)" : "var(--ink)" }}>{l.product?.name}</div>
                        <div style={{ fontSize: 11.5, color: isOver ? "var(--red)" : "var(--ink-soft)", marginTop: 2 }}>
                          Available: <strong>{stockCount} {l.product?.baseUnit}</strong> · {fmt(l.unitPrice)} ea
                        </div>
                      </div>
                      <button
                        onClick={() => removeItem(l.productId)}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 8px" }}
                        title="Remove"
                      >
                        <Trash2 size={16} color="var(--red)" />
                      </button>
                    </div>

                    {isOver && (
                      <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 700, marginTop: 4 }}>
                        ⚠ Requested quantity exceeds stock on hand!
                      </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line-soft)" }}>
                      {/* Touch-Friendly Stepper */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          className="hf-btn hf-btn-ghost"
                          style={{ width: 38, height: 38, padding: 0, justifyContent: "center", borderRadius: 8 }}
                          onClick={() => decrementQty(l.productId)}
                          type="button"
                        >
                          <Minus size={16} />
                        </button>
                        <input
                          className="hf-input mono"
                          style={{
                            width: 64,
                            height: 38,
                            textAlign: "center",
                            padding: "4px",
                            fontWeight: 700,
                            fontSize: 16,
                            border: isOver || isZero ? "1.5px solid var(--red)" : "1.5px solid var(--line)",
                          }}
                          type="number"
                          min="1"
                          max={stockCount}
                          value={l.qtyInput !== undefined ? l.qtyInput : l.qty}
                          onChange={e => handleQtyChange(l.productId, e.target.value)}
                          onBlur={() => handleQtyBlur(l.productId)}
                        />
                        <button
                          className="hf-btn hf-btn-ghost"
                          style={{ width: 38, height: 38, padding: 0, justifyContent: "center", borderRadius: 8 }}
                          onClick={() => incrementQty(l.productId)}
                          disabled={Number(l.qty) >= stockCount}
                          type="button"
                        >
                          <Plus size={16} />
                        </button>
                      </div>

                      {/* Line Total */}
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10.5, color: "var(--ink-soft)", textTransform: "uppercase", fontWeight: 700 }}>Line Total</div>
                        <div className="mono text-profit" style={{ fontSize: 16, fontWeight: 700 }}>{fmt(l.lineTotal)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Checkout Column */}
          <div className="hf-ticket" style={{ padding: 18, position: "sticky", top: 16 }}>
            <div className="disp" style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Checkout</div>

            {/* Pricing Tier Options */}
            <div style={{ marginBottom: 10 }}>
              <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Pricing Tier</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["retail", "contractor", "wholesale"].map(t => {
                  const isSelected = tier === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTier(t)}
                      className="hf-btn"
                      style={{
                        flex: 1,
                        justifyContent: "center",
                        background: isSelected ? "var(--rust)" : "var(--surface-hover)",
                        color: isSelected ? "#FFFFFF" : "var(--ink)",
                        border: isSelected ? "1.5px solid var(--rust-dark)" : "1.5px solid var(--line)",
                        boxShadow: isSelected ? "0 2px 8px rgba(193,80,47,0.35)" : "none",
                        fontWeight: isSelected ? 700 : 500,
                        fontSize: 12.5,
                      }}
                    >
                      {isSelected ? "✓ " : ""}{t[0].toUpperCase() + t.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Customer (Required for Credit)</div>
              <select className="hf-input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="">Walk-in customer</option>
                {db.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {customerId && (
                <div style={{ fontSize: 12, color: custAvailable < 0 ? "var(--red)" : "var(--green)", marginTop: 4, fontWeight: 600 }}>
                  Available Credit: {fmt(custAvailable)}
                </div>
              )}
            </div>

            {/* Payment Method with Bank option */}
            <div style={{ marginBottom: 12 }}>
              <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Payment Method</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[
                  { key: "cash", label: "Cash" },
                  { key: "mpesa", label: "M-Pesa" },
                  { key: "bank", label: "Bank / Transfer" },
                  { key: "credit", label: "Credit" },
                  { key: "split", label: "Cash + M-Pesa" },
                ].map(m => {
                  const isSelected = payment === m.key;
                  return (
                    <button
                      key={m.key}
                      onClick={() => setPayment(m.key)}
                      className="hf-btn"
                      style={{
                        justifyContent: "center",
                        background: isSelected ? "var(--rust)" : "var(--surface-hover)",
                        color: isSelected ? "#FFFFFF" : "var(--ink)",
                        border: isSelected ? "1.5px solid var(--rust-dark)" : "1.5px solid var(--line)",
                        boxShadow: isSelected ? "0 2px 8px rgba(193,80,47,0.35)" : "none",
                        fontWeight: isSelected ? 700 : 500,
                        fontSize: 12,
                        gridColumn: m.key === "split" ? "span 2" : "span 1"
                      }}
                    >
                      {isSelected ? "✓ " : ""}{m.label}
                    </button>
                  );
                })}
              </div>

              {payment === "split" && (
                <div style={{ marginTop: 10, padding: 10, background: "var(--surface-hover)", borderRadius: 8, fontSize: 12.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span>Cash portion:</span>
                    <span className="mono" style={{ fontWeight: 700 }}>{fmt(splitCash)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={total}
                    value={Math.min(splitCash, total)}
                    onChange={e => setSplitCash(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "var(--rust)" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", color: "var(--ink-soft)", marginTop: 4 }}>
                    <span>M-Pesa portion:</span>
                    <span className="mono" style={{ fontWeight: 700 }}>{fmt(total - Math.min(splitCash, total))}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Custom or Auto Invoice Number Toggle & Input */}
            <div style={{ marginBottom: 14, background: "var(--surface-hover)", border: "1px solid var(--line)", padding: 10, borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div className="hf-kpi-label">Invoice Number</div>
                <button
                  type="button"
                  onClick={() => setUseCustomInvoice(!useCustomInvoice)}
                  style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}
                >
                  {useCustomInvoice ? "Use Auto Number" : "+ Write Custom Invoice #"}
                </button>
              </div>
              {useCustomInvoice ? (
                <input
                  className="hf-input mono"
                  style={{ marginTop: 4 }}
                  placeholder="e.g. INV-2026-99 or Book #14"
                  value={customInvoiceNo}
                  onChange={e => setCustomInvoiceNo(e.target.value)}
                />
              ) : (
                <div className="mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  Auto generated: INV-2026-XXXXX
                </div>
              )}
            </div>

            <div style={{ borderTop: "1.5px dashed var(--line)", paddingTop: 12, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700 }}>
                <span>Total Due</span>
                <span className="mono text-profit" style={{ fontSize: 18 }}>{fmt(total)}</span>
              </div>
            </div>

            <button
              className={`hf-btn ${hasStockError ? "hf-btn-danger" : "hf-btn-primary"}`}
              style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 14 }}
              onClick={completeSale}
              disabled={lines.length === 0 || hasStockError}
            >
              {hasStockError ? (
                <>
                  <AlertTriangle size={16} /> Stock Exceeded — Adjust Quantity
                </>
              ) : (
                <>
                  <Check size={16} /> Complete sale
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* SALES HISTORY & PERIOD SEARCH */
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>Sales History & Invoices</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Track, review, print receipts/invoices, or delete sales with Store PIN authorization.</div>
            </div>

            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ color: "var(--red)", borderColor: "var(--red)" }}
              onClick={handleClearAllSales}
              title="Delete all sales records (Protected by PIN)"
            >
              <Trash2 size={14} /> Clear All Sales History
            </button>
          </div>

          <div className="hf-card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 4 }}>From Date</div>
                <input
                  type="date"
                  className="hf-input"
                  value={histStartDate}
                  onChange={e => setHistStartDate(e.target.value)}
                />
              </div>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 4 }}>To Date</div>
                <input
                  type="date"
                  className="hf-input"
                  value={histEndDate}
                  onChange={e => setHistEndDate(e.target.value)}
                />
              </div>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Payment Method</div>
                <select className="hf-input" value={histPayment} onChange={e => setHistPayment(e.target.value)}>
                  <option value="all">All payment methods</option>
                  <option value="cash">Cash only</option>
                  <option value="mpesa">M-Pesa only</option>
                  <option value="bank">Bank / Transfer only</option>
                  <option value="credit">Credit only</option>
                  <option value="split">Split payment</option>
                </select>
              </div>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Search Invoices / Items</div>
                <div style={{ position: "relative" }}>
                  <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)", pointerEvents: "none" }} />
                  <input
                    className="hf-input hf-input-with-left-icon"
                    style={{ paddingLeft: 38 }}
                    placeholder="Invoice #, customer, item…"
                    value={histSearch}
                    onChange={e => setHistSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 600, marginRight: 4 }}>Quick Range:</span>
              <button
                className="hf-btn hf-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => { setHistStartDate(todayISO(0)); setHistEndDate(todayISO(0)); }}
              >
                Today
              </button>
              <button
                className="hf-btn hf-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => { setHistStartDate(todayISO(-1)); setHistEndDate(todayISO(-1)); }}
              >
                Yesterday
              </button>
              <button
                className="hf-btn hf-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => { setHistStartDate(todayISO(-7)); setHistEndDate(todayISO(0)); }}
              >
                Last 7 Days
              </button>
              <button
                className="hf-btn hf-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => { setHistStartDate(todayISO(0).slice(0, 8) + "01"); setHistEndDate(todayISO(0)); }}
              >
                This Month
              </button>
              <button
                className="hf-btn hf-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => { setHistStartDate(""); setHistEndDate(""); }}
              >
                All Time
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
            <div className="hf-ticket" style={{ padding: 14 }}>
              <div className="hf-kpi-label">Filtered Sales Volume</div>
              <div className="mono text-profit" style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{fmt(histTotalRevenue)}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>{filteredSales.length} invoice(s) found</div>
            </div>
            {role === "owner" && (
              <div className="hf-ticket" style={{ padding: 14 }}>
                <div className="hf-kpi-label">Filtered Gross Profit (Owner)</div>
                <div className="mono text-profit" style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{fmt(histTotalProfit)}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>Margin on filtered sales</div>
              </div>
            )}
          </div>

          <div className="hf-card" style={{ overflowX: "auto" }}>
            <table className="hf-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date & Time</th>
                  <th>Customer</th>
                  <th>Items Sold</th>
                  <th>Payment</th>
                  <th style={{ textAlign: "right" }}>Total Amount</th>
                  {role === "owner" && <th style={{ textAlign: "right" }}>Profit</th>}
                  <th>Cashier</th>
                  <th style={{ width: 220, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map(s => {
                  const cust = db.customers.find(c => c.id === s.customerId);
                  const itemCount = (s.items || []).reduce((a, b) => a + (Number(b.qty) || 0), 0);
                  const summaryStr = (s.items || []).map(it => {
                    const prod = db.products.find(p => p.id === it.productId);
                    return `${it.qty} × ${prod?.name || "Item"}`;
                  }).join(", ");

                  return (
                    <tr key={s.id}>
                      <td className="mono" style={{ fontWeight: 600 }}>{s.invoiceNo}</td>
                      <td>
                        <div>{niceDate(s.date)}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{s.time || "—"}</div>
                      </td>
                      <td>{cust ? cust.name : "Walk-in"}</td>
                      <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={summaryStr}>
                        <span style={{ fontWeight: 600 }}>{itemCount} pcs</span> · {summaryStr}
                      </td>
                      <td>
                        <Pill tone={s.payment === "mpesa" ? "green" : s.payment === "credit" ? "amber" : s.payment === "bank" ? "purple" : "steel"}>
                          {s.payment === "mpesa" ? "M-Pesa" : s.payment === "bank" ? "Bank Transfer" : s.payment.toUpperCase()}
                        </Pill>
                      </td>
                      <td className="mono text-profit" style={{ textAlign: "right", fontWeight: 700 }}>{fmt(s.total)}</td>
                      {role === "owner" && (
                        <td className="mono text-profit" style={{ textAlign: "right" }}>{fmt(s.profit)}</td>
                      )}
                      <td>{s.employee}</td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <button
                            className="hf-btn hf-btn-ghost"
                            style={{ padding: "4px 7px", fontSize: 11 }}
                            onClick={() => setReceiptSale(s)}
                            title="View receipt modal"
                          >
                            <Eye size={12} /> View
                          </button>
                          <button
                            className="hf-btn hf-btn-ghost"
                            style={{ padding: "4px 7px", fontSize: 11 }}
                            onClick={() => {
                              exportReceiptPDF({ sale: s, db });
                              notify("success", "Receipt Downloaded", `Receipt for ${s.invoiceNo} downloaded.`);
                            }}
                            title="Download PDF sales receipt"
                          >
                            <Download size={12} /> Receipt
                          </button>
                          <button
                            className="hf-btn hf-btn-ghost"
                            style={{ padding: "4px 7px", fontSize: 11, color: "var(--rust)" }}
                            onClick={() => {
                              exportInvoicePDF({ sale: s, db });
                              notify("success", "Tax Invoice Downloaded", `Invoice for ${s.invoiceNo} downloaded.`);
                            }}
                            title="Download Commercial Supply / Tax Invoice"
                          >
                            <FileText size={12} /> Invoice
                          </button>
                          <button
                            className="hf-btn hf-btn-ghost"
                            style={{ padding: "4px 6px", fontSize: 11, color: "var(--red)" }}
                            onClick={() => handleDeleteSale(s)}
                            title="Delete sale and restore stock (Requires PIN)"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredSales.length === 0 && (
                  <tr>
                    <td colSpan={role === "owner" ? 9 : 8} style={{ textAlign: "center", color: "var(--ink-soft)", padding: 28 }}>
                      No sales found matching your date or search filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ReceiptView({ sale, db, onClose, notify }) {
  const cust = db.customers.find(c => c.id === sale.customerId);

  function handleDownloadReceipt() {
    exportReceiptPDF({ sale, db });
    notify("success", "PDF Receipt Downloaded", `Receipt for ${sale.invoiceNo} saved.`);
  }

  function handleDownloadInvoice() {
    exportInvoicePDF({ sale, db });
    notify("success", "Supply Invoice Downloaded", `Tax Invoice for ${sale.invoiceNo} saved.`);
  }

  return (
    <div style={{ maxWidth: 460, margin: "20px auto" }}>
      <div className="hf-card" style={{ padding: 24 }}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div className="disp" style={{ fontSize: 24, fontWeight: 700 }}>HARDWAREFLOW</div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Official Payment Receipt & Proof of Purchase</div>
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
          <span className="mono" style={{ fontWeight: 700 }}>{sale.invoiceNo}</span>
          <span>{niceDate(sale.date)} {sale.time ? `· ${sale.time}` : ""}</span>
        </div>
        {cust && <div style={{ fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>Customer: {cust.name}</div>}
        <div style={{ borderTop: "1.5px dashed var(--line)", borderBottom: "1.5px dashed var(--line)", padding: "10px 0", marginBottom: 10 }}>
          {sale.items.map((i, idx) => {
            const p = db.products.find(pp => pp.id === i.productId);
            return (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                <span>{p?.name} × {i.qty}</span>
                <span className="mono">{fmt(i.unitPrice * i.qty)}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          <span>Total Paid</span>
          <span className="mono text-profit">{fmt(sale.total)}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
          Paid via {sale.payment === "mpesa" ? "M-Pesa" : sale.payment === "bank" ? "Bank Transfer" : sale.payment.toUpperCase()} · Served by {sale.employee}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <button
          className="hf-btn hf-btn-primary"
          style={{ justifyContent: "center", fontSize: 12.5 }}
          onClick={handleDownloadReceipt}
        >
          <Download size={14} /> Receipt PDF
        </button>
        <button
          className="hf-btn hf-btn-ghost"
          style={{ justifyContent: "center", fontSize: 12.5, color: "var(--rust)" }}
          onClick={handleDownloadInvoice}
        >
          <FileText size={14} /> Supply Invoice PDF
        </button>
      </div>

      <div style={{ marginTop: 8 }}>
        <button
          className="hf-btn hf-btn-dark"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={onClose}
        >
          New Sale / Close
        </button>
      </div>
    </div>
  );
}

/* ================= STOCK ADJUSTMENT MODULE ================= */
function StockAdjustmentModal({ db, setDb, initialProduct, onCancel, notify, currentUser, role }) {
  const [selectedProductId, setSelectedProductId] = useState(initialProduct?.id || db.products[0]?.id || "");
  const [mode, setMode] = useState("decrease"); // "decrease" | "increase"
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("Damage / Broken");
  const [notes, setNotes] = useState("");

  const product = db.products.find(p => p.id === selectedProductId);
  const currentStock = Number(product?.stock) || 0;
  const adjustQty = Number(qty) || 0;
  const newStock = mode === "increase" ? currentStock + adjustQty : currentStock - adjustQty;
  const unitCost = getProductUnitCost(product);
  const valueDifference = (mode === "increase" ? adjustQty : -adjustQty) * unitCost;

  const REASONS = [
    "Damage / Broken",
    "Theft / Lost",
    "Physical Count Correction",
    "Customer Return",
    "Supplier Return / Replacement",
    "Scrapped / Expired",
    "Other Correction",
  ];

  function handleSubmit() {
    if (!product) {
      notify("error", "No Product Selected", "Please choose a valid product.");
      return;
    }
    if (adjustQty <= 0) {
      notify("error", "Invalid Quantity", "Please enter a positive adjustment quantity.");
      return;
    }
    if (mode === "decrease" && newStock < 0) {
      if (!confirm(`Warning: Decreasing stock by ${adjustQty} will result in negative inventory (${newStock} ${product.baseUnit}). Do you want to proceed?`)) {
        return;
      }
    }

    const operator = currentUser?.name || (role === "owner" ? "Shop Owner" : "Mary");
    const timeStr = new Date().toTimeString().slice(0, 5);
    const today = todayISO(0);
    const nextAdjSeq = (db.adjSeq || 1002) + 1;
    const adjRef = `ADJ-${nextAdjSeq}`;
    const fullReason = `${reason}${notes.trim() ? " — " + notes.trim() : ""}`;

    setDb(prev => ({
      ...prev,
      products: prev.products.map(p => p.id === product.id ? {
        ...p,
        stock: newStock,
        history: [
          ...(p.history || []),
          {
            id: uid("ADJ"),
            date: today,
            time: timeStr,
            action: "Adjustment",
            ref: adjRef,
            qty: mode === "increase" ? adjustQty : -adjustQty,
            balance: newStock,
            user: operator,
            reason: fullReason,
          }
        ],
      } : p),
      adjSeq: nextAdjSeq,
      auditLog: [
        {
          id: uid("LOG"),
          time: `${today} ${timeStr}`,
          user: operator,
          role: role === "owner" ? "Owner" : "Storekeeper",
          category: "Stock Adjustment",
          action: `Adjusted stock for ${product.name}: ${mode === "increase" ? "+" : "-"}${adjustQty} ${product.baseUnit} (${adjRef})`,
          detail: `Reason: ${fullReason} · Prior stock: ${currentStock} → New stock: ${newStock} · Value Impact: ${fmt(valueDifference)}`,
          target: product.name,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Stock Adjusted", `${product.name} stock updated to ${newStock} ${product.baseUnit} (${adjRef}).`);
    onCancel();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1300 }} onClick={onCancel}>
      <div className="hf-card hf-modal-card" style={{ width: 520, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: "24px 20px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div className="disp" style={{ fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <SlidersHorizontal size={22} color="var(--rust)" />
              <span>Stock Adjustment</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>Record damaged, broken, lost, or physical count corrections.</div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={20} /></button>
        </div>

        {/* Product Selector */}
        <div style={{ marginBottom: 14 }}>
          <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Select Product *</div>
          <select className="hf-input" value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
            {db.products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}) — Stock: {p.stock} {p.baseUnit}
              </option>
            ))}
          </select>
        </div>

        {/* Adjustment Direction Toggle: Decrease (-) vs Increase (+) */}
        <div style={{ marginBottom: 14 }}>
          <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Adjustment Action *</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="hf-btn"
              style={{
                flex: 1,
                justifyContent: "center",
                background: mode === "decrease" ? "var(--red)" : "var(--surface)",
                color: mode === "decrease" ? "#fff" : "var(--ink)",
                border: mode === "decrease" ? "1.5px solid var(--red-dark, #A82020)" : "1.5px solid var(--line)",
                fontWeight: mode === "decrease" ? 700 : 500,
              }}
              onClick={() => setMode("decrease")}
            >
              <Minus size={15} /> Decrease Stock (Damaged / Lost)
            </button>
            <button
              type="button"
              className="hf-btn"
              style={{
                flex: 1,
                justifyContent: "center",
                background: mode === "increase" ? "var(--green)" : "var(--surface)",
                color: mode === "increase" ? "#fff" : "var(--ink)",
                border: mode === "increase" ? "1.5px solid var(--green, #2E7D32)" : "1.5px solid var(--line)",
                fontWeight: mode === "increase" ? 700 : 500,
              }}
              onClick={() => setMode("increase")}
            >
              <Plus size={15} /> Increase Stock (Found / Returned)
            </button>
          </div>
        </div>

        <FieldGrid>
          <div>
            <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Quantity to {mode === "increase" ? "Add" : "Deduct"} ({product?.baseUnit || "units"}) *</div>
            <input
              className="hf-input mono"
              type="number"
              min="1"
              placeholder="e.g. 2, 5, 10"
              value={qty}
              onChange={e => setQty(e.target.value)}
            />
          </div>

          <div>
            <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Reason Required *</div>
            <select className="hf-input" value={reason} onChange={e => setReason(e.target.value)}>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </FieldGrid>

        <div style={{ marginTop: 12, marginBottom: 16 }}>
          <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Audit Remarks / Explanation</div>
          <input
            className="hf-input"
            placeholder="e.g. Torn cement bags during forklift offloading, stocktake recount variance"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {/* Live Calculation Preview Banner */}
        <div style={{ background: "var(--surface-hover)", border: "1.5px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.04em", marginBottom: 6 }}>
            Adjustment Stock Preview
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13.5, flexWrap: "wrap", gap: 8 }}>
            <div>
              <span style={{ color: "var(--ink-soft)" }}>Current: </span>
              <strong className="mono">{currentStock} {product?.baseUnit}</strong>
              <span style={{ margin: "0 6px", color: "var(--ink-soft)" }}>→</span>
              <span style={{ color: "var(--ink-soft)" }}>Change: </span>
              <strong className="mono" style={{ color: mode === "increase" ? "var(--green)" : "var(--red)" }}>
                {mode === "increase" ? "+" : "-"}{adjustQty || 0}
              </strong>
              <span style={{ margin: "0 6px", color: "var(--ink-soft)" }}>→</span>
              <span style={{ color: "var(--ink-soft)" }}>New Stock: </span>
              <strong className="mono" style={{ color: newStock < 0 ? "var(--red)" : "var(--ink)", fontWeight: 700 }}>
                {newStock} {product?.baseUnit}
              </strong>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>Valuation Impact</div>
              <div className="mono" style={{ fontWeight: 700, color: valueDifference >= 0 ? "var(--green)" : "var(--red)" }}>
                {valueDifference >= 0 ? "+" : ""}{fmt(valueDifference)}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="hf-btn hf-btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="hf-btn hf-btn-primary"
            onClick={handleSubmit}
            disabled={!qty || Number(qty) <= 0}
          >
            <Check size={16} /> Confirm Stock Adjustment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= EXCEL & CSV BULK IMPORT MODULE ================= */
function ExcelImportModal({ db, setDb, onCancel, notify, currentUser, role }) {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [parseError, setParseError] = useState("");
  const [defaultSupplierId, setDefaultSupplierId] = useState("");
  const [defaultCategory, setDefaultCategory] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const fileInputRef = useRef(null);

  async function handleFileSelect(selectedFile) {
    if (!selectedFile) return;
    setFile(selectedFile);
    setParseError("");
    setParsing(true);
    try {
      const result = await parseProductFile(selectedFile);
      setParsedData(result);
    } catch (err) {
      console.error("Excel import parse error:", err);
      setParseError(err.message || "Failed to parse file. Please verify format.");
      setParsedData(null);
    } finally {
      setParsing(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }

  function handleExecuteImport() {
    if (!parsedData || parsedData.validRows.length === 0) {
      notify("warning", "No Valid Rows", "There are no valid products to import.");
      return;
    }

    setIsImporting(true);
    const operator = currentUser?.name || (role === "owner" ? "Shop Owner" : "Mary");
    const today = todayISO(0);
    const timeStr = new Date().toTimeString().slice(0, 5);

    const newProducts = [];

    parsedData.validRows.forEach((r, idx) => {
      const pId = uid("P");
      const sku = r.sku || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
      const prodCategory = r.category || defaultCategory || "General";
      const supplierId = r.supplierId || defaultSupplierId || "";
      const stock = Number(r.stock) || 0;

      newProducts.push({
        id: pId,
        name: r.name,
        category: prodCategory,
        brand: r.brand || "Standard",
        sku: sku,
        description: r.description || `Imported product: ${r.name}`,
        baseUnit: r.baseUnit || "piece",
        purchaseUnit: r.purchaseUnit || r.baseUnit || "piece",
        conversionFactor: Number(r.conversionFactor) > 0 ? Number(r.conversionFactor) : 1,
        buyPrice: Number(r.buyPrice) || 0,
        sellPrice: Number(r.sellPrice) || 0,
        contractorPrice: Number(r.contractorPrice) || Number(r.sellPrice) || 0,
        wholesalePrice: Number(r.wholesalePrice) || Number(r.sellPrice) || 0,
        minStock: Number(r.minStock) || 10,
        stock: stock,
        supplierId: supplierId,
        location: r.location || "Main Store",
        history: [
          {
            id: uid("H"),
            date: today,
            time: timeStr,
            action: "Opening Stock",
            ref: "EXCEL-IMPORT",
            qty: stock,
            balance: stock,
            user: operator,
            reason: `Bulk onboard from ${parsedData.filename}`,
          }
        ],
      });
    });

    setDb(prev => ({
      ...prev,
      products: [...prev.products, ...newProducts],
      auditLog: [
        {
          id: uid("LOG"),
          time: `${today} ${timeStr}`,
          user: operator,
          role: role === "owner" ? "Owner" : "Storekeeper",
          category: "Bulk Import",
          action: `Imported ${newProducts.length} product(s) from Excel/CSV`,
          detail: `File: ${parsedData.filename} · Total stock value added: ${fmt(newProducts.reduce((a, p) => a + getProductStockValue(p), 0))}`,
          target: `${newProducts.length} Products`,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Bulk Import Successful", `Successfully imported ${newProducts.length} products into your inventory!`);
    setIsImporting(false);
    onCancel();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1300 }} onClick={onCancel}>
      <div className="hf-card hf-modal-card" style={{ width: 780, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", padding: "24px 20px", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div className="disp" style={{ fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <FileSpreadsheet size={24} color="var(--green)" />
              <span>Import Products from Excel / CSV</span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>
              Onboard hundreds of hardware products in seconds with automatic column mapping and opening stock tracking.
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={20} /></button>
        </div>

        {/* Template Downloads & Guidance Bar */}
        <div style={{ background: "var(--surface-hover)", border: "1.5px dashed var(--line)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Download Standard Hardware Template</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Columns: Product Name, Category, Unit, Cost Price, Retail Price, Contractor, Wholesale, Opening Stock, Reorder Level</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="hf-btn hf-btn-ghost" style={{ fontSize: 12 }} onClick={downloadExcelTemplate}>
              <Download size={14} color="var(--green)" /> Excel Template (.xlsx)
            </button>
            <button type="button" className="hf-btn hf-btn-ghost" style={{ fontSize: 12 }} onClick={downloadCSVTemplate}>
              <Download size={14} /> CSV Template (.csv)
            </button>
          </div>
        </div>

        {/* File Dropzone */}
        {!parsedData && (
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: isDragging ? "2px solid var(--rust)" : "2px dashed var(--line)",
              background: isDragging ? "var(--surface-hover)" : "var(--surface)",
              borderRadius: 12,
              padding: "36px 20px",
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 16,
              transition: "all .15s ease",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              style={{ display: "none" }}
              onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />
            <UploadCloud size={38} color="var(--rust)" style={{ margin: "0 auto 10px" }} />
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {parsing ? "Parsing spreadsheet..." : "Click or drag & drop Excel / CSV file here"}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
              Supports Microsoft Excel (.xlsx, .xls) and Comma-Separated Values (.csv)
            </div>
          </div>
        )}

        {parseError && (
          <div className="hf-card" style={{ padding: "12px 14px", borderLeft: "3px solid var(--red)", marginBottom: 14, color: "var(--red)", fontSize: 13 }}>
            <AlertTriangle size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />
            {parseError}
          </div>
        )}

        {/* Preview of Parsed Rows */}
        {parsedData && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FileCheck size={18} color="var(--green)" />
                <span style={{ fontWeight: 700, fontSize: 14 }}>{parsedData.filename}</span>
                <Pill tone="green">{parsedData.validRows.length} valid product(s)</Pill>
                {parsedData.invalidRows.length > 0 && <Pill tone="red">{parsedData.invalidRows.length} invalid</Pill>}
              </div>
              <button className="hf-btn hf-btn-ghost" style={{ fontSize: 12 }} onClick={() => { setParsedData(null); setFile(null); }}>
                Choose Different File
              </button>
            </div>

            {/* Global Assignment Options */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, background: "var(--surface-hover)", padding: 12, borderRadius: 8, marginBottom: 12 }}>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Default Supplier (if empty in file)</div>
                <select className="hf-input" value={defaultSupplierId} onChange={e => setDefaultSupplierId(e.target.value)}>
                  <option value="">None / Unassigned</option>
                  {db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Default Category (if empty in file)</div>
                <input className="hf-input" placeholder="e.g. General, Hardware" value={defaultCategory} onChange={e => setDefaultCategory(e.target.value)} />
              </div>
            </div>

            {/* Preview Table */}
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 14 }}>
              <table className="hf-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 35 }}>#</th>
                    <th>Product Name</th>
                    <th>Category</th>
                    <th>Unit</th>
                    <th>Cost Price</th>
                    <th>Retail Price</th>
                    <th>Contractor</th>
                    <th>Opening Stock</th>
                    <th>Reorder Level</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.validRows.map((r, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ color: "var(--ink-soft)" }}>{r._rowNumber}</td>
                      <td>
                        <strong>{r.name}</strong>
                        {r.brand && <span style={{ color: "var(--ink-soft)", fontSize: 11 }}> ({r.brand})</span>}
                      </td>
                      <td>{r.category}</td>
                      <td className="mono">{r.baseUnit}</td>
                      <td className="mono">{fmt(r.buyPrice)}</td>
                      <td className="mono text-profit" style={{ fontWeight: 600 }}>{fmt(r.sellPrice)}</td>
                      <td className="mono">{fmt(r.contractorPrice)}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{r.stock}</td>
                      <td className="mono" style={{ color: "var(--ink-soft)" }}>{r.minStock}</td>
                      <td>
                        <span style={{ color: "var(--green)", fontWeight: 600 }}>✓ Ready</span>
                      </td>
                    </tr>
                  ))}
                  {parsedData.invalidRows.map((r, i) => (
                    <tr key={"inv-" + i} style={{ background: "rgba(220, 50, 50, 0.05)" }}>
                      <td className="mono" style={{ color: "var(--red)" }}>{r._rowNumber}</td>
                      <td style={{ color: "var(--red)" }}><strong>{r.name || "Missing Name"}</strong></td>
                      <td>{r.category}</td>
                      <td>{r.baseUnit}</td>
                      <td>{fmt(r.buyPrice)}</td>
                      <td>{fmt(r.sellPrice)}</td>
                      <td>—</td>
                      <td>{r.stock}</td>
                      <td>{r.minStock}</td>
                      <td><Pill tone="red">INVALID</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parsedData.errors.length > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 12 }}>
                ⚠️ {parsedData.errors.slice(0, 3).join("; ")}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: "auto" }}>
          <button className="hf-btn hf-btn-ghost" onClick={onCancel}>Cancel</button>
          {parsedData && (
            <button
              className="hf-btn hf-btn-primary"
              onClick={handleExecuteImport}
              disabled={isImporting || parsedData.validRows.length === 0}
            >
              <Check size={16} /> Import {parsedData.validRows.length} Products
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= INVENTORY & PRODUCT MANAGEMENT ================= */
function Inventory({ db, setDb, role, notify, currentUser, onReceiveShortcut }) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState(null);
  const [pinModal, setPinModal] = useState({
    isOpen: false,
    title: "",
    description: "",
    onSuccess: () => {},
  });

  const canSeeCost = role === "owner" || role === "storekeeper";

  const metrics = useMemo(() => getInventoryMetrics(db.products), [db.products]);

  const categories = useMemo(() => {
    const set = new Set();
    (db.products || []).forEach(p => {
      if (p.category) set.add(p.category.trim());
    });
    return ["all", ...Array.from(set)];
  }, [db.products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (db.products || []).filter(p => {
      if (selectedCategory !== "all" && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        (p.brand || "").toLowerCase().includes(q)
      );
    });
  }, [db.products, query, selectedCategory]);

  const activeProduct = selected ? db.products.find(p => p.id === selected) : null;

  function addProduct(form) {
    const operator = currentUser?.name || (role === "owner" ? "Shop Owner" : "Mary");
    const stock = Number(form.stock) || 0;
    const p = {
      id: uid("P"),
      name: form.name,
      category: form.category || "General",
      brand: form.brand || "Standard",
      sku: form.sku || uid("SKU"),
      description: form.description || "",
      baseUnit: form.baseUnit || "piece",
      purchaseUnit: form.purchaseUnit || form.baseUnit || "piece",
      conversionFactor: Number(form.conversionFactor) > 0 ? Number(form.conversionFactor) : 1,
      buyPrice: Number(form.buyPrice) || 0,
      sellPrice: Number(form.sellPrice) || 0,
      contractorPrice: Number(form.contractorPrice) || 0,
      wholesalePrice: Number(form.wholesalePrice) || 0,
      minStock: Number(form.minStock) || 0,
      stock: stock,
      supplierId: form.supplierId || "",
      location: form.location || "Main Store",
      history: [
        {
          id: uid("H"),
          date: todayISO(0),
          time: new Date().toTimeString().slice(0, 5),
          action: "Opening Stock",
          ref: "INIT",
          qty: stock,
          balance: stock,
          user: operator,
          reason: "Product catalog registration",
        }
      ],
    };

    setDb(prev => ({
      ...prev,
      products: [...prev.products, p],
      auditLog: [
        {
          id: uid("LOG"),
          time: todayISO(0) + " " + new Date().toTimeString().slice(0, 5),
          user: operator,
          role: role === "owner" ? "Owner" : "Storekeeper",
          category: "Product",
          action: `Added new product: ${p.name}`,
          detail: `SKU: ${p.sku} · Initial stock: ${p.stock} ${p.baseUnit} · Cost: ${fmt(getProductUnitCost(p))}`,
          target: p.name,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Product Added Successfully", `${p.name} (${p.sku}) saved to inventory.`);
    setShowNew(false);
  }

  /* ---------- Delete Individual Product with Store PIN ---------- */
  function deleteProduct(productId) {
    const prod = (db.products || []).find(p => p.id === productId);
    if (!prod) return;

    setPinModal({
      isOpen: true,
      title: "Authorize Product Deletion",
      description: `Enter Store Security PIN to permanently delete "${prod.name}" (${prod.sku}) and its movement history from inventory.`,
      onSuccess: () => {
        const operator = currentUser?.name || (role === "owner" ? "Shop Owner" : "Staff");
        const today = todayISO(0);
        const timeStr = new Date().toTimeString().slice(0, 5);

        setDb(prev => ({
          ...prev,
          products: (prev.products || []).filter(p => p.id !== productId),
          auditLog: [
            {
              id: uid("LOG"),
              time: `${today} ${timeStr}`,
              user: operator,
              role: role === "owner" ? "Owner" : "Storekeeper",
              category: "Product Removal",
              action: `Removed product from inventory: ${prod.name}`,
              detail: `SKU: ${prod.sku} · Prior stock: ${prod.stock} ${prod.baseUnit} — Verified via Store PIN`,
              target: prod.name,
            },
            ...(prev.auditLog || [])
          ]
        }));

        notify("success", "Product Removed", `"${prod.name}" has been deleted from inventory.`);
        setSelected(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  /* ---------- 1. Wipe Entire Inventory & Stock with Store PIN ---------- */
  function handleClearAllInventory() {
    if ((db.products || []).length === 0) {
      notify("info", "Inventory Empty", "There are no products in inventory.");
      return;
    }

    const totalCount = (db.products || []).length;
    const totalUnits = (db.products || []).reduce((a, p) => a + (Number(p.stock) || 0), 0);

    setPinModal({
      isOpen: true,
      title: "Authorize Wipe Entire Inventory & Stock",
      description: `WARNING: Enter Store Security PIN to permanently delete all ${totalCount} products (${totalUnits.toLocaleString()} units) and wipe inventory stock records. This cannot be undone.`,
      onSuccess: () => {
        const operator = currentUser?.name || (role === "owner" ? "Shop Owner" : "Owner");
        const today = todayISO(0);
        const timeStr = new Date().toTimeString().slice(0, 5);

        setDb(prev => ({
          ...prev,
          products: [],
          auditLog: [
            {
              id: uid("LOG"),
              time: `${today} ${timeStr}`,
              user: operator,
              role: role === "owner" ? "Owner" : "Storekeeper",
              category: "Bulk Inventory Deletion",
              action: `Wiped entire product inventory (${totalCount} products removed)`,
              detail: `All product catalog and stock records cleared — Verified via Store PIN`,
              target: "All Products",
            },
            ...(prev.auditLog || [])
          ]
        }));

        setSelected(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
        notify("success", "Inventory Cleared", `All ${totalCount} products have been permanently wiped from inventory.`);
      }
    });
  }

  /* ---------- 2. Reset All Stock Quantities to 0 with Store PIN ---------- */
  function handleZeroOutAllStock() {
    if ((db.products || []).length === 0) {
      notify("info", "Inventory Empty", "There are no products in inventory.");
      return;
    }

    const totalUnits = (db.products || []).reduce((a, p) => a + (Number(p.stock) || 0), 0);
    const totalCount = (db.products || []).length;

    setPinModal({
      isOpen: true,
      title: "Authorize Reset Stock to Zero",
      description: `WARNING: Enter Store Security PIN to reset stock counts to 0 for all ${totalCount} products (${totalUnits.toLocaleString()} units). Product catalog names and prices will remain intact.`,
      onSuccess: () => {
        const operator = currentUser?.name || (role === "owner" ? "Shop Owner" : "Owner");
        const today = todayISO(0);
        const timeStr = new Date().toTimeString().slice(0, 5);

        setDb(prev => ({
          ...prev,
          products: (prev.products || []).map(p => ({
            ...p,
            stock: 0,
            history: [
              ...(p.history || []),
              {
                id: uid("ADJ"),
                date: today,
                time: timeStr,
                action: "Adjustment",
                ref: "ZERO-ALL",
                qty: -(Number(p.stock) || 0),
                balance: 0,
                user: operator,
                reason: "Bulk stock reset to 0 authorized via Store PIN",
              }
            ]
          })),
          auditLog: [
            {
              id: uid("LOG"),
              time: `${today} ${timeStr}`,
              user: operator,
              role: role === "owner" ? "Owner" : "Storekeeper",
              category: "Stock Adjustment",
              action: `Reset all stock quantities to 0 across ${totalCount} products`,
              detail: `Prior stock cleared (${totalUnits.toLocaleString()} units) — Verified via Store PIN`,
              target: "All Stock",
            },
            ...(prev.auditLog || [])
          ]
        }));

        setSelected(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
        notify("success", "Stock Reset to Zero", `All stock counts have been reset to 0 across ${totalCount} products.`);
      }
    });
  }

  function downloadPDF() {
    exportInventoryPDF({ products: filtered, suppliers: db.suppliers });
    notify("success", "Inventory PDF Downloaded", `${filtered.length} products exported.`);
  }

  return (
    <div>
      <PinVerificationModal
        isOpen={pinModal.isOpen}
        title={pinModal.title}
        description={pinModal.description}
        onSuccess={pinModal.onSuccess}
        onCancel={() => setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} })}
        db={db}
      />

      {/* Desktop Header & Actions */}
      <div className="hf-desktop-only" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="disp" style={{ fontSize: 28, fontWeight: 700 }}>Real-Time Stock & Inventory</div>
          <div style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 2 }}>
            Live stock counts, Excel batch importing, movement ledger, and price tier tracking.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--red)", borderColor: "var(--red)" }}
            onClick={handleClearAllInventory}
            title="Wipe entire inventory & stock (Requires PIN)"
          >
            <Trash2 size={14} /> Clear All Inventory
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--amber)", borderColor: "var(--amber)" }}
            onClick={handleZeroOutAllStock}
            title="Reset all product stock counts to 0 (Requires PIN)"
          >
            <AlertTriangle size={14} /> Reset Stock to 0
          </button>
          <button className="hf-btn hf-btn-ghost" onClick={() => setShowImport(true)}>
            <FileSpreadsheet size={15} color="var(--green)" /> Import Excel / CSV
          </button>
          <button className="hf-btn hf-btn-ghost" onClick={() => { setAdjustProduct(null); setShowAdjustment(true); }}>
            <SlidersHorizontal size={15} /> Adjust Stock
          </button>
          <button className="hf-btn hf-btn-ghost" onClick={downloadPDF}>
            <Download size={15} /> Download PDF
          </button>
          <button className="hf-btn hf-btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={15} /> Add New Product
          </button>
        </div>
      </div>

      {/* Mobile Top Header & Quick Action Buttons (Touch-Optimized for Phones) */}
      <div className="hf-mobile-only" style={{ marginBottom: 14 }}>
        <div style={{ marginBottom: 10 }}>
          <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>Stock & Inventory</div>
          <div style={{ color: "var(--ink-soft)", fontSize: 12 }}>
            Real-time catalog, live stock balance & rapid restock
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            style={{ justifyContent: "center", fontSize: 13, minHeight: 44 }}
            onClick={() => setShowNew(true)}
          >
            <Plus size={16} /> Add Product
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ justifyContent: "center", fontSize: 13, minHeight: 44 }}
            onClick={() => { setAdjustProduct(null); setShowAdjustment(true); }}
          >
            <SlidersHorizontal size={15} /> Adjust Stock
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ justifyContent: "center", fontSize: 12, minHeight: 40 }}
            onClick={() => setShowImport(true)}
          >
            <FileSpreadsheet size={14} color="var(--green)" /> Excel Import
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ justifyContent: "center", fontSize: 12, minHeight: 40 }}
            onClick={downloadPDF}
          >
            <Download size={14} /> Export PDF
          </button>
        </div>

        {/* Mobile Clear / Wipe Actions Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "8px", background: "var(--surface-hover)", borderRadius: 10, border: "1px solid var(--line)" }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ justifyContent: "center", fontSize: 11.5, minHeight: 38, color: "var(--red)", borderColor: "rgba(220,50,50,0.3)" }}
            onClick={handleClearAllInventory}
            title="Wipe entire inventory catalog and stock records (Requires PIN)"
          >
            <Trash2 size={13} /> Wipe All Items
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ justifyContent: "center", fontSize: 11.5, minHeight: 38, color: "var(--amber)", borderColor: "rgba(217,119,6,0.3)" }}
            onClick={handleZeroOutAllStock}
            title="Reset stock balances to 0 (Requires PIN)"
          >
            <AlertTriangle size={13} /> Reset Stock to 0
          </button>
        </div>
      </div>

      {/* Executive Real-Time Stock Valuation Banner */}
      <div className="hf-stock-banner">
        <div className="hf-ticket" style={{ padding: "14px 16px" }}>
          <div className="hf-kpi-label">Active Stock Items</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 700, marginTop: 4 }}>
            {metrics.totalUnits.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-soft)" }}>units</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>
            {metrics.totalProducts} catalog products
          </div>
        </div>

        <div className="hf-ticket" style={{ padding: "14px 16px" }}>
          <div className="hf-kpi-label">Real-Time Stock Value</div>
          <div className="mono text-profit" style={{ fontSize: 21, fontWeight: 700, marginTop: 4 }}>
            {fmt(metrics.totalStockValue)}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>
            Total inventory valuation
          </div>
        </div>

        <div className="hf-ticket" style={{ padding: "14px 16px" }}>
          <div className="hf-kpi-label">Low Stock Alerts</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: metrics.lowStockCount > 0 ? "var(--red)" : "var(--green)" }}>
            {metrics.lowStockCount} <span style={{ fontSize: 13, fontWeight: 500 }}>items</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>
            {metrics.lowStockCount > 0 ? "Replenishment required" : "All levels adequate"}
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ position: "relative", minWidth: 280, flex: "1 1 280px", maxWidth: 400 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)", pointerEvents: "none" }} />
          <input
            className="hf-input hf-input-with-left-icon"
            style={{ paddingLeft: 38 }}
            placeholder="Search products by name, SKU, category, brand…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {/* Category Filter Pills */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", maxWidth: "100%", paddingBottom: 4 }}>
          {categories.slice(0, 6).map(c => (
            <button
              key={c}
              type="button"
              className="hf-btn"
              style={{
                fontSize: 12,
                padding: "6px 12px",
                background: selectedCategory === c ? "var(--rust)" : "var(--surface)",
                color: selectedCategory === c ? "#fff" : "var(--ink)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                textTransform: c === "all" ? "uppercase" : "none",
                fontWeight: selectedCategory === c ? 700 : 500,
              }}
              onClick={() => setSelectedCategory(c)}
            >
              {c === "all" ? "All Categories" : c}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Desktop Table View */}
      <div className="hf-card hf-desktop-only" style={{ overflowX: "auto" }}>
        <table className="hf-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Category</th>
              <th>Stock on Hand</th>
              <th>Min Alert</th>
              {canSeeCost && <th>Buying Cost</th>}
              <th>Selling Price</th>
              <th style={{ textAlign: "right" }}>Stock Value</th>
              <th>Supplier</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const low = (p.stock || 0) <= (p.minStock || 0);
              const supplier = db.suppliers.find(s => s.id === p.supplierId);
              const unitCost = getProductUnitCost(p);
              const stockVal = getProductStockValue(p);

              return (
                <tr key={p.id} onClick={() => setSelected(p.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{p.sku} {p.brand ? `· ${p.brand}` : ""}</div>
                  </td>
                  <td>{p.category}</td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {p.stock} {p.baseUnit}
                    {low && <span style={{ marginLeft: 6 }}><Pill tone="red">LOW STOCK</Pill></span>}
                  </td>
                  <td className="mono" style={{ color: "var(--ink-soft)" }}>{p.minStock}</td>
                  {canSeeCost && (
                    <td className="mono">
                      {fmt(unitCost)}
                      <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>/{p.baseUnit}</span>
                    </td>
                  )}
                  <td className="mono text-profit" style={{ fontWeight: 600 }}>{fmt(p.sellPrice)}</td>
                  <td className="mono text-profit" style={{ textAlign: "right", fontWeight: 700 }}>
                    {fmt(stockVal)}
                  </td>
                  <td>{supplier?.name || "—"}</td>
                  <td><ChevronRight size={15} color="var(--ink-soft)" /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canSeeCost ? 9 : 8} style={{ textAlign: "center", color: "var(--ink-soft)", padding: 28 }}>
                  No inventory products match "{query}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 2. Mobile Card List View (Thumb-Friendly for Smartphones) */}
      <div className="hf-mobile-only" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map(p => {
          const low = (p.stock || 0) <= (p.minStock || 0);
          const supplier = db.suppliers.find(s => s.id === p.supplierId);
          const unitCost = getProductUnitCost(p);
          const stockVal = getProductStockValue(p);

          return (
            <div
              key={p.id}
              className="hf-card"
              onClick={() => setSelected(p.id)}
              style={{
                padding: "14px",
                cursor: "pointer",
                borderLeft: low ? "4px solid var(--red)" : "1px solid var(--line)",
                transition: "transform .12s ease",
              }}
            >
              {/* Top Row: Name + Category */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 1 }}>
                    {p.sku} {p.brand ? `· ${p.brand}` : ""} · <span style={{ color: "var(--steel)" }}>{p.location || "Store"}</span>
                  </div>
                </div>
                <Pill tone="ink">{p.category}</Pill>
              </div>

              {/* Middle Row: Stock Count + Low Alert */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-hover)", padding: "8px 10px", borderRadius: 8, margin: "8px 0" }}>
                <div>
                  <span style={{ fontSize: 11, color: "var(--ink-soft)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.04em" }}>Stock on Hand: </span>
                  <strong className="mono" style={{ fontSize: 15, color: low ? "var(--red)" : "var(--ink)" }}>
                    {p.stock} {p.baseUnit}
                  </strong>
                </div>
                {low ? (
                  <Pill tone="red">LOW STOCK</Pill>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 600 }}>✓ In Stock</span>
                )}
              </div>

              {/* Bottom Row: Valuation & Prices */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
                <div>
                  <span style={{ color: "var(--ink-soft)" }}>Retail: </span>
                  <strong className="mono text-profit" style={{ fontSize: 13.5 }}>{fmt(p.sellPrice)}</strong>
                  {canSeeCost && (
                    <span style={{ marginLeft: 8, color: "var(--ink-soft)", fontSize: 11.5 }}>
                      Cost: <span className="mono">{fmt(unitCost)}</span>
                    </span>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>Stock Val: </span>
                  <strong className="mono text-profit" style={{ fontSize: 14 }}>{fmt(stockVal)}</strong>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="hf-card" style={{ padding: 24, textAlign: "center", color: "var(--ink-soft)" }}>
            No products found matching "{query}".
          </div>
        )}
      </div>

      {activeProduct && (
        <ProductDrawer
          product={activeProduct}
          db={db}
          setDb={setDb}
          canSeeCost={canSeeCost}
          onDelete={deleteProduct}
          onClose={() => setSelected(null)}
          notify={notify}
          currentUser={currentUser}
          role={role}
          onReceiveShortcut={onReceiveShortcut}
        />
      )}
      {showNew && <NewProductModal db={db} onCancel={() => setShowNew(false)} onSave={addProduct} notify={notify} />}
      {showImport && <ExcelImportModal db={db} setDb={setDb} onCancel={() => setShowImport(false)} notify={notify} currentUser={currentUser} role={role} />}
      {showAdjustment && (
        <StockAdjustmentModal
          db={db}
          setDb={setDb}
          initialProduct={adjustProduct}
          onCancel={() => { setShowAdjustment(false); setAdjustProduct(null); }}
          notify={notify}
          currentUser={currentUser}
          role={role}
        />
      )}
    </div>
  );
}

/* ================= PRODUCT DETAILS DRAWER & TRANSACTION HISTORY ================= */
function ProductDrawer({ product, db, setDb, canSeeCost, onDelete, onClose, notify, currentUser, role, onReceiveShortcut }) {
  const supplier = db.suppliers.find(s => s.id === product.supplierId);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("all");

  const [editForm, setEditForm] = useState({
    name: product.name,
    category: product.category,
    brand: product.brand || "",
    sellPrice: product.sellPrice,
    buyPrice: product.buyPrice,
    conversionFactor: product.conversionFactor || 1,
    purchaseUnit: product.purchaseUnit || product.baseUnit || "piece",
    baseUnit: product.baseUnit || "piece",
    contractorPrice: product.contractorPrice || 0,
    wholesalePrice: product.wholesalePrice || 0,
    minStock: product.minStock,
    stock: product.stock,
    location: product.location,
  });

  const unitCost = getProductUnitCost(product);
  const stockVal = getProductStockValue(product);
  const isLow = (Number(product.stock) || 0) <= (Number(product.minStock) || 0);
  const isOut = (Number(product.stock) || 0) <= 0;

  const lastSale = getProductLastSale(product, db.sales);
  const lastPurchase = getProductLastPurchase(product, db.purchases);
  const fullLedger = getProductLedger(product);

  const filteredLedger = useMemo(() => {
    if (historyFilter === "all") return fullLedger;
    if (historyFilter === "sale") return fullLedger.filter(h => h.action === "Sale" || h.qty < 0);
    if (historyFilter === "receive") return fullLedger.filter(h => h.action === "Receive Stock" || h.action === "Received" || h.action === "Opening Stock");
    if (historyFilter === "adjustment") return fullLedger.filter(h => h.action === "Adjustment");
    return fullLedger;
  }, [fullLedger, historyFilter]);

  function handleSaveEdit() {
    const updatedBuyPrice = Number(editForm.buyPrice) >= 0 ? Number(editForm.buyPrice) : product.buyPrice;
    const updatedConversion = Number(editForm.conversionFactor) > 0 ? Number(editForm.conversionFactor) : 1;
    const updatedUnitCost = updatedBuyPrice / updatedConversion;

    setDb(prev => ({
      ...prev,
      products: prev.products.map(p => p.id === product.id ? {
        ...p,
        name: editForm.name,
        category: editForm.category,
        brand: editForm.brand,
        sellPrice: Number(editForm.sellPrice) || p.sellPrice,
        buyPrice: updatedBuyPrice,
        conversionFactor: updatedConversion,
        purchaseUnit: editForm.purchaseUnit || p.purchaseUnit,
        baseUnit: editForm.baseUnit || p.baseUnit,
        contractorPrice: Number(editForm.contractorPrice) || 0,
        wholesalePrice: Number(editForm.wholesalePrice) || 0,
        minStock: Number(editForm.minStock) || p.minStock,
        stock: Number(editForm.stock) !== undefined ? Number(editForm.stock) : p.stock,
        location: editForm.location,
      } : p),
      auditLog: [
        {
          id: uid("LOG"),
          time: todayISO(0) + " " + new Date().toTimeString().slice(0, 5),
          user: currentUser?.name || "Owner",
          role: role === "owner" ? "Owner" : "Storekeeper",
          category: "Product Update",
          action: `Updated details for ${editForm.name}`,
          detail: `Sell price: ${fmt(editForm.sellPrice)} · Unit Cost: ${fmt(updatedUnitCost)} · Stock: ${editForm.stock} ${editForm.baseUnit}`,
          target: editForm.name,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Product Updated", `Updated specifications and pricing for ${editForm.name}.`);
    setEditing(false);
  }

  function downloadMovementCSV() {
    const headers = ["Date", "Time", "Action", "Reference", "Quantity Change", "Running Balance", "User", "Reason"];
    const rows = fullLedger.map(h => [
      h.date,
      h.time || "",
      h.action,
      h.ref,
      h.qty,
      h.balance,
      h.user,
      `"${(h.reason || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${product.name.replace(/\s+/g, '_')}_Movement_History.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    notify("success", "Movement Ledger Exported", `Downloaded transaction history for ${product.name}.`);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.6)", backdropFilter: "blur(2px)", display: "flex", justifyContent: "flex-end", zIndex: 1200 }} onClick={onClose}>
      <div className="hf-card hf-modal-card" style={{ width: 560, maxWidth: "96vw", height: "100%", borderRadius: 0, overflowY: "auto", padding: "24px 20px" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="disp" style={{ fontSize: 24, fontWeight: 700 }}>{product.name}</div>
              <Pill tone={isOut ? "red" : isLow ? "red" : "green"}>
                {isOut ? "OUT OF STOCK" : isLow ? "LOW STOCK" : "IN STOCK"}
              </Pill>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
              {product.sku} · {product.category} {product.brand ? `· ${product.brand}` : ""} · <span style={{ color: "var(--steel)" }}>{product.location || "Store"}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={20} /></button>
        </div>

        {product.description && (
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 16, background: "var(--surface-hover)", padding: 10, borderRadius: 8 }}>
            {product.description}
          </div>
        )}

        {/* Quick Action Buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ flex: 1, justifyContent: "center", fontSize: 12.5, borderColor: "var(--rust)", color: "var(--rust)" }}
            onClick={() => setAdjusting(true)}
          >
            <SlidersHorizontal size={14} /> Adjust Stock (+ / -)
          </button>
          {typeof onReceiveShortcut === "function" && (
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ flex: 1, justifyContent: "center", fontSize: 12.5 }}
              onClick={() => { onReceiveShortcut(product); onClose(); }}
            >
              <Truck size={14} /> Receive Stock
            </button>
          )}
          {!editing && (
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ flex: 1, justifyContent: "center", fontSize: 12.5 }}
              onClick={() => setEditing(true)}
            >
              <Edit3 size={14} /> Edit Details
            </button>
          )}
        </div>

        {/* Edit Form */}
        {editing ? (
          <div style={{ background: "var(--surface-hover)", padding: 14, borderRadius: 10, marginBottom: 16 }}>
            <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Edit Product Details</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Product Name</div>
                <input className="hf-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="hf-field-grid">
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Category</div>
                  <input className="hf-input" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} />
                </div>
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Brand</div>
                  <input className="hf-input" value={editForm.brand} onChange={e => setEditForm({ ...editForm, brand: e.target.value })} />
                </div>
              </div>
              <div className="hf-field-grid">
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Selling Price (KSh)</div>
                  <input className="hf-input" type="number" value={editForm.sellPrice} onChange={e => setEditForm({ ...editForm, sellPrice: e.target.value })} />
                </div>
                {canSeeCost && (
                  <div>
                    <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Package Buying Cost (KSh)</div>
                    <input className="hf-input" type="number" value={editForm.buyPrice} onChange={e => setEditForm({ ...editForm, buyPrice: e.target.value })} />
                  </div>
                )}
              </div>
              <div className="hf-field-grid">
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Contractor Price (KSh)</div>
                  <input className="hf-input" type="number" value={editForm.contractorPrice} onChange={e => setEditForm({ ...editForm, contractorPrice: e.target.value })} />
                </div>
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Wholesale Price (KSh)</div>
                  <input className="hf-input" type="number" value={editForm.wholesalePrice} onChange={e => setEditForm({ ...editForm, wholesalePrice: e.target.value })} />
                </div>
              </div>
              <div className="hf-field-grid">
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Low Stock Alert Level</div>
                  <input className="hf-input" type="number" value={editForm.minStock} onChange={e => setEditForm({ ...editForm, minStock: e.target.value })} />
                </div>
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Storage Location</div>
                  <input className="hf-input" value={editForm.location} onChange={e => setEditForm({ ...editForm, location: e.target.value })} />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="hf-btn hf-btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button className="hf-btn hf-btn-primary" onClick={handleSaveEdit}>Save Changes</button>
            </div>
          </div>
        ) : (
          /* Comprehensive Product Details Grid */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Current Stock on Hand</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: isLow ? "var(--red)" : "var(--ink)", marginTop: 2 }}>
                {product.stock} {product.baseUnit}
              </div>
            </div>
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Real-Time Stock Value</div>
              <div className="mono text-profit" style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                {fmt(stockVal)}
              </div>
            </div>
            {canSeeCost && (
              <div className="hf-ticket" style={{ padding: "10px 12px" }}>
                <div className="hf-kpi-label">Cost Basis (Single Unit)</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>
                  {fmt(unitCost)} <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>/{product.baseUnit}</span>
                </div>
              </div>
            )}
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Normal Retail Price</div>
              <div className="mono text-profit" style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>
                {fmt(product.sellPrice)}
              </div>
            </div>
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Contractor Discount Price</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                {product.contractorPrice > 0 ? fmt(product.contractorPrice) : "—"}
              </div>
            </div>
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Bulk Wholesale Price</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                {product.wholesalePrice > 0 ? fmt(product.wholesalePrice) : "—"}
              </div>
            </div>
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Reorder Warning Level</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                {product.minStock} {product.baseUnit}
              </div>
            </div>
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Main Supplier</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>
                {supplier?.name || "—"}
              </div>
            </div>
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Last Sale Recorded</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                {lastSale ? `${niceDate(lastSale.date)} (${lastSale.invoiceNo || 'Sale'})` : "No sales yet"}
              </div>
            </div>
            <div className="hf-ticket" style={{ padding: "10px 12px" }}>
              <div className="hf-kpi-label">Last Purchase / Received</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                {lastPurchase ? `${niceDate(lastPurchase.date)} (${lastPurchase.poNumber || 'Delivery'})` : "No purchases yet"}
              </div>
            </div>
          </div>
        )}

        {/* Packaging Conversion Note */}
        {product.purchaseUnit !== product.baseUnit && (
          <div className="hf-ticket" style={{ padding: 10, marginBottom: 16, fontSize: 12 }}>
            <b>Packaging Conversion:</b> Purchased in {product.purchaseUnit}s (1 {product.purchaseUnit} = {product.conversionFactor} {product.baseUnit}s), sold individually by {product.baseUnit}.
          </div>
        )}

        {/* 2. Full Inventory Movement History Section */}
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="disp" style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <History size={16} />
              <span>Inventory Transaction History</span>
            </div>
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ fontSize: 11.5, padding: "4px 8px" }}
              onClick={downloadMovementCSV}
              title="Download full movement history as CSV"
            >
              <Download size={13} /> Export CSV
            </button>
          </div>

          {/* Filter Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10, overflowX: "auto" }}>
            {[
              { key: "all", label: `All (${fullLedger.length})` },
              { key: "sale", label: "Sales (-)" },
              { key: "receive", label: "Deliveries (+)" },
              { key: "adjustment", label: "Adjustments" },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                className="hf-btn"
                style={{
                  fontSize: 11.5,
                  padding: "4px 10px",
                  background: historyFilter === t.key ? "var(--rust)" : "var(--surface-hover)",
                  color: historyFilter === t.key ? "#fff" : "var(--ink)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                }}
                onClick={() => setHistoryFilter(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Ledger Table */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <table className="hf-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action & Ref</th>
                  <th style={{ textAlign: "right" }}>Quantity</th>
                  <th style={{ textAlign: "right" }}>Balance</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredLedger].reverse().map((h, i) => {
                  const isPositive = Number(h.qty) > 0;
                  return (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{niceDate(h.date)}</div>
                        {h.time && <div style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>{h.time}</div>}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{h.action}</div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-soft)" }}>
                          {h.ref} {h.reason ? `· ${h.reason}` : ""}
                        </div>
                      </td>
                      <td className="mono" style={{ textAlign: "right", color: isPositive ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                        {isPositive ? `+${h.qty}` : h.qty}
                      </td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                        {h.balance}
                      </td>
                      <td style={{ color: "var(--ink-soft)" }}>{h.user}</td>
                    </tr>
                  );
                })}
                {filteredLedger.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)", padding: 18 }}>
                      No transaction records match filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Delete Product Action */}
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--red)", borderColor: "var(--red-tint)", fontSize: 12.5 }}
            onClick={() => onDelete(product.id)}
            title="Permanently remove this product from inventory"
          >
            <Trash2 size={13} /> Permanently Delete Product
          </button>
        </div>

        {/* Nested Stock Adjustment Modal */}
        {adjusting && (
          <StockAdjustmentModal
            db={db}
            setDb={setDb}
            initialProduct={product}
            onCancel={() => setAdjusting(false)}
            notify={notify}
            currentUser={currentUser}
            role={role}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return <div><div className="hf-kpi-label">{label}</div><div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</div></div>;
}

/* ================= SIMPLIFIED ADD PRODUCT MODAL ================= */
function NewProductModal({ db, onCancel, onSave, notify }) {
  const [form, setForm] = useState({
    name: "",
    category: "",
    brand: "",
    sku: "",
    description: "",
    baseUnit: "piece",
    purchaseUnit: "piece",
    conversionFactor: 1,
    buyPrice: "",
    sellPrice: "",
    contractorPrice: "",
    wholesalePrice: "",
    minStock: "10",
    stock: "0",
    supplierId: "",
    location: "Main Store"
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSubmit() {
    if (!form.name.trim()) {
      notify("error", "Missing Information", "Please enter the product name.");
      return;
    }
    if (!form.sellPrice || Number(form.sellPrice) <= 0) {
      notify("error", "Missing Selling Price", "Please specify a valid selling price.");
      return;
    }
    onSave(form);
  }

  const calculatedUnitCost = (Number(form.buyPrice) || 0) / (Number(form.conversionFactor) > 0 ? Number(form.conversionFactor) : 1);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }} onClick={onCancel}>
      <div className="hf-card hf-modal-card" style={{ width: 560, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: "24px 20px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div className="disp" style={{ fontSize: 24, fontWeight: 700 }}>Add New Product</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Fill in the specifications below to add stock to your hardware catalog.</div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={20} /></button>
        </div>

        <FieldGrid>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Product Name *" help="Simple name that sellers and customers recognize">
              <input className="hf-input" placeholder="e.g. Cement 50kg, 4-inch Nails, Gloss Paint 4L" value={form.name} onChange={e => set("name", e.target.value)} />
            </Field>
          </div>

          <Field label="Category / Department *" help="What group of items is this?">
            <input className="hf-input" placeholder="e.g. Cement, Plumbing, Electrical, Paint" value={form.category} onChange={e => set("category", e.target.value)} />
          </Field>

          <Field label="Brand / Manufacturer" help="Brand name if applicable">
            <input className="hf-input" placeholder="e.g. Bamburi, Crown, Kenpipe, SteelCo" value={form.brand} onChange={e => set("brand", e.target.value)} />
          </Field>

          <Field label="Item Code / SKU (Optional)" help="Leave blank to auto-generate">
            <input className="hf-input" placeholder="e.g. CEM-001" value={form.sku} onChange={e => set("sku", e.target.value)} />
          </Field>

          <Field label="Main Supplier" help="Who supplies this item to you?">
            <select className="hf-input" value={form.supplierId} onChange={e => set("supplierId", e.target.value)}>
              <option value="">Select supplier…</option>
              {db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>

          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Product Description / Simple Notes" help="Brief description of the item">
              <input className="hf-input" placeholder="e.g. All-purpose building cement for masonry & concrete work" value={form.description} onChange={e => set("description", e.target.value)} />
            </Field>
          </div>

          <Field label="How is it sold to customers? (Unit)" help="e.g. piece, bag, kg, metre, tin">
            <input className="hf-input" placeholder="piece, bag, kg, metre" value={form.baseUnit} onChange={e => set("baseUnit", e.target.value)} />
          </Field>

          <Field label="How do you buy it from suppliers?" help="e.g. carton, roll, bundle, box">
            <input className="hf-input" placeholder="carton, roll, box" value={form.purchaseUnit} onChange={e => set("purchaseUnit", e.target.value)} />
          </Field>

          <Field label="Pieces inside 1 supplier package" help="e.g. If 1 carton has 12 tins, enter 12. If bought per piece, enter 1">
            <input className="hf-input" type="number" min="1" value={form.conversionFactor} onChange={e => set("conversionFactor", e.target.value)} />
          </Field>

          <Field label="Storage Location" help="Where is it kept in the shop/yard?">
            <input className="hf-input" placeholder="e.g. Main Store, Yard, Shelf B" value={form.location} onChange={e => set("location", e.target.value)} />
          </Field>

          <Field label="Package Buying Cost (KSh)" help="Total cost you pay supplier per package">
            <input className="hf-input" type="number" placeholder="e.g. 650" value={form.buyPrice} onChange={e => set("buyPrice", e.target.value)} />
          </Field>

          <Field label="Calculated Single Unit Cost" help="Cost basis per single item sold">
            <div className="mono text-profit" style={{ padding: "10px 12px", background: "var(--surface-hover)", border: "1.5px solid var(--line)", borderRadius: 9, fontWeight: 700 }}>
              {fmt(calculatedUnitCost)} / {form.baseUnit || "piece"}
            </div>
          </Field>

          <Field label="Selling Price (Normal Retail) *" help="Price charged to normal retail customer">
            <input className="hf-input" type="number" placeholder="e.g. 780" value={form.sellPrice} onChange={e => set("sellPrice", e.target.value)} />
          </Field>

          <Field label="Discount Price for Contractors (Optional)" help="Special rate for builders">
            <input className="hf-input" type="number" placeholder="e.g. 750" value={form.contractorPrice} onChange={e => set("contractorPrice", e.target.value)} />
          </Field>

          <Field label="Bulk / Wholesale Price (Optional)" help="Price for large bulk purchases">
            <input className="hf-input" type="number" placeholder="e.g. 720" value={form.wholesalePrice} onChange={e => set("wholesalePrice", e.target.value)} />
          </Field>

          <Field label="Starting Stock in Shop" help="How many single units you currently have on hand">
            <input className="hf-input" type="number" min="0" placeholder="e.g. 50" value={form.stock} onChange={e => set("stock", e.target.value)} />
          </Field>

          <Field label="Low Stock Warning Level" help="Alert when stock drops below this number">
            <input className="hf-input" type="number" min="0" placeholder="e.g. 10" value={form.minStock} onChange={e => set("minStock", e.target.value)} />
          </Field>
        </FieldGrid>

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button className="hf-btn hf-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="hf-btn hf-btn-primary" onClick={handleSubmit} disabled={!form.name.trim()}>
            <Check size={16} /> Save Product
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldGrid({ children }) { return <div className="hf-field-grid">{children}</div>; }
function Field({ label, help, children }) {
  return (
    <div>
      <div className="hf-kpi-label" style={{ marginBottom: 3 }}>{label}</div>
      {children}
      {help && <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{help}</div>}
    </div>
  );
}

/* ================= RECEIVING ================= */
function Receiving({ db, setDb, notify, currentUser, prefill, onClearPrefill }) {
  const [supplierId, setSupplierId] = useState(() => prefill?.supplierId || db.suppliers[0]?.id || "");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [paymentMode, setPaymentMode] = useState("credit"); // "credit" | "cash" | "mpesa"
  const [lines, setLines] = useState(() => {
    if (prefill?.productId) {
      const p = (db.products || []).find(prod => prod.id === prefill.productId);
      return [{
        productId: prefill.productId,
        qty: prefill.qty ? String(prefill.qty) : "1",
        buyPrice: p ? String(p.buyPrice) : ""
      }];
    }
    return [{ productId: "", qty: "", buyPrice: "" }];
  });
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (prefill?.productId) {
      if (prefill.supplierId) setSupplierId(prefill.supplierId);
      const p = (db.products || []).find(prod => prod.id === prefill.productId);
      setLines([{
        productId: prefill.productId,
        qty: prefill.qty ? String(prefill.qty) : "1",
        buyPrice: p ? String(p.buyPrice) : ""
      }]);
      if (typeof onClearPrefill === "function") onClearPrefill();
    }
  }, [prefill, db.products, onClearPrefill]);

  function updateLine(i, key, val) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  }
  function addLine() { setLines(ls => [...ls, { productId: "", qty: "", buyPrice: "" }]); }
  function removeLine(i) { setLines(ls => ls.filter((_, idx) => idx !== i)); }

  const validLines = lines.filter(l => l.productId && Number(l.qty) > 0);
  const total = validLines.reduce((a, l) => a + Number(l.qty) * (Number(l.buyPrice) || db.products.find(p=>p.id===l.productId)?.buyPrice || 0), 0);

  function receive() {
    if (validLines.length === 0) {
      notify("warning", "No Items Added", "Please select products and valid quantities.");
      return;
    }
    const supp = db.suppliers.find(s => s.id === supplierId);
    const operator = currentUser?.name || "Mary";
    const today = todayISO(0);
    const timeStr = new Date().toTimeString().slice(0, 5);

    setDb(prev => {
      const nextPoSeq = (prev.poSeq || 2046) + 1;
      const poNumber = invoiceRef.trim() || `PO-${nextPoSeq}`;

      const purchaseItems = validLines.map(l => {
        const prod = prev.products.find(p => p.id === l.productId);
        const itemBuy = Number(l.buyPrice) || prod?.buyPrice || 0;
        return {
          productId: l.productId,
          productName: prod?.name || "Product",
          qty: Number(l.qty),
          unit: prod?.purchaseUnit || "piece",
          unitPrice: itemBuy,
          lineTotal: Number(l.qty) * itemBuy,
        };
      });

      const purchaseEntry = {
        id: uid("PO"),
        poNumber: poNumber,
        supplierId: supp?.id || null,
        supplierName: supp?.name || "Supplier",
        date: today,
        time: timeStr,
        items: purchaseItems,
        total,
        payment: paymentMode,
        receivedBy: operator,
        notes: `Delivery received from ${supp?.name || 'Supplier'} (${invoiceRef || 'No Invoice Ref'})`,
      };

      const products = prev.products.map(p => {
        const line = validLines.find(l => l.productId === p.id);
        if (!line) return p;
        const purchaseQty = Number(line.qty);
        const baseQty = purchaseQty * (p.conversionFactor || 1);
        const newBuy = Number(line.buyPrice) || p.buyPrice;
        const newStock = (Number(p.stock) || 0) + baseQty;

        return {
          ...p,
          stock: newStock,
          buyPrice: newBuy,
          history: [
            ...(p.history || []),
            {
              id: uid("H"),
              date: today,
              time: timeStr,
              action: "Receive Stock",
              ref: poNumber,
              qty: baseQty,
              balance: newStock,
              user: operator,
              reason: `Stock delivery from ${supp?.name || "Supplier"}`,
            }
          ],
        };
      });

      // If paid directly (cash, mpesa, or bank), log as an immediate stock purchase expense
      let updatedExpenses = prev.expenses;
      let updatedSuppliers = prev.suppliers;

      if (paymentMode === "cash" || paymentMode === "mpesa" || paymentMode === "bank") {
        const expEntry = {
          id: uid("EXP"),
          date: today,
          category: "Stock Purchase",
          amount: total,
          description: `Stock delivery from ${supp?.name || "Supplier"} (${invoiceRef || poNumber})`,
          payment: paymentMode === "bank" ? "other" : paymentMode,
          supplierId: supp?.id || null,
        };
        updatedExpenses = [expEntry, ...prev.expenses];

        // Also record payment on supplier ledger so outstanding balance doesn't accumulate
        if (supp) {
          updatedSuppliers = prev.suppliers.map(s => s.id === supp.id ? {
            ...s,
            payments: [...(s.payments || []), { date: today, amount: total, method: paymentMode }]
          } : s);
        }
      }

      const auditEntry = {
        id: uid("LOG"),
        time: `${today} ${timeStr}`,
        user: operator,
        role: "Storekeeper",
        category: "Stock Received",
        action: `Received stock delivery ${poNumber} from ${supp?.name || "Supplier"} (${paymentMode === "credit" ? "On Credit" : "Paid " + paymentMode.toUpperCase()})`,
        detail: `${fmt(total)} · ${purchaseItems.length} item(s)`,
        target: supp?.name || "Supplier",
      };

      return {
        ...prev,
        products,
        purchases: [purchaseEntry, ...(prev.purchases || [])],
        poSeq: nextPoSeq,
        expenses: updatedExpenses,
        suppliers: updatedSuppliers,
        auditLog: [auditEntry, ...prev.auditLog]
      };
    });

    notify("success", "Delivery Received", `Stock updated from ${supp?.name || "Supplier"} · Value: ${fmt(total)}`);
    setDone(true);
  }

  if (done) {
    return (
      <div className="hf-card" style={{ padding: 32, maxWidth: 440, margin: "40px auto", textAlign: "center" }}>
        <CheckCircle2 size={32} color="var(--green)" style={{ margin: "0 auto" }} />
        <div className="disp" style={{ fontSize: 22, fontWeight: 700, marginTop: 12 }}>Delivery Processed</div>
        <div style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 4 }}>
          Inventory levels and cost records updated.
        </div>
        <button
          className="hf-btn hf-btn-primary"
          style={{ marginTop: 18 }}
          onClick={() => { setDone(false); setLines([{ productId: "", qty: "", buyPrice: "" }]); setInvoiceRef(""); }}
        >
          Receive Another Delivery
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="disp" style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Receive Stock Delivery</div>
      <div style={{ color: "var(--ink-soft)", fontSize: 13, marginBottom: 14 }}>
        Log incoming stock shipments from suppliers and automatically update on-hand quantities & buying costs.
      </div>
      <div className="hf-card" style={{ maxWidth: 660, padding: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field label="Supplier *">
            <select className="hf-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              {db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Supplier Invoice / Delivery Note # (Optional)">
            <input className="hf-input" placeholder="e.g. BAM-INV-9921" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} />
          </Field>
        </div>

        {/* Payment Terms for Delivery */}
        <div style={{ marginTop: 12, marginBottom: 6 }}>
          <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Payment for Delivery</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6 }}>
            {[
              { key: "credit", label: "On Credit" },
              { key: "cash", label: "Paid Cash" },
              { key: "mpesa", label: "Paid M-Pesa" },
              { key: "bank", label: "Paid via Bank" },
            ].map(m => {
              const isSelected = paymentMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setPaymentMode(m.key)}
                  className="hf-btn"
                  style={{
                    justifyContent: "center",
                    background: isSelected ? "var(--rust)" : "var(--surface-hover)",
                    color: isSelected ? "#FFFFFF" : "var(--ink)",
                    border: isSelected ? "1.5px solid var(--rust-dark)" : "1.5px solid var(--line)",
                    fontWeight: isSelected ? 700 : 500,
                    fontSize: 12,
                  }}
                >
                  {isSelected ? "✓ " : ""}{m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="hf-kpi-label" style={{ margin: "16px 0 6px" }}>Items Received</div>
        {lines.map((l, i) => {
          const prod = db.products.find(p => p.id === l.productId);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <select className="hf-input" value={l.productId} onChange={e => updateLine(i, "productId", e.target.value)}>
                <option value="">Select product…</option>
                {db.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className="hf-input" type="number" placeholder={prod ? `Qty (${prod.purchaseUnit})` : "Qty"} value={l.qty} onChange={e => updateLine(i, "qty", e.target.value)} />
              <input className="hf-input" type="number" placeholder={prod ? `Buy price (${fmt(prod.buyPrice)})` : "Buy price"} value={l.buyPrice} onChange={e => updateLine(i, "buyPrice", e.target.value)} />
              <button onClick={() => removeLine(i)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={15} color="var(--red)" /></button>
            </div>
          );
        })}
        <button className="hf-btn hf-btn-ghost" onClick={addLine}><Plus size={14} /> Add Product Line</button>

        <div style={{ borderTop: "1.5px dashed var(--line)", marginTop: 16, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Total Delivery Value:</div>
          <div className="mono text-profit" style={{ fontSize: 20, fontWeight: 700 }}>{fmt(total)}</div>
        </div>
        <button className="hf-btn hf-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 14, padding: 12 }} onClick={receive} disabled={validLines.length === 0}>
          <Truck size={16} /> Confirm and Receive Stock
        </button>
      </div>
    </div>
  );
}

/* ================= SUPPLIERS & AUTOMATED EXPENSES ================= */
function Suppliers({ db, setDb, notify, currentUser }) {
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [pinModal, setPinModal] = useState({
    isOpen: false,
    title: "",
    description: "",
    onSuccess: () => {},
  });

  const suppliersWithBal = (db.suppliers || []).map(s => {
    const totalPurchases = supplierTotalPurchases(db, s.id);
    const outstanding = supplierOutstanding(db, s.id);
    const paidFromSupplier = (s.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const linkedExpenseIds = new Set((s.payments || []).map(p => p.expenseId || p.id).filter(Boolean));
    const paidFromExpenses = (db.expenses || [])
      .filter(e => e.category === "Supplier Payment" && e.supplierId === s.id && !linkedExpenseIds.has(e.id))
      .reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const totalPaid = paidFromSupplier + paidFromExpenses;

    return {
      ...s,
      total: totalPurchases,
      paid: totalPaid,
      outstanding: outstanding,
    };
  });

  const active = selected ? suppliersWithBal.find(s => s.id === selected) : null;

  const totalAllPurchases = suppliersWithBal.reduce((a, s) => a + s.total, 0);
  const totalAllPaid = suppliersWithBal.reduce((a, s) => a + s.paid, 0);
  const totalAllOutstanding = suppliersWithBal.reduce((a, s) => a + s.outstanding, 0);

  function recordPayment(supplierId, amount, paymentMethod = "mpesa", reference = "") {
    const valCheck = validateSupplierPayment(db, supplierId, amount);
    if (!valCheck.valid) {
      notify("error", "Payment Blocked", valCheck.reason);
      return;
    }

    const supp = (db.suppliers || []).find(s => s.id === supplierId);
    const today = todayISO(0);
    const timeStr = new Date().toTimeString().slice(0, 5);
    const operator = currentUser?.name || "Owner";
    const payId = uid("SPAY");
    const expId = uid("EXP");

    const paymentEntry = {
      id: payId,
      expenseId: expId,
      date: today,
      time: timeStr,
      amount: Number(amount),
      method: paymentMethod,
      reference: reference.trim(),
      user: operator,
    };

    const expenseEntry = {
      id: expId,
      date: today,
      category: "Supplier Payment",
      amount: Number(amount),
      description: `Payment to supplier: ${supp?.name || 'Supplier'} (${paymentMethod.toUpperCase()}${reference.trim() ? ' - ' + reference.trim() : ''})`,
      payment: paymentMethod === "bank" ? "other" : paymentMethod,
      supplierId: supplierId,
    };

    setDb(prev => ({
      ...prev,
      suppliers: (prev.suppliers || []).map(s => s.id === supplierId ? {
        ...s,
        payments: [paymentEntry, ...(s.payments || [])]
      } : s),
      expenses: [expenseEntry, ...(prev.expenses || [])],
      auditLog: [
        {
          id: uid("LOG"),
          time: `${today} ${timeStr}`,
          user: operator,
          role: currentUser?.role || "Owner",
          category: "Supplier Payment",
          action: `Paid supplier: ${supp?.name || 'Supplier'}`,
          detail: `${fmt(amount)} via ${paymentMethod.toUpperCase()} (logged to expenses & ledger)`,
          target: supp?.name || 'Supplier',
        },
        ...(prev.auditLog || [])
      ],
    }));

    notify("success", "Supplier Payment Recorded", `Paid ${fmt(amount)} to ${supp?.name || 'Supplier'}. Balance updated.`);
  }

  function clearBalance(supplierId) {
    const supp = (db.suppliers || []).find(s => s.id === supplierId);
    const bal = supplierOutstanding(db, supplierId);
    if (bal <= 0) {
      notify("error", "Balance Already Settled", `${supp?.name || 'Supplier'} has zero outstanding payables. No settlement payment is needed.`);
      return;
    }

    if (!confirm(`Are you sure you want to clear the entire outstanding balance (${fmt(bal)}) for ${supp?.name || 'this supplier'}? This will record a settlement payment in your ledger.`)) {
      return;
    }

    recordPayment(supplierId, bal, "mpesa", "Full Balance Settlement");
  }

  function deletePayment(supplierId, paymentId) {
    const supp = (db.suppliers || []).find(s => s.id === supplierId);
    const targetPayment = (supp?.payments || []).find(p => p.id === paymentId);
    if (!targetPayment) return;

    if (!confirm(`Are you sure you want to undo / delete this payment of ${fmt(targetPayment.amount)}? This will restore the supplier's outstanding balance.`)) {
      return;
    }

    const linkedExpenseId = targetPayment.expenseId;

    setDb(prev => ({
      ...prev,
      suppliers: (prev.suppliers || []).map(s => s.id === supplierId ? {
        ...s,
        payments: (s.payments || []).filter(p => p.id !== paymentId)
      } : s),
      expenses: linkedExpenseId ? (prev.expenses || []).filter(e => e.id !== linkedExpenseId) : prev.expenses,
      auditLog: [
        {
          id: uid("LOG"),
          time: `${todayISO(0)} ${new Date().toTimeString().slice(0, 5)}`,
          user: currentUser?.name || "Owner",
          role: currentUser?.role || "Owner",
          category: "Supplier Payment Undo",
          action: `Undid supplier payment of ${fmt(targetPayment.amount)} for ${supp?.name || 'Supplier'}`,
          detail: `Deleted payment ID ${paymentId}`,
          target: supp?.name || 'Supplier',
        },
        ...(prev.auditLog || [])
      ]
    }));

    notify("warning", "Payment Undone", `Removed payment of ${fmt(targetPayment.amount)}. Supplier balance updated.`);
  }

  /* ---------- Delete Individual Supplier with Store PIN ---------- */
  function handleDeleteSupplier(suppId) {
    const target = (db.suppliers || []).find(s => s.id === suppId);
    if (!target) return;

    setPinModal({
      isOpen: true,
      title: "Authorize Supplier Removal",
      description: `Enter Store Security PIN to permanently remove supplier "${target.name}". Associated products will have their supplier link unassigned.`,
      onSuccess: () => {
        const today = todayISO(0);
        const timeStr = new Date().toTimeString().slice(0, 5);
        const operator = currentUser?.name || "Owner";

        setDb(prev => ({
          ...prev,
          suppliers: (prev.suppliers || []).filter(s => s.id !== suppId),
          products: (prev.products || []).map(p => p.supplierId === suppId ? { ...p, supplierId: null } : p),
          auditLog: [
            {
              id: uid("LOG"),
              time: `${today} ${timeStr}`,
              user: operator,
              role: currentUser?.role || "Owner",
              category: "Supplier Deleted",
              action: `Deleted supplier: ${target.name}`,
              detail: `Supplier account removed — Verified via Store PIN`,
              target: target.name,
            },
            ...(prev.auditLog || [])
          ]
        }));

        notify("success", "Supplier Removed", `Supplier "${target.name}" has been deleted.`);
        setSelected(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  /* ---------- Clear All Suppliers with Store PIN ---------- */
  function handleClearAllSuppliers() {
    if ((db.suppliers || []).length === 0) {
      notify("info", "No Suppliers Found", "Supplier list is already empty.");
      return;
    }

    setPinModal({
      isOpen: true,
      title: "Authorize Clear All Suppliers",
      description: `WARNING: Enter Store Security PIN to permanently delete all ${db.suppliers.length} supplier accounts.`,
      onSuccess: () => {
        const today = todayISO(0);
        const timeStr = new Date().toTimeString().slice(0, 5);
        const operator = currentUser?.name || "Owner";

        setDb(prev => ({
          ...prev,
          suppliers: [],
          products: (prev.products || []).map(p => ({ ...p, supplierId: null })),
          auditLog: [
            {
              id: uid("LOG"),
              time: `${today} ${timeStr}`,
              user: operator,
              role: currentUser?.role || "Owner",
              category: "Bulk Supplier Deletion",
              action: `Cleared all suppliers (${(prev.suppliers || []).length} accounts)`,
              detail: `All suppliers removed — Verified via Store PIN`,
              target: "All Suppliers",
            },
            ...(prev.auditLog || [])
          ]
        }));

        notify("success", "All Suppliers Cleared", "All supplier records have been deleted.");
        setSelected(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  function handleSaveNewSupplier(newSupp) {
    setDb(prev => ({
      ...prev,
      suppliers: [newSupp, ...(prev.suppliers || [])],
      auditLog: [
        {
          id: uid("LOG"),
          time: `${todayISO(0)} ${new Date().toTimeString().slice(0, 5)}`,
          user: currentUser?.name || "Owner",
          role: currentUser?.role || "Owner",
          category: "Supplier Created",
          action: `Added new supplier: ${newSupp.name}`,
          detail: `Terms: ${newSupp.terms}, Phone: ${newSupp.phone || 'N/A'}`,
          target: newSupp.name,
        },
        ...(prev.auditLog || [])
      ]
    }));
    notify("success", "Supplier Added", `Registered ${newSupp.name} successfully.`);
    setCreating(false);
  }

  return (
    <div>
      <PinVerificationModal
        isOpen={pinModal.isOpen}
        title={pinModal.title}
        description={pinModal.description}
        onSuccess={pinModal.onSuccess}
        onCancel={() => setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} })}
        db={db}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>Suppliers & Payables</div>
          <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>
            Manage supplier accounts, track stock deliveries, and settle debts with automated expense recording.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--red)", borderColor: "var(--red)" }}
            onClick={handleClearAllSuppliers}
            title="Delete all supplier accounts (Requires PIN)"
          >
            <Trash2 size={14} /> Clear All Suppliers
          </button>
          <button className="hf-btn hf-btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> Add Supplier
          </button>
        </div>
      </div>

      {/* Top Overview KPI Cards */}
      <div className="hf-kpis-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <div className="hf-ticket" style={{ padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label">Total Purchases (All Time)</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, marginTop: "auto", color: "var(--ink)" }}>
            {fmt(totalAllPurchases)}
          </div>
        </div>
        <div className="hf-ticket" style={{ padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label">Total Paid to Suppliers</div>
          <div className="mono text-profit" style={{ fontSize: 22, fontWeight: 700, marginTop: "auto" }}>
            {fmt(totalAllPaid)}
          </div>
        </div>
        <div className="hf-ticket" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", borderLeft: totalAllOutstanding > 0 ? "4px solid var(--red)" : "4px solid var(--green)" }}>
          <div className="hf-kpi-label">Total Outstanding Debt</div>
          <div className={`mono ${totalAllOutstanding > 0 ? "text-loss" : "text-profit"}`} style={{ fontSize: 22, fontWeight: 700, marginTop: "auto" }}>
            {fmt(totalAllOutstanding)}
          </div>
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="hf-card hf-desktop-only">
        <table className="hf-table">
          <thead>
            <tr>
              <th>Supplier Name</th>
              <th>Payment Terms</th>
              <th>Total Purchases</th>
              <th>Total Paid</th>
              <th>Outstanding Balance</th>
              <th>Status</th>
              <th style={{ width: 80, textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {suppliersWithBal.map(s => {
              const isDue = s.outstanding > 0;
              return (
                <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => setSelected(s.id)}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{s.phone || "No phone registered"}</div>
                  </td>
                  <td>{s.terms || "Net 30"}</td>
                  <td className="mono">{fmt(s.total)}</td>
                  <td className="mono text-profit" style={{ fontWeight: 600 }}>{fmt(s.paid)}</td>
                  <td className={`mono ${isDue ? "text-loss" : "text-profit"}`} style={{ fontWeight: 700, fontSize: 14.5 }}>
                    {fmt(s.outstanding)}
                  </td>
                  <td>
                    <Pill tone={isDue ? "red" : "green"}>
                      {isDue ? "BALANCE DUE" : "SETTLED"}
                    </Pill>
                  </td>
                  <td style={{ textAlign: "right" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <button
                        type="button"
                        className="hf-btn hf-btn-ghost"
                        style={{ padding: "4px 6px", color: "var(--red)" }}
                        onClick={() => handleDeleteSupplier(s.id)}
                        title="Delete supplier (Requires PIN)"
                      >
                        <Trash2 size={13} />
                      </button>
                      <ChevronRight size={15} color="var(--ink-soft)" />
                    </div>
                  </td>
                </tr>
              );
            })}
            {suppliersWithBal.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--ink-soft)" }}>
                  No suppliers registered yet. Click "Add Supplier" above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="hf-mobile-only" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {suppliersWithBal.map(s => {
          const isDue = s.outstanding > 0;
          return (
            <div
              key={s.id}
              className="hf-ticket"
              style={{ padding: "14px 16px", cursor: "pointer" }}
              onClick={() => setSelected(s.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{s.phone || "No phone"} · {s.terms}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Pill tone={isDue ? "red" : "green"}>
                    {isDue ? "DUE" : "SETTLED"}
                  </Pill>
                  <button
                    type="button"
                    className="hf-btn hf-btn-ghost"
                    style={{ padding: "4px", color: "var(--red)" }}
                    onClick={e => { e.stopPropagation(); handleDeleteSupplier(s.id); }}
                    title="Delete supplier"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                <div>
                  <div className="hf-kpi-label">Paid</div>
                  <div className="mono text-profit" style={{ fontWeight: 600, fontSize: 13 }}>{fmt(s.paid)}</div>
                </div>
                <div>
                  <div className="hf-kpi-label">Outstanding</div>
                  <div className={`mono ${isDue ? "text-loss" : "text-profit"}`} style={{ fontWeight: 700, fontSize: 14 }}>
                    {fmt(s.outstanding)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Supplier Drawer */}
      {active && (
        <SupplierDrawer
          supplier={active}
          db={db}
          onPay={recordPayment}
          onClearBalance={clearBalance}
          onDeletePayment={deletePayment}
          onDeleteSupplier={handleDeleteSupplier}
          onClose={() => setSelected(null)}
          notify={notify}
        />
      )}

      {/* New Supplier Modal */}
      {creating && (
        <NewSupplierModal
          onCancel={() => setCreating(false)}
          onSave={handleSaveNewSupplier}
          notify={notify}
        />
      )}
    </div>
  );
}

function SupplierDrawer({ supplier, db, onPay, onClearBalance, onDeletePayment, onDeleteSupplier, onClose, notify }) {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("mpesa"); // "mpesa" | "cash" | "bank"
  const [reference, setReference] = useState("");

  const products = (db.products || []).filter(p => p.supplierId === supplier.id);
  const rawPayments = supplier.payments || [];
  const linkedExpensePayments = (db.expenses || [])
    .filter(e => e.category === "Supplier Payment" && e.supplierId === supplier.id && !rawPayments.some(p => p.expenseId === e.id || p.id === e.id))
    .map(e => ({
      id: e.id,
      expenseId: e.id,
      date: e.date,
      time: "",
      amount: e.amount,
      method: e.payment || "mpesa",
      reference: e.description || "Cashbook Expense",
      user: "Owner",
    }));

  const allPayments = [...rawPayments, ...linkedExpensePayments];

  function handlePay() {
    const val = Number(amount);
    const valCheck = validateSupplierPayment(db, supplier.id, val);
    if (!valCheck.valid) {
      notify("error", "Payment Blocked", valCheck.reason);
      return;
    }
    onPay(supplier.id, val, paymentMethod, reference);
    setAmount("");
    setReference("");
  }

  function handleQuickPayFull() {
    if (supplier.outstanding <= 0) {
      notify("error", "Supplier Settled", "This supplier has zero outstanding payables. No payment is required.");
      return;
    }
    setAmount(String(supplier.outstanding));
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.6)", backdropFilter: "blur(2px)", display: "flex", justifyContent: "flex-end", zIndex: 1100 }} onClick={onClose}>
      <div
        className="hf-card hf-modal-card"
        style={{ width: 480, maxWidth: "96vw", height: "100%", borderRadius: 0, overflowY: "auto", padding: "24px 20px", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div className="disp" style={{ fontSize: 24, fontWeight: 700 }}>{supplier.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
              {supplier.phone || "No phone"} · {supplier.terms || "Net 30"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={20} /></button>
        </div>

        {/* Metrics Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div className="hf-ticket" style={{ padding: "12px 14px" }}>
            <div className="hf-kpi-label">Outstanding Balance</div>
            <div className={`mono ${supplier.outstanding > 0 ? "text-loss" : "text-profit"}`} style={{ fontSize: 20, fontWeight: 700 }}>
              {fmt(supplier.outstanding)}
            </div>
          </div>
          <div className="hf-ticket" style={{ padding: "12px 14px" }}>
            <div className="hf-kpi-label">Total Paid to Date</div>
            <div className="mono text-profit" style={{ fontSize: 20, fontWeight: 700 }}>
              {fmt(supplier.paid)}
            </div>
          </div>
          <div className="hf-ticket" style={{ padding: "12px 14px" }}>
            <div className="hf-kpi-label">Total Purchases</div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>
              {fmt(supplier.total)}
            </div>
          </div>
          <div className="hf-ticket" style={{ padding: "12px 14px" }}>
            <div className="hf-kpi-label">Payment Terms</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {supplier.terms || "Net 30"}
            </div>
          </div>
        </div>

        {/* Quick Settlement Actions */}
        {supplier.outstanding > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ flex: 1, justifyContent: "center", fontSize: 12.5, borderColor: "var(--rust)", color: "var(--rust)" }}
              onClick={handleQuickPayFull}
            >
              Fill Full Balance ({fmt(supplier.outstanding)})
            </button>
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ flex: 1, justifyContent: "center", fontSize: 12.5, borderColor: "var(--green)", color: "var(--green)" }}
              onClick={() => onClearBalance(supplier.id)}
            >
              ✓ Clear All to KSh 0
            </button>
          </div>
        )}

        {/* Record Payment Form Box */}
        {supplier.outstanding <= 0 ? (
          <div style={{ background: "rgba(46, 125, 50, 0.08)", border: "1.5px solid rgba(46, 125, 50, 0.25)", borderRadius: 12, padding: "16px 14px", marginBottom: 20, textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--green)", fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
              <CheckCircle2 size={16} /> All Payables Fully Settled
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              {supplier.name} has zero outstanding debt balance (KSh 0). Payments cannot be recorded.
            </div>
          </div>
        ) : (
          <div style={{ background: "var(--surface-hover)", border: "1.5px solid var(--line)", padding: "16px 14px", borderRadius: 12, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div className="hf-kpi-label" style={{ fontWeight: 700 }}>Record Payment to Supplier</div>
              <span style={{ fontSize: 11, color: "var(--rust)", fontWeight: 600 }}>Max: {fmt(supplier.outstanding)}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 12 }}>
              Payments directly deduct from the supplier's outstanding balance and automatically reflect in your daily Cashbook & Expenses.
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[
                { key: "mpesa", label: "M-Pesa" },
                { key: "cash", label: "Cash" },
                { key: "bank", label: "Bank Transfer" },
              ].map(m => (
                <button
                  key={m.key}
                  type="button"
                  className="hf-btn"
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    fontSize: 12,
                    padding: "6px 8px",
                    background: paymentMethod === m.key ? "var(--rust)" : "var(--surface)",
                    color: paymentMethod === m.key ? "#fff" : "var(--ink)",
                    border: paymentMethod === m.key ? "1.5px solid var(--rust-dark)" : "1.5px solid var(--line)",
                  }}
                  onClick={() => setPaymentMethod(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="hf-input"
                type="number"
                max={supplier.outstanding}
                placeholder={`Amount to pay (Max: ${fmt(supplier.outstanding)})`}
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
              <input
                className="hf-input"
                placeholder="Reference / Notes (optional, e.g. BANK-TRF-9921)"
                value={reference}
                onChange={e => setReference(e.target.value)}
              />
              <button
                type="button"
                className="hf-btn hf-btn-primary"
                style={{ width: "100%", justifyContent: "center", padding: "10px", marginTop: 4 }}
                onClick={handlePay}
                disabled={!amount || Number(amount) <= 0}
              >
                Confirm & Deduct Balance
              </button>
            </div>
          </div>
        )}

        {/* Supplier Purchase History & Deliveries */}
        <div style={{ marginBottom: 22 }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Supplier Purchase History</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 500 }}>
              {(db.purchases || []).filter(p => p.supplierId === supplier.id).length} order(s)
            </span>
          </div>

          {/* Total Purchased Summary Ticket */}
          <div className="hf-ticket" style={{ padding: "12px 14px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-hover)" }}>
            <div>
              <div className="hf-kpi-label">Total Purchased Volume</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 1 }}>Cumulative inventory supplied to date</div>
            </div>
            <div className="mono text-profit" style={{ fontSize: 20, fontWeight: 700 }}>
              {fmt(
                (db.purchases || []).filter(p => p.supplierId === supplier.id).reduce((a, p) => a + Number(p.total), 0) || supplier.total || 0
              )}
            </div>
          </div>

          {(() => {
            const suppPurchases = (db.purchases || []).filter(p => p.supplierId === supplier.id);
            if (suppPurchases.length === 0) {
              return (
                <div style={{ color: "var(--ink-soft)", fontSize: 12.5, padding: "12px 0", textAlign: "center", background: "var(--surface-hover)", borderRadius: 8 }}>
                  No purchase records logged for this supplier yet.
                </div>
              );
            }
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                {suppPurchases.map(p => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "9px 12px",
                      background: "var(--surface-hover)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      fontSize: 12.5,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{niceDate(p.date)}</span>
                        <span className="mono" style={{ background: "var(--surface)", padding: "1px 6px", borderRadius: 4, fontSize: 11, border: "1px solid var(--line)" }}>
                          {p.poNumber}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {(p.items || []).map(i => `${i.qty} × ${i.productName}`).join(", ") || p.notes || "Stock delivery"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="mono text-profit" style={{ fontWeight: 700, fontSize: 14 }}>
                        {fmt(p.total)}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--ink-soft)", textTransform: "uppercase" }}>
                        {p.payment === "credit" ? "On Credit" : `Paid ${String(p.payment).toUpperCase()}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Payment History Ledger */}
        <div style={{ marginBottom: 20 }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Payment History & Receipts</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 500 }}>{allPayments.length} recorded</span>
          </div>

          {allPayments.length === 0 ? (
            <div style={{ color: "var(--ink-soft)", fontSize: 12.5, padding: "12px 0", textAlign: "center", background: "var(--surface-hover)", borderRadius: 8 }}>
              No payments recorded for this supplier yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {allPayments.map(p => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    background: "var(--surface-hover)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    fontSize: 12.5,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{niceDate(p.date)} {p.time && `· ${p.time}`}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                      via {(p.method || 'MPESA').toUpperCase()} {p.reference && `(${p.reference})`}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mono text-profit" style={{ fontWeight: 700, fontSize: 13.5 }}>
                      {fmt(p.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeletePayment(supplier.id, p.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", padding: 4 }}
                      title="Undo / Delete this payment"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Products Supplied */}
        <div style={{ marginBottom: 20 }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Products Supplied ({products.length})</div>
          {products.map(p => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{p.name}</span>
              <span className="mono">{fmt(p.buyPrice)} / {p.purchaseUnit}</span>
            </div>
          ))}
          {products.length === 0 && (
            <div style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>No catalog items linked to this supplier yet.</div>
          )}
        </div>

        {/* Delete Supplier Action */}
        <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--red)", borderColor: "var(--red-tint)", fontSize: 12.5 }}
            onClick={() => onDeleteSupplier(supplier.id)}
            title="Permanently remove this supplier (Requires PIN)"
          >
            <Trash2 size={13} /> Delete Supplier Account
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSupplierModal({ onCancel, onSave, notify }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    terms: "Net 30",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSubmit() {
    if (!form.name.trim()) {
      notify("error", "Missing Information", "Please enter the supplier name.");
      return;
    }
    const newSupp = {
      id: uid("SUPP"),
      name: form.name.trim(),
      phone: form.phone.trim(),
      terms: form.terms,
      payments: [],
    };
    onSave(newSupp);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }} onClick={onCancel}>
      <div className="hf-card hf-modal-card" style={{ width: 440, maxWidth: "94vw", padding: "22px 20px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="disp" style={{ fontSize: 20, fontWeight: 700 }}>Add New Supplier</div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={18} /></button>
        </div>

        <Field label="Supplier / Company Name *">
          <input className="hf-input" placeholder="e.g. Bamburi Cement Ltd, Crown Paints" value={form.name} onChange={e => set("name", e.target.value)} autoFocus />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Phone / Contact Number">
          <input className="hf-input" placeholder="e.g. 0722 000 111" value={form.phone} onChange={e => set("phone", e.target.value)} />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Payment Terms">
          <select className="hf-input" value={form.terms} onChange={e => set("terms", e.target.value)}>
            <option value="Cash on delivery">Cash on delivery (COD)</option>
            <option value="Net 7">Net 7 Days</option>
            <option value="Net 14">Net 14 Days</option>
            <option value="Net 30">Net 30 Days</option>
            <option value="Net 60">Net 60 Days</option>
          </select>
        </Field>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button className="hf-btn hf-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="hf-btn hf-btn-primary" onClick={handleSubmit} disabled={!form.name.trim()}>Save Supplier</button>
        </div>
      </div>
    </div>
  );
}

/* ================= CUSTOMERS & CREDIT ================= */
function Customers({ db, setDb, notify, currentUser }) {
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [pinModal, setPinModal] = useState({
    isOpen: false,
    title: "",
    description: "",
    onSuccess: () => {},
  });

  const withBal = (db.customers || []).map(c => ({
    ...c,
    balance: customerBalance(db, c.id),
    days: daysSinceLastActivity(db, c.id)
  }));
  const active = selected ? withBal.find(c => c.id === selected) : null;

  function recordPayment(customerId, amount, method = "cash", reference = "") {
    const valCheck = validateCustomerDebtRepayment(db, customerId, amount);
    if (!valCheck.valid) {
      notify("error", "Payment Blocked", valCheck.reason);
      return;
    }

    const cust = (db.customers || []).find(c => c.id === customerId);
    const today = todayISO(0);
    const timeStr = new Date().toTimeString().slice(0, 5);
    const operator = currentUser?.name || "Owner";

    setDb(prev => ({
      ...prev,
      customers: (prev.customers || []).map(c => c.id === customerId ? {
        ...c,
        payments: [...(c.payments || []), { date: today, time: timeStr, amount: Number(amount), method, reference: reference.trim() }]
      } : c),
      auditLog: [
        {
          id: uid("LOG"),
          time: `${today} ${timeStr}`,
          user: operator,
          role: currentUser?.role || "Staff",
          category: "Customer Payment",
          action: `Received debt payment from ${cust?.name}`,
          detail: `${fmt(amount)} via ${method.toUpperCase()}${reference.trim() ? ` (${reference.trim()})` : ""}`,
          target: cust?.name,
        },
        ...(prev.auditLog || [])
      ],
    }));

    notify("success", "Payment Received", `Recorded ${fmt(amount)} received from ${cust?.name}. Balance updated.`);
  }

  function deletePayment(customerId, paymentIndex) {
    const cust = (db.customers || []).find(c => c.id === customerId);
    if (!cust) return;
    const targetPayment = (cust.payments || [])[paymentIndex];
    if (!targetPayment) return;

    if (!confirm(`Are you sure you want to remove this payment of ${fmt(targetPayment.amount)} from ${cust.name}? This will restore their outstanding debt balance.`)) {
      return;
    }

    const today = todayISO(0);
    const timeStr = new Date().toTimeString().slice(0, 5);
    const operator = currentUser?.name || "Owner";

    setDb(prev => ({
      ...prev,
      customers: (prev.customers || []).map(c => c.id === customerId ? {
        ...c,
        payments: (c.payments || []).filter((_, idx) => idx !== paymentIndex)
      } : c),
      auditLog: [
        {
          id: uid("LOG"),
          time: `${today} ${timeStr}`,
          user: operator,
          role: currentUser?.role || "Owner",
          category: "Payment Voided",
          action: `Voided debt payment for ${cust.name}`,
          detail: `Removed payment of ${fmt(targetPayment.amount)} — Restored debt balance`,
          target: cust.name,
        },
        ...(prev.auditLog || [])
      ]
    }));

    notify("success", "Payment Voided", `Payment of ${fmt(targetPayment.amount)} removed. ${cust.name}'s debt balance restored.`);
  }

  function statusOf(c) {
    if (c.balance === 0) return { tone: "green", label: "Settled" };
    if (c.days > 30) return { tone: "red", label: "Overdue" };
    if (c.days > 14) return { tone: "amber", label: "Due Soon" };
    return { tone: "green", label: "Active" };
  }

  /* ---------- Delete Individual Customer with PIN ---------- */
  function handleDeleteCustomer(custId) {
    const target = (db.customers || []).find(c => c.id === custId);
    if (!target) return;

    setPinModal({
      isOpen: true,
      title: "Authorize Customer Removal",
      description: `Enter Store Security PIN to permanently delete customer account "${target.name}". Any existing sales will remain in sales history.`,
      onSuccess: () => {
        const today = todayISO(0);
        const timeStr = new Date().toTimeString().slice(0, 5);
        const operator = currentUser?.name || "Owner";

        setDb(prev => ({
          ...prev,
          customers: (prev.customers || []).filter(c => c.id !== custId),
          auditLog: [
            {
              id: uid("LOG"),
              time: `${today} ${timeStr}`,
              user: operator,
              role: currentUser?.role || "Owner",
              category: "Customer Deleted",
              action: `Deleted customer account: ${target.name}`,
              detail: `Customer deleted — Verified via Store PIN`,
              target: target.name,
            },
            ...(prev.auditLog || [])
          ]
        }));

        notify("success", "Customer Removed", `Customer "${target.name}" has been deleted.`);
        setSelected(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  /* ---------- Clear All Customers with PIN ---------- */
  function handleClearAllCustomers() {
    if ((db.customers || []).length === 0) {
      notify("info", "No Customers Found", "Customer list is already empty.");
      return;
    }

    setPinModal({
      isOpen: true,
      title: "Authorize Clear All Customers",
      description: `WARNING: Enter Store Security PIN to permanently delete all ${db.customers.length} registered customer accounts.`,
      onSuccess: () => {
        const today = todayISO(0);
        const timeStr = new Date().toTimeString().slice(0, 5);
        const operator = currentUser?.name || "Owner";

        setDb(prev => ({
          ...prev,
          customers: [],
          auditLog: [
            {
              id: uid("LOG"),
              time: `${today} ${timeStr}`,
              user: operator,
              role: currentUser?.role || "Owner",
              category: "Bulk Customer Deletion",
              action: `Cleared all customer accounts (${(prev.customers || []).length} accounts)`,
              detail: `All customer profiles removed — Verified via Store PIN`,
              target: "All Customers",
            },
            ...(prev.auditLog || [])
          ]
        }));

        notify("success", "All Customers Cleared", "All customer records have been deleted.");
        setSelected(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  function handleSaveNewCustomer(newCust) {
    setDb(prev => ({
      ...prev,
      customers: [newCust, ...(prev.customers || [])],
      auditLog: [
        {
          id: uid("LOG"),
          time: `${todayISO(0)} ${new Date().toTimeString().slice(0, 5)}`,
          user: currentUser?.name || "Owner",
          role: currentUser?.role || "Owner",
          category: "Customer Created",
          action: `Registered new customer: ${newCust.name}`,
          detail: `Credit limit: ${fmt(newCust.creditLimit)}, Phone: ${newCust.phone || "N/A"}`,
          target: newCust.name,
        },
        ...(prev.auditLog || [])
      ]
    }));
    notify("success", "Customer Added", `Registered ${newCust.name} successfully.`);
    setCreating(false);
  }

  const totalDebt = withBal.reduce((a, c) => a + c.balance, 0);

  return (
    <div>
      <PinVerificationModal
        isOpen={pinModal.isOpen}
        title={pinModal.title}
        description={pinModal.description}
        onSuccess={pinModal.onSuccess}
        onCancel={() => setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} })}
        db={db}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="disp" style={{ fontSize: 26, fontWeight: 700, marginBottom: 2 }}>Customers & Credit</div>
          <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>
            Total customer debt: <span className="mono text-loss" style={{ fontWeight: 700, fontSize: 15 }}>{fmt(totalDebt)}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--red)", borderColor: "var(--red)" }}
            onClick={handleClearAllCustomers}
            title="Delete all customer accounts (Requires PIN)"
          >
            <Trash2 size={14} /> Clear All Customers
          </button>
          <button className="hf-btn hf-btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> Add Customer
          </button>
        </div>
      </div>

      <div className="hf-card">
        <table className="hf-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Credit Limit</th>
              <th>Current Balance</th>
              <th>Available Credit</th>
              <th>Status</th>
              <th style={{ width: 80, textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {withBal.map(c => {
              const st = statusOf(c);
              return (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setSelected(c.id)}>
                  <td style={{ fontWeight: 600 }}>{c.name}<div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{c.phone}</div></td>
                  <td className="mono">{fmt(c.creditLimit)}</td>
                  <td className={`mono ${c.balance > 0 ? "text-loss" : "text-profit"}`} style={{ fontWeight: 700 }}>
                    {fmt(c.balance)}
                  </td>
                  <td className="mono">{fmt(c.creditLimit - c.balance)}</td>
                  <td><Pill tone={st.tone}>{st.label}</Pill></td>
                  <td style={{ textAlign: "right" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <button
                        type="button"
                        className="hf-btn hf-btn-ghost"
                        style={{ padding: "4px 6px", color: "var(--red)" }}
                        onClick={() => handleDeleteCustomer(c.id)}
                        title="Delete customer (Requires PIN)"
                      >
                        <Trash2 size={13} />
                      </button>
                      <ChevronRight size={15} color="var(--ink-soft)" />
                    </div>
                  </td>
                </tr>
              );
            })}
            {withBal.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 28, color: "var(--ink-soft)" }}>
                  No customers registered yet. Click "Add Customer" above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active && (
        <CustomerDrawer
          customer={active}
          db={db}
          onPay={recordPayment}
          onDeletePayment={deletePayment}
          onDeleteCustomer={handleDeleteCustomer}
          onClose={() => setSelected(null)}
          notify={notify}
        />
      )}

      {creating && (
        <NewCustomerModal
          onCancel={() => setCreating(false)}
          onSave={handleSaveNewCustomer}
          notify={notify}
        />
      )}
    </div>
  );
}

function CustomerDrawer({ customer, db, onPay, onDeletePayment, onDeleteCustomer, onClose, notify }) {
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash"); // "cash" | "mpesa" | "bank"
  const [reference, setReference] = useState("");
  const sales = (db.sales || []).filter(s => s.customerId === customer.id);
  const payments = customer.payments || [];

  function handlePay() {
    const val = Number(amount);
    const valCheck = validateCustomerDebtRepayment(db, customer.id, val);
    if (!valCheck.valid) {
      notify("error", "Payment Blocked", valCheck.reason);
      return;
    }
    onPay(customer.id, val, paymentMethod, reference);
    setAmount("");
    setReference("");
  }

  function handleDownloadStatement() {
    exportCustomerStatementPDF({ customer, db });
    notify("success", "Statement Exported", `Account ledger statement downloaded for ${customer.name}.`);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", justifyContent: "flex-end", zIndex: 1100 }} onClick={onClose}>
      <div className="hf-card" style={{ width: 460, maxWidth: "94vw", height: "100%", borderRadius: 0, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>{customer.name}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{customer.phone || "No phone"}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ fontSize: 11.5, padding: "5px 8px" }}
              onClick={handleDownloadStatement}
              title="Download Customer Account Statement PDF"
            >
              <Download size={13} /> Statement PDF
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)" }}><X size={18} /></button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <Stat label="Credit Limit" value={fmt(customer.creditLimit)} />
          <Stat label="Current Debt Balance" value={fmt(customer.balance)} />
          <Stat label="Available Credit" value={fmt(customer.creditLimit - customer.balance)} />
          <Stat label="Total Purchases" value={fmt(sales.reduce((a,s)=>a+s.total,0))} />
        </div>

        {/* Record Payment Form */}
        {customer.balance <= 0 ? (
          <div style={{ background: "rgba(46, 125, 50, 0.08)", border: "1.5px solid rgba(46, 125, 50, 0.25)", borderRadius: 10, padding: "16px 14px", marginBottom: 18, textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--green)", fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
              <CheckCircle2 size={16} /> Debt Balance Fully Settled
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              {customer.name} has zero outstanding debt balance (KSh 0). Repayment is not permitted.
            </div>
          </div>
        ) : (
          <div style={{ background: "var(--surface-hover)", padding: 14, borderRadius: 10, marginBottom: 18, border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div className="hf-kpi-label">Record Payment Received</div>
              <span style={{ fontSize: 11, color: "var(--rust)", fontWeight: 600 }}>Max: {fmt(customer.balance)}</span>
            </div>
            
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {[
                { key: "cash", label: "Cash" },
                { key: "mpesa", label: "M-Pesa" },
                { key: "bank", label: "Bank Transfer" },
              ].map(m => (
                <button
                  key={m.key}
                  type="button"
                  className="hf-btn"
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    fontSize: 11.5,
                    padding: "5px 6px",
                    background: paymentMethod === m.key ? "var(--rust)" : "var(--surface)",
                    color: paymentMethod === m.key ? "#fff" : "var(--ink)",
                    border: paymentMethod === m.key ? "1.5px solid var(--rust-dark)" : "1.5px solid var(--line)",
                  }}
                  onClick={() => setPaymentMethod(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="hf-input"
                type="number"
                max={customer.balance}
                placeholder={`Payment received (Max: ${fmt(customer.balance)})`}
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
              <input
                className="hf-input"
                placeholder="Reference / Note (optional, e.g. MPESA Ref)"
                value={reference}
                onChange={e => setReference(e.target.value)}
              />
              <button
                className="hf-btn hf-btn-primary"
                style={{ justifyContent: "center" }}
                onClick={handlePay}
                disabled={!amount || Number(amount) <= 0}
              >
                Record Debt Payment
              </button>
            </div>
          </div>
        )}

        {/* Customer Payment History & Receipts */}
        <div style={{ marginBottom: 20 }}>
          <div className="disp" style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Payment History & Receipts</span>
            <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 500 }}>
              {payments.length} recorded
            </span>
          </div>

          {payments.length === 0 ? (
            <div style={{ color: "var(--ink-soft)", fontSize: 12.5, padding: "12px 0", textAlign: "center", background: "var(--surface-hover)", borderRadius: 8 }}>
              No payments recorded for this customer yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {payments.map((p, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    background: "var(--surface-hover)",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    fontSize: 12.5,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{niceDate(p.date)}</span>
                      <Pill tone="green">{p.method ? p.method.toUpperCase() : "CASH"}</Pill>
                    </div>
                    {p.reference && (
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>
                        Ref: {p.reference}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mono text-profit" style={{ fontWeight: 700, fontSize: 13.5 }}>
                      +{fmt(p.amount)}
                    </span>
                    {onDeletePayment && (
                      <button
                        type="button"
                        className="hf-btn hf-btn-ghost"
                        style={{ padding: "3px 6px", color: "var(--red)", borderColor: "transparent" }}
                        onClick={() => onDeletePayment(customer.id, idx)}
                        title="Delete / undo this payment (Restores debt)"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="disp" style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Purchase History</div>
        {sales.length === 0 && <div style={{ color: "var(--ink-soft)", fontSize: 13, marginBottom: 14 }}>No purchases recorded yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {sales.map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{s.invoiceNo} · {niceDate(s.date)}</span>
              <span className="mono text-profit" style={{ fontWeight: 600 }}>{fmt(s.total)}</span>
            </div>
          ))}
        </div>

        {/* Delete Customer Action */}
        <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--red)", borderColor: "var(--red-tint)", fontSize: 12.5 }}
            onClick={() => onDeleteCustomer(customer.id)}
            title="Permanently remove this customer account (Requires PIN)"
          >
            <Trash2 size={13} /> Delete Customer Account
          </button>
        </div>
      </div>
    </div>
  );
}

function NewCustomerModal({ onCancel, onSave, notify }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    creditLimit: "50000",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSubmit() {
    if (!form.name.trim()) {
      notify("error", "Missing Information", "Please enter the customer's name.");
      return;
    }
    const newCust = {
      id: uid("CUST"),
      name: form.name.trim(),
      phone: form.phone.trim(),
      creditLimit: Number(form.creditLimit) || 50000,
      payments: [],
    };
    onSave(newCust);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }} onClick={onCancel}>
      <div className="hf-card hf-modal-card" style={{ width: 440, maxWidth: "94vw", padding: "22px 20px" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="disp" style={{ fontSize: 20, fontWeight: 700 }}>Add New Customer</div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={18} /></button>
        </div>

        <Field label="Customer / Business Name *">
          <input className="hf-input" placeholder="e.g. John Kamau / BuildCorp Builders" value={form.name} onChange={e => set("name", e.target.value)} autoFocus />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Phone / Contact Number">
          <input className="hf-input" placeholder="e.g. 0712 345 678" value={form.phone} onChange={e => set("phone", e.target.value)} />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Credit Limit (KSh)">
          <input className="hf-input mono" type="number" placeholder="e.g. 50000" value={form.creditLimit} onChange={e => set("creditLimit", e.target.value)} />
        </Field>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button className="hf-btn hf-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="hf-btn hf-btn-primary" onClick={handleSubmit} disabled={!form.name.trim()}>Save Customer</button>
        </div>
      </div>
    </div>
  );
}

/* ================= QUOTATIONS ================= */
function Quotations({ db, setDb, notify, currentUser }) {
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  function convert(q) {
    const items = q.items.map(i => {
      const prod = db.products.find(p => p.id === i.productId);
      return {
        productId: i.productId,
        qty: Number(i.qty) || 0,
        unitPrice: i.unitPrice,
        unitCost: prod ? prod.buyPrice / (prod.conversionFactor || 1) : 0,
        product: prod,
      };
    });

    // Check inventory availability before converting
    const overStockItems = items.filter(i => (Number(i.qty) || 0) > (i.product?.stock || 0));
    if (overStockItems.length > 0) {
      const summary = overStockItems.map(i => `"${i.product?.name || 'Item'}" (Requested: ${i.qty}, In Stock: ${i.product?.stock || 0})`).join("; ");
      notify("error", "Conversion Blocked — Insufficient Stock", `Cannot convert quotation to sale. Requested items exceed inventory: ${summary}. Please receive stock first.`);
      return;
    }

    const total = items.reduce((a, i) => a + i.unitPrice * i.qty, 0);
    const cost = items.reduce((a, i) => a + i.unitCost * i.qty, 0);
    
    const existingInvSeqs = (db.sales || []).map(s => {
      const m = String(s.invoiceNo || "").match(/\d+$/);
      return m ? parseInt(m[0], 10) : 0;
    });
    const nextSeqNum = Math.max(457, ...existingInvSeqs, Number(db.invoiceSeq) || 0) + 1;
    const invoiceNo = `INV-2026-${String(nextSeqNum).padStart(5, "0")}`;
    const employee = currentUser?.name || "Owner";

    const sale = {
      id: uid("INV"),
      invoiceNo,
      date: todayISO(0),
      time: new Date().toTimeString().slice(0, 5),
      items,
      total,
      cost,
      profit: total - cost,
      payment: "credit",
      customerId: q.customerId,
      employee
    };

    setDb(prev => {
      const allPrevInvSeqs = (prev.sales || []).map(s => {
        const m = String(s.invoiceNo || "").match(/\d+$/);
        return m ? parseInt(m[0], 10) : 0;
      });
      const resolvedSeq = Math.max(nextSeqNum, ...allPrevInvSeqs) + 1;

      return {
        ...prev,
        products: prev.products.map(p => {
          const line = items.find(i => i.productId === p.id);
          if (!line) return p;
          return {
            ...p,
            stock: p.stock - line.qty,
            history: [...p.history, { date: sale.date, action: "Sale", qty: -line.qty, user: employee }]
          };
        }),
        sales: [sale, ...prev.sales],
        invoiceSeq: resolvedSeq,
        quotations: prev.quotations.map(x => x.id === q.id ? { ...x, status: "converted" } : x),
        auditLog: [
          {
            id: uid("LOG"),
            time: todayISO(0) + " " + new Date().toTimeString().slice(0, 5),
            user: employee,
            role: currentUser?.role || "Staff",
            category: "Quotation",
            action: `Converted quotation ${q.number} to sale`,
            detail: invoiceNo,
            target: q.number,
          },
          ...prev.auditLog
        ],
      };
    });

    notify("success", "Quotation Converted", `${q.number} converted to sale invoice ${invoiceNo}.`);
    setViewing(null);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>Quotations</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
            Prepare formal price quotes, export branded customer PDF quotations, and convert approved quotes to sales.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            onClick={() => {
              if ((db.quotations || []).length === 0) {
                notify("info", "No Quotations", "No quotations available to export.");
                return;
              }
              exportQuotationsListPDF({ quotations: db.quotations, db });
              notify("success", "Quotations Register Downloaded", `Exported ${(db.quotations || []).length} quotations to PDF summary.`);
            }}
            title="Download full quotations register PDF"
          >
            <Download size={14} /> Download Quotations List PDF
          </button>
          <button className="hf-btn hf-btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New Quotation
          </button>
        </div>
      </div>
      <div className="hf-card">
        <table className="hf-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Total Amount</th>
              <th>Status</th>
              <th style={{ width: 140, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(db.quotations || []).map(q => {
              const cust = (db.customers || []).find(c => c.id === q.customerId);
              const total = (q.items || []).reduce((a, i) => a + i.unitPrice * i.qty, 0);
              return (
                <tr key={q.id} style={{ cursor: "pointer" }} onClick={() => setViewing(q)}>
                  <td className="mono" style={{ fontWeight: 600 }}>{q.number}</td>
                  <td>{cust?.name || "Walk-in Prospect"}</td>
                  <td>{niceDate(q.date)}</td>
                  <td className="mono text-profit" style={{ fontWeight: 600 }}>{fmt(total)}</td>
                  <td><Pill tone={q.status === "converted" ? "green" : "steel"}>{q.status.toUpperCase()}</Pill></td>
                  <td style={{ textAlign: "right" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <button
                        type="button"
                        className="hf-btn hf-btn-ghost"
                        style={{ padding: "4px 8px", fontSize: 11.5 }}
                        onClick={() => {
                          exportQuotationPDF({ quote: q, db });
                          notify("success", "Quotation PDF Downloaded", `Saved ${q.number}.`);
                        }}
                        title="Download branded official PDF quotation"
                      >
                        <Download size={12} /> PDF
                      </button>
                      <ChevronRight size={15} color="var(--ink-soft)" />
                    </div>
                  </td>
                </tr>
              );
            })}
            {(db.quotations || []).length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)", padding: 24 }}>No quotations created yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {viewing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setViewing(null)}>
          <div className="hf-card" style={{ width: 480, maxWidth: "92vw", padding: 22 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div className="disp" style={{ fontSize: 20, fontWeight: 700 }}>{viewing.number}</div>
              <button onClick={() => setViewing(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>
              {(db.customers || []).find(c=>c.id===viewing.customerId)?.name || "Walk-in Prospect"} · {niceDate(viewing.date)}
            </div>
            <table className="hf-table" style={{ marginBottom: 12 }}>
              <thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
              <tbody>
                {(viewing.items || []).map((i, idx) => {
                  const p = (db.products || []).find(pp => pp.id === i.productId);
                  return (
                    <tr key={idx}>
                      <td>{p?.name}</td>
                      <td className="mono">{i.qty}</td>
                      <td className="mono">{fmt(i.unitPrice)}</td>
                      <td className="mono text-profit">{fmt(i.unitPrice * i.qty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 16 }}>
              <span>Total Quotation</span>
              <span className="mono text-profit" style={{ fontSize: 16 }}>{fmt((viewing.items || []).reduce((a,i)=>a+i.unitPrice*i.qty,0))}</span>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="hf-btn hf-btn-ghost"
                onClick={() => {
                  exportQuotationPDF({ quote: viewing, db });
                  notify("success", "Quotation PDF Downloaded", `Saved ${viewing.number}.`);
                }}
              >
                <Download size={14} /> Download PDF
              </button>
              {viewing.status !== "converted" && (
                <button className="hf-btn hf-btn-primary" onClick={() => convert(viewing)}>
                  <ArrowRight size={14} /> Convert to Sale
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {creating && <NewQuoteModal db={db} setDb={setDb} onClose={() => setCreating(false)} notify={notify} />}
    </div>
  );
}

function NewQuoteModal({ db, setDb, onClose, notify }) {
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState([{ productId: "", qty: "" }]);
  function updateLine(i, key, val) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [key]: val } : l)); }

  function save() {
    const items = lines.filter(l => l.productId && Number(l.qty) > 0).map(l => {
      const p = db.products.find(pp => pp.id === l.productId);
      return { productId: l.productId, qty: Number(l.qty), unitPrice: p.sellPrice };
    });
    if (items.length === 0) {
      notify("warning", "Missing Items", "Please add valid products and quantities to the quotation.");
      return;
    }

    const existingQuoteSeqs = (db.quotations || []).map(q => {
      const m = String(q.number || "").match(/\d+$/);
      return m ? parseInt(m[0], 10) : 0;
    });
    const nextQuoteNum = Math.max(1044, ...existingQuoteSeqs, Number(db.quoteSeq) || 0) + 1;
    const qNumber = `QT-${nextQuoteNum}`;

    const q = { id: uid("QT"), number: qNumber, customerId: customerId || null, date: todayISO(0), status: "draft", items };
    
    setDb(prev => {
      const allPrevSeqs = (prev.quotations || []).map(x => {
        const m = String(x.number || "").match(/\d+$/);
        return m ? parseInt(m[0], 10) : 0;
      });
      const resolvedSeq = Math.max(nextQuoteNum, ...allPrevSeqs) + 1;
      return {
        ...prev,
        quotations: [q, ...prev.quotations],
        quoteSeq: resolvedSeq,
      };
    });

    notify("success", "Quotation Saved", `Created quote ${q.number}.`);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div className="hf-card" style={{ width: 480, maxWidth: "92vw", padding: 22 }} onClick={e => e.stopPropagation()}>
        <div className="disp" style={{ fontSize: 20, fontWeight: 700, marginBottom: 14 }}>New Quotation</div>
        <Field label="Customer">
          <select className="hf-input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">Walk-in / prospect</option>
            {db.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="hf-kpi-label" style={{ margin: "14px 0 6px" }}>Items</div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 8 }}>
            <select className="hf-input" value={l.productId} onChange={e => updateLine(i, "productId", e.target.value)}>
              <option value="">Select product…</option>
              {db.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="hf-input" type="number" placeholder="Qty" value={l.qty} onChange={e => updateLine(i, "qty", e.target.value)} />
          </div>
        ))}
        <button className="hf-btn hf-btn-ghost" onClick={() => setLines(ls => [...ls, { productId: "", qty: "" }])}><Plus size={14} /> Add Line</button>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="hf-btn hf-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="hf-btn hf-btn-primary" onClick={save}>Save Quotation</button>
        </div>
      </div>
    </div>
  );
}

/* ================= CASHBOOK & EXPENSES ================= */
function Cashbook({ db, setDb, notify, currentUser }) {
  const [showExpense, setShowExpense] = useState(false);
  const today = todayISO(0);
  const inflows = db.sales.filter(s => isSameDay(s.date, today) && s.payment !== "credit");
  const paymentsIn = [...db.customers.flatMap(c => (c.payments||[]).filter(p=>isSameDay(p.date, today)).map(p=>({...p, who:c.name}))) ];
  const outflows = db.expenses.filter(e => isSameDay(e.date, today));

  const totalIn = inflows.reduce((a, s) => a + s.total, 0) + paymentsIn.reduce((a, p) => a + p.amount, 0);
  const totalOut = outflows.reduce((a, e) => a + e.amount, 0);
  const netMovement = totalIn - totalOut;

  function addExpense(form) {
    if (form.category === "Supplier Payment") {
      if (!form.supplierId) {
        notify("error", "Supplier Required", "Please select a supplier for supplier payments. No expense recorded.");
        return;
      }
      const valCheck = validateSupplierPayment(db, form.supplierId, Number(form.amount));
      if (!valCheck.valid) {
        notify("error", "Payment Blocked", valCheck.reason);
        return;
      }
    }

    const expId = uid("EXP");
    const todayStr = todayISO(0);
    const timeStr = new Date().toTimeString().slice(0, 5);
    const operator = currentUser?.name || "Owner";
    const amountVal = Number(form.amount) || 0;

    const exp = {
      id: expId,
      date: todayStr,
      category: form.category,
      amount: amountVal,
      description: form.description || (form.category === "Supplier Payment" ? `Payment to supplier: ${(db.suppliers || []).find(s => s.id === form.supplierId)?.name || 'Supplier'}` : "No description"),
      payment: form.payment || "cash",
      supplierId: form.supplierId || null,
    };

    setDb(prev => {
      let updatedSuppliers = prev.suppliers || [];
      if (form.category === "Supplier Payment" && form.supplierId) {
        const supp = updatedSuppliers.find(s => s.id === form.supplierId);
        updatedSuppliers = updatedSuppliers.map(s => s.id === form.supplierId ? {
          ...s,
          payments: [
            {
              id: uid("SPAY"),
              expenseId: expId,
              date: todayStr,
              time: timeStr,
              amount: amountVal,
              method: form.payment || "cash",
              reference: form.description || "Cashbook Expense Payment",
              user: operator,
            },
            ...(s.payments || [])
          ]
        } : s);
      }

      return {
        ...prev,
        suppliers: updatedSuppliers,
        expenses: [exp, ...(prev.expenses || [])],
        auditLog: [
          {
            id: uid("LOG"),
            time: `${todayStr} ${timeStr}`,
            user: operator,
            role: "Owner",
            category: "Expense",
            action: `Recorded expense — ${form.category}`,
            detail: `${fmt(amountVal)} (${form.description || "No description"})`,
            target: form.category,
          },
          ...(prev.auditLog || [])
        ]
      };
    });

    notify("success", "Expense Recorded", `${form.category}: ${fmt(amountVal)} saved.`);
    setShowExpense(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>Cashbook & Daily Flow</div>
        <button className="hf-btn hf-btn-primary" onClick={() => setShowExpense(true)}><Plus size={15} /> Record Expense</button>
      </div>

      <div className="hf-cashbook-summary">
        <div className="hf-ticket" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label" style={{ minHeight: 24 }}>Today's Inflow (Money In)</div>
          <div className="mono text-profit" style={{ fontSize: 22, fontWeight: 700, marginTop: "auto" }}>{fmt(totalIn)}</div>
        </div>
        <div className="hf-ticket" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label" style={{ minHeight: 24 }}>Today's Outflow (Money Out)</div>
          <div className="mono text-loss" style={{ fontSize: 22, fontWeight: 700, marginTop: "auto" }}>{fmt(totalOut)}</div>
        </div>
        <div className="hf-ticket" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label" style={{ minHeight: 24 }}>Net Cash Movement</div>
          <div className={`mono ${netMovement >= 0 ? "text-profit" : "text-loss"}`} style={{ fontSize: 22, fontWeight: 700, marginTop: "auto" }}>
            {fmt(netMovement)}
          </div>
        </div>
      </div>

      <div className="hf-two-col">
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingUp size={15} color="var(--green)" /> Money In (Cash & M-Pesa Sales + Debt Payments)
          </div>
          <div className="hf-card">
            {inflows.map(s => <Row key={s.id} label={`Sale ${s.invoiceNo} (${s.payment === "mpesa" ? "M-Pesa" : s.payment.toUpperCase()})`} value={s.total} isProfit />)}
            {paymentsIn.map((p, i) => <Row key={i} label={`Customer Debt Payment — ${p.who}`} value={p.amount} isProfit />)}
            {inflows.length === 0 && paymentsIn.length === 0 && <div style={{ padding: 16, color: "var(--ink-soft)", fontSize: 13 }}>No cash inflows recorded today.</div>}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingDown size={15} color="var(--red)" /> Money Out (Expenses & Supplier Payments)
          </div>
          <div className="hf-card">
            {outflows.map(e => <Row key={e.id} label={`${e.category} — ${e.description}`} value={e.amount} isLoss />)}
            {outflows.length === 0 && <div style={{ padding: 16, color: "var(--ink-soft)", fontSize: 13 }}>No outflows recorded today.</div>}
          </div>
        </div>
      </div>

      <div className="disp" style={{ fontSize: 18, fontWeight: 700, margin: "24px 0 10px" }}>Expenses This Month by Category</div>
      <ExpenseSummary db={db} />

      {showExpense && <NewExpenseModal db={db} onCancel={() => setShowExpense(false)} onSave={addExpense} notify={notify} />}
    </div>
  );
}

function Row({ label, value, isProfit, isLoss }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 14px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <span>{label}</span>
      <span className={`mono ${isProfit ? "text-profit" : isLoss ? "text-loss" : ""}`} style={{ fontWeight: 600 }}>
        {fmt(value)}
      </span>
    </div>
  );
}

function ExpenseSummary({ db }) {
  const monthPrefix = todayISO(0).slice(0, 7);
  const thisMonth = db.expenses.filter(e => e.date.startsWith(monthPrefix));
  const byCat = {};
  thisMonth.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
  const total = Object.values(byCat).reduce((a, b) => a + b, 0);

  return (
    <div className="hf-card">
      {Object.entries(byCat).map(([cat, amt]) => <Row key={cat} label={cat} value={amt} isLoss />)}
      {Object.keys(byCat).length === 0 && <div style={{ padding: 16, color: "var(--ink-soft)", fontSize: 13 }}>No expenses recorded this month.</div>}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", fontWeight: 700, fontSize: 13.5 }}>
        <span>Total Expenses This Month</span>
        <span className="mono text-loss">{fmt(total)}</span>
      </div>
    </div>
  );
}

function NewExpenseModal({ db, onCancel, onSave, notify }) {
  const [form, setForm] = useState({ category: "Transport", amount: "", description: "", payment: "cash", supplierId: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSave() {
    if (!form.amount || Number(form.amount) <= 0) {
      notify("error", "Invalid Amount", "Please enter a valid expense amount.");
      return;
    }
    if (form.category === "Supplier Payment") {
      if (!form.supplierId) {
        notify("error", "Supplier Required", "Please select which supplier you are paying.");
        return;
      }
      const valCheck = validateSupplierPayment(db, form.supplierId, Number(form.amount));
      if (!valCheck.valid) {
        notify("error", "Payment Blocked", valCheck.reason);
        return;
      }
    }
    onSave(form);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }} onClick={onCancel}>
      <div className="hf-card hf-modal-card" style={{ width: 440, maxWidth: "94vw", padding: "22px 20px" }} onClick={e => e.stopPropagation()}>
        <div className="disp" style={{ fontSize: 20, fontWeight: 700, marginBottom: 14 }}>Record Expense</div>
        <Field label="Category">
          <select className="hf-input" value={form.category} onChange={e => set("category", e.target.value)}>
            {["Transport", "Rent", "Salaries", "Electricity", "Repairs", "Supplier Payment", "Other"].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>

        {form.category === "Supplier Payment" && (
          <>
            <div style={{ height: 10 }} />
            <Field label="Select Supplier to Pay *">
              <select
                className="hf-input"
                value={form.supplierId}
                onChange={e => {
                  const sId = e.target.value;
                  const bal = sId ? supplierOutstanding(db, sId) : 0;
                  setForm(f => ({
                    ...f,
                    supplierId: sId,
                    amount: bal > 0 && (!f.amount || f.amount === "0") ? String(bal) : f.amount
                  }));
                }}
              >
                <option value="">Select supplier…</option>
                {(db?.suppliers || []).map(s => {
                  const bal = supplierOutstanding(db, s.id);
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} {bal > 0 ? `(Owed: ${fmt(bal)})` : "(Settled: KSh 0)"}
                    </option>
                  );
                })}
              </select>
            </Field>
          </>
        )}

        <div style={{ height: 10 }} />
        <Field label="Amount (KSh)"><input className="hf-input" type="number" placeholder="e.g. 2500" value={form.amount} onChange={e => set("amount", e.target.value)} /></Field>
        <div style={{ height: 10 }} />
        <Field label="Description / Reference"><input className="hf-input" placeholder="e.g. Generator fuel, delivery fare, M-Pesa ref" value={form.description} onChange={e => set("description", e.target.value)} /></Field>
        <div style={{ height: 10 }} />
        <Field label="Payment Method">
          <select className="hf-input" value={form.payment} onChange={e => set("payment", e.target.value)}>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
            <option value="bank">Bank Transfer</option>
          </select>
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="hf-btn hf-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="hf-btn hf-btn-primary" onClick={handleSave}>Save Expense</button>
        </div>
      </div>
    </div>
  );
}

/* ================= REPORTS ================= */
function Reports({ db, notify, role }) {
  const monthPrefix = todayISO(0).slice(0, 7);
  const monthName = new Date(todayISO(0)).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const monthSales = db.sales.filter(s => s.date.startsWith(monthPrefix));
  const revenue = monthSales.reduce((a, s) => a + s.total, 0);
  const cogs = monthSales.reduce((a, s) => a + s.cost, 0);
  const grossProfit = revenue - cogs;
  const monthExpenses = db.expenses.filter(e => e.date.startsWith(monthPrefix)).reduce((a, e) => a + e.amount, 0);
  const netEst = grossProfit - monthExpenses;

  const productProfit = {};
  monthSales.forEach(s => s.items.forEach(i => {
    const p = db.products.find(pp => pp.id === i.productId);
    if (!p) return;
    productProfit[p.id] = productProfit[p.id] || { name: p.name, qtySold: 0, sales: 0, profit: 0 };
    productProfit[p.id].qtySold += i.qty;
    productProfit[p.id].sales += i.unitPrice * i.qty;
    productProfit[p.id].profit += (i.unitPrice - i.unitCost) * i.qty;
  }));
  const ranked = Object.values(productProfit).sort((a, b) => b.profit - a.profit);

  const lowStock = db.products.filter(p => p.stock <= p.minStock);
  const debts = db.customers.map(c => ({ name: c.name, phone: c.phone, creditLimit: c.creditLimit, balance: customerBalance(db, c.id) })).filter(c => c.balance > 0);

  function downloadPDF() {
    exportReportCenterPDF({
      monthName,
      revenue,
      cogs,
      grossProfit,
      expenses: monthExpenses,
      netProfit: netEst,
      rankedProducts: ranked,
      lowStock,
      debts,
    });
    notify("success", "Performance Report PDF Exported", `Report for ${monthName} generated.`);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>Report Centre — {monthName}</div>
        <button className="hf-btn hf-btn-ghost" onClick={downloadPDF}>
          <Download size={15} /> Download PDF Report
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 22 }}>
        <div className="hf-ticket" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label" style={{ minHeight: 24 }}>Total Sales</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: "auto" }}>{fmt(revenue)}</div>
        </div>
        <div className="hf-ticket" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label" style={{ minHeight: 24 }}>Cost of Goods</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: "auto", color: "var(--ink-soft)" }}>{fmt(cogs)}</div>
        </div>
        <div className="hf-ticket" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label" style={{ minHeight: 24 }}>Gross Profit</div>
          <div className="mono text-profit" style={{ fontSize: 20, fontWeight: 700, marginTop: "auto" }}>{fmt(grossProfit)}</div>
        </div>
        <div className="hf-ticket" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label" style={{ minHeight: 24 }}>Expenses</div>
          <div className="mono text-loss" style={{ fontSize: 20, fontWeight: 700, marginTop: "auto" }}>{fmt(monthExpenses)}</div>
        </div>
        <div className="hf-ticket" style={{ padding: 16, display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label" style={{ minHeight: 24 }}>Estimated Net {netEst >= 0 ? "Profit" : "Loss"}</div>
          <div className={`mono ${netEst >= 0 ? "text-profit" : "text-loss"}`} style={{ fontSize: 20, fontWeight: 700, marginTop: "auto" }}>
            {fmt(netEst)}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div>
          <div className="disp" style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Award size={16} color="var(--rust)" /> Product Profitability {role !== "owner" && <Lock size={12} />}
          </div>
          {role === "owner" ? (
            <div className="hf-card">
              {ranked.map((p, i) => (
                <div key={i} style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13.5 }}>
                    <span>#{i + 1} {p.name}</span>
                    <span className="mono text-profit">{fmt(p.profit)}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>
                    {p.qtySold} units sold · Revenue {fmt(p.sales)}
                  </div>
                </div>
              ))}
              {ranked.length === 0 && <div style={{ padding: 16, color: "var(--ink-soft)", fontSize: 13 }}>No sales recorded this month.</div>}
            </div>
          ) : (
            <div className="hf-card" style={{ padding: 24, textAlign: "center", color: "var(--ink-soft)" }}>
              <Lock size={18} style={{ margin: "0 auto 6px" }} />
              Product margin analytics are restricted to Owner.
            </div>
          )}
        </div>

        <div>
          <div className="disp" style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Low Stock Alert Items</div>
          <div className="hf-card" style={{ marginBottom: 18 }}>
            {lowStock.map(p => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                <span>{p.name}</span>
                <span className="mono text-loss" style={{ fontWeight: 700 }}>{p.stock} {p.baseUnit}</span>
              </div>
            ))}
            {lowStock.length === 0 && <div style={{ padding: 16, color: "var(--green)", fontSize: 13 }}>All products are above minimum stock levels.</div>}
          </div>

          <div className="disp" style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Outstanding Customer Debts</div>
          <div className="hf-card">
            {debts.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                <span>{c.name}</span>
                <span className="mono text-loss" style={{ fontWeight: 700 }}>{fmt(c.balance)}</span>
              </div>
            ))}
            {debts.length === 0 && <div style={{ padding: 16, color: "var(--green)", fontSize: 13 }}>No outstanding customer debts.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Intelligently reverses the underlying financial, inventory, or ledger transaction
 * associated with an audit log record when the user deletes the audit event.
 */
function revertTransactionFromAuditLog(prevDb, logItem) {
  let updatedDb = {
    ...prevDb,
    customers: [...(prevDb.customers || [])],
    suppliers: [...(prevDb.suppliers || [])],
    expenses: [...(prevDb.expenses || [])],
    sales: [...(prevDb.sales || [])],
    products: [...(prevDb.products || [])],
    auditLog: [...(prevDb.auditLog || [])],
  };

  const cat = (logItem.category || "").toLowerCase();
  const act = (logItem.action || "").toLowerCase();
  const det = (logItem.detail || "").toLowerCase();
  let reversalDescription = "";

  // 1. Customer Debt Payment Reversal
  if (cat.includes("customer payment") || cat.includes("debt") || act.includes("debt payment") || act.includes("payment from")) {
    const custTargetName = (logItem.target || "").trim();
    // Extract numerical amount from detail e.g. "KSh 25,000 via CASH" or detail string
    const amtMatch = (logItem.detail || "").replace(/,/g, "").match(/\d+/);
    const amountVal = amtMatch ? Number(amtMatch[0]) : null;
    const logDate = (logItem.time || "").slice(0, 10);

    let foundAndReverted = false;
    updatedDb.customers = updatedDb.customers.map(c => {
      const isTargetCust = (custTargetName && c.name.toLowerCase() === custTargetName.toLowerCase()) ||
                           (custTargetName && c.id === custTargetName) ||
                           (act.includes(c.name.toLowerCase()));

      if (isTargetCust && !foundAndReverted) {
        const paymentsList = [...(c.payments || [])];
        let removeIdx = -1;

        // Search for matching payment starting from latest
        for (let i = paymentsList.length - 1; i >= 0; i--) {
          const p = paymentsList[i];
          const pAmt = Number(p.amount) || 0;
          if (amountVal && pAmt === amountVal && (!logDate || p.date === logDate)) {
            removeIdx = i;
            break;
          } else if (amountVal && pAmt === amountVal) {
            removeIdx = i;
            break;
          } else if (!amountVal && p.date === logDate) {
            removeIdx = i;
            break;
          }
        }

        if (removeIdx !== -1) {
          const removedPayment = paymentsList.splice(removeIdx, 1)[0];
          foundAndReverted = true;
          reversalDescription = `Removed payment of ${fmt(removedPayment.amount)} from ${c.name} (Debt balance restored).`;
          return {
            ...c,
            payments: paymentsList,
          };
        }
      }
      return c;
    });
  }

  // 2. Supplier Payment Reversal
  else if (cat.includes("supplier payment") || act.includes("paid supplier")) {
    const suppTargetName = (logItem.target || "").trim();
    const amtMatch = (logItem.detail || "").replace(/,/g, "").match(/\d+/);
    const amountVal = amtMatch ? Number(amtMatch[0]) : null;
    let linkedExpId = null;

    let foundAndReverted = false;
    updatedDb.suppliers = updatedDb.suppliers.map(s => {
      const isTargetSupp = (suppTargetName && s.name.toLowerCase() === suppTargetName.toLowerCase()) ||
                           (suppTargetName && s.id === suppTargetName) ||
                           (act.includes(s.name.toLowerCase()));

      if (isTargetSupp && !foundAndReverted) {
        const paymentsList = [...(s.payments || [])];
        let removeIdx = -1;

        for (let i = paymentsList.length - 1; i >= 0; i--) {
          const p = paymentsList[i];
          if (amountVal ? Number(p.amount) === amountVal : true) {
            removeIdx = i;
            linkedExpId = p.expenseId || p.id;
            break;
          }
        }

        if (removeIdx !== -1) {
          const removedPayment = paymentsList.splice(removeIdx, 1)[0];
          foundAndReverted = true;
          reversalDescription = `Removed payment of ${fmt(removedPayment.amount)} to ${s.name} (Payables balance restored).`;
          return {
            ...s,
            payments: paymentsList,
          };
        }
      }
      return s;
    });

    // Remove matching expense
    if (linkedExpId || amountVal) {
      let expRemoved = false;
      updatedDb.expenses = updatedDb.expenses.filter(e => {
        if (!expRemoved) {
          if (linkedExpId && (e.id === linkedExpId || e.expenseId === linkedExpId)) {
            expRemoved = true;
            return false;
          }
          if (e.category === "Supplier Payment" && amountVal && Number(e.amount) === amountVal) {
            expRemoved = true;
            return false;
          }
        }
        return true;
      });
    }
  }

  // 3. General Expense Reversal
  else if (cat === "expense" || act.includes("recorded expense")) {
    const amtMatch = (logItem.detail || "").replace(/,/g, "").match(/\d+/);
    const amountVal = amtMatch ? Number(amtMatch[0]) : null;
    const targetCategory = (logItem.target || "").trim();

    let expRemoved = false;
    updatedDb.expenses = updatedDb.expenses.filter(e => {
      if (!expRemoved) {
        const catMatches = targetCategory ? e.category.toLowerCase() === targetCategory.toLowerCase() : act.includes(e.category.toLowerCase());
        const amtMatches = amountVal ? Number(e.amount) === amountVal : true;
        if (catMatches && amtMatches) {
          expRemoved = true;
          reversalDescription = `Removed expense of ${fmt(e.amount)} (${e.category}).`;
          return false;
        }
      }
      return true;
    });
  }

  // 4. Sale / Invoice Reversal
  else if (cat.includes("sale") || act.includes("sold") || act.includes("credit sale")) {
    const invMatch = (logItem.detail || logItem.action || "").match(/INV-[A-Za-z0-9-]+/i);
    if (invMatch) {
      const invNo = invMatch[0];
      const saleToCancel = updatedDb.sales.find(s => s.invoiceNo === invNo || s.id === invNo);
      if (saleToCancel) {
        // Restock products
        updatedDb.products = updatedDb.products.map(p => {
          const item = (saleToCancel.items || []).find(it => it.productId === p.id);
          if (!item) return p;
          const restoredStock = (Number(p.stock) || 0) + Number(item.qty || 0);
          return {
            ...p,
            stock: restoredStock,
            history: [
              ...(p.history || []),
              {
                id: uid("H"),
                date: todayISO(0),
                time: new Date().toTimeString().slice(0, 5),
                action: "Restock",
                ref: `REV-${invNo}`,
                qty: Number(item.qty || 0),
                balance: restoredStock,
                user: "Owner",
                reason: `Audit log removal — Sale ${invNo} reversed`,
              }
            ]
          };
        });
        updatedDb.sales = updatedDb.sales.filter(s => s.invoiceNo !== invNo && s.id !== invNo);
        reversalDescription = `Cancelled sale ${invNo} (${fmt(saleToCancel.total)}) and restored inventory stock.`;
      }
    }
  }

  // Remove the audit log entry itself
  updatedDb.auditLog = (prevDb.auditLog || []).filter(a => (a.id ? a.id !== logItem.id : a !== logItem));

  return { updatedDb, reversalDescription };
}

/* ================= MODERN INTERACTIVE AUDIT LOG ================= */
function AuditLog({ db, setDb, notify, currentUser }) {
  const [query, setQuery] = useState("");
  const [user, setUser] = useState("all");
  const [selectedLog, setSelectedLog] = useState(null);
  const [pinModal, setPinModal] = useState({
    isOpen: false,
    title: "",
    description: "",
    onSuccess: () => {},
  });

  const users = useMemo(() => {
    const set = new Set((db.auditLog || []).map(a => a.user));
    return ["all", ...Array.from(set)];
  }, [db.auditLog]);

  const q = query.trim().toLowerCase();
  const filtered = (db.auditLog || []).filter(a => {
    if (user !== "all" && a.user !== user) return false;
    if (!q) return true;
    return (
      (a.action || "").toLowerCase().includes(q) ||
      (a.user || "").toLowerCase().includes(q) ||
      (a.detail || "").toLowerCase().includes(q) ||
      (a.time || "").toLowerCase().includes(q) ||
      (a.category || "").toLowerCase().includes(q)
    );
  });

  function downloadPDF() {
    exportAuditLogPDF({ logs: filtered, userFilter: user, query });
    notify("success", "Audit Log PDF Exported", `${filtered.length} log entries exported.`);
  }

  function getCategoryPill(category) {
    const cat = (category || "").toLowerCase();
    if (cat.includes("sale")) return <Pill tone="green">SALE</Pill>;
    if (cat.includes("stock") || cat.includes("received")) return <Pill tone="steel">STOCK</Pill>;
    if (cat.includes("price")) return <Pill tone="amber">PRICE</Pill>;
    if (cat.includes("expense") || cat.includes("paid")) return <Pill tone="red">PAYMENT</Pill>;
    if (cat.includes("quotation")) return <Pill tone="purple">QUOTE</Pill>;
    return <Pill tone="ink">AUDIT</Pill>;
  }

  /* ---------- Delete Single Audit Log with Store PIN & Revert Linked Impact ---------- */
  function handleDeleteSingleLog(logItem) {
    setPinModal({
      isOpen: true,
      title: "Authorize Log Deletion & Transaction Reversal",
      description: `Enter Store Security PIN to permanently remove audit event "${logItem.action}". This will reverse the linked transaction and update Dashboard & Account balances.`,
      onSuccess: () => {
        setDb(prev => {
          const { updatedDb, reversalDescription } = revertTransactionFromAuditLog(prev, logItem);
          notify("success", "Audit Record & Transaction Reverted", reversalDescription || "Audit record removed and dashboard balances updated.");
          return updatedDb;
        });
        setSelectedLog(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  /* ---------- Clear All Audit Logs with Store PIN ---------- */
  function handleClearAllLogs() {
    if ((db.auditLog || []).length === 0) {
      notify("info", "No Logs Found", "Audit log is already empty.");
      return;
    }

    setPinModal({
      isOpen: true,
      title: "Authorize Clear All Audit Logs",
      description: `WARNING: Enter Store Security PIN to permanently wipe all ${(db.auditLog || []).length} audit history records.`,
      onSuccess: () => {
        setDb(prev => ({
          ...prev,
          auditLog: []
        }));
        notify("success", "All Audit Logs Cleared", "System audit log was cleared successfully.");
        setSelectedLog(null);
        setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} });
      }
    });
  }

  return (
    <div>
      <PinVerificationModal
        isOpen={pinModal.isOpen}
        title={pinModal.title}
        description={pinModal.description}
        onSuccess={pinModal.onSuccess}
        onCancel={() => setPinModal({ isOpen: false, title: "", description: "", onSuccess: () => {} })}
        db={db}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>System Audit Log</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Complete traceability of all sales, payments, price changes, and stock movements.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--red)", borderColor: "var(--red)" }}
            onClick={handleClearAllLogs}
            title="Wipe audit log history (Requires PIN)"
          >
            <Trash2 size={14} /> Clear All Logs
          </button>
          <button className="hf-btn hf-btn-ghost" onClick={downloadPDF}>
            <Download size={15} /> Download PDF
          </button>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)", pointerEvents: "none" }} />
            <input className="hf-input hf-input-with-left-icon" style={{ paddingLeft: 38, width: 220 }} placeholder="Search action, user, amount…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <select className="hf-input" style={{ width: 140 }} value={user} onChange={e => setUser(e.target.value)}>
            {users.map(u => <option key={u} value={u}>{u === "all" ? "All Users" : u}</option>)}
          </select>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
        <span>Showing <b>{filtered.length}</b> of <b>{(db.auditLog || []).length}</b> events</span>
        <span style={{ fontStyle: "italic" }}>Tip: Click on any log row to inspect detailed transaction metadata.</span>
      </div>

      <div className="hf-card" style={{ overflowX: "auto" }}>
        <table className="hf-table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Timestamp</th>
              <th style={{ width: 110 }}>Actor / User</th>
              <th style={{ width: 100 }}>Type</th>
              <th>Action Description</th>
              <th>Reference / Amount</th>
              <th style={{ width: 80, textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, i) => (
              <tr
                key={a.id || i}
                onClick={() => setSelectedLog(a)}
                style={{ cursor: "pointer" }}
                title="Click to view full log details"
              >
                <td>
                  <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{a.time}</div>
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: a.user === "Owner" ? "var(--rust)" : "#33546B",
                      color: "#fff", fontSize: 10.5, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                      {a.user?.charAt(0) || "U"}
                    </div>
                    <span style={{ fontWeight: 600 }}>{a.user}</span>
                  </div>
                </td>
                <td>{getCategoryPill(a.category)}</td>
                <td style={{ fontWeight: 500 }}>{a.action}</td>
                <td className="mono" style={{ color: "var(--ink)" }}>{a.detail || "—"}</td>
                <td style={{ textAlign: "right" }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost"
                      style={{ padding: "4px 6px", color: "var(--red)" }}
                      onClick={() => handleDeleteSingleLog(a)}
                      title="Delete log record (Requires PIN)"
                    >
                      <Trash2 size={13} />
                    </button>
                    <Eye size={15} color="var(--ink-soft)" />
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--ink-soft)", fontSize: 13.5 }}>
                  No audit entries match "{query}"{user !== "all" ? ` for ${user}` : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedLog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={() => setSelectedLog(null)}>
          <div className="hf-card" style={{ width: 480, maxWidth: "92vw", padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>Audit Event Details</div>
                  {getCategoryPill(selectedLog.category)}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
                  Log Record ID: {selectedLog.id || uid("LOG")}
                </div>
              </div>
              <button onClick={() => setSelectedLog(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>

            <div style={{ background: "var(--surface-hover)", padding: 14, borderRadius: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                {selectedLog.action}
              </div>
              {selectedLog.detail && (
                <div className="mono" style={{ fontSize: 13, marginTop: 4, color: "var(--rust)", fontWeight: 600 }}>
                  {selectedLog.detail}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <Stat label="Timestamp" value={selectedLog.time} />
              <Stat label="Operator / User" value={`${selectedLog.user} (${selectedLog.role || "Staff"})`} />
              <Stat label="Category" value={selectedLog.category || "General"} />
              <Stat label="Affected Entity" value={selectedLog.target || "System"} />
            </div>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "space-between" }}>
              <button
                type="button"
                className="hf-btn hf-btn-ghost"
                style={{ color: "var(--red)" }}
                onClick={() => handleDeleteSingleLog(selectedLog)}
              >
                <Trash2 size={14} /> Delete Record
              </button>
              <button className="hf-btn hf-btn-dark" onClick={() => setSelectedLog(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= ALERTS & REORDERS HUB ================= */
function Alerts({ db, setDb, notify, role, onRestock, onNavigate }) {
  const [activeTab, setActiveTab] = useState("all"); // "all" | "out" | "low" | "debts" | "suppliers"
  const [searchQuery, setSearchQuery] = useState("");

  const outOfStock = useMemo(() => {
    return (db.products || []).filter(p => (Number(p.stock) || 0) <= 0);
  }, [db.products]);

  const lowStock = useMemo(() => {
    return (db.products || []).filter(p => (Number(p.stock) || 0) > 0 && (Number(p.stock) || 0) <= (Number(p.minStock) || 0));
  }, [db.products]);

  const criticalStockProducts = useMemo(() => {
    return [...outOfStock, ...lowStock];
  }, [outOfStock, lowStock]);

  const overdueCustomers = useMemo(() => {
    return (db.customers || [])
      .map(c => ({ ...c, balance: customerBalance(db, c.id), days: daysSinceLastActivity(db, c.id) }))
      .filter(c => c.balance > 0 && c.days > 25);
  }, [db.customers, db.sales]);

  const supplierPayables = useMemo(() => {
    return (db.suppliers || [])
      .map(s => ({ ...s, outstanding: supplierOutstanding(db, s.id) }))
      .filter(s => s.outstanding > 0);
  }, [db.suppliers, db.products, db.expenses]);

  // Compute estimated restock budget
  const estimatedRestockBudget = useMemo(() => {
    return criticalStockProducts.reduce((sum, p) => {
      const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
      const currentStock = Math.max(0, Number(p.stock) || 0);
      const minStock = Math.max(0, Number(p.minStock) || 0);
      const deficitUnits = Math.max(1, (minStock * 2) - currentStock);
      const recommendedPackages = Math.ceil(deficitUnits / factor);
      const packCost = Number(p.buyPrice) || 0;
      return sum + (recommendedPackages * packCost);
    }, 0);
  }, [criticalStockProducts]);

  const totalOverdueDebt = useMemo(() => {
    return overdueCustomers.reduce((sum, c) => sum + c.balance, 0);
  }, [overdueCustomers]);

  const totalAlertsCount = criticalStockProducts.length + overdueCustomers.length + supplierPayables.length;

  function handleExportPDF() {
    if (criticalStockProducts.length === 0) {
      notify("info", "No Low Stock Items", "All inventory stock levels are currently above minimum threshold.");
      return;
    }
    exportReorderListPDF(criticalStockProducts, db.suppliers);
    notify("success", "Reorder List PDF Exported", `Downloaded purchase order list for ${criticalStockProducts.length} low-stock item(s).`);
  }

  // Filtered Items
  const filteredOutOfStock = outOfStock.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase())) || (p.category && p.category.toLowerCase().includes(searchQuery.toLowerCase())));
  const filteredLowStock = lowStock.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase())) || (p.category && p.category.toLowerCase().includes(searchQuery.toLowerCase())));
  const filteredCustomers = overdueCustomers.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || (c.phone && c.phone.includes(searchQuery)));
  const filteredSuppliers = supplierPayables.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()) || (s.phone && s.phone.includes(searchQuery)));

  return (
    <div>
      {/* Top Header & Export Action */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="disp" style={{ fontSize: 26, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <span>Alerts & Reorders Hub</span>
            {totalAlertsCount > 0 ? (
              <Pill tone={outOfStock.length > 0 ? "red" : "amber"}>{totalAlertsCount} ACTIVE</Pill>
            ) : (
              <Pill tone="green">ALL HEALTHY</Pill>
            )}
          </div>
          <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>
            Real-time depletion monitoring, automatic reorder recommendations, and debtor warnings.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            onClick={handleExportPDF}
            disabled={criticalStockProducts.length === 0}
            title="Download purchase reorder list as PDF for suppliers / WhatsApp"
          >
            <Download size={15} /> Export Reorder List (PDF)
          </button>
        </div>
      </div>

      {/* Top KPI Cards Banner */}
      <div className="hf-kpis-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <div
          className="hf-ticket"
          style={{ padding: "16px 18px", display: "flex", flexDirection: "column", borderLeft: outOfStock.length > 0 ? "4px solid var(--red)" : "4px solid var(--line)", cursor: "pointer" }}
          onClick={() => setActiveTab("out")}
        >
          <div className="hf-kpi-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} color="var(--red)" /> Out of Stock (0 units)
          </div>
          <div className={`mono ${outOfStock.length > 0 ? "text-loss" : "text-profit"}`} style={{ fontSize: 22, fontWeight: 700, marginTop: "auto" }}>
            {outOfStock.length} items
          </div>
        </div>

        <div
          className="hf-ticket"
          style={{ padding: "16px 18px", display: "flex", flexDirection: "column", borderLeft: lowStock.length > 0 ? "4px solid var(--amber)" : "4px solid var(--line)", cursor: "pointer" }}
          onClick={() => setActiveTab("low")}
        >
          <div className="hf-kpi-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} color="var(--amber)" /> Low Stock Threshold
          </div>
          <div className={`mono ${lowStock.length > 0 ? "text-loss" : "text-profit"}`} style={{ fontSize: 22, fontWeight: 700, marginTop: "auto" }}>
            {lowStock.length} items
          </div>
        </div>

        <div
          className="hf-ticket"
          style={{ padding: "16px 18px", display: "flex", flexDirection: "column", borderLeft: overdueCustomers.length > 0 ? "4px solid #7E22CE" : "4px solid var(--line)", cursor: "pointer" }}
          onClick={() => setActiveTab("debts")}
        >
          <div className="hf-kpi-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <CreditCard size={14} color="#7E22CE" /> Overdue Debtors (&gt;25 days)
          </div>
          <div className={`mono ${overdueCustomers.length > 0 ? "text-loss" : "text-profit"}`} style={{ fontSize: 22, fontWeight: 700, marginTop: "auto" }}>
            {overdueCustomers.length} ({fmt(totalOverdueDebt)})
          </div>
        </div>

        <div className="hf-ticket" style={{ padding: "16px 18px", display: "flex", flexDirection: "column" }}>
          <div className="hf-kpi-label">Est. Restock Budget Needed</div>
          <div className="mono text-profit" style={{ fontSize: 20, fontWeight: 700, marginTop: "auto" }}>
            {fmt(estimatedRestockBudget)}
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { key: "all", label: `All Alerts (${totalAlertsCount})` },
            { key: "out", label: `🚨 Out of Stock (${outOfStock.length})` },
            { key: "low", label: `⚠️ Low Stock (${lowStock.length})` },
            { key: "debts", label: `⏳ Overdue Debtors (${overdueCustomers.length})` },
            { key: "suppliers", label: `🚚 Payables Due (${supplierPayables.length})` },
          ].map(t => {
            const isSel = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                className="hf-btn"
                onClick={() => setActiveTab(t.key)}
                style={{
                  fontSize: 12.5,
                  padding: "7px 12px",
                  background: isSel ? "var(--rust)" : "var(--surface)",
                  color: isSel ? "#FFFFFF" : "var(--ink)",
                  border: isSel ? "1.5px solid var(--rust-dark)" : "1.5px solid var(--line)",
                  fontWeight: isSel ? 700 : 500,
                  borderRadius: 9,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Search Filter */}
        <div style={{ position: "relative", minWidth: 220 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)", pointerEvents: "none" }} />
          <input
            className="hf-input hf-input-with-left-icon"
            style={{ paddingLeft: 38, fontSize: 13, height: 36, minHeight: 36 }}
            placeholder="Search items or people…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Main Alerts Content List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 1. OUT OF STOCK SECTION */}
        {(activeTab === "all" || activeTab === "out") && filteredOutOfStock.length > 0 && (
          <div className="hf-card" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="disp" style={{ fontSize: 18, fontWeight: 700, color: "var(--red)", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={18} /> Critical: Out of Stock Items ({filteredOutOfStock.length})
              </div>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Sales are blocked until stock is received</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {filteredOutOfStock.map(p => {
                const supp = (db.suppliers || []).find(s => s.id === p.supplierId);
                const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
                const minStock = Math.max(0, Number(p.minStock) || 0);
                const deficitUnits = Math.max(1, minStock * 2);
                const recommendedPackages = Math.ceil(deficitUnits / factor);
                const packageCost = Number(p.buyPrice) || 0;
                const estCost = recommendedPackages * packageCost;

                return (
                  <div
                    key={p.id}
                    className="hf-ticket"
                    style={{ padding: "14px 16px", border: "1.5px solid var(--red-tint)", background: "var(--surface)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                          {p.sku || "No SKU"} · {p.category} · {p.location || "Store"}
                        </div>
                      </div>
                      <Pill tone="red">0 {p.baseUnit}</Pill>
                    </div>

                    <div style={{ background: "var(--red-tint)", padding: "8px 10px", borderRadius: 8, margin: "8px 0", fontSize: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "var(--red)" }}>
                        <span>Current Stock: 0 {p.baseUnit}</span>
                        <span>Min Threshold: {p.minStock} {p.baseUnit}</span>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: "var(--ink)", marginBottom: 10 }}>
                      <div><b>Supplier:</b> {supp?.name || "Unassigned"} {supp?.phone ? `(${supp.phone})` : ""}</div>
                      <div><b>Suggested Reorder:</b> {recommendedPackages} {p.purchaseUnit} (= {recommendedPackages * factor} {p.baseUnit})</div>
                      <div><b>Est. Cost:</b> <span className="mono text-profit" style={{ fontWeight: 700 }}>{fmt(estCost)}</span> (@ {fmt(packageCost)}/{p.purchaseUnit})</div>
                    </div>

                    <button
                      type="button"
                      className="hf-btn hf-btn-primary"
                      style={{ width: "100%", justifyContent: "center", padding: "8px", fontSize: 12.5 }}
                      onClick={() => onRestock({ supplierId: p.supplierId, productId: p.id, qty: recommendedPackages })}
                    >
                      <Truck size={14} /> Receive Stock Delivery
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. LOW STOCK SECTION */}
        {(activeTab === "all" || activeTab === "low") && filteredLowStock.length > 0 && (
          <div className="hf-card" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="disp" style={{ fontSize: 18, fontWeight: 700, color: "var(--amber)", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={18} /> Warning: Low Stock Threshold ({filteredLowStock.length})
              </div>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Items running low — reorder before stockout</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {filteredLowStock.map(p => {
                const supp = (db.suppliers || []).find(s => s.id === p.supplierId);
                const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
                const currentStock = Math.max(0, Number(p.stock) || 0);
                const minStock = Math.max(0, Number(p.minStock) || 0);
                const deficitUnits = Math.max(1, (minStock * 2) - currentStock);
                const recommendedPackages = Math.ceil(deficitUnits / factor);
                const packageCost = Number(p.buyPrice) || 0;
                const estCost = recommendedPackages * packageCost;
                const percentage = Math.min(100, Math.round((currentStock / (minStock || 1)) * 100));

                return (
                  <div
                    key={p.id}
                    className="hf-ticket"
                    style={{ padding: "14px 16px", background: "var(--surface)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                          {p.sku || "No SKU"} · {p.category} · {p.location || "Store"}
                        </div>
                      </div>
                      <Pill tone="amber">{p.stock} {p.baseUnit} LEFT</Pill>
                    </div>

                    {/* Visual Meter */}
                    <div style={{ margin: "10px 0 8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                        <span style={{ color: "var(--ink-soft)" }}>Stock Meter: {p.stock} / {p.minStock} {p.baseUnit}</span>
                        <span className="mono" style={{ fontWeight: 700, color: "var(--amber)" }}>{percentage}%</span>
                      </div>
                      <div style={{ height: 6, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${percentage}%`, background: percentage <= 30 ? "var(--red)" : "var(--amber)", borderRadius: 4 }} />
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: "var(--ink)", marginBottom: 10 }}>
                      <div><b>Supplier:</b> {supp?.name || "Unassigned"} {supp?.phone ? `(${supp.phone})` : ""}</div>
                      <div><b>Suggested Reorder:</b> {recommendedPackages} {p.purchaseUnit} (= {recommendedPackages * factor} {p.baseUnit})</div>
                      <div><b>Est. Cost:</b> <span className="mono text-profit" style={{ fontWeight: 700 }}>{fmt(estCost)}</span> (@ {fmt(packageCost)}/{p.purchaseUnit})</div>
                    </div>

                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost"
                      style={{ width: "100%", justifyContent: "center", padding: "8px", fontSize: 12.5, borderColor: "var(--rust)", color: "var(--rust)" }}
                      onClick={() => onRestock({ supplierId: p.supplierId, productId: p.id, qty: recommendedPackages })}
                    >
                      <Truck size={14} /> Receive Stock Delivery
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. OVERDUE CUSTOMER DEBTS */}
        {(activeTab === "all" || activeTab === "debts") && filteredCustomers.length > 0 && (
          <div className="hf-card" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="disp" style={{ fontSize: 18, fontWeight: 700, color: "#7E22CE", display: "flex", alignItems: "center", gap: 6 }}>
                <CreditCard size={18} /> Overdue Customer Credit Balances ({filteredCustomers.length})
              </div>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Credit accounts inactive &gt;25 days</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {filteredCustomers.map(c => (
                <div key={c.id} className="hf-ticket" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{c.phone || "No phone registered"}</div>
                    </div>
                    <Pill tone="red">{c.days} DAYS OVERDUE</Pill>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, margin: "10px 0 12px", padding: "8px 10px", background: "var(--surface-hover)", borderRadius: 8 }}>
                    <div>
                      <div className="hf-kpi-label">Debt Balance</div>
                      <div className="mono text-loss" style={{ fontWeight: 700, fontSize: 15 }}>{fmt(c.balance)}</div>
                    </div>
                    <div>
                      <div className="hf-kpi-label">Credit Limit</div>
                      <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{fmt(c.creditLimit)}</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    {c.phone && (
                      <a
                        href={`https://wa.me/${c.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hello ${c.name}, this is HardwareFlow. Friendly reminder regarding your outstanding balance of ${fmt(c.balance)}. Kindly arrange payment at your earliest convenience.`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hf-btn hf-btn-ghost"
                        style={{ flex: 1, justifyContent: "center", fontSize: 11.5, padding: "6px", color: "var(--green)", textDecoration: "none" }}
                      >
                        <PhoneCall size={13} /> WhatsApp
                      </a>
                    )}
                    <button
                      type="button"
                      className="hf-btn hf-btn-ghost"
                      style={{ flex: 1, justifyContent: "center", fontSize: 11.5, padding: "6px" }}
                      onClick={() => onNavigate("customers")}
                    >
                      View Account →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. SUPPLIER PAYABLES */}
        {(activeTab === "all" || activeTab === "suppliers") && filteredSuppliers.length > 0 && (
          <div className="hf-card" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="disp" style={{ fontSize: 18, fontWeight: 700, color: "var(--steel)", display: "flex", alignItems: "center", gap: 6 }}>
                <Building2 size={18} /> Supplier Balances Due ({filteredSuppliers.length})
              </div>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Outstanding payables to stock vendors</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {filteredSuppliers.map(s => (
                <div key={s.id} className="hf-ticket" style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{s.phone || "No phone"} · {s.terms}</div>
                    </div>
                    <Pill tone="steel">DUE</Pill>
                  </div>

                  <div style={{ margin: "10px 0 12px", padding: "8px 10px", background: "var(--surface-hover)", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="hf-kpi-label">Outstanding Payable</div>
                    <div className="mono text-loss" style={{ fontWeight: 700, fontSize: 16 }}>{fmt(s.outstanding)}</div>
                  </div>

                  <button
                    type="button"
                    className="hf-btn hf-btn-primary"
                    style={{ width: "100%", justifyContent: "center", padding: "7px", fontSize: 12.5 }}
                    onClick={() => onNavigate("suppliers")}
                  >
                    Settle Supplier Balance →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ALL HEALTHY CLEAN STATE */}
        {totalAlertsCount === 0 && (
          <div className="hf-card" style={{ padding: 48, textAlign: "center", maxWidth: 520, margin: "40px auto" }}>
            <CheckCircle2 size={42} color="var(--green)" style={{ margin: "0 auto 12px" }} />
            <div className="disp" style={{ fontSize: 24, fontWeight: 700 }}>All Systems Optimal & Healthy</div>
            <div style={{ color: "var(--ink-soft)", fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
              All product stock levels are above warning thresholds, and there are no overdue customer debts or pending critical actions.
            </div>
            <button
              type="button"
              className="hf-btn hf-btn-primary"
              style={{ marginTop: 18 }}
              onClick={() => onNavigate("inventory")}
            >
              <Package size={15} /> View Full Inventory Catalog
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= APP SHELL ================= */
const NAV = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["owner","cashier","storekeeper"] },
  { key: "alerts", label: "Alerts & Reorders", icon: Bell, roles: ["owner","cashier","storekeeper"], hasBadge: true },
  { key: "pos", label: "Point of Sale", icon: ShoppingCart, roles: ["owner","cashier","storekeeper"] },
  { key: "inventory", label: "Inventory", icon: Package, roles: ["owner","cashier","storekeeper"] },
  { key: "receiving", label: "Receive Stock", icon: Truck, roles: ["owner","storekeeper"] },
  { key: "suppliers", label: "Suppliers", icon: Building2, roles: ["owner","storekeeper"] },
  { key: "customers", label: "Customers & Credit", icon: CreditCard, roles: ["owner","cashier"] },
  { key: "quotations", label: "Quotations", icon: FileText, roles: ["owner","cashier"] },
  { key: "cashbook", label: "Cashbook & Expenses", icon: BookOpen, roles: ["owner"] },
  { key: "reports", label: "Report Centre", icon: BarChart3, roles: ["owner"] },
  { key: "audit", label: "Audit Log", icon: ShieldAlert, roles: ["owner"] },
];

export default function App() {
  const [db, setDb, loading] = useDB();
  const [page, setPage] = useState(() => {
    try {
      const hash = window.location.hash.replace("#", "").trim().toLowerCase();
      if (hash && NAV.some(n => n.key === hash)) {
        return hash;
      }
      const saved = localStorage.getItem(PAGE_KEY);
      if (saved && NAV.some(n => n.key === saved)) {
        return saved;
      }
    } catch {
      // fallback
    }
    return "dashboard";
  });

  const [toasts, setToasts] = useState([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showAlertsFlyout, setShowAlertsFlyout] = useState(false);
  const [receivingPrefill, setReceivingPrefill] = useState(null);

  // Progressive Web App Install hook
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();

  // Sync active page across refreshes and URL hash
  useEffect(() => {
    try {
      localStorage.setItem(PAGE_KEY, page);
      if (window.location.hash !== `#${page}`) {
        window.location.hash = page;
      }
    } catch (e) {
      console.warn("Could not sync page state:", e);
    }
  }, [page]);

  useEffect(() => {
    function handleHashChange() {
      try {
        const hash = window.location.hash.replace("#", "").trim().toLowerCase();
        if (hash && NAV.some(n => n.key === hash)) {
          setPage(hash);
        }
      } catch (e) {
        console.warn("Hash change error:", e);
      }
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) || "light";
    } catch {
      return "light";
    }
  });

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTH_KEY);
      return saved ? sanitizeUserForSession(JSON.parse(saved)) : null;
    } catch {
      return null;
    }
  });

  const [showForgotPass, setShowForgotPass] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);

  // Active alerts calculation for topbar notification badge
  const outOfStockItems = useMemo(() => {
    return (db?.products || []).filter(p => (Number(p.stock) || 0) <= 0);
  }, [db?.products]);

  const lowStockItems = useMemo(() => {
    return (db?.products || []).filter(p => (Number(p.stock) || 0) > 0 && (Number(p.stock) || 0) <= (Number(p.minStock) || 0));
  }, [db?.products]);

  const overdueCustomerDebts = useMemo(() => {
    if (!db?.customers) return [];
    return db.customers
      .map(c => ({ ...c, balance: customerBalance(db, c.id), days: daysSinceLastActivity(db, c.id) }))
      .filter(c => c.balance > 0 && c.days > 25);
  }, [db?.customers, db?.sales]);

  const totalAlertsCount = outOfStockItems.length + lowStockItems.length + overdueCustomerDebts.length;

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
  }

  function handleLogin(user) {
    const safeUser = sanitizeUserForSession(user);
    setCurrentUser(safeUser);
    localStorage.setItem(AUTH_KEY, JSON.stringify(safeUser));
    notify("success", `Welcome back, ${safeUser.name}!`, `Signed in as ${safeUser.role.toUpperCase()}`);
  }

  function handleLogout() {
    setCurrentUser(null);
    localStorage.removeItem(AUTH_KEY);
    setUserDropdown(false);
    setShowAlertsFlyout(false);
    notify("info", "Signed Out", "You have been securely logged out.");
  }

  function handleUserUpdate(updated) {
    const safeUser = sanitizeUserForSession(updated);
    setCurrentUser(safeUser);
    localStorage.setItem(AUTH_KEY, JSON.stringify(safeUser));
  }

  function handleAlertRestock(prefillData) {
    setReceivingPrefill(prefillData);
    setPage("receiving");
    setShowAlertsFlyout(false);
  }

  const notify = (type, message, detail) => {
    const id = uid("TOAST");
    setToasts(prev => [...prev, { id, type, message, detail }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const dismissToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (loading || !db) {
    return (
      <div className="hf-root" style={{ minHeight: "100vh", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle theme={theme} />
        Loading HardwareFlow…
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="hf-root hf-login-root" style={{ width: "100%", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <GlobalStyle theme={theme} />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <LoginScreen
          db={db}
          onLogin={handleLogin}
          onForgotPassword={() => setShowForgotPass(true)}
          notify={notify}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        {showForgotPass && (
          <ForgotPasswordModal
            db={db}
            setDb={setDb}
            onClose={() => setShowForgotPass(false)}
            notify={notify}
          />
        )}
      </div>
    );
  }

  const role = currentUser.role || "owner";
  const allowed = (item) => role === "owner" || item.roles.includes(role) || item.roles.includes("cashier");
  const currentNav = NAV.find(n => n.key === page);
  const restricted = currentNav && !allowed(currentNav);

  const pages = {
    dashboard: <Dashboard db={db} role={role} notify={notify} />,
    alerts: <Alerts db={db} setDb={setDb} notify={notify} role={role} onRestock={handleAlertRestock} onNavigate={(p) => setPage(p)} />,
    pos: <POS db={db} setDb={setDb} role={role} notify={notify} currentUser={currentUser} />,
    inventory: (
      <Inventory
        db={db}
        setDb={setDb}
        role={role}
        notify={notify}
        currentUser={currentUser}
        onReceiveShortcut={(prod) => {
          setReceivingPrefill({ supplierId: prod.supplierId, productId: prod.id, qty: 1 });
          setPage("receiving");
        }}
      />
    ),
    receiving: <Receiving db={db} setDb={setDb} notify={notify} currentUser={currentUser} prefill={receivingPrefill} onClearPrefill={() => setReceivingPrefill(null)} />,
    suppliers: <Suppliers db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    customers: <Customers db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    quotations: <Quotations db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    cashbook: <Cashbook db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    reports: <Reports db={db} notify={notify} role={role} />,
    audit: <AuditLog db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
  };

  return (
    <div className="hf-root">
      <GlobalStyle theme={theme} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Mobile Drawer Backdrop */}
      {mobileNavOpen && (
        <div className="hf-mobile-backdrop" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Sidebar Navigation */}
      <div className={`hf-sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div style={{ padding: "0 20px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: "linear-gradient(155deg,#C7573A,var(--rust-dark))",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 12px -3px rgba(193,80,47,0.6)", flexShrink: 0
            }}>
              <Package size={17} color="#fff" />
            </div>
            <div>
              <div className="disp" style={{ color: "#fff", fontSize: 19, fontWeight: 700, letterSpacing: "0.01em", lineHeight: 1 }}>
                HARDWARE<span style={{ color: "#E8977E" }}>FLOW</span>
              </div>
              <div style={{ color: "#767E8C", fontSize: 10.5, marginTop: 3 }}>Cash-flow & stock control</div>
            </div>
          </div>
          {/* Close button inside mobile drawer */}
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            style={{ display: mobileNavOpen ? "flex" : "none", background: "transparent", border: "none", color: "#A9B0BC", cursor: "pointer", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {NAV.map(item => {
            const Icon = item.icon;
            const ok = allowed(item);
            const isAlertItem = item.key === "alerts";

            return (
              <div
                key={item.key}
                className={`hf-navitem ${page === item.key ? "active" : ""} ${!ok ? "locked" : ""}`}
                onClick={() => {
                  setPage(item.key);
                  setMobileNavOpen(false);
                }}
              >
                <Icon size={16} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {isAlertItem && totalAlertsCount > 0 && (
                  <span style={{
                    background: outOfStockItems.length > 0 ? "var(--red)" : "var(--amber)",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "2px 7px",
                    fontSize: 11,
                    fontWeight: 700,
                  }}>
                    {totalAlertsCount}
                  </span>
                )}
                {!ok && <Lock size={12} />}
              </div>
            );
          })}
        </div>
        <div style={{ padding: "0 18px", color: "#6E7684", fontSize: 10.5, lineHeight: 1.5 }}>
          Signed in: <b style={{ color: "#A9B0BC" }}>{currentUser.name}</b>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="hf-main-wrap">
        {/* Mobile Header Bar */}
        <div className="hf-mobile-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 6, borderRadius: 8 }}
              title="Open Navigation Menu"
            >
              <Menu size={22} />
            </button>
            <div className="disp" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.02em" }}>
              HARDWARE<span style={{ color: "#E8977E" }}>FLOW</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Mobile Notification Bell & Dropdown */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => {
                  setShowAlertsFlyout(!showAlertsFlyout);
                  setUserDropdown(false);
                }}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  color: "#fff",
                  padding: "7px 9px",
                  borderRadius: 8,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative"
                }}
                title="Stock & Business Alerts"
              >
                <Bell size={16} color={totalAlertsCount > 0 ? "#F87171" : "#fff"} />
                {totalAlertsCount > 0 && (
                  <span style={{
                    position: "absolute",
                    top: -3,
                    right: -3,
                    background: outOfStockItems.length > 0 ? "var(--red)" : "var(--amber)",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 16,
                    height: 16,
                    fontSize: 9.5,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    {totalAlertsCount}
                  </span>
                )}
              </button>

              {/* Mobile Alerts Dropdown Flyout */}
              {showAlertsFlyout && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.3)" }}
                    onClick={() => setShowAlertsFlyout(false)}
                  />
                  <div
                    className="hf-card"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 8px)",
                      width: "min(340px, calc(100vw - 20px))",
                      padding: "16px 14px",
                      zIndex: 1200,
                      boxShadow: "var(--shadow-lg)",
                      color: "var(--ink)",
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6, color: "var(--ink)" }}>
                        <BellRing size={15} color="var(--rust)" />
                        <span>Stock & Business Alerts</span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{totalAlertsCount} items</span>
                    </div>

                    {totalAlertsCount === 0 ? (
                      <div style={{ textAlign: "center", padding: "18px 8px", color: "var(--green)", fontSize: 12.5 }}>
                        <CheckCircle2 size={24} style={{ margin: "0 auto 6px" }} />
                        <div>All stock levels healthy! No active alerts.</div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 250, overflowY: "auto" }}>
                        {outOfStockItems.slice(0, 3).map(p => (
                          <div
                            key={p.id}
                            onClick={() => {
                              handleAlertRestock({ supplierId: p.supplierId, productId: p.id, qty: 1 });
                              setShowAlertsFlyout(false);
                            }}
                            style={{ padding: "8px 10px", background: "var(--red-tint)", border: "1px solid var(--red)", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                          >
                            <div style={{ fontWeight: 700, color: "var(--red)" }}>🚨 Out of Stock: {p.name}</div>
                            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>0 {p.baseUnit} in stock · Click to restock</div>
                          </div>
                        ))}
                        {lowStockItems.slice(0, 2).map(p => (
                          <div
                            key={p.id}
                            onClick={() => {
                              handleAlertRestock({ supplierId: p.supplierId, productId: p.id, qty: 1 });
                              setShowAlertsFlyout(false);
                            }}
                            style={{ padding: "8px 10px", background: "var(--amber-tint)", border: "1px solid var(--amber)", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                          >
                            <div style={{ fontWeight: 700, color: "var(--amber)" }}>⚠️ Low Stock: {p.name}</div>
                            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{p.stock} of {p.minStock} {p.baseUnit} remaining</div>
                          </div>
                        ))}
                        {overdueCustomerDebts.slice(0, 2).map(c => (
                          <div
                            key={c.id}
                            onClick={() => { setPage("customers"); setShowAlertsFlyout(false); }}
                            style={{ padding: "8px 10px", background: "var(--surface-hover)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                          >
                            <div style={{ fontWeight: 700, color: "var(--ink)" }}>⏳ Overdue Debt: {c.name}</div>
                            <div style={{ fontSize: 11, color: "var(--red)", marginTop: 2 }}>Owes {fmt(c.balance)} ({c.days} days inactive)</div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 10 }}>
                      <button
                        type="button"
                        className="hf-btn hf-btn-primary"
                        style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px" }}
                        onClick={() => { setPage("alerts"); setShowAlertsFlyout(false); }}
                      >
                        Open Alerts & Reorders Center <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Mobile PWA Install Prompt Button */}
            {isInstallable && !isInstalled && (
              <button
                type="button"
                onClick={promptInstall}
                style={{
                  background: "var(--rust)",
                  border: "none",
                  color: "#fff",
                  padding: "5px 9px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  boxShadow: "0 2px 6px rgba(193,80,47,0.4)"
                }}
                title="Add HardwareFlow to Home Screen"
              >
                <Download size={13} /> Install
              </button>
            )}

            {/* Mobile Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "7px 9px", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center" }}
              title="Toggle Theme"
            >
              {theme === "dark" ? <Sun size={15} color="#FBBF24" /> : <Moon size={15} color="#fff" />}
            </button>

            {/* Mobile User Profile Avatar & Dropdown */}
            <div style={{ position: "relative" }}>
              <div
                onClick={() => {
                  setUserDropdown(!userDropdown);
                  setShowAlertsFlyout(false);
                }}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "rgba(255,255,255,0.12)", padding: "4px 8px", borderRadius: 8 }}
                title="Account Menu"
              >
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--rust)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                  {currentUser.name.charAt(0)}
                </div>
              </div>

              {/* Mobile User Dropdown Menu */}
              {userDropdown && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.3)" }}
                    onClick={() => setUserDropdown(false)}
                  />
                  <div
                    className="hf-card"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 8px)",
                      width: 230,
                      padding: 6,
                      zIndex: 1200,
                      boxShadow: "var(--shadow-lg)",
                      color: "var(--ink)",
                    }}
                    onClick={() => setUserDropdown(false)}
                  >
                    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)" }}>{currentUser.name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-soft)", textTransform: "capitalize" }}>Role: {role}</div>
                    </div>

                    <div
                      onClick={() => setShowProfile(true)}
                      style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 6, color: "var(--ink)" }}
                    >
                      <Key size={15} color="var(--ink-soft)" /> My Profile & Password
                    </div>

                    {role === "owner" && (
                      <div
                        onClick={() => setShowUserMgmt(true)}
                        style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 6, color: "var(--ink)" }}
                      >
                        <Users size={15} color="var(--ink-soft)" /> Staff & Accounts
                      </div>
                    )}

                    {!isInstalled && (
                      <div
                        onClick={() => {
                          if (isInstallable) {
                            promptInstall();
                          } else {
                            notify("info", "Install HardwareFlow", "To install HardwareFlow on your phone, tap your browser's menu (⋮ or Share) and select 'Add to Home screen'.");
                          }
                        }}
                        style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 6, color: "var(--rust)", fontWeight: 600 }}
                      >
                        <Download size={15} color="var(--rust)" /> Install App
                      </div>
                    )}

                    <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />

                    <div
                      onClick={handleLogout}
                      style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 6, color: "var(--red)", fontWeight: 600 }}
                    >
                      <LogOut size={15} color="var(--red)" /> Sign Out
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Desktop Topbar */}
        <div className="hf-desktop-topbar" style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--line)",
          padding: "14px 26px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 1px 0 rgba(20,24,30,0.02)"
        }}>
          <div className="disp" style={{ fontWeight: 700, fontSize: 18 }}>{currentNav?.label}</div>

          {/* Top-Right Controls: Alerts Bell, PWA Install, Theme Toggle & User Account Dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Desktop Notification Bell with Flyout */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => {
                  setShowAlertsFlyout(!showAlertsFlyout);
                  setUserDropdown(false);
                }}
                className="hf-btn hf-btn-ghost"
                style={{
                  position: "relative",
                  padding: "7px 10px",
                  borderRadius: 10,
                  background: totalAlertsCount > 0 ? "var(--rust-tint)" : undefined,
                  borderColor: totalAlertsCount > 0 ? "var(--rust)" : undefined
                }}
                title={`${totalAlertsCount} active stock & credit alerts`}
              >
                <Bell size={16} color={totalAlertsCount > 0 ? "var(--rust)" : "var(--ink-soft)"} />
                {totalAlertsCount > 0 && (
                  <span style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    background: outOfStockItems.length > 0 ? "var(--red)" : "var(--amber)",
                    color: "#fff",
                    borderRadius: "50%",
                    width: 18,
                    height: 18,
                    fontSize: 10,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.25)"
                  }}>
                    {totalAlertsCount}
                  </span>
                )}
              </button>

              {/* Alerts Quick Dropdown Flyout */}
              {showAlertsFlyout && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 1050 }}
                    onClick={() => setShowAlertsFlyout(false)}
                  />
                  <div
                    className="hf-card"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "100%",
                      marginTop: 8,
                      width: 350,
                      maxWidth: "92vw",
                      padding: "16px 14px",
                      zIndex: 1100,
                      boxShadow: "var(--shadow-lg)",
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                        <BellRing size={15} color="var(--rust)" />
                        <span>Stock & Business Alerts</span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{totalAlertsCount} items</span>
                    </div>

                    {totalAlertsCount === 0 ? (
                      <div style={{ textAlign: "center", padding: "18px 8px", color: "var(--green)", fontSize: 12.5 }}>
                        <CheckCircle2 size={24} style={{ margin: "0 auto 6px" }} />
                        <div>All stock levels healthy! No active alerts.</div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 250, overflowY: "auto" }}>
                        {outOfStockItems.slice(0, 3).map(p => (
                          <div
                            key={p.id}
                            onClick={() => {
                              handleAlertRestock({ supplierId: p.supplierId, productId: p.id, qty: 1 });
                              setShowAlertsFlyout(false);
                            }}
                            style={{ padding: "8px 10px", background: "var(--red-tint)", border: "1px solid var(--red)", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                          >
                            <div style={{ fontWeight: 700, color: "var(--red)" }}>🚨 Out of Stock: {p.name}</div>
                            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>0 {p.baseUnit} in stock · Click to restock</div>
                          </div>
                        ))}
                        {lowStockItems.slice(0, 2).map(p => (
                          <div
                            key={p.id}
                            onClick={() => {
                              handleAlertRestock({ supplierId: p.supplierId, productId: p.id, qty: 1 });
                              setShowAlertsFlyout(false);
                            }}
                            style={{ padding: "8px 10px", background: "var(--amber-tint)", border: "1px solid var(--amber)", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                          >
                            <div style={{ fontWeight: 700, color: "var(--amber)" }}>⚠️ Low Stock: {p.name}</div>
                            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{p.stock} of {p.minStock} {p.baseUnit} remaining</div>
                          </div>
                        ))}
                        {overdueCustomerDebts.slice(0, 2).map(c => (
                          <div
                            key={c.id}
                            onClick={() => { setPage("customers"); setShowAlertsFlyout(false); }}
                            style={{ padding: "8px 10px", background: "var(--surface-hover)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                          >
                            <div style={{ fontWeight: 700, color: "var(--ink)" }}>⏳ Overdue Debt: {c.name}</div>
                            <div style={{ fontSize: 11, color: "var(--red)", marginTop: 2 }}>Owes {fmt(c.balance)} ({c.days} days inactive)</div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 10 }}>
                      <button
                        type="button"
                        className="hf-btn hf-btn-primary"
                        style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px" }}
                        onClick={() => { setPage("alerts"); setShowAlertsFlyout(false); }}
                      >
                        Open Alerts & Reorders Center <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Desktop PWA Install Button */}
            {isInstallable && !isInstalled && (
              <button
                type="button"
                onClick={promptInstall}
                className="hf-btn hf-btn-primary"
                style={{ padding: "6px 13px", fontSize: 12.5, borderRadius: 9 }}
                title="Install HardwareFlow on your Windows Desktop / Laptop"
              >
                <Download size={14} /> Install Desktop App
              </button>
            )}

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="hf-btn hf-btn-ghost"
              style={{ padding: "7px 10px", borderRadius: 10 }}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === "dark" ? <Sun size={16} color="#FBBF24" /> : <Moon size={16} color="#4B5563" />}
            </button>

            {/* User Account Menu */}
            <div style={{ position: "relative" }}>
              <div
                onClick={() => {
                  setUserDropdown(!userDropdown);
                  setShowAlertsFlyout(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--surface-hover)",
                  border: "1.5px solid var(--line)",
                  borderRadius: 10,
                  padding: "5px 10px 5px 8px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: role === "owner" ? "var(--rust)" : "#33546B",
                  color: "#fff", fontSize: 11, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}>
                  {currentUser.name.charAt(0)}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{currentUser.name}</span>
                  <span style={{ fontSize: 10.5, color: "var(--ink-soft)", textTransform: "capitalize" }}>{role}</span>
                </div>
                <ChevronRight size={14} color="var(--ink-soft)" style={{ transform: userDropdown ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
              </div>

              {/* Dropdown Menu */}
              {userDropdown && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 950 }}
                    onClick={() => setUserDropdown(false)}
                  />
                  <div
                    className="hf-card"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "100%",
                      marginTop: 6,
                      width: 230,
                      padding: 6,
                      zIndex: 1000,
                      boxShadow: "var(--shadow-lg)",
                    }}
                    onClick={() => setUserDropdown(false)}
                  >
                    <div
                      onClick={() => setShowProfile(true)}
                      style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 6 }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface-hover)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <Key size={15} color="var(--ink-soft)" /> My Profile & Password
                    </div>

                    {role === "owner" && (
                      <div
                        onClick={() => setShowUserMgmt(true)}
                        style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 6 }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--surface-hover)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <Users size={15} color="var(--ink-soft)" /> Staff & Accounts
                      </div>
                    )}

                    {/* Install PWA Option */}
                    {!isInstalled && (
                      <div
                        onClick={() => {
                          if (isInstallable) {
                            promptInstall();
                          } else {
                            notify("info", "Install HardwareFlow", "To install HardwareFlow on your phone or desktop, tap your browser's menu (⋮ or Share) and select 'Add to Home screen' or 'Install'.");
                          }
                        }}
                        style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 6, color: "var(--rust)", fontWeight: 600 }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--rust-tint)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <Download size={15} color="var(--rust)" /> Install App / Shortcut
                      </div>
                    )}

                    <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0" }} />

                    <div
                      onClick={handleLogout}
                      style={{ padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderRadius: 6, color: "var(--red)" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--red-tint)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <LogOut size={15} color="var(--red)" /> Sign Out
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Content Wrap */}
        <div className="hf-main-content-wrap" style={{ padding: "24px 26px 60px", overflowY: "auto", flex: 1 }}>
          {restricted ? <Locked label={currentNav?.label || "Page"} /> : pages[page]}
        </div>

        {/* Mobile Bottom Navigation Bar */}
        <div className="hf-mobile-bottomnav">
          <button
            type="button"
            className={`hf-bottom-item ${page === "pos" ? "active" : ""}`}
            onClick={() => {
              setPage("pos");
              setMobileNavOpen(false);
            }}
          >
            <ShoppingCart size={18} />
            <span>POS</span>
          </button>
          <button
            type="button"
            className={`hf-bottom-item ${page === "dashboard" ? "active" : ""}`}
            onClick={() => {
              setPage("dashboard");
              setMobileNavOpen(false);
            }}
          >
            <LayoutDashboard size={18} />
            <span>Overview</span>
          </button>
          <button
            type="button"
            className={`hf-bottom-item ${page === "inventory" ? "active" : ""}`}
            onClick={() => {
              setPage("inventory");
              setMobileNavOpen(false);
            }}
          >
            <Package size={18} />
            <span>Stock</span>
          </button>
          <button
            type="button"
            className={`hf-bottom-item ${page === "cashbook" ? "active" : ""}`}
            onClick={() => {
              setPage("cashbook");
              setMobileNavOpen(false);
            }}
          >
            <Coins size={18} />
            <span>Cash</span>
          </button>
          <button
            type="button"
            className="hf-bottom-item"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={18} />
            <span>Menu</span>
          </button>
        </div>
      </div>

      {/* Account Settings Modals */}
      {showProfile && (
        <ProfileModal
          currentUser={currentUser}
          db={db}
          setDb={setDb}
          onUserUpdate={handleUserUpdate}
          onClose={() => setShowProfile(false)}
          notify={notify}
        />
      )}

      {showUserMgmt && (
        <UserManagementModal
          currentUser={currentUser}
          db={db}
          setDb={setDb}
          onClose={() => setShowUserMgmt(false)}
          notify={notify}
        />
      )}
    </div>
  );
}
