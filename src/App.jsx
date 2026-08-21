import { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, ShoppingCart, Package, Truck, Building2, Users, CreditCard,
  FileText, BookOpen, BarChart3, ShieldAlert, Lock, Search, Plus, X, Check,
  AlertTriangle, TrendingUp, TrendingDown, ChevronRight, Minus, Trash2,
  ArrowRight, Receipt as ReceiptIcon, Download, Eye, Calendar,
  Award, CheckCircle2, Sun, Moon,
  LogOut, Key, Coins, Edit3, Menu, Wifi, WifiOff, RefreshCw
} from "lucide-react";
import {
  exportAuditLogPDF,
  exportInventoryPDF,
  exportReportCenterPDF,
  exportReceiptPDF,
  exportBestSellersPDF
} from "./utils/pdfExport";
import { ToastContainer } from "./components/Toast";
import { LoginScreen, ForgotPasswordModal, ProfileModal, UserManagementModal } from "./components/Auth";
import { autoSyncDatabase, pullDatabaseFromSupabase, subscribeToSupabaseRealtime, getIsSyncing } from "./utils/supabaseClient";
import { hashPassword, sanitizeUserForSession } from "./utils/security";
import { useOnlineStatus, enqueueOfflineSale, syncOfflineQueue } from "./utils/offlineSync";
import { usePWAInstall } from "./utils/usePWAInstall";

/* ---------------------------------------------------------------
   HardwareFlow — Business Management System
   Data persists via localStorage with automatic Supabase Cloud Sync.
   Design: Industrial ledger with Dark/Light theme & Full Auth.
---------------------------------------------------------------- */

const STORAGE_KEY = "hardwareflow-db-v1";
const AUTH_KEY = "hardwareflow-auth-session";
const THEME_KEY = "hardwareflow-theme";

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

