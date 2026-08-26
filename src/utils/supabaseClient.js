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
  };

  const tasks = [];

  // 1. Users
  if (db.users && db.users.length > 0) {
    tasks.push((async () => {
      try {
        // Fetch existing users to align IDs and avoid duplicate username constraint errors
        let remoteUsers = [];
        try {
          const { data } = await supabase.from("users").select("id, username");
          if (data) remoteUsers = data;
        } catch (err) {
          console.warn("Could not query existing users:", err);
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
            name: u.name,
            role: u.role || "cashier",
            phone: u.phone || null,
            pin: u.pin || "8888",
          };
        });

        const { error } = await supabase.from("users").upsert(userPayloads, { onConflict: "id" });
        if (error) {
          console.warn("Batch user upsert notice, falling back to individual updates:", error.message);
          for (const u of userPayloads) {
            await supabase.from("users").upsert(u, { onConflict: "id" }).catch(console.warn);
          }
        }
        results.users = db.users.length;

        // Clean up deleted users if any
        if (remoteUsers && remoteUsers.length > 0) {
          const localUsernames = new Set(db.users.map(u => String(u.username).toLowerCase().trim()));
          const toDelete = remoteUsers
            .filter(r => !localUsernames.has(String(r.username).toLowerCase().trim()))
            .map(r => r.id);
          if (toDelete.length > 0) {
            await supabase.from("users").delete().in("id", toDelete);
          }
        }
      } catch (userTaskErr) {
        console.warn("Users sync task error:", userTaskErr);
      }
    })());
  }

  // 2. Suppliers
  if (db.suppliers !== undefined) {
    tasks.push((async () => {
      if (db.suppliers.length > 0) {
        const { error } = await supabase.from("suppliers").upsert(
          db.suppliers.map(s => ({
            id: s.id,
            name: s.name,
            phone: s.phone || null,
            terms: s.terms || "Net 30",
            payments: (s.payments || []).filter(p => Number(p.amount) > 0),
          })),
          { onConflict: "id" }
        );
        if (error) throw new Error(`Failed pushing Suppliers: ${error.message}`);
        results.suppliers = db.suppliers.length;
      }

      // Clean up deleted suppliers if any
      try {
        const { data: remoteSuppliers } = await supabase.from("suppliers").select("id");
        if (remoteSuppliers && remoteSuppliers.length > 0) {
          const localSupplierIds = new Set((db.suppliers || []).map(s => s.id));
          const toDelete = remoteSuppliers.filter(r => !localSupplierIds.has(r.id)).map(r => r.id);
          if (toDelete.length > 0) {
            await supabase.from("suppliers").delete().in("id", toDelete);
          }
        }
      } catch (cleanErr) {
        console.warn("Supplier deletion cleanup notice:", cleanErr);
      }
    })());
  }

  // 3. Products
  if (db.products !== undefined) {
    tasks.push((async () => {
      if (db.products.length > 0) {
        const { error } = await supabase.from("products").upsert(
          db.products.map(p => ({
            id: p.id,
            name: p.name,
            category: p.category || "General",
            brand: p.brand || "",
            sku: p.sku || "",
            description: p.description || "",
            base_unit: p.baseUnit || "piece",
            purchase_unit: p.purchaseUnit || "piece",
            conversion_factor: Number(p.conversionFactor) || 1,
            buy_price: Number(p.buyPrice) || 0,
            sell_price: Number(p.sellPrice) || 0,
            contractor_price: Number(p.contractorPrice) || 0,
            wholesale_price: Number(p.wholesalePrice) || 0,
            min_stock: Number(p.minStock) || 0,
            stock: Number(p.stock) || 0,
            supplier_id: p.supplierId || null,
            location: p.location || "Main Store",
            history: p.history || [],
          })),
          { onConflict: "id" }
        );
        if (error) throw new Error(`Failed pushing Products: ${error.message}`);
        results.products = db.products.length;
      }

      // Clean up deleted products if any
      try {
        const { data: remoteProducts } = await supabase.from("products").select("id");
        if (remoteProducts && remoteProducts.length > 0) {
          const localProductIds = new Set((db.products || []).map(p => p.id));
          const toDelete = remoteProducts.filter(r => !localProductIds.has(r.id)).map(r => r.id);
          if (toDelete.length > 0) {
            await supabase.from("products").delete().in("id", toDelete);
          }
        }
      } catch (cleanErr) {
        console.warn("Product deletion cleanup notice:", cleanErr);
      }
    })());
  }

  // 4. Customers
  if (db.customers !== undefined) {
    tasks.push((async () => {
      if (db.customers.length > 0) {
        const { error } = await supabase.from("customers").upsert(
          db.customers.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone || null,
            credit_limit: Number(c.creditLimit) || 0,
            payments: (c.payments || []).filter(p => Number(p.amount) > 0),
          })),
          { onConflict: "id" }
        );
        if (error) throw new Error(`Failed pushing Customers: ${error.message}`);
        results.customers = db.customers.length;
      }

      // Clean up deleted customers if any
      try {
        const { data: remoteCustomers } = await supabase.from("customers").select("id");
        if (remoteCustomers && remoteCustomers.length > 0) {
          const localCustIds = new Set((db.customers || []).map(c => c.id));
          const toDelete = remoteCustomers.filter(r => !localCustIds.has(r.id)).map(r => r.id);
          if (toDelete.length > 0) {
            await supabase.from("customers").delete().in("id", toDelete);
          }
        }
      } catch (cleanErr) {
        console.warn("Customer deletion cleanup notice:", cleanErr);
      }
    })());
  }

  // 5. Sales
  if (db.sales !== undefined) {
    tasks.push((async () => {
      if (db.sales.length > 0) {
        const { error } = await supabase.from("sales").upsert(
          db.sales.map(s => ({
            id: s.id,
            invoice_no: s.invoiceNo,
            date: s.date,
            time: s.time || null,
            items: s.items || [],
            total: Number(s.total) || 0,
            cost: Number(s.cost) || 0,
            profit: Number(s.profit) || 0,
            payment: s.payment || "cash",
            split_cash: s.splitCash ? Number(s.splitCash) : null,
            customer_id: s.customerId || null,
            employee: s.employee || "Staff",
          })),
          { onConflict: "invoice_no" }
        );
        if (error) throw new Error(`Failed pushing Sales: ${error.message}`);
        results.sales = db.sales.length;
      }

      // Clean up deleted sales if any
      try {
        const { data: remoteSales } = await supabase.from("sales").select("id, invoice_no");
        if (remoteSales && remoteSales.length > 0) {
          const localInvSet = new Set((db.sales || []).map(s => s.invoiceNo || s.id));
          const toDelete = remoteSales.filter(r => !localInvSet.has(r.invoice_no) && !localInvSet.has(r.id)).map(r => r.id);
          if (toDelete.length > 0) {
            await supabase.from("sales").delete().in("id", toDelete);
          }
        }
      } catch (cleanErr) {
        console.warn("Sales deletion cleanup notice:", cleanErr);
      }
    })());
  }

  // 6. Expenses
  if (db.expenses !== undefined) {
    tasks.push((async () => {
      if (db.expenses.length > 0) {
        const { error } = await supabase.from("expenses").upsert(
          db.expenses.map(e => ({
            id: e.id,
            date: e.date,
            category: e.category,
            amount: Number(e.amount) || 0,
            description: e.description || "",
            payment: e.payment || "cash",
            supplier_id: e.supplierId || null,
          })),
          { onConflict: "id" }
        );
        if (error) throw new Error(`Failed pushing Expenses: ${error.message}`);
        results.expenses = db.expenses.length;
      }

      // Clean up deleted expenses if any
      try {
        const { data: remoteExpenses } = await supabase.from("expenses").select("id");
        if (remoteExpenses && remoteExpenses.length > 0) {
          const localExpIds = new Set((db.expenses || []).map(e => e.id));
          const toDelete = remoteExpenses.filter(r => !localExpIds.has(r.id)).map(r => r.id);
          if (toDelete.length > 0) {
            await supabase.from("expenses").delete().in("id", toDelete);
          }
        }
      } catch (cleanErr) {
        console.warn("Expense deletion cleanup notice:", cleanErr);
      }
    })());
  }

  // 7. Quotations
  if (db.quotations !== undefined) {
    tasks.push((async () => {
      if (db.quotations.length > 0) {
        const { error } = await supabase.from("quotations").upsert(
          db.quotations.map(q => ({
            id: q.id,
            number: q.number,
            customer_id: q.customerId || null,
            date: q.date,
            status: q.status || "draft",
            items: q.items || [],
          })),
          { onConflict: "number" }
        );
        if (error) throw new Error(`Failed pushing Quotations: ${error.message}`);
        results.quotations = db.quotations.length;
      }

      // Clean up deleted quotations if any
      try {
        const { data: remoteQuotations } = await supabase.from("quotations").select("id");
        if (remoteQuotations && remoteQuotations.length > 0) {
          const localQuoteIds = new Set((db.quotations || []).map(q => q.id));
          const toDelete = remoteQuotations.filter(r => !localQuoteIds.has(r.id)).map(r => r.id);
          if (toDelete.length > 0) {
            await supabase.from("quotations").delete().in("id", toDelete);
          }
        }
      } catch (cleanErr) {
        console.warn("Quotation deletion cleanup notice:", cleanErr);
      }
    })());
  }

  // 8. Audit Log
  if (db.auditLog !== undefined) {
    tasks.push((async () => {
      try {
        if (db.auditLog.length > 0) {
          const payload = db.auditLog.map(a => ({
            id: a.id || `LOG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            time: a.time,
            user_name: a.user || "Staff",
            role: a.role || "Staff",
            category: a.category || "General",
            action: a.action,
            detail: a.detail || null,
            target: a.target || null,
            metadata: a.metadata || {},
          }));

          const { error } = await supabase.from("audit_log").upsert(payload, { onConflict: "id" });
          if (error) {
            console.warn("Audit Log push notice, falling back without metadata if schema differs:", error.message);
            // Fallback without metadata column if remote DB has older schema
            const fallbackPayload = db.auditLog.map(a => ({
              id: a.id || `LOG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
              time: a.time,
              user_name: a.user || "Staff",
              role: a.role || "Staff",
              category: a.category || "General",
              action: a.action,
              detail: a.detail || null,
              target: a.target || null,
            }));
            await supabase.from("audit_log").upsert(fallbackPayload, { onConflict: "id" }).catch(console.warn);
          }
          results.auditLog = db.auditLog.length;
        }

        // Clean up deleted audit logs
        try {
          const { data: remoteLogs } = await supabase.from("audit_log").select("id");
          if (remoteLogs && remoteLogs.length > 0) {
            const localLogIds = new Set((db.auditLog || []).map(a => a.id));
            const toDelete = remoteLogs.filter(r => !localLogIds.has(r.id)).map(r => r.id);
            if (toDelete.length > 0) {
              await supabase.from("audit_log").delete().in("id", toDelete);
            }
          }
        } catch (cleanErr) {
          console.warn("Audit log deletion cleanup notice:", cleanErr);
        }
      } catch (logErr) {
        console.warn("Audit log sync notice:", logErr);
      }
    })());
  }

  // 9. Purchases
  if (db.purchases !== undefined) {
    tasks.push((async () => {
      try {
        if (db.purchases.length > 0) {
          const { error } = await supabase.from("purchases").upsert(
            db.purchases.map(p => ({
              id: p.id,
              po_number: p.poNumber || p.id,
              supplier_id: p.supplierId || null,
              supplier_name: p.supplierName || "",
              date: p.date,
              time: p.time || null,
              items: p.items || [],
              total: Number(p.total) || 0,
              payment: p.payment || "credit",
              received_by: p.receivedBy || "Staff",
              notes: p.notes || "",
            })),
            { onConflict: "id" }
          );
          if (error) console.warn("Purchases sync notice:", error.message);
          results.purchases = db.purchases.length;
        }

        // Clean up deleted purchases
        try {
          const { data: remotePurchases } = await supabase.from("purchases").select("id");
          if (remotePurchases && remotePurchases.length > 0) {
            const localPurchaseIds = new Set((db.purchases || []).map(p => p.id));
            const toDelete = remotePurchases.filter(r => !localPurchaseIds.has(r.id)).map(r => r.id);
            if (toDelete.length > 0) {
              await supabase.from("purchases").delete().in("id", toDelete);
            }
          }
        } catch (cleanErr) {
          console.warn("Purchases deletion cleanup notice:", cleanErr);
        }
      } catch (err) {
        console.warn("Purchases table sync notice:", err);
      }
    })());
  }

  // 10. System Settings (Sequences & Security Action PIN)
  tasks.push(
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
    )
  );

  await Promise.all(tasks);
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

export function autoSyncDatabase(db, delay = 50) {
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
        autoSyncDatabase(pendingDb, 50);
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

