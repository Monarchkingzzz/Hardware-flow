import { createClient } from "@supabase/supabase-js";

const SUPABASE_CONFIG_KEY = "hardwareflow-supabase-config";

export function getSupabaseCredentials() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (envUrl && envKey) {
    return { url: envUrl, key: envKey, source: "env" };
  }

  try {
    const saved = localStorage.getItem(SUPABASE_CONFIG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.url && parsed.key) {
        return { url: parsed.url, key: parsed.key, source: "local" };
      }
    }
  } catch (err) {
    console.error("Failed to read Supabase config:", err);
  }

  return { url: "", key: "", source: "none" };
}

export function saveSupabaseCredentials(url, key) {
  try {
    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url: url.trim(), key: key.trim() }));
  } catch (err) {
    console.error("Failed to save Supabase config:", err);
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
    cachedClient = createClient(creds.url, creds.key);
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

  // 1. Users
  if (db.users && db.users.length > 0) {
    const { data, error } = await supabase.from("users").upsert(
      db.users.map(u => ({
        id: u.id,
        username: u.username,
        password: u.password,
        name: u.name,
        role: u.role,
        phone: u.phone || null,
        pin: u.pin || "8888",
      })),
      { onConflict: "id" }
    );
    if (error) throw new Error(`Failed pushing Users: ${error.message}`);
    results.users = db.users.length;
  }

  // 2. Suppliers
  if (db.suppliers && db.suppliers.length > 0) {
    const { error } = await supabase.from("suppliers").upsert(
      db.suppliers.map(s => ({
        id: s.id,
        name: s.name,
        phone: s.phone || null,
        terms: s.terms || "Net 30",
        payments: s.payments || [],
      })),
      { onConflict: "id" }
    );
    if (error) throw new Error(`Failed pushing Suppliers: ${error.message}`);
    results.suppliers = db.suppliers.length;
  }

  // 3. Products
  if (db.products && db.products.length > 0) {
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

  // 4. Customers
  if (db.customers && db.customers.length > 0) {
    const { error } = await supabase.from("customers").upsert(
      db.customers.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone || null,
        credit_limit: Number(c.creditLimit) || 0,
        payments: c.payments || [],
      })),
      { onConflict: "id" }
    );
    if (error) throw new Error(`Failed pushing Customers: ${error.message}`);
    results.customers = db.customers.length;
  }

  // 5. Sales
  if (db.sales && db.sales.length > 0) {
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
      { onConflict: "id" }
    );
    if (error) throw new Error(`Failed pushing Sales: ${error.message}`);
    results.sales = db.sales.length;
  }

  // 6. Expenses
  if (db.expenses && db.expenses.length > 0) {
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

  // 7. Quotations
  if (db.quotations && db.quotations.length > 0) {
    const { error } = await supabase.from("quotations").upsert(
      db.quotations.map(q => ({
        id: q.id,
        number: q.number,
        customer_id: q.customerId || null,
        date: q.date,
        status: q.status || "draft",
        items: q.items || [],
      })),
      { onConflict: "id" }
    );
    if (error) throw new Error(`Failed pushing Quotations: ${error.message}`);
    results.quotations = db.quotations.length;
  }

  // 8. Audit Log
  if (db.auditLog && db.auditLog.length > 0) {
    const { error } = await supabase.from("audit_log").upsert(
      db.auditLog.map(a => ({
        id: a.id,
        time: a.time,
        user_name: a.user,
        role: a.role || "Staff",
        category: a.category || "General",
        action: a.action,
        detail: a.detail || null,
        target: a.target || null,
      })),
      { onConflict: "id" }
    );
    if (error) throw new Error(`Failed pushing Audit Log: ${error.message}`);
    results.auditLog = db.auditLog.length;
  }

  // 9. System Settings (Sequences)
  await supabase.from("system_settings").upsert(
    {
      key: "sequences",
      value: {
        invoiceSeq: db.invoiceSeq || 454,
        quoteSeq: db.quoteSeq || 1042,
        poSeq: db.poSeq || 2046,
      },
    },
    { onConflict: "key" }
  );

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
  ]);

  if (usersRes.error) throw usersRes.error;
  if (suppliersRes.error) throw suppliersRes.error;
  if (productsRes.error) throw productsRes.error;
  if (customersRes.error) throw customersRes.error;
  if (salesRes.error) throw salesRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (quotationsRes.error) throw quotationsRes.error;

  const seqObj = settingsRes.data?.find(s => s.key === "sequences")?.value || {};

  return {
    users: usersRes.data.map(u => ({
      id: u.id,
      username: u.username,
      password: u.password,
      name: u.name,
      role: u.role,
      phone: u.phone,
      pin: u.pin,
    })),
    suppliers: suppliersRes.data.map(s => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      terms: s.terms,
      payments: s.payments || [],
    })),
    products: productsRes.data.map(p => ({
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
    customers: customersRes.data.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      creditLimit: Number(c.credit_limit) || 0,
      payments: c.payments || [],
    })),
    sales: salesRes.data.map(s => ({
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
    expenses: expensesRes.data.map(e => ({
      id: e.id,
      date: e.date,
      category: e.category,
      amount: Number(e.amount) || 0,
      description: e.description,
      payment: e.payment,
      supplierId: e.supplier_id,
    })),
    quotations: quotationsRes.data.map(q => ({
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
    })),
    invoiceSeq: seqObj.invoiceSeq || 454,
    quoteSeq: seqObj.quoteSeq || 1042,
    poSeq: seqObj.poSeq || 2046,
  };
}
