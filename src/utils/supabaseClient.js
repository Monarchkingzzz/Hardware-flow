import { createClient } from "@supabase/supabase-js";

const SUPABASE_CONFIG_KEY = "hardwareflow-supabase-config";

const DEFAULT_SUPABASE_URL = "https://ivoetfcryfaherjczzpl.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2b2V0ZmNyeWZhaGVyamN6enBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MzA3NDAsImV4cCI6MjEwMzMwNjc0MH0.KScFPCFdds0Te8och92n3dtlHkycIe-kiZXpRXosQ4g";

export function getSupabaseCredentials() {
  const envUrl = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : null;
  const envKey = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : null;

  if (envUrl && envKey) {
    return { url: envUrl.trim(), key: envKey.trim(), source: "env" };
  }

  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(SUPABASE_CONFIG_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.url && parsed.key) {
          return { url: parsed.url.trim(), key: parsed.key.trim(), source: "local" };
        }
      }
    }
  } catch (err) {
    console.error("Failed to read Supabase config:", err);
  }

  // Fallback to configured HardwareFlow Supabase project URL
  if (DEFAULT_SUPABASE_URL) {
    return { url: DEFAULT_SUPABASE_URL, key: DEFAULT_SUPABASE_ANON_KEY || "", source: "default" };
  }

  return { url: "", key: "", source: "none" };
}

export function saveSupabaseCredentials(url, key) {
  try {
    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url: url.trim(), key: key.trim() }));
    cachedClient = null;
    lastUrl = null;
    lastKey = null;
  } catch (err) {
    console.error("Failed to save Supabase config:", err);
  }
}

export function clearSupabaseCredentials() {
  try {
    localStorage.removeItem(SUPABASE_CONFIG_KEY);
    cachedClient = null;
    lastUrl = null;
    lastKey = null;
  } catch (err) {
    console.error("Failed to clear Supabase config:", err);
  }
}

export async function testSupabaseConnection(url, key) {
  if (!url || !key) {
    return { success: false, error: "Please provide both Supabase Project URL and Anon API Key." };
  }
  try {
    const client = createClient(url.trim(), key.trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await client.from("products").select("count").limit(1);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, count: data };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

let cachedClient = null;
let lastUrl = null;
let lastKey = null;

export function getSupabaseClient() {
  const creds = getSupabaseCredentials();
  if (!creds.url || !creds.key) return null;

  if (cachedClient && lastUrl === creds.url && lastKey === creds.key) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(creds.url, creds.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    });
    lastUrl = creds.url;
    lastKey = creds.key;
    return cachedClient;
  } catch (err) {
    console.error("Error creating Supabase client:", err);
    return null;
  }
}

/**
 * Push all local database tables to Supabase with upserts.
 * Optimized for Supabase Free Tier quotas (bandwidth, storage & rate limits).
 */
