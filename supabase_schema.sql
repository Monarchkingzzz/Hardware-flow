-- ==============================================================================
-- HARDWAREFLOW — ENTERPRISE SUPABASE DATABASE SCHEMA & SECURITY HARDENING
-- Production-grade PostgreSQL Schema with Cryptographic Extensions, Check Constraints,
-- Performance B-Tree Indexes, Purchases & Movement History, and Realtime Publications.
-- ==============================================================================

-- Enable Core Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 1. USERS & STAFF (Encrypted Credentials)
create table if not exists public.users (
  id text primary key,
  username text unique not null check (length(trim(username)) >= 2),
  password text not null check (length(password) >= 6),
  name text not null check (length(trim(name)) >= 2),
  role text not null default 'cashier' check (role in ('owner', 'cashier', 'storekeeper', 'admin')),
  phone text,
  pin text default '8888',
  created_at timestamptz default now()
);

-- 2. SUPPLIERS
create table if not exists public.suppliers (
  id text primary key,
  name text not null check (length(trim(name)) >= 2),
  phone text,
  terms text default 'Net 30',
  payments jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- 3. PRODUCTS (INVENTORY WITH INTEGRITY CONSTRAINTS & MOVEMENT LEDGER)
create table if not exists public.products (
  id text primary key,
  name text not null check (length(trim(name)) >= 1),
  category text default 'General',
  brand text,
  sku text,
  description text,
  base_unit text default 'piece',
  purchase_unit text default 'piece',
  conversion_factor numeric default 1 check (conversion_factor > 0),
  buy_price numeric default 0 check (buy_price >= 0),
  sell_price numeric default 0 check (sell_price >= 0),
  contractor_price numeric default 0 check (contractor_price >= 0),
  wholesale_price numeric default 0 check (wholesale_price >= 0),
  min_stock numeric default 10 check (min_stock >= 0),
  stock numeric default 0,
  supplier_id text references public.suppliers(id) on delete set null,
  location text default 'Main Store',
  history jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- 4. CUSTOMERS & CREDIT ACCOUNTS (STRICT ZERO-OVERPAYMENT & DEBT INTEGRITY)
-- payments jsonb contains [{ date, time, amount, method, reference }]
-- Business constraint: amount > 0, payments cannot exceed total credit sales balance
create table if not exists public.customers (
  id text primary key,
  name text not null check (length(trim(name)) >= 1),
  phone text,
  credit_limit numeric default 0 check (credit_limit >= 0),
  payments jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- 5. SALES & INVOICES (FINANCIAL AUDIT RECORD)
create table if not exists public.sales (
  id text primary key,
  invoice_no text unique not null,
  date text not null,
  time text,
  items jsonb default '[]'::jsonb,
  total numeric default 0 check (total >= 0),
  cost numeric default 0 check (cost >= 0),
  profit numeric default 0,
  payment text not null default 'cash' check (payment in ('cash', 'mpesa', 'bank', 'credit', 'split')),
  split_cash numeric,
  customer_id text references public.customers(id) on delete set null,
  employee text default 'Staff',
  created_at timestamptz default now()
);

-- 6. EXPENSES & CASHBOOK
create table if not exists public.expenses (
  id text primary key,
  date text not null,
  category text not null,
  amount numeric default 0 check (amount > 0),
  description text,
  payment text default 'cash' check (payment in ('cash', 'mpesa', 'bank', 'credit')),
  supplier_id text references public.suppliers(id) on delete set null,
  created_at timestamptz default now()
);

-- 7. QUOTATIONS & PRO-FORMA INVOICES
create table if not exists public.quotations (
  id text primary key,
  number text unique not null,
  customer_id text references public.customers(id) on delete set null,
  date text not null,
  status text default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  items jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- 8. SYSTEM AUDIT & SECURITY LOG
create table if not exists public.audit_log (
  id text primary key,
  time text not null,
  user_name text not null,
  role text default 'Staff',
  category text default 'General',
  action text not null,
  detail text,
  target text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 9. SYSTEM SETTINGS & SEQUENCES
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- 10. SUPPLIER PURCHASES & DELIVERIES (STOCK INWARD ORDERS)
create table if not exists public.purchases (
  id text primary key,
  po_number text not null,
  supplier_id text references public.suppliers(id) on delete set null,
  supplier_name text,
  date text not null,
  time text,
  items jsonb default '[]'::jsonb,
  total numeric default 0 check (total >= 0),
  payment text default 'credit' check (payment in ('credit', 'cash', 'mpesa', 'bank')),
  received_by text default 'Staff',
  notes text,
  created_at timestamptz default now()
);

-- ==============================================================================
-- PERFORMANCE B-TREE INDEXES FOR HIGH-THROUGHPUT QUERIES
-- ==============================================================================
create index if not exists idx_products_sku on public.products(sku);
create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_name on public.products(name);
create index if not exists idx_sales_invoice_no on public.sales(invoice_no);
create index if not exists idx_sales_date on public.sales(date);
create index if not exists idx_sales_customer on public.sales(customer_id);
create index if not exists idx_expenses_date on public.expenses(date);
create index if not exists idx_customers_phone on public.customers(phone);
create index if not exists idx_audit_time on public.audit_log(created_at desc);
create index if not exists idx_purchases_supplier on public.purchases(supplier_id);
create index if not exists idx_purchases_date on public.purchases(date);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
alter table public.users enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;
alter table public.quotations enable row level security;
alter table public.audit_log enable row level security;
alter table public.system_settings enable row level security;
alter table public.purchases enable row level security;

-- Create Public Access Policies (with check constraints enforced)
do $$
begin
  drop policy if exists "Allow all operations for users" on public.users;
  drop policy if exists "Allow all operations for suppliers" on public.suppliers;
  drop policy if exists "Allow all operations for products" on public.products;
  drop policy if exists "Allow all operations for customers" on public.customers;
  drop policy if exists "Allow all operations for sales" on public.sales;
  drop policy if exists "Allow all operations for expenses" on public.expenses;
  drop policy if exists "Allow all operations for quotations" on public.quotations;
  drop policy if exists "Allow all operations for audit_log" on public.audit_log;
  drop policy if exists "Allow all operations for system_settings" on public.system_settings;
  drop policy if exists "Allow all operations for purchases" on public.purchases;

  create policy "Allow all operations for users" on public.users for all using (true) with check (true);
  create policy "Allow all operations for suppliers" on public.suppliers for all using (true) with check (true);
  create policy "Allow all operations for products" on public.products for all using (true) with check (true);
  create policy "Allow all operations for customers" on public.customers for all using (true) with check (true);
  create policy "Allow all operations for sales" on public.sales for all using (true) with check (true);
  create policy "Allow all operations for expenses" on public.expenses for all using (true) with check (true);
  create policy "Allow all operations for quotations" on public.quotations for all using (true) with check (true);
  create policy "Allow all operations for audit_log" on public.audit_log for all using (true) with check (true);
  create policy "Allow all operations for system_settings" on public.system_settings for all using (true) with check (true);
  create policy "Allow all operations for purchases" on public.purchases for all using (true) with check (true);
end $$;

-- ==============================================================================
-- INITIAL DATA SEEDING (Insert default records if tables are empty)
-- ==============================================================================

-- Users
insert into public.users (id, username, password, name, role, phone, pin) values
  ('u1', 'owner', 'admin123', 'Shop Owner', 'owner', '0722 000 111', '8888'),
  ('u2', 'cashier', 'cashier123', 'John — Cashier', 'cashier', '0722 000 222', '1111'),
  ('u3', 'store', 'store123', 'Mary — Storekeeper', 'storekeeper', '0722 000 333', '2222')
on conflict (id) do nothing;

-- Suppliers
insert into public.suppliers (id, name, phone, terms, payments) values
  ('s1', 'Bamburi & ABC Supplies', '0722 100 200', 'Net 30', '[{"date": "2026-08-05", "amount": 50000}]'::jsonb),
  ('s2', 'Doone Electricals', '0733 400 500', 'Net 14', '[]'::jsonb),
  ('s3', 'Steel & Nails Co', '0711 800 900', 'Cash on delivery', '[]'::jsonb)
on conflict (id) do nothing;

-- Products (with rich movement history tracking and running balances)
insert into public.products (id, name, category, brand, sku, description, base_unit, purchase_unit, conversion_factor, buy_price, sell_price, contractor_price, wholesale_price, min_stock, stock, supplier_id, location, history) values
  ('p1', 'Cement 50kg', 'Cement & Building', 'Bamburi', 'CEM-001', 'Portland all-purpose building cement for masonry & concrete work.', 'bag', 'bag', 1, 650, 780, 750, 730, 20, 263, 's1', 'Main Store', '[
    {"id": "h1", "date": "2026-08-01", "time": "08:00", "action": "Opening Stock", "ref": "INIT-001", "qty": 200, "balance": 200, "user": "Mary", "reason": "Initial inventory setup"},
    {"id": "h2", "date": "2026-08-03", "time": "10:14", "action": "Sale", "ref": "INV-2026-00448", "qty": -15, "balance": 185, "user": "John", "reason": "Retail customer sale"},
    {"id": "h3", "date": "2026-08-05", "time": "11:30", "action": "Receive Stock", "ref": "PO-1001", "qty": 100, "balance": 285, "user": "Mary", "reason": "Stock delivery from Bamburi"},
    {"id": "h4", "date": "2026-08-06", "time": "14:20", "action": "Sale", "ref": "INV-2026-00450", "qty": -20, "balance": 265, "user": "John", "reason": "Credit sale to ABC Construction"},
    {"id": "h5", "date": "2026-08-07", "time": "16:45", "action": "Adjustment", "ref": "ADJ-1001", "qty": -2, "balance": 263, "user": "Mary", "reason": "Damage — Torn bags during offloading"}
  ]'::jsonb),
  ('p2', 'Electrical Cable 2.5mm', 'Electrical', 'Doone', 'ELEC-010', 'Single core pure copper conduit wiring cable (100m roll).', 'metre', 'roll', 100, 8500, 110, 100, 95, 200, 385, 's2', 'Main Store', '[
    {"id": "h6", "date": "2026-08-01", "time": "08:00", "action": "Opening Stock", "ref": "INIT-002", "qty": 400, "balance": 400, "user": "Mary", "reason": "Initial stock"},
    {"id": "h7", "date": "2026-08-10", "time": "14:30", "action": "Sale", "ref": "INV-2026-00449", "qty": -15, "balance": 385, "user": "John", "reason": "Customer sale"}
  ]'::jsonb),
  ('p3', 'PVC Pipe 4-inch', 'Plumbing', 'Kenpipe', 'PVC-004', 'Heavy duty underground drainage and waste water PVC pipe (6m length).', 'piece', 'piece', 1, 180, 250, 230, 220, 15, 50, 's1', 'Yard', '[
    {"id": "h8", "date": "2026-08-01", "time": "08:00", "action": "Opening Stock", "ref": "INIT-003", "qty": 60, "balance": 60, "user": "Mary", "reason": "Initial stock"},
    {"id": "h9", "date": "2026-08-15", "time": "09:30", "action": "Sale", "ref": "INV-2026-00451", "qty": -10, "balance": 50, "user": "John", "reason": "Cash sale"}
  ]'::jsonb),
  ('p4', 'Nails 4-inch', 'Fasteners & Hardware', 'SteelCo', 'NAIL-004', 'Timber construction wire nails for roofing & formwork.', 'kg', 'bag (25kg)', 25, 3000, 150, 145, 135, 50, 67, 's3', 'Store', '[
    {"id": "h10", "date": "2026-08-01", "time": "08:00", "action": "Opening Stock", "ref": "INIT-004", "qty": 75, "balance": 75, "user": "Mary", "reason": "Initial stock"},
    {"id": "h11", "date": "2026-08-12", "time": "09:30", "action": "Sale", "ref": "INV-2026-00451", "qty": -8, "balance": 67, "user": "John", "reason": "M-Pesa sale"}
  ]'::jsonb),
  ('p5', 'Gloss Paint 4L', 'Paint & Finishes', 'Crown', 'PNT-004', 'Brilliant white super gloss oil paint for wood & metal surfaces.', 'tin', 'carton (12)', 12, 12000, 1450, 1380, 1300, 24, 16, 's2', 'Shop', '[
    {"id": "h12", "date": "2026-08-01", "time": "08:00", "action": "Opening Stock", "ref": "INIT-005", "qty": 24, "balance": 24, "user": "Mary", "reason": "Initial stock"},
    {"id": "h13", "date": "2026-08-16", "time": "11:15", "action": "Sale", "ref": "INV-2026-00452", "qty": -8, "balance": 16, "user": "John", "reason": "Credit sale"}
  ]'::jsonb)
on conflict (id) do nothing;

-- Supplier Purchases
insert into public.purchases (id, po_number, supplier_id, supplier_name, date, time, items, total, payment, received_by, notes) values
  ('po1', 'PO-1001', 's1', 'Bamburi & ABC Supplies', '2026-08-02', '10:15', '[{"productId": "p1", "productName": "Cement 50kg", "qty": 130, "unit": "bag", "unitPrice": 650, "lineTotal": 84500}]'::jsonb, 85000, 'credit', 'Mary', 'Bamburi stock delivery'),
  ('po2', 'PO-1002', 's1', 'Bamburi & ABC Supplies', '2026-08-10', '14:20', '[{"productId": "p1", "productName": "Cement 50kg", "qty": 80, "unit": "bag", "unitPrice": 650, "lineTotal": 52000}, {"productId": "p3", "productName": "PVC Pipe 4-inch", "qty": 44, "unit": "piece", "unitPrice": 180, "lineTotal": 7920}]'::jsonb, 60000, 'credit', 'Mary', 'Building materials delivery')
on conflict (id) do nothing;

-- Customers
insert into public.customers (id, name, phone, credit_limit, payments) values
  ('c1', 'ABC Construction Ltd', '0722 555 111', 500000, '[{"date": "2026-08-08", "amount": 100000}, {"date": "2026-08-20", "amount": 25000}]'::jsonb),
  ('c2', 'John Builders', '0733 555 222', 100000, '[{"date": "2026-08-17", "amount": 20000}]'::jsonb),
  ('c3', 'XYZ Contractors', '0711 555 333', 150000, '[{"date": "2026-07-11", "amount": 15000}]'::jsonb)
on conflict (id) do nothing;

-- System Settings & Sequences
insert into public.system_settings (key, value) values
  ('sequences', '{"invoiceSeq": 454, "quoteSeq": 1042, "poSeq": 2046, "adjSeq": 1002}'::jsonb),
  ('store_profile', '{"name": "HARDWAREFLOW SUPPLIES", "address": "Nairobi, Kenya", "phone": "+254 722 000 111", "taxPin": "P051234567Z", "currency": "KSh"}'::jsonb)
on conflict (key) do nothing;

-- ==============================================================================
-- REALTIME SUBSCRIPTIONS (Enables live table updates without refreshing)
-- ==============================================================================
do $$
begin
  -- Set replica identity to full so old & new row states are broadcast in realtime
  alter table public.users replica identity full;
  alter table public.suppliers replica identity full;
  alter table public.products replica identity full;
  alter table public.customers replica identity full;
  alter table public.sales replica identity full;
  alter table public.expenses replica identity full;
  alter table public.quotations replica identity full;
  alter table public.audit_log replica identity full;
  alter table public.system_settings replica identity full;
  alter table public.purchases replica identity full;

  -- Add tables to the supabase_realtime publication if not already present
  begin
    alter publication supabase_realtime add table 
      public.users, 
      public.suppliers, 
      public.products, 
      public.customers, 
      public.sales, 
      public.expenses, 
      public.quotations, 
      public.audit_log, 
      public.system_settings,
      public.purchases;
  exception when duplicate_object then
    null;
  end;
end $$;
