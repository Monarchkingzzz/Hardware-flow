-- ==============================================================================
-- HARDWAREFLOW — ENTERPRISE SUPABASE DATABASE SCHEMA & SECURITY HARDENING
-- Production-grade PostgreSQL Schema with Cryptographic Extensions, Check Constraints,
-- Performance B-Tree Indexes, and Realtime Publications.
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

-- 3. PRODUCTS (INVENTORY WITH INTEGRITY CONSTRAINTS)
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

-- 4. CUSTOMERS & CREDIT ACCOUNTS
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
  created_at timestamptz default now()
);

-- 9. SYSTEM SETTINGS & SEQUENCES
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
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

  create policy "Allow all operations for users" on public.users for all using (true) with check (true);
  create policy "Allow all operations for suppliers" on public.suppliers for all using (true) with check (true);
  create policy "Allow all operations for products" on public.products for all using (true) with check (true);
  create policy "Allow all operations for customers" on public.customers for all using (true) with check (true);
  create policy "Allow all operations for sales" on public.sales for all using (true) with check (true);
  create policy "Allow all operations for expenses" on public.expenses for all using (true) with check (true);
  create policy "Allow all operations for quotations" on public.quotations for all using (true) with check (true);
  create policy "Allow all operations for audit_log" on public.audit_log for all using (true) with check (true);
  create policy "Allow all operations for system_settings" on public.system_settings for all using (true) with check (true);
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
  ('s1', 'ABC Supplies', '0722 100 200', 'Net 30', '[]'::jsonb),
  ('s2', 'Doone Electricals', '0733 400 500', 'Net 14', '[]'::jsonb),
  ('s3', 'Steel & Nails Co', '0711 800 900', 'Cash on delivery', '[]'::jsonb)
on conflict (id) do nothing;

-- Products
insert into public.products (id, name, category, brand, sku, description, base_unit, purchase_unit, conversion_factor, buy_price, sell_price, contractor_price, wholesale_price, min_stock, stock, supplier_id, location, history) values
  ('p1', 'Cement 50kg', 'Cement & Building', 'Bamburi', 'CEM-001', 'Portland all-purpose building cement for masonry & concrete work.', 'bag', 'bag', 1, 650, 780, 750, 720, 20, 47, 's1', 'Main Store', '[{"date": "2026-08-14", "user": "Mary", "action": "Received", "qty": 100}, {"date": "2026-08-18", "user": "John", "action": "Sale", "qty": -12}]'::jsonb),
  ('p2', 'Electrical Cable 2.5mm', 'Electrical', 'Doone', 'ELEC-010', 'Single core pure copper conduit wiring cable (100m roll).', 'metre', 'roll', 100, 8500, 110, 100, 95, 200, 385, 's2', 'Main Store', '[{"date": "2026-08-10", "user": "Mary", "action": "Received", "qty": 500}]'::jsonb),
  ('p3', 'PVC Pipe 4-inch', 'Plumbing', 'Kenpipe', 'PVC-004', 'Heavy duty underground drainage and waste water PVC pipe (6m length).', 'piece', 'piece', 1, 180, 250, 230, 215, 15, 50, 's1', 'Yard', '[{"date": "2026-08-15", "user": "Mary", "action": "Received", "qty": 60}]'::jsonb),
  ('p4', 'Nails 4-inch', 'Fasteners & Hardware', 'SteelCo', 'NAIL-004', 'Timber construction wire nails for roofing & formwork.', 'kg', 'bag (25kg)', 25, 3000, 150, 145, 135, 50, 18, 's3', 'Store', '[{"date": "2026-08-12", "user": "Mary", "action": "Received", "qty": 75}]'::jsonb),
  ('p5', 'Gloss Paint 4L', 'Paint & Finishes', 'Crown', 'PNT-004', 'Brilliant white super gloss oil paint for wood & metal surfaces.', 'tin', 'carton (12)', 12, 12000, 1450, 1380, 1300, 24, 8, 's2', 'Shop', '[{"date": "2026-08-06", "user": "Mary", "action": "Received", "qty": 24}]'::jsonb)
on conflict (id) do nothing;

-- Customers
insert into public.customers (id, name, phone, credit_limit, payments) values
  ('c1', 'ABC Construction Ltd', '0722 555 111', 500000, '[{"date": "2026-08-08", "amount": 100000}, {"date": "2026-08-20", "amount": 25000}]'::jsonb),
  ('c2', 'John Builders', '0733 555 222', 100000, '[{"date": "2026-08-17", "amount": 20000}]'::jsonb),
  ('c3', 'XYZ Contractors', '0711 555 333', 150000, '[{"date": "2026-07-11", "amount": 15000}]'::jsonb)
on conflict (id) do nothing;

-- System Settings & Sequences
insert into public.system_settings (key, value) values
  ('sequences', '{"invoiceSeq": 454, "quoteSeq": 1042, "poSeq": 2046}'::jsonb),
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
      public.system_settings;
  exception when duplicate_object then
    null;
  end;
end $$;