export async function pushDatabaseToSupabase(db) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured. Please enter your Project URL and Anon API Key.");
  }

  const results = {
    users: 0,
    suppliers: 0,
    products: 0,
    customers: 0,
    sales: 0,
    expenses: 0,
    quotations: 0,
    auditLog: 0,
    purchases: 0,
  };

  // Build valid foreign key lookup sets to prevent Foreign Key constraint errors
  const validSupplierIds = new Set((db.suppliers || []).map(s => s.id));
  const validCustomerIds = new Set((db.customers || []).map(c => c.id));

  // PHASE 1: Push Core Parent Tables First (Users, Suppliers, Customers)
  const phase1Tasks = [];

  // 1. Users
  if (db.users && db.users.length > 0) {
    phase1Tasks.push((async () => {
      try {
        let remoteUsers = [];
        try {
          const { data } = await supabase.from("users").select("id, username");
          if (data) remoteUsers = data;
        } catch (err) {
          console.warn("[Supabase Sync] User query notice:", err);
        }

        const remoteByUsername = new Map(
          remoteUsers.map(r => [String(r.username).toLowerCase().trim(), r.id])
        );

        const userPayloads = db.users.map(u => {
          const cleanUser = String(u.username || "").toLowerCase().trim();
          const resolvedId = remoteByUsername.get(cleanUser) || u.id;
          return {
            id: resolvedId,
            username: cleanUser,
            password: u.password,
            name: (u.name && u.name.trim()) || cleanUser,
            role: (u.role && ['owner', 'cashier', 'storekeeper', 'admin'].includes(u.role.toLowerCase())) ? u.role.toLowerCase() : 'cashier',
            phone: u.phone || null,
            pin: u.pin || "8888",
          };
        });

        const { error } = await supabase.from("users").upsert(userPayloads, { onConflict: "id" });
        if (error) {
          console.warn("[Supabase Sync] Users upsert notice, falling back to individual updates:", error.message);
          for (const u of userPayloads) {
            await supabase.from("users").upsert(u, { onConflict: "id" }).catch(console.warn);
          }
        }
        results.users = db.users.length;
      } catch (userTaskErr) {
        console.warn("[Supabase Sync] Users sync error:", userTaskErr);
      }
    })());
  }

  // 2. Suppliers
  if (db.suppliers !== undefined && db.suppliers.length > 0) {
    phase1Tasks.push((async () => {
      try {
        const supplierPayload = db.suppliers.map(s => ({
          id: s.id,
          name: (s.name && s.name.trim()) || "Supplier",
          phone: s.phone || null,
          terms: s.terms || "Net 30",
          payments: Array.isArray(s.payments) ? s.payments.filter(p => Number(p.amount) > 0) : [],
        }));
        const { error } = await supabase.from("suppliers").upsert(supplierPayload, { onConflict: "id" });
        if (error) console.warn("[Supabase Sync] Suppliers notice:", error.message);
        results.suppliers = db.suppliers.length;
      } catch (cleanErr) {
        console.warn("[Supabase Sync] Supplier cleanup notice:", cleanErr);
      }
    })());
  }

  // 3. Customers
  if (db.customers !== undefined && db.customers.length > 0) {
    phase1Tasks.push((async () => {
      try {
        const customerPayload = db.customers.map(c => ({
          id: c.id,
          name: (c.name && c.name.trim()) || "Customer",
          phone: c.phone || null,
          credit_limit: Math.max(0, Number(c.creditLimit) || 0),
          payments: Array.isArray(c.payments) ? c.payments.filter(p => Number(p.amount) > 0) : [],
        }));
        const { error } = await supabase.from("customers").upsert(customerPayload, { onConflict: "id" });
        if (error) console.warn("[Supabase Sync] Customers notice:", error.message);
        results.customers = db.customers.length;
      } catch (cleanErr) {
        console.warn("[Supabase Sync] Customer sync notice:", cleanErr);
      }
    })());
  }

  // Wait for all parent entities to be written and indexed
  await Promise.all(phase1Tasks);

  // PHASE 2: Push Products (Chunked in Batches of 50 to prevent payload timeout & FK violations)
  if (db.products !== undefined && db.products.length > 0) {
    try {
      const sanitizedProducts = db.products.map(p => ({
        id: p.id,
        name: (p.name && p.name.trim()) || ("Product " + (p.sku || p.id || "")),
        category: p.category || "General",
        brand: p.brand || "",
        sku: p.sku || "",
        description: p.description || "",
        base_unit: p.baseUnit || "piece",
        purchase_unit: p.purchaseUnit || "piece",
        conversion_factor: Math.max(0.001, Number(p.conversionFactor) || 1),
        buy_price: Math.max(0, Number(p.buyPrice) || 0),
        sell_price: Math.max(0, Number(p.sellPrice) || 0),
        contractor_price: Math.max(0, Number(p.contractorPrice) || 0),
        wholesale_price: Math.max(0, Number(p.wholesalePrice) || 0),
        min_stock: Math.max(0, Number(p.minStock) || 0),
        stock: Number(p.stock) || 0,
        supplier_id: (p.supplierId && validSupplierIds.has(p.supplierId)) ? p.supplierId : null,
        location: p.location || "Main Store",
        history: Array.isArray(p.history) ? p.history : [],
      }));

      const CHUNK_SIZE = 50;
      for (let i = 0; i < sanitizedProducts.length; i += CHUNK_SIZE) {
        const chunk = sanitizedProducts.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from("products").upsert(chunk, { onConflict: "id" });
        if (error) {
          console.warn(`[Supabase Sync] Product chunk ${i}-${i + chunk.length} notice:`, error.message);
          // Fallback: push item by item to isolate any single faulty row
          for (const item of chunk) {
            await supabase.from("products").upsert(item, { onConflict: "id" }).catch(e => {
              console.warn("[Supabase Sync] Single product upsert error:", item.id, e.message);
            });
          }
        }
      }
      results.products = sanitizedProducts.length;
      console.log(`[Supabase Sync] Successfully persisted ${sanitizedProducts.length} inventory products to cloud.`);
    } catch (prodErr) {
      console.error("[Supabase Sync] Products sync error:", prodErr);
    }
  }

  // PHASE 3: Push Dependent & Event Tables in Parallel
  const phase3Tasks = [];

  // 5. Sales (Quota optimized: slice up to 500 recent sales)
  if (db.sales !== undefined && db.sales.length > 0) {
    phase3Tasks.push((async () => {
      try {
        const salesPayload = db.sales.slice(0, 500).map(s => ({
          id: s.id || `S-${Date.now()}`,
          invoice_no: s.invoiceNo || s.id,
          date: s.date || new Date().toISOString().slice(0, 10),
          time: s.time || null,
          items: Array.isArray(s.items) ? s.items : [],
          total: Math.max(0, Number(s.total) || 0),
          cost: Math.max(0, Number(s.cost) || 0),
          profit: Number(s.profit) || 0,
          payment: (s.payment && ['cash', 'mpesa', 'bank', 'credit', 'split'].includes(s.payment.toLowerCase())) ? s.payment.toLowerCase() : 'cash',
          split_cash: s.splitCash ? Number(s.splitCash) : null,
          customer_id: (s.customerId && validCustomerIds.has(s.customerId)) ? s.customerId : null,
          employee: s.employee || "Staff",
        }));

        const { error } = await supabase.from("sales").upsert(salesPayload, { onConflict: "invoice_no" });
        if (error) console.warn("[Supabase Sync] Sales notice:", error.message);
        results.sales = salesPayload.length;
      } catch (err) {
        console.warn("[Supabase Sync] Sales error:", err.message || err);
      }
    })());
  }

  // 6. Expenses (Quota optimized: slice up to 500 recent expenses)
  if (db.expenses !== undefined && db.expenses.length > 0) {
    phase3Tasks.push((async () => {
      try {
        const expensePayload = db.expenses.slice(0, 500).map(e => ({
          id: e.id,
          date: e.date || new Date().toISOString().slice(0, 10),
          category: (e.category && e.category.trim()) || "General",
          amount: Math.max(0.01, Number(e.amount) || 1),
          description: e.description || "",
          payment: (e.payment && ['cash', 'mpesa', 'bank', 'other'].includes(e.payment.toLowerCase())) ? e.payment.toLowerCase() : 'cash',
          supplier_id: (e.supplierId && validSupplierIds.has(e.supplierId)) ? e.supplierId : null,
        }));

        const { error } = await supabase.from("expenses").upsert(expensePayload, { onConflict: "id" });
        if (error) console.warn("[Supabase Sync] Expenses notice:", error.message);
        results.expenses = expensePayload.length;
      } catch (err) {
        console.warn("[Supabase Sync] Expenses error:", err.message || err);
      }
    })());
  }

  // 7. Quotations
  if (db.quotations !== undefined && db.quotations.length > 0) {
    phase3Tasks.push((async () => {
      try {
        const quotePayload = db.quotations.map(q => ({
          id: q.id,
          number: q.number || q.id,
          customer_id: (q.customerId && validCustomerIds.has(q.customerId)) ? q.customerId : null,
          date: q.date || new Date().toISOString().slice(0, 10),
          status: q.status || "draft",
          items: Array.isArray(q.items) ? q.items : [],
        }));
        const { error } = await supabase.from("quotations").upsert(quotePayload, { onConflict: "number" });
        if (error) console.warn("[Supabase Sync] Quotations notice:", error.message);
        results.quotations = db.quotations.length;
      } catch (err) {
        console.warn("[Supabase Sync] Quotations error:", err.message || err);
      }
    })());
  }

  // 8. Purchases
  if (db.purchases !== undefined && db.purchases.length > 0) {
    phase3Tasks.push((async () => {
      try {
        const purchasePayload = db.purchases.map(p => ({
          id: p.id,
          po_number: p.poNumber || p.id,
          supplier_id: (p.supplierId && validSupplierIds.has(p.supplierId)) ? p.supplierId : null,
          supplier_name: p.supplierName || "",
          date: p.date || new Date().toISOString().slice(0, 10),
          time: p.time || null,
          items: Array.isArray(p.items) ? p.items : [],
          total: Math.max(0, Number(p.total) || 0),
          payment: (p.payment && ['credit', 'cash', 'mpesa', 'bank'].includes(p.payment.toLowerCase())) ? p.payment.toLowerCase() : 'credit',
          received_by: p.receivedBy || "Staff",
          notes: p.notes || "",
        }));
        const { error } = await supabase.from("purchases").upsert(purchasePayload, { onConflict: "id" });
        if (error) console.warn("[Supabase Sync] Purchases notice:", error.message);
        results.purchases = db.purchases.length;
      } catch (err) {
        console.warn("[Supabase Sync] Purchases error:", err.message || err);
      }
    })());
  }

  // 9. Audit Log (Ultra-reliable & Free-Tier Quota Efficient)
  if (db.auditLog !== undefined && Array.isArray(db.auditLog) && db.auditLog.length > 0) {
    phase3Tasks.push((async () => {
      try {
        const recentLogs = db.auditLog.slice(0, 300);
        const payload = recentLogs.map((a, idx) => ({
          id: a.id || `LOG-${Date.now()}-${idx}`,
          time: a.time || a.created_at || new Date().toISOString().replace("T", " ").slice(0, 16),
          user_name: a.user || a.userName || a.user_name || "Staff",
          role: a.role || "Staff",
          category: a.category || "General",
          action: a.action || a.detail || "System Event",
          detail: a.detail || a.action || null,
          target: a.target || null,
          metadata: (a.metadata && typeof a.metadata === "object") ? a.metadata : {},
        }));

        const { error } = await supabase.from("audit_log").upsert(payload, { onConflict: "id" });
        if (error) {
          console.warn("[Supabase Sync] Audit Log notice, falling back without metadata:", error.message);
          const fallback = payload.map(({ metadata, ...rest }) => rest);
          await supabase.from("audit_log").upsert(fallback, { onConflict: "id" }).catch(console.warn);
        }
        results.auditLog = recentLogs.length;
      } catch (err) {
        console.warn("[Supabase Sync] Audit Log task error:", err.message || err);
      }
    })());
  }

  // 10. System Settings (Sequences & Action PIN)
  phase3Tasks.push(
    supabase.from("system_settings").upsert(
      [
        {
          key: "sequences",
          value: {
            invoiceSeq: db.invoiceSeq || 454,
            quoteSeq: db.quoteSeq || 1042,
            poSeq: db.poSeq || 2046,
            adjSeq: db.adjSeq || 1002,
          },
        },
        {
          key: "store_security",
          value: {
            actionPin: db?.settings?.actionPin || null,
            updatedAt: new Date().toISOString(),
          },
        }
      ],
      { onConflict: "key" }
    ).catch(err => console.warn("[Supabase Sync] Settings notice:", err.message || err))
  );

  await Promise.all(phase3Tasks);
  return results;
}