function buildSeed() {
  const users = [
    { id: "u1", username: "owner", password: "admin123", name: "Shop Owner", role: "owner", phone: "0722 000 111", pin: "8888" },
    { id: "u2", username: "cashier", password: "cashier123", name: "John — Cashier", role: "cashier", phone: "0722 000 222", pin: "1111" },
    { id: "u3", username: "store", password: "store123", name: "Mary — Storekeeper", role: "storekeeper", phone: "0722 000 333", pin: "2222" },
  ];

  const suppliers = [
    { id: "s1", name: "ABC Supplies", phone: "0722 100 200", terms: "Net 30", payments: [] },
    { id: "s2", name: "Doone Electricals", phone: "0733 400 500", terms: "Net 14", payments: [] },
    { id: "s3", name: "Steel & Nails Co", phone: "0711 800 900", terms: "Cash on delivery", payments: [] },
  ];

  const products = [
    {
      id: "p1", name: "Cement 50kg", category: "Cement & Building", brand: "Bamburi", sku: "CEM-001",
      description: "Portland all-purpose building cement for masonry & concrete work.",
      baseUnit: "bag", purchaseUnit: "bag", conversionFactor: 1,
      buyPrice: 650, sellPrice: 780, contractorPrice: 750, wholesalePrice: 720,
      minStock: 20, stock: 47, supplierId: "s1", location: "Main Store",
      history: [
        { date: todayISO(-6), action: "Received", qty: 100, user: "Mary" },
        { date: todayISO(-2), action: "Sale", qty: -12, user: "John" },
        { date: todayISO(-1), action: "Sale", qty: -8, user: "John" },
      ],
    },
    {
      id: "p2", name: "Electrical Cable 2.5mm", category: "Electrical", brand: "Doone", sku: "ELEC-010",
      description: "Single core pure copper conduit wiring cable (100m roll).",
      baseUnit: "metre", purchaseUnit: "roll", conversionFactor: 100,
      buyPrice: 8500, sellPrice: 110, contractorPrice: 100, wholesalePrice: 95,
      minStock: 200, stock: 385, supplierId: "s2", location: "Main Store",
      history: [
        { date: todayISO(-10), action: "Received", qty: 500, user: "Mary" },
        { date: todayISO(-1), action: "Sale", qty: -15, user: "John" },
      ],
    },
    {
      id: "p3", name: "PVC Pipe 4-inch", category: "Plumbing", brand: "Kenpipe", sku: "PVC-004",
      description: "Heavy duty underground drainage and waste water PVC pipe (6m length).",
      baseUnit: "piece", purchaseUnit: "piece", conversionFactor: 1,
      buyPrice: 180, sellPrice: 250, contractorPrice: 230, wholesalePrice: 215,
      minStock: 15, stock: 50, supplierId: "s1", location: "Yard",
      history: [{ date: todayISO(-5), action: "Received", qty: 60, user: "Mary" }],
    },
    {
      id: "p4", name: "Nails 4-inch", category: "Fasteners & Hardware", brand: "SteelCo", sku: "NAIL-004",
      description: "Timber construction wire nails for roofing & formwork.",
      baseUnit: "kg", purchaseUnit: "bag (25kg)", conversionFactor: 25,
      buyPrice: 3000, sellPrice: 150, contractorPrice: 145, wholesalePrice: 135,
      minStock: 50, stock: 18, supplierId: "s3", location: "Store",
      history: [{ date: todayISO(-8), action: "Received", qty: 75, user: "Mary" }],
    },
    {
      id: "p5", name: "Gloss Paint 4L", category: "Paint & Finishes", brand: "Crown", sku: "PNT-004",
      description: "Brilliant white super gloss oil paint for wood & metal surfaces.",
      baseUnit: "tin", purchaseUnit: "carton (12)", conversionFactor: 12,
      buyPrice: 12000, sellPrice: 1450, contractorPrice: 1380, wholesalePrice: 1300,
      minStock: 24, stock: 8, supplierId: "s2", location: "Shop",
      history: [{ date: todayISO(-14), action: "Received", qty: 24, user: "Mary" }],
    },
  ];

  const customers = [
    { id: "c1", name: "ABC Construction Ltd", phone: "0722 555 111", creditLimit: 500000, payments: [{ date: todayISO(-12), amount: 100000 }, { date: todayISO(0), amount: 25000 }] },
    { id: "c2", name: "John Builders", phone: "0733 555 222", creditLimit: 100000, payments: [{ date: todayISO(-3), amount: 20000 }] },
    { id: "c3", name: "XYZ Contractors", phone: "0711 555 333", creditLimit: 150000, payments: [{ date: todayISO(-40), amount: 15000 }] },
  ];

  const sales = [
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
    { id: uid("LOG"), time: todayISO(0) + " 10:15", user: "Mary", role: "Storekeeper", category: "Stock Received", action: "Received 100 × Cement 50kg", detail: "from ABC Supplies", target: "Cement 50kg" },
    { id: uid("LOG"), time: todayISO(-1) + " 11:02", user: "Owner", role: "Owner", category: "Price Change", action: "Changed selling price — Cement 50kg", detail: "750 → 780 KSh", target: "Cement 50kg" },
    { id: uid("LOG"), time: todayISO(-1) + " 11:43", user: "Mary", role: "Storekeeper", category: "Adjustment", action: "Stock adjustment — PVC Pipe", detail: "-3 pieces, reason: damaged during handling", target: "PVC Pipe 4-inch" },
  ];

  return {
    users, products, suppliers, customers, sales, expenses, quotations, auditLog,
    invoiceSeq: 454, quoteSeq: 1042, poSeq: 2046,
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

          // Check if any users have unhashed legacy passwords or pins
          let needsMigration = false;
          const upgradedUsers = await Promise.all(
            (targetDb.users || []).map(async (u) => {
              let updated = { ...u };
              if (u.password && !u.password.startsWith("pbkdf2:")) {
                updated.password = await hashPassword(u.password);
                needsMigration = true;
              }
              if (u.pin && !u.pin.startsWith("pbkdf2:")) {
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

              // Non-destructive merge: preserve any locally made sales/expenses/logs
              const cloudSaleInvoices = new Set((cloudDb.sales || []).map(s => s.invoiceNo || s.id));
              const pendingLocalSales = (prevLocal.sales || []).filter(s => !cloudSaleInvoices.has(s.invoiceNo) && !cloudSaleInvoices.has(s.id));

              const cloudExpIds = new Set((cloudDb.expenses || []).map(e => e.id));
              const pendingLocalExpenses = (prevLocal.expenses || []).filter(e => !cloudExpIds.has(e.id));

              const cloudLogIds = new Set((cloudDb.auditLog || []).map(l => l.id));
              const pendingLocalLogs = (prevLocal.auditLog || []).filter(l => !cloudLogIds.has(l.id));

              const merged = {
                ...cloudDb,
                sales: [...pendingLocalSales, ...(cloudDb.sales || [])],
                expenses: [...pendingLocalExpenses, ...(cloudDb.expenses || [])],
                auditLog: [...pendingLocalLogs, ...(cloudDb.auditLog || [])],
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
        font-family: 'Inter', sans-serif;
        color: var(--ink);
        background: var(--bg);
        -webkit-font-smoothing: antialiased;
        transition: background .2s ease, color .2s ease;
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
        border: 1.5px solid var(--line); border-radius: 9px; padding: 9px 11px;
        font-size: 13.5px; font-family: 'Inter', sans-serif; width: 100%;
        background: ${isDark ? "#0E1118" : "#fff"}; color: var(--ink);
        transition: border-color .14s ease, box-shadow .14s ease, background .14s ease;
      }
      .hf-input:focus { outline: none; border-color: var(--rust); box-shadow: 0 0 0 3.5px var(--rust-tint); }
      .hf-input:hover:not(:focus) { border-color: ${isDark ? "#3A455A" : "#C9CDD3"}; }
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

      /* Mobile Phone Optimization & Responsive Layout */
      .hf-mobile-header {
        display: none;
      }
      .hf-mobile-bottomnav {
        display: none;
      }
      .hf-mobile-backdrop {
        display: none;
      }
      .hf-table-responsive {
        width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }

      @media (max-width: 768px) {
        .hf-mobile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: var(--tab-bg);
          color: #fff;
          position: sticky;
          top: 0;
          z-index: 900;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .hf-mobile-backdrop {
          display: block;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.65);
          backdrop-filter: blur(2px);
          z-index: 1000;
        }
        .hf-sidebar {
          position: fixed !important;
          top: 0;
          left: 0;
          bottom: 0;
          width: 270px !important;
          z-index: 1100;
          transform: translateX(-100%);
          transition: transform .22s ease-in-out;
          box-shadow: 0 0 30px rgba(0,0,0,0.5);
        }
        .hf-sidebar.open {
          transform: translateX(0) !important;
        }
        .hf-desktop-topbar {
          display: none !important;
        }
        .hf-main-content-wrap {
          padding: 14px 12px 85px !important;
        }
        .hf-mobile-bottomnav {
          display: flex;
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 60px;
          background: var(--surface);
          border-top: 1px solid var(--line);
          z-index: 950;
          justify-content: space-around;
          align-items: center;
          padding: 0 4px;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.06);
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
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          background: transparent;
        }
        .hf-bottom-item.active {
          color: var(--rust);
        }
        .hf-ticket {
          padding: 12px 14px !important;
          min-height: 96px !important;
          height: auto !important;
        }
        .hf-card {
          border-radius: 10px;
        }
        .hf-btn {
          min-height: 40px;
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

  const stockValueCorrect = db.products.reduce((a, p) => a + p.stock * (p.buyPrice / (p.conversionFactor || 1)), 0);
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
      value: fmt(stockValueCorrect),
      tone: "ink",
      ownerOnly: true,
      icon: Package,
      rawVal: stockValueCorrect,
      sub: "Total inventory cost base",
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
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div>
          <div className="disp" style={{ fontSize: 28, fontWeight: 700 }}>{periodTitle}</div>
          <div style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 2 }}>{periodSubtitle}</div>
        </div>

        {/* Period Selector Toggle */}
        <div style={{ display: "flex", background: "var(--surface-hover)", padding: 3, borderRadius: 10, border: "1px solid var(--line)" }}>
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
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
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

      {/* KPI Cards Grid with Perfect Straight Line Alignment & Subtitles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 22 }}>
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

          <div className="hf-card hf-table-responsive" style={{ padding: 6 }}>
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
  const sold = db.sales.filter(s => s.customerId === customerId && s.payment === "credit")
    .reduce((a, s) => a + s.total, 0);
  const cust = db.customers.find(c => c.id === customerId);
  const paid = (cust?.payments || []).reduce((a, p) => a + p.amount, 0);
  return Math.max(0, sold - paid);
}
function daysSinceLastActivity(db, customerId) {
  const cust = db.customers.find(c => c.id === customerId);
  const dates = [
    ...db.sales.filter(s => s.customerId === customerId).map(s => s.date),
    ...(cust?.payments || []).map(p => p.date),
  ];
  if (dates.length === 0) return 999;
  const latest = dates.sort().slice(-1)[0];
  return Math.round((new Date(todayISO(0)) - new Date(latest)) / 86400000);
}
function supplierOutstanding(db, supplierId) {
  let total = 0;
  db.products.filter(p => p.supplierId === supplierId).forEach(p => {
    (p.history || []).forEach(h => {
      if (h.action === "Received") total += h.qty * (p.buyPrice / (p.conversionFactor || 1));
    });
  });
  const supplier = db.suppliers.find(s => s.id === supplierId);
  const paid = (supplier?.payments || []).reduce((a, x) => a + x.amount, 0);
  return Math.max(0, total - paid);
}
function supplierTotalPurchases(db, supplierId) {
  let total = 0;
  db.products.filter(p => p.supplierId === supplierId).forEach(p => {
    (p.history || []).forEach(h => {
      if (h.action === "Received") total += h.qty * (p.buyPrice / (p.conversionFactor || 1));
    });
  });
  return total;
}

/* ================= POINT OF SALE (POS) ================= */
function POS({ db, setDb, role, notify, currentUser }) {
  const [activeTab, setActiveTab] = useState("pos");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("retail");
  const [cart, setCart] = useState([]);
  const [payment, setPayment] = useState("cash");
  const [customerId, setCustomerId] = useState("");
  const [splitCash, setSplitCash] = useState(0);
  const [receiptSale, setReceiptSale] = useState(null);

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
    setCart(c => {
      const existing = c.find(i => i.productId === p.id);
      if (existing) {
        const newQty = (Number(existing.qty) || 0) + 1;
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
    setCart(c => c.map(i => {
      if (i.productId !== id) return i;
      if (!i.qtyInput || Number(i.qtyInput) <= 0) {
        return { ...i, qty: 1, qtyInput: "1" };
      }
      return i;
    }));
  }

  function incrementQty(id) {
    setCart(c => c.map(i => {
      if (i.productId !== id) return i;
      const newQty = (Number(i.qty) || 0) + 1;
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
    return { ...i, product: p, unitPrice, lineTotal: unitPrice * actualQty };
  });

  const total = lines.reduce((a, l) => a + l.lineTotal, 0);
  const custAvailable = customerId ? (db.customers.find(c => c.id === customerId)?.creditLimit || 0) - customerBalance(db, customerId) : null;

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
    if (payment === "credit" && !customerId) {
      notify("error", "Customer Required", "Please select a registered customer for credit sales.");
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
    const invoiceNo = `INV-2026-${String(nextSeqNum).padStart(5, "0")}`;
    const saleDate = todayISO(0);

    const saleItems = lines.map(l => ({
      productId: l.product.id,
      qty: Number(l.qty),
      unitPrice: l.unitPrice,
      unitCost: l.product.buyPrice / (l.product.conversionFactor || 1)
    }));
    const cost = saleItems.reduce((a, i) => a + i.unitCost * i.qty, 0);
    const profit = total - cost;
    const employee = currentUser?.name || (role === "owner" ? "Owner" : "John");

    const sale = {
      id: uid("INV"),
      invoiceNo,
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

    // Instant local stock reduction & persistence (0ms latency for Kenyan retail counters)
    setDb(prev => {
      const products = prev.products.map(p => {
        const line = saleItems.find(i => i.productId === p.id);
        if (!line) return p;
        return {
          ...p,
          stock: p.stock - line.qty,
          history: [...p.history, { date: sale.date, action: "Sale", qty: -line.qty, user: sale.employee }],
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
            action: `Sold ${saleItems.map(i=>i.qty).reduce((a,b)=>a+b,0)} item(s) — ${invoiceNo}`,
            detail: `${fmt(total)} via ${payment.toUpperCase()}${!navigator.onLine ? " (Offline)" : ""}`,
            target: invoiceNo,
          },
          ...prev.auditLog
        ],
      };
    });

    if (!navigator.onLine) {
      enqueueOfflineSale(sale);
      notify("info", "Sale Saved Locally (Offline Mode)", `${invoiceNo} recorded instantly. Receipt generated & queued for cloud sync.`);
    } else {
      notify("success", "Sale Completed Successfully", `${invoiceNo} · Total: ${fmt(total)} (${payment.toUpperCase()})`);
    }

    setReceiptSale(sale);
    setCart([]);
    setCustomerId("");
    setPayment("cash");
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
      const invMatch = s.invoiceNo.toLowerCase().includes(q);
      const empMatch = (s.employee || "").toLowerCase().includes(q);
      const itemMatch = s.items.some(it => {
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
            <Calendar size={15} /> Sales History & Period Search
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
              <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-soft)" }} />
              <input
                className="hf-input"
                style={{ paddingLeft: 32 }}
                placeholder="Search product name or SKU to add to cart…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            {results.length > 0 && (
              <div className="hf-card" style={{ marginBottom: 14, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
                {results.map(p => (
                  <div
                    key={p.id}
                    onClick={() => addToCart(p)}
                    style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                        Stock: {p.stock} {p.baseUnit} · Retail {fmt(p.sellPrice)}
                        {p.contractorPrice ? ` · Contractor ${fmt(p.contractorPrice)}` : ""}
                        {p.wholesalePrice ? ` · Wholesale ${fmt(p.wholesalePrice)}` : ""}
                      </div>
                    </div>
                    <Plus size={16} color="var(--rust)" />
                  </div>
                ))}
              </div>
            )}

            <div className="hf-card hf-table-responsive" style={{ padding: 4 }}>
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
                        Cart is empty — type a product name or SKU above to add.
                      </td>
                    </tr>
                  )}
                  {lines.map(l => (
                    <tr key={l.productId}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{l.product.name}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{l.product.baseUnit}</div>
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
                            style={{ width: 62, textAlign: "center", padding: "4px 4px", fontWeight: 700 }}
                            type="number"
                            min="1"
                            value={l.qtyInput !== undefined ? l.qtyInput : l.qty}
                            onChange={e => handleQtyChange(l.productId, e.target.value)}
                            onBlur={() => handleQtyBlur(l.productId)}
                          />
                          <button
                            className="hf-btn hf-btn-ghost"
                            style={{ padding: "3px 7px" }}
                            onClick={() => incrementQty(l.productId)}
                            type="button"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="mono">{fmt(l.unitPrice)}</td>
                      <td className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{fmt(l.lineTotal)}</td>
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
                  ))}
                </tbody>
              </table>
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

            <div style={{ marginBottom: 14 }}>
              <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Payment Method</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[
                  { key: "cash", label: "Cash" },
                  { key: "mpesa", label: "M-Pesa" },
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
                        fontSize: 12.5,
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

            <div style={{ borderTop: "1.5px dashed var(--line)", paddingTop: 12, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700 }}>
                <span>Total Due</span>
                <span className="mono text-profit" style={{ fontSize: 18 }}>{fmt(total)}</span>
              </div>
            </div>

            <button
              className="hf-btn hf-btn-primary"
              style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 14 }}
              onClick={completeSale}
              disabled={lines.length === 0}
            >
              <Check size={16} /> Complete sale
            </button>
          </div>
        </div>
      ) : (
        /* SALES HISTORY & PERIOD SEARCH */
        <div>
          <div className="disp" style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>
            Sales History & Period Search
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
                  <option value="credit">Credit only</option>
                  <option value="split">Split payment</option>
                </select>
              </div>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Search Invoices / Items</div>
                <div style={{ position: "relative" }}>
                  <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-soft)" }} />
                  <input
                    className="hf-input"
                    style={{ paddingLeft: 30 }}
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

          <div className="hf-card">
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
                  <th style={{ width: 140 }}>Receipt Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map(s => {
                  const cust = db.customers.find(c => c.id === s.customerId);
                  const itemCount = s.items.reduce((a, b) => a + b.qty, 0);
                  const summaryStr = s.items.map(it => {
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
                        <Pill tone={s.payment === "mpesa" ? "green" : s.payment === "credit" ? "amber" : "steel"}>
                          {s.payment === "mpesa" ? "M-Pesa" : s.payment.toUpperCase()}
                        </Pill>
                      </td>
                      <td className="mono text-profit" style={{ textAlign: "right", fontWeight: 700 }}>{fmt(s.total)}</td>
                      {role === "owner" && (
                        <td className="mono text-profit" style={{ textAlign: "right" }}>{fmt(s.profit)}</td>
                      )}
                      <td>{s.employee}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="hf-btn hf-btn-ghost"
                            style={{ padding: "4px 8px", fontSize: 11.5 }}
                            onClick={() => setReceiptSale(s)}
                            title="View receipt modal"
                          >
                            <Eye size={12} /> View
                          </button>
                          <button
                            className="hf-btn hf-btn-ghost"
                            style={{ padding: "4px 8px", fontSize: 11.5 }}
                            onClick={() => {
                              exportReceiptPDF({ sale: s, db });
                              notify("success", "Receipt Downloaded", `Receipt for ${s.invoiceNo} downloaded.`);
                            }}
                            title="Download official PDF sales receipt"
                          >
                            <Download size={12} /> PDF
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

  function handleDownloadPDF() {
    exportReceiptPDF({ sale, db });
    notify("success", "PDF Receipt Downloaded", `Receipt for ${sale.invoiceNo} saved.`);
  }

  return (
    <div style={{ maxWidth: 440, margin: "20px auto" }}>
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
          Paid via {sale.payment === "mpesa" ? "M-Pesa" : sale.payment.toUpperCase()} · Served by {sale.employee}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        <button
          className="hf-btn hf-btn-primary"
          style={{ justifyContent: "center" }}
          onClick={handleDownloadPDF}
        >
          <Download size={15} /> Download PDF Receipt
        </button>
        <button
          className="hf-btn hf-btn-dark"
          style={{ justifyContent: "center" }}
          onClick={onClose}
        >
          New Sale / Close
        </button>
      </div>
    </div>
  );
}

/* ================= INVENTORY & PRODUCT REMOVAL/EDIT ================= */
function Inventory({ db, setDb, role, notify, currentUser }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const canSeeCost = role === "owner" || role === "storekeeper";

  const filtered = db.products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()));
  const activeProduct = selected ? db.products.find(p => p.id === selected) : null;

  function addProduct(form) {
    const operator = currentUser?.name || (role === "owner" ? "Owner" : "Mary");
    const p = {
      id: uid("P"),
      name: form.name,
      category: form.category || "General",
      brand: form.brand || "Standard",
      sku: form.sku || uid("SKU"),
      description: form.description || "",
      baseUnit: form.baseUnit || "piece",
      purchaseUnit: form.purchaseUnit || form.baseUnit || "piece",
      conversionFactor: Number(form.conversionFactor) || 1,
      buyPrice: Number(form.buyPrice) || 0,
      sellPrice: Number(form.sellPrice) || 0,
      contractorPrice: Number(form.contractorPrice) || 0,
      wholesalePrice: Number(form.wholesalePrice) || 0,
      minStock: Number(form.minStock) || 0,
      stock: Number(form.stock) || 0,
      supplierId: form.supplierId || "",
      location: form.location || "Main Store",
      history: [
        { date: todayISO(0), action: "Opening Stock", qty: Number(form.stock) || 0, user: operator }
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
          detail: `SKU: ${p.sku} · Stock: ${p.stock} ${p.baseUnit}`,
          target: p.name,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Product Added Successfully", `${p.name} (${p.sku}) saved to inventory.`);
    setShowNew(false);
  }

  function deleteProduct(productId) {
    const prod = db.products.find(p => p.id === productId);
    if (!prod) return;

    if (!confirm(`Are you sure you want to remove "${prod.name}" (${prod.sku}) from inventory? This action cannot be undone.`)) {
      return;
    }

    const operator = currentUser?.name || (role === "owner" ? "Owner" : "Staff");

    setDb(prev => ({
      ...prev,
      products: prev.products.filter(p => p.id !== productId),
      auditLog: [
        {
          id: uid("LOG"),
          time: todayISO(0) + " " + new Date().toTimeString().slice(0, 5),
          user: operator,
          role: role === "owner" ? "Owner" : "Storekeeper",
          category: "Product Removal",
          action: `Removed product from inventory: ${prod.name}`,
          detail: `SKU: ${prod.sku} · Prior stock: ${prod.stock} ${prod.baseUnit}`,
          target: prod.name,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Product Removed", `"${prod.name}" has been deleted from inventory.`);
    setSelected(null);
  }

  function downloadPDF() {
    exportInventoryPDF({ products: filtered, suppliers: db.suppliers });
    notify("success", "Inventory PDF Downloaded", `${filtered.length} products exported.`);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>Inventory</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="hf-btn hf-btn-ghost" onClick={downloadPDF}>
            <Download size={15} /> Download PDF
          </button>
          <button className="hf-btn hf-btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={15} /> Add New Product
          </button>
        </div>
      </div>

      <div style={{ position: "relative", marginBottom: 12, maxWidth: 340 }}>
        <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-soft)" }} />
        <input className="hf-input" style={{ paddingLeft: 32 }} placeholder="Search products by name or SKU…" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      <div className="hf-card" style={{ overflowX: "auto" }}>
        <table className="hf-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Category</th>
              <th>Stock on Hand</th>
              <th>Min Alert</th>
              {canSeeCost && <th>Buying Price</th>}
              <th>Selling Price</th>
              <th>Supplier</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const low = p.stock <= p.minStock;
              const supplier = db.suppliers.find(s => s.id === p.supplierId);
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
                    <td className="mono">{fmt(p.buyPrice)}<span style={{ color: "var(--ink-soft)", fontSize: 11 }}>/{p.purchaseUnit}</span></td>
                  )}
                  <td className="mono text-profit" style={{ fontWeight: 600 }}>{fmt(p.sellPrice)}</td>
                  <td>{supplier?.name || "—"}</td>
                  <td><ChevronRight size={15} color="var(--ink-soft)" /></td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canSeeCost ? 8 : 7} style={{ textAlign: "center", color: "var(--ink-soft)", padding: 28 }}>
                  No inventory products match "{query}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
        />
      )}
      {showNew && <NewProductModal db={db} onCancel={() => setShowNew(false)} onSave={addProduct} notify={notify} />}
    </div>
  );
}

function ProductDrawer({ product, db, setDb, canSeeCost, onDelete, onClose, notify }) {
  const supplier = db.suppliers.find(s => s.id === product.supplierId);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: product.name,
    category: product.category,
    sellPrice: product.sellPrice,
    buyPrice: product.buyPrice,
    minStock: product.minStock,
    location: product.location,
  });

  function handleSaveEdit() {
    setDb(prev => ({
      ...prev,
      products: prev.products.map(p => p.id === product.id ? {
        ...p,
        name: editForm.name,
        category: editForm.category,
        sellPrice: Number(editForm.sellPrice) || p.sellPrice,
        buyPrice: Number(editForm.buyPrice) || p.buyPrice,
        minStock: Number(editForm.minStock) || p.minStock,
        location: editForm.location,
      } : p),
      auditLog: [
        {
          id: uid("LOG"),
          time: todayISO(0) + " " + new Date().toTimeString().slice(0, 5),
          user: "Owner",
          role: "Owner",
          category: "Product Update",
          action: `Updated details for ${editForm.name}`,
          detail: `Sell price: ${fmt(editForm.sellPrice)} · Min: ${editForm.minStock}`,
          target: editForm.name,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Product Updated", `Updated details for ${editForm.name}.`);
    setEditing(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", justifyContent: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="hf-card" style={{ width: 460, maxWidth: "92vw", height: "100%", borderRadius: 0, overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>{product.name}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{product.sku} · {product.category} {product.brand ? `· ${product.brand}` : ""}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        {product.description && (
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 16, background: "var(--surface-hover)", padding: 10, borderRadius: 8 }}>
            {product.description}
          </div>
        )}

        {editing ? (
          <div style={{ background: "var(--surface-hover)", padding: 14, borderRadius: 10, marginBottom: 16 }}>
            <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Edit Product Details</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Product Name</div>
                <input className="hf-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Selling Price (KSh)</div>
                  <input className="hf-input" type="number" value={editForm.sellPrice} onChange={e => setEditForm({ ...editForm, sellPrice: e.target.value })} />
                </div>
                {canSeeCost && (
                  <div>
                    <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Buying Price (KSh)</div>
                    <input className="hf-input" type="number" value={editForm.buyPrice} onChange={e => setEditForm({ ...editForm, buyPrice: e.target.value })} />
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Low Stock Alert Level</div>
                  <input className="hf-input" type="number" value={editForm.minStock} onChange={e => setEditForm({ ...editForm, minStock: e.target.value })} />
                </div>
                <div>
                  <div className="hf-kpi-label" style={{ marginBottom: 3 }}>Location</div>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <Stat label="Current Stock" value={`${product.stock} ${product.baseUnit}`} />
            <Stat label="Low Stock Warning" value={`${product.minStock} ${product.baseUnit}`} />
            {canSeeCost && <Stat label="Buying Price (Cost)" value={`${fmt(product.buyPrice)} / ${product.purchaseUnit}`} />}
            <Stat label="Selling Price" value={fmt(product.sellPrice)} />
            {product.contractorPrice > 0 && <Stat label="Contractor Price" value={fmt(product.contractorPrice)} />}
            {product.wholesalePrice > 0 && <Stat label="Wholesale Price" value={fmt(product.wholesalePrice)} />}
            <Stat label="Main Supplier" value={supplier?.name || "—"} />
            <Stat label="Storage Location" value={product.location} />
          </div>
        )}

        {product.purchaseUnit !== product.baseUnit && (
          <div className="hf-ticket" style={{ padding: 12, marginBottom: 16, fontSize: 12.5 }}>
            <b>Packaging Conversion:</b> Bought in {product.purchaseUnit}s (1 {product.purchaseUnit} = {product.conversionFactor} {product.baseUnit}s), sold by the {product.baseUnit}.
          </div>
        )}

        {/* Action buttons: Edit & Remove */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {!editing && (
            <button className="hf-btn hf-btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setEditing(true)}>
              <Edit3 size={14} /> Quick Edit
            </button>
          )}
          <button
            className="hf-btn hf-btn-ghost"
            style={{ color: "var(--red)", borderColor: "var(--red-tint)", flex: 1, justifyContent: "center" }}
            onClick={() => onDelete(product.id)}
            title="Permanently remove this product from inventory"
          >
            <Trash2 size={14} /> Remove Product
          </button>
        </div>

        <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Stock Movement History</div>
        <table className="hf-table">
          <thead><tr><th>Date</th><th>Action</th><th>Quantity</th><th>User</th></tr></thead>
          <tbody>
            {[...product.history].reverse().map((h, i) => (
              <tr key={i}>
                <td>{niceDate(h.date)}</td>
                <td>{h.action}</td>
                <td className="mono" style={{ color: h.qty < 0 ? "var(--red)" : "var(--green)", fontWeight: 600 }}>
                  {h.qty > 0 ? "+" : ""}{h.qty}
                </td>
                <td>{h.user}</td>
              </tr>
            ))}
            {product.history.length === 0 && (
              <tr><td colSpan={4} style={{ color: "var(--ink-soft)", textAlign: "center", padding: 16 }}>No movement recorded yet.</td></tr>
            )}
          </tbody>
        </table>
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

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onCancel}>
      <div className="hf-card" style={{ width: 540, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>Add New Product</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Fill in the simple product details below to add it to your shop.</div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
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

          <Field label="Buying Price (Cost per package)" help="How much you pay the supplier">
            <input className="hf-input" type="number" placeholder="e.g. 650" value={form.buyPrice} onChange={e => set("buyPrice", e.target.value)} />
          </Field>

          <Field label="Selling Price (Normal Retail) *" help="Price per customer unit">
            <input className="hf-input" type="number" placeholder="e.g. 780" value={form.sellPrice} onChange={e => set("sellPrice", e.target.value)} />
          </Field>

          <Field label="Discount Price for Contractors (Optional)" help="Special rate for builders">
            <input className="hf-input" type="number" placeholder="e.g. 750" value={form.contractorPrice} onChange={e => set("contractorPrice", e.target.value)} />
          </Field>

          <Field label="Bulk / Wholesale Price (Optional)" help="Price for large bulk purchases">
            <input className="hf-input" type="number" placeholder="e.g. 720" value={form.wholesalePrice} onChange={e => set("wholesalePrice", e.target.value)} />
          </Field>

          <Field label="Starting Stock in Shop" help="How many you currently have on hand">
            <input className="hf-input" type="number" min="0" placeholder="e.g. 50" value={form.stock} onChange={e => set("stock", e.target.value)} />
          </Field>

          <Field label="Low Stock Warning Level" help="Warn when stock drops below this number">
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

function FieldGrid({ children }) { return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>; }
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
function Receiving({ db, setDb, notify, currentUser }) {
  const [supplierId, setSupplierId] = useState(db.suppliers[0]?.id || "");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [paymentMode, setPaymentMode] = useState("credit"); // "credit" | "cash" | "mpesa"
  const [lines, setLines] = useState([{ productId: "", qty: "", buyPrice: "" }]);
  const [done, setDone] = useState(false);

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
      const products = prev.products.map(p => {
        const line = validLines.find(l => l.productId === p.id);
        if (!line) return p;
        const purchaseQty = Number(line.qty);
        const baseQty = purchaseQty * (p.conversionFactor || 1);
        const newBuy = Number(line.buyPrice) || p.buyPrice;
        return {
          ...p,
          stock: p.stock + baseQty,
          buyPrice: newBuy,
          history: [...p.history, { date: today, action: "Received", qty: baseQty, user: operator }],
        };
      });

      // If paid directly (cash or mpesa), log as an immediate stock purchase expense
      let updatedExpenses = prev.expenses;
      let updatedSuppliers = prev.suppliers;

      if (paymentMode === "cash" || paymentMode === "mpesa") {
        const expEntry = {
          id: uid("EXP"),
          date: today,
          category: "Stock Purchase",
          amount: total,
          description: `Stock delivery from ${supp?.name || "Supplier"} (${invoiceRef || "Direct Purchase"})`,
          payment: paymentMode,
          supplierId: supp?.id || null,
        };
        updatedExpenses = [expEntry, ...prev.expenses];

        // Also record payment on supplier ledger so outstanding balance doesn't accumulate
        if (supp) {
          updatedSuppliers = prev.suppliers.map(s => s.id === supp.id ? {
            ...s,
            payments: [...(s.payments || []), { date: today, amount: total }]
          } : s);
        }
      }

      const auditEntry = {
        id: uid("LOG"),
        time: `${today} ${timeStr}`,
        user: operator,
        role: "Storekeeper",
        category: "Stock Received",
        action: `Received stock delivery from ${supp?.name || "Supplier"} (${paymentMode === "credit" ? "On Credit" : "Paid " + paymentMode.toUpperCase()})`,
        detail: `${fmt(total)} (${invoiceRef || "No Invoice Ref"})`,
        target: supp?.name || "Supplier",
      };

      return {
        ...prev,
        products,
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
        <div className="disp" style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>Stock Delivery Received</div>
        <div style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 4 }}>
          Inventory stock levels, purchase histories, and supplier account have been updated in real-time.
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
    <div style={{ maxWidth: 720 }}>
      <div className="disp" style={{ fontSize: 26, fontWeight: 700, marginBottom: 14 }}>Receive Stock Delivery</div>
      <div className="hf-card" style={{ padding: 18 }}>
        <FieldGrid>
          <Field label="Supplier">
            <select className="hf-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              {db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Supplier Delivery Note / Invoice #">
            <input className="hf-input" placeholder="e.g. INV-1045" value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} />
          </Field>
        </FieldGrid>

        {/* Payment Terms for Delivery */}
        <div style={{ marginTop: 12, marginBottom: 6 }}>
          <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Payment for Delivery</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { key: "credit", label: "On Credit (Supplier Account)" },
              { key: "cash", label: "Paid Cash on Delivery" },
              { key: "mpesa", label: "Paid via M-Pesa" },
            ].map(m => {
              const isSelected = paymentMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setPaymentMode(m.key)}
                  className="hf-btn"
                  style={{
                    flex: 1,
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
  const suppliersWithBal = db.suppliers.map(s => ({
    ...s,
    total: supplierTotalPurchases(db, s.id),
    outstanding: supplierOutstanding(db, s.id)
  }));
  const active = selected ? suppliersWithBal.find(s => s.id === selected) : null;

  function recordPayment(supplierId, amount) {
    const supp = db.suppliers.find(s => s.id === supplierId);
    const today = todayISO(0);
    const timeStr = new Date().toTimeString().slice(0, 5);
    const operator = currentUser?.name || "Owner";

    const expenseEntry = {
      id: uid("EXP"),
      date: today,
      category: "Supplier Payment",
      amount: Number(amount),
      description: `Payment to supplier: ${supp?.name}`,
      payment: "mpesa",
      supplierId: supplierId,
    };

    setDb(prev => ({
      ...prev,
      suppliers: prev.suppliers.map(s => s.id === supplierId ? {
        ...s,
        payments: [...(s.payments || []), { date: today, amount: Number(amount) }]
      } : s),
      expenses: [expenseEntry, ...prev.expenses],
      auditLog: [
        {
          id: uid("LOG"),
          time: `${today} ${timeStr}`,
          user: operator,
          role: "Owner",
          category: "Supplier Payment",
          action: `Paid supplier: ${supp?.name}`,
          detail: `${fmt(amount)} (logged to expenses)`,
          target: supp?.name,
        },
        ...prev.auditLog
      ],
    }));

    notify("success", "Supplier Payment Recorded", `Paid ${fmt(amount)} to ${supp?.name}. Automatically reflected as expense.`);
  }

  return (
    <div>
      <div className="disp" style={{ fontSize: 26, fontWeight: 700, marginBottom: 14 }}>Suppliers</div>
      <div className="hf-card">
        <table className="hf-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Terms</th>
              <th>Total Purchases</th>
              <th>Paid</th>
              <th>Outstanding Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suppliersWithBal.map(s => {
              const paid = (s.payments || []).reduce((a, p) => a + p.amount, 0);
              return (
                <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => setSelected(s.id)}>
                  <td style={{ fontWeight: 600 }}>{s.name}<div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{s.phone}</div></td>
                  <td>{s.terms}</td>
                  <td className="mono">{fmt(s.total)}</td>
                  <td className="mono text-profit">{fmt(paid)}</td>
                  <td className={`mono ${s.outstanding > 0 ? "text-loss" : "text-profit"}`} style={{ fontWeight: 700 }}>
                    {fmt(s.outstanding)}
                  </td>
                  <td><ChevronRight size={15} color="var(--ink-soft)" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {active && <SupplierDrawer supplier={active} db={db} onPay={recordPayment} onClose={() => setSelected(null)} notify={notify} />}
    </div>
  );
}

function SupplierDrawer({ supplier, db, onPay, onClose, notify }) {
  const [amount, setAmount] = useState("");
  const products = db.products.filter(p => p.supplierId === supplier.id);
  const paid = (supplier.payments || []).reduce((a, p) => a + p.amount, 0);

  function handlePay() {
    const val = Number(amount);
    if (isNaN(val) || val <= 0) {
      notify("error", "Invalid Amount", "Please enter a valid payment amount.");
      return;
    }
    onPay(supplier.id, val);
    setAmount("");
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", justifyContent: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="hf-card" style={{ width: 420, maxWidth: "92vw", height: "100%", borderRadius: 0, overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>{supplier.name}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <Stat label="Total Purchases" value={fmt(supplier.total)} />
          <Stat label="Total Paid" value={fmt(paid)} />
          <Stat label="Outstanding Balance" value={fmt(supplier.outstanding)} />
          <Stat label="Payment Terms" value={supplier.terms} />
        </div>

        <div style={{ background: "var(--surface-hover)", padding: 12, borderRadius: 10, marginBottom: 18 }}>
          <div className="hf-kpi-label" style={{ marginBottom: 6 }}>Record Payment to Supplier</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 8 }}>
            Recording this payment will automatically reflect as an Expense on your Dashboard.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="hf-input" type="number" placeholder="Amount (KSh)" value={amount} onChange={e => setAmount(e.target.value)} />
            <button className="hf-btn hf-btn-primary" onClick={handlePay}>Record</button>
          </div>
        </div>

        <div className="disp" style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Products Supplied</div>
        {products.map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <span>{p.name}</span><span className="mono">{fmt(p.buyPrice)}/{p.purchaseUnit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= CUSTOMERS & CREDIT ================= */
function Customers({ db, setDb, notify, currentUser }) {
  const [selected, setSelected] = useState(null);
  const withBal = db.customers.map(c => ({
    ...c,
    balance: customerBalance(db, c.id),
    days: daysSinceLastActivity(db, c.id)
  }));
  const active = selected ? withBal.find(c => c.id === selected) : null;

  function recordPayment(customerId, amount) {
    const cust = db.customers.find(c => c.id === customerId);
    const today = todayISO(0);
    const timeStr = new Date().toTimeString().slice(0, 5);
    const operator = currentUser?.name || "Owner";

    setDb(prev => ({
      ...prev,
      customers: prev.customers.map(c => c.id === customerId ? {
        ...c,
        payments: [...(c.payments || []), { date: today, amount: Number(amount) }]
      } : c),
      auditLog: [
        {
          id: uid("LOG"),
          time: `${today} ${timeStr}`,
          user: operator,
          role: currentUser?.role || "Staff",
          category: "Customer Payment",
          action: `Received debt payment from ${cust?.name}`,
          detail: fmt(amount),
          target: cust?.name,
        },
        ...prev.auditLog
      ],
    }));

    notify("success", "Payment Received", `Recorded ${fmt(amount)} received from ${cust?.name}. Balance updated.`);
  }

  function statusOf(c) {
    if (c.balance === 0) return { tone: "green", label: "Settled" };
    if (c.days > 30) return { tone: "red", label: "Overdue" };
    if (c.days > 14) return { tone: "amber", label: "Due Soon" };
    return { tone: "green", label: "Active" };
  }

  const totalDebt = withBal.reduce((a, c) => a + c.balance, 0);

  return (
    <div>
      <div className="disp" style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Customers & Credit</div>
      <div style={{ color: "var(--ink-soft)", fontSize: 13, marginBottom: 14 }}>
        Total customer debt: <span className="mono text-loss" style={{ fontWeight: 700, fontSize: 15 }}>{fmt(totalDebt)}</span>
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
              <th></th>
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
                  <td><ChevronRight size={15} color="var(--ink-soft)" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {active && <CustomerDrawer customer={active} db={db} onPay={recordPayment} onClose={() => setSelected(null)} notify={notify} />}
    </div>
  );
}

function CustomerDrawer({ customer, db, onPay, onClose, notify }) {
  const [amount, setAmount] = useState("");
  const sales = db.sales.filter(s => s.customerId === customer.id);

  function handlePay() {
    const val = Number(amount);
    if (isNaN(val) || val <= 0) {
      notify("error", "Invalid Amount", "Please enter a valid amount.");
      return;
    }
    onPay(customer.id, val);
    setAmount("");
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", justifyContent: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="hf-card" style={{ width: 440, maxWidth: "92vw", height: "100%", borderRadius: 0, overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>{customer.name}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <Stat label="Credit Limit" value={fmt(customer.creditLimit)} />
          <Stat label="Current Debt Balance" value={fmt(customer.balance)} />
          <Stat label="Available Credit" value={fmt(customer.creditLimit - customer.balance)} />
          <Stat label="Total Purchases" value={fmt(sales.reduce((a,s)=>a+s.total,0))} />
        </div>
        <div style={{ background: "var(--surface-hover)", padding: 12, borderRadius: 10, marginBottom: 18 }}>
          <div className="hf-kpi-label" style={{ marginBottom: 6 }}>Record Payment Received</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="hf-input" type="number" placeholder="Payment received (KSh)" value={amount} onChange={e => setAmount(e.target.value)} />
            <button className="hf-btn hf-btn-primary" onClick={handlePay}>Record</button>
          </div>
        </div>
        <div className="disp" style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Purchase History</div>
        {sales.length === 0 && <div style={{ color: "var(--ink-soft)", fontSize: 13 }}>No purchases recorded yet.</div>}
        {sales.map(s => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <span>{s.invoiceNo} · {niceDate(s.date)}</span>
            <span className="mono text-profit" style={{ fontWeight: 600 }}>{fmt(s.total)}</span>
          </div>
        ))}
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
        qty: i.qty,
        unitPrice: i.unitPrice,
        unitCost: prod ? prod.buyPrice / (prod.conversionFactor || 1) : 0
      };
    });
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>Quotations</div>
        <button className="hf-btn hf-btn-primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New Quotation
        </button>
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {db.quotations.map(q => {
              const cust = db.customers.find(c => c.id === q.customerId);
              const total = q.items.reduce((a, i) => a + i.unitPrice * i.qty, 0);
              return (
                <tr key={q.id} style={{ cursor: "pointer" }} onClick={() => setViewing(q)}>
                  <td className="mono" style={{ fontWeight: 600 }}>{q.number}</td>
                  <td>{cust?.name || "Walk-in Prospect"}</td>
                  <td>{niceDate(q.date)}</td>
                  <td className="mono text-profit" style={{ fontWeight: 600 }}>{fmt(total)}</td>
                  <td><Pill tone={q.status === "converted" ? "green" : "steel"}>{q.status.toUpperCase()}</Pill></td>
                  <td><ChevronRight size={15} color="var(--ink-soft)" /></td>
                </tr>
              );
            })}
            {db.quotations.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)", padding: 24 }}>No quotations created yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {viewing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setViewing(null)}>
          <div className="hf-card" style={{ width: 460, maxWidth: "92vw", padding: 22 }} onClick={e => e.stopPropagation()}>
            <div className="disp" style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{viewing.number}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>
              {db.customers.find(c=>c.id===viewing.customerId)?.name || "Walk-in"} · {niceDate(viewing.date)}
            </div>
            <table className="hf-table" style={{ marginBottom: 12 }}>
              <thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
              <tbody>
                {viewing.items.map((i, idx) => {
                  const p = db.products.find(pp => pp.id === i.productId);
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
              <span className="mono text-profit" style={{ fontSize: 16 }}>{fmt(viewing.items.reduce((a,i)=>a+i.unitPrice*i.qty,0))}</span>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="hf-btn hf-btn-ghost" onClick={() => setViewing(null)}>Close</button>
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
    const exp = {
      id: uid("EXP"),
      date: today,
      category: form.category,
      amount: Number(form.amount),
      description: form.description,
      payment: form.payment
    };
    const operator = currentUser?.name || "Owner";

    setDb(prev => ({
      ...prev,
      expenses: [exp, ...prev.expenses],
      auditLog: [
        {
          id: uid("LOG"),
          time: today + " " + new Date().toTimeString().slice(0, 5),
          user: operator,
          role: "Owner",
          category: "Expense",
          action: `Recorded expense — ${form.category}`,
          detail: `${fmt(exp.amount)} (${form.description || "No description"})`,
          target: form.category,
        },
        ...prev.auditLog
      ]
    }));
    notify("success", "Expense Recorded", `${form.category}: ${fmt(exp.amount)} saved.`);
    setShowExpense(false);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>Cashbook & Daily Flow</div>
        <button className="hf-btn hf-btn-primary" onClick={() => setShowExpense(true)}><Plus size={15} /> Record Expense</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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

      {showExpense && <NewExpenseModal onCancel={() => setShowExpense(false)} onSave={addExpense} notify={notify} />}
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

function NewExpenseModal({ onCancel, onSave, notify }) {
  const [form, setForm] = useState({ category: "Transport", amount: "", description: "", payment: "cash" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSave() {
    if (!form.amount || Number(form.amount) <= 0) {
      notify("error", "Invalid Amount", "Please enter a valid expense amount.");
      return;
    }
    onSave(form);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onCancel}>
      <div className="hf-card" style={{ width: 400, maxWidth: "92vw", padding: 22 }} onClick={e => e.stopPropagation()}>
        <div className="disp" style={{ fontSize: 20, fontWeight: 700, marginBottom: 14 }}>Record Expense</div>
        <Field label="Category">
          <select className="hf-input" value={form.category} onChange={e => set("category", e.target.value)}>
            {["Transport", "Rent", "Salaries", "Electricity", "Repairs", "Supplier Payment", "Other"].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Amount (KSh)"><input className="hf-input" type="number" placeholder="e.g. 2500" value={form.amount} onChange={e => set("amount", e.target.value)} /></Field>
        <div style={{ height: 10 }} />
        <Field label="Description"><input className="hf-input" placeholder="e.g. Generator fuel, delivery fare" value={form.description} onChange={e => set("description", e.target.value)} /></Field>
        <div style={{ height: 10 }} />
        <Field label="Payment Method">
          <select className="hf-input" value={form.payment} onChange={e => set("payment", e.target.value)}>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
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

/* ================= MODERN INTERACTIVE AUDIT LOG ================= */
function AuditLog({ db, notify }) {
  const [query, setQuery] = useState("");
  const [user, setUser] = useState("all");
  const [selectedLog, setSelectedLog] = useState(null);

  const users = useMemo(() => {
    const set = new Set(db.auditLog.map(a => a.user));
    return ["all", ...Array.from(set)];
  }, [db.auditLog]);

  const q = query.trim().toLowerCase();
  const filtered = db.auditLog.filter(a => {
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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="disp" style={{ fontSize: 26, fontWeight: 700 }}>System Audit Log</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Complete traceability of all sales, payments, price changes, and stock movements.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="hf-btn hf-btn-ghost" onClick={downloadPDF}>
            <Download size={15} /> Download PDF
          </button>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-soft)" }} />
            <input className="hf-input" style={{ paddingLeft: 30, width: 220 }} placeholder="Search action, user, amount…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <select className="hf-input" style={{ width: 140 }} value={user} onChange={e => setUser(e.target.value)}>
            {users.map(u => <option key={u} value={u}>{u === "all" ? "All Users" : u}</option>)}
          </select>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
        <span>Showing <b>{filtered.length}</b> of <b>{db.auditLog.length}</b> events</span>
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
              <th style={{ width: 50 }}></th>
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
                <td><Eye size={15} color="var(--ink-soft)" /></td>
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

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", justifyContent: "flex-end" }}>
              <button className="hf-btn hf-btn-dark" onClick={() => setSelectedLog(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= APP SHELL ================= */
const NAV = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["owner","cashier","storekeeper"] },
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
  const [page, setPage] = useState("dashboard");
  const [toasts, setToasts] = useState([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Progressive Web App Install hook
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();

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
    notify("info", "Signed Out", "You have been securely logged out.");
  }

  function handleUserUpdate(updated) {
    const safeUser = sanitizeUserForSession(updated);
    setCurrentUser(safeUser);
    localStorage.setItem(AUTH_KEY, JSON.stringify(safeUser));
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
      <div className="hf-root" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle theme={theme} />
        Loading HardwareFlow…
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="hf-root">
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
  const allowed = (item) => item.roles.includes(role);
  const currentNav = NAV.find(n => n.key === page);
  const restricted = currentNav && !allowed(currentNav);

  const pages = {
    dashboard: <Dashboard db={db} role={role} notify={notify} />,
    pos: <POS db={db} setDb={setDb} role={role} notify={notify} currentUser={currentUser} />,
    inventory: <Inventory db={db} setDb={setDb} role={role} notify={notify} currentUser={currentUser} />,
    receiving: <Receiving db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    suppliers: <Suppliers db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    customers: <Customers db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    quotations: <Quotations db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    cashbook: <Cashbook db={db} setDb={setDb} notify={notify} currentUser={currentUser} />,
    reports: <Reports db={db} notify={notify} role={role} />,
    audit: <AuditLog db={db} notify={notify} />,
  };

  return (
    <div className="hf-root" style={{ minHeight: "100vh", display: "flex", flexDirection: "row" }}>
      <GlobalStyle theme={theme} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Mobile Drawer Backdrop */}
      {mobileNavOpen && (
        <div className="hf-mobile-backdrop" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Sidebar Navigation */}
      <div className={`hf-sidebar ${mobileNavOpen ? "open" : ""}`} style={{ width: 240, background: "var(--tab-bg)", flexShrink: 0, display: "flex", flexDirection: "column", padding: "20px 0" }}>
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Mobile Header Bar */}
        <div className="hf-mobile-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", display: "flex", padding: 4 }}
              title="Open Menu"
            >
              <Menu size={22} />
            </button>
            <div className="disp" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.02em" }}>
              HARDWARE<span style={{ color: "#E8977E" }}>FLOW</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

            <button
              type="button"
              onClick={toggleTheme}
              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}
              title="Toggle Theme"
            >
              {theme === "dark" ? <Sun size={15} color="#FBBF24" /> : <Moon size={15} color="#fff" />}
            </button>
            <div
              onClick={() => setUserDropdown(!userDropdown)}
              style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "rgba(255,255,255,0.12)", padding: "4px 8px", borderRadius: 8 }}
            >
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--rust)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                {currentUser.name.charAt(0)}
              </div>
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

          {/* Top-Right Controls: PWA Install, Theme Toggle & User Account Dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                onClick={() => setUserDropdown(!userDropdown)}
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