/**
 * Fetch all database tables from Supabase into local app shape.
 */
export async function pullDatabaseFromSupabase() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const [
    usersRes,
    suppliersRes,
    productsRes,
    customersRes,
    salesRes,
    expensesRes,
    quotationsRes,
    auditRes,
    settingsRes,
    purchasesRes,
  ] = await Promise.all([
    supabase.from("users").select("*"),
    supabase.from("suppliers").select("*"),
    supabase.from("products").select("*"),
    supabase.from("customers").select("*"),
    supabase.from("sales").select("*"),
    supabase.from("expenses").select("*"),
    supabase.from("quotations").select("*"),
    supabase.from("audit_log").select("*").order("created_at", { ascending: false }),
    supabase.from("system_settings").select("*"),
    supabase.from("purchases").select("*").order("date", { ascending: false }),
  ]);

  if (usersRes.error) throw usersRes.error;
  if (suppliersRes.error) throw suppliersRes.error;
  if (productsRes.error) throw productsRes.error;
  if (customersRes.error) throw customersRes.error;
  if (salesRes.error) throw salesRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (quotationsRes.error) throw quotationsRes.error;

  const seqObj = settingsRes.data?.find(s => s.key === "sequences")?.value || {};
  const secObj = settingsRes.data?.find(s => s.key === "store_security")?.value || {};

  return {
    settings: {
      actionPin: secObj?.actionPin || null,
    },
    users: (usersRes.data || []).map(u => ({
      id: u.id,
      username: u.username,
      password: u.password,
      name: u.name,
      role: u.role,
      phone: u.phone,
      pin: u.pin,
    })),
    suppliers: (suppliersRes.data || []).map(s => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      terms: s.terms,
      payments: s.payments || [],
    })),
    products: (productsRes.data || []).map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      brand: p.brand,
      sku: p.sku,
      description: p.description,
      baseUnit: p.base_unit,
      purchaseUnit: p.purchase_unit,
      conversionFactor: Number(p.conversion_factor) || 1,
      buyPrice: Number(p.buy_price) || 0,
      sellPrice: Number(p.sell_price) || 0,
      contractorPrice: Number(p.contractor_price) || 0,
      wholesalePrice: Number(p.wholesale_price) || 0,
      minStock: Number(p.min_stock) || 0,
      stock: Number(p.stock) || 0,
      supplierId: p.supplier_id,
      location: p.location,
      history: p.history || [],
    })),
    customers: (customersRes.data || []).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      creditLimit: Number(c.credit_limit) || 0,
      payments: c.payments || [],
    })),
    sales: (salesRes.data || []).map(s => ({
      id: s.id,
      invoiceNo: s.invoice_no,
      date: s.date,
      time: s.time,
      items: s.items || [],
      total: Number(s.total) || 0,
      cost: Number(s.cost) || 0,
      profit: Number(s.profit) || 0,
      payment: s.payment,
      splitCash: s.split_cash ? Number(s.split_cash) : null,
      customerId: s.customer_id,
      employee: s.employee,
    })),
    expenses: (expensesRes.data || []).map(e => ({
      id: e.id,
      date: e.date,
      category: e.category,
      amount: Number(e.amount) || 0,
      description: e.description,
      payment: e.payment,
      supplierId: e.supplier_id,
    })),
    quotations: (quotationsRes.data || []).map(q => ({
      id: q.id,
      number: q.number,
      customerId: q.customer_id,
      date: q.date,
      status: q.status,
      items: q.items || [],
    })),
    auditLog: (auditRes.data || []).map(a => ({
      id: a.id,
      time: a.time,
      user: a.user_name,
      role: a.role,
      category: a.category,
      action: a.action,
      detail: a.detail,
      target: a.target,
      metadata: a.metadata || {},
    })),
    purchases: (purchasesRes?.data || []).map(p => ({
      id: p.id,
      poNumber: p.po_number,
      supplierId: p.supplier_id,
      supplierName: p.supplier_name,
      date: p.date,
      time: p.time,
      items: p.items || [],
      total: Number(p.total) || 0,
      payment: p.payment,
      receivedBy: p.received_by,
      notes: p.notes,
    })),
    invoiceSeq: Math.max(
      458,
      ...(salesRes.data || []).map(s => {
        const m = String(s.invoice_no || "").match(/\d+$/);
        return m ? parseInt(m[0], 10) + 1 : 0;
      }),
      Number(seqObj.invoiceSeq) || 458
    ),
    quoteSeq: Math.max(
      1045,
      ...(quotationsRes.data || []).map(q => {
        const m = String(q.number || "").match(/\d+$/);
        return m ? parseInt(m[0], 10) + 1 : 0;
      }),
      Number(seqObj.quoteSeq) || 1045
    ),
    poSeq: Math.max(
      2046,
      ...(purchasesRes?.data || []).map(p => {
        const m = String(p.po_number || "").match(/\d+$/);
        return m ? parseInt(m[0], 10) + 1 : 0;
      }),
      Number(seqObj.poSeq) || 2046
    ),
    adjSeq: Number(seqObj.adjSeq) || 1002,
  };
}

let isSyncing = false;
let pendingDb = null;
let syncTimeout = null;
let lastLocalMutationTime = 0;

export function recordLocalMutation() {
  lastLocalMutationTime = Date.now();
}

export function getLastLocalMutationTime() {
  return lastLocalMutationTime;
}

export function getIsSyncing() {
  return isSyncing || (pendingDb !== null) || (Date.now() - lastLocalMutationTime < 4000);
}

const CREDENTIALS_BACKUP_KEY = "hardwareflow-credentials-backup-v1";
const OFFLINE_CREDENTIALS_QUEUE_KEY = "hardwareflow-offline-credentials-queue-v1";

/**
 * Save updated user credentials in local resilient backup cache
 */
export function saveCredentialsBackup(username, userObj) {
  try {
    const raw = localStorage.getItem(CREDENTIALS_BACKUP_KEY);
    const backup = raw ? JSON.parse(raw) : {};
    const clean = String(username || "").toLowerCase().trim();
    if (clean) {
      backup[clean] = {
        ...userObj,
        username: clean,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(CREDENTIALS_BACKUP_KEY, JSON.stringify(backup));
    }
  } catch (e) {
    console.warn("Credentials backup notice:", e);
  }
}

/**
 * Retrieve credentials from local backup cache
 */
export function getCredentialsBackup() {
  try {
    const raw = localStorage.getItem(CREDENTIALS_BACKUP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Queue credential update for offline sync
 */
export function enqueueOfflineCredentials(user) {
  try {
    const raw = localStorage.getItem(OFFLINE_CREDENTIALS_QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    const clean = String(user.username || "").toLowerCase().trim();
    const existingIdx = queue.findIndex(u => String(u.username || "").toLowerCase().trim() === clean);
    if (existingIdx >= 0) {
      queue[existingIdx] = { ...user, queuedAt: new Date().toISOString() };
    } else {
      queue.push({ ...user, queuedAt: new Date().toISOString() });
    }
    localStorage.setItem(OFFLINE_CREDENTIALS_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn("Offline credential queue notice:", e);
  }
}

/**
 * Direct push for an individual user credential update to guarantee instant cloud persistence.
 */
export async function pushUserToSupabase(user) {
  if (!user) return { success: false, error: "No user provided" };
  const cleanUsername = String(user.username || "").toLowerCase().trim();

  // 1. Immediately cache locally in credentials backup
  saveCredentialsBackup(cleanUsername, user);

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn("[Supabase] Client not initialized. Queuing credentials for sync.");
    enqueueOfflineCredentials(user);
    return { success: false, error: "Supabase client not ready" };
  }

  try {
    // 2. Query Supabase for existing user record by username or ID
    let targetId = user.id;
    try {
      const { data: existingList } = await supabase
        .from("users")
        .select("id, username")
        .or(`username.ilike.${cleanUsername},id.eq.${user.id}`);

      if (existingList && existingList.length > 0) {
        targetId = existingList[0].id;
      }
    } catch (queryErr) {
      console.warn("Supabase user search notice:", queryErr);
    }

    const payload = {
      id: targetId,
      username: cleanUsername,
      password: user.password,
      name: user.name,
      role: user.role || "cashier",
      phone: user.phone || null,
      pin: user.pin || "8888",
    };

    // 3. Upsert with verified targetId
    const { error: upsertError } = await supabase.from("users").upsert(payload, { onConflict: "id" });

    if (upsertError) {
      console.warn("[Supabase] Upsert warning, trying direct update:", upsertError.message);
      // Fallback: direct update by id or username
      const { error: updateError } = await supabase
        .from("users")
        .update({
          password: user.password,
          name: user.name,
          role: user.role || "cashier",
          phone: user.phone || null,
          pin: user.pin || "8888",
        })
        .or(`id.eq.${targetId},username.ilike.${cleanUsername}`);

      if (updateError) throw updateError;
    }

    console.log("[Supabase] User credentials successfully synced to cloud in real-time for:", cleanUsername);
    return { success: true };
  } catch (err) {
    console.error("[Supabase] Direct user push failed, queuing offline:", err.message || err);
    enqueueOfflineCredentials(user);
    return { success: false, error: err.message || String(err) };
  }
}

export function autoSyncDatabase(db, delay = 300) {
  if (!db) return;
  lastLocalMutationTime = Date.now();
  pendingDb = db;

  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = setTimeout(async () => {
    if (isSyncing) return;
    if (!pendingDb) return;

    const dbToSync = pendingDb;
    pendingDb = null;
    isSyncing = true;
    lastLocalMutationTime = Date.now();

    window.dispatchEvent(new CustomEvent("supabase-sync-status", {
      detail: { status: "syncing", timestamp: new Date().toISOString() }
    }));

    try {
      await pushDatabaseToSupabase(dbToSync);
      console.log("[Supabase Realtime Sync] Updated cloud database at", new Date().toLocaleTimeString());
      window.dispatchEvent(new CustomEvent("supabase-sync-status", {
        detail: { status: "success", timestamp: new Date().toISOString() }
      }));
    } catch (err) {
      console.warn("[Supabase Realtime Sync] Push error:", err.message || err);
      window.dispatchEvent(new CustomEvent("supabase-sync-status", {
        detail: { status: "error", error: err.message || String(err), timestamp: new Date().toISOString() }
      }));
    } finally {
      isSyncing = false;
      // If another change occurred while push was in flight, sync it next
      if (pendingDb) {
        autoSyncDatabase(pendingDb, 300);
      }
    }
  }, delay);
}

/**
 * Subscribe to Supabase Realtime changes across all public database tables.
 */
export function subscribeToSupabaseRealtime(onCloudChange) {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  const channel = supabase
    .channel("hardwareflow-cloud-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public" },
      (payload) => {
        console.log("[Supabase Realtime] Cloud table update detected:", payload.table, payload.eventType);
        if (onCloudChange) {
          onCloudChange(payload);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[Supabase Realtime] Connected to real-time live database stream.");
      }
    });

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch (e) {
      console.warn("Error removing realtime channel:", e);
    }
  };
}

