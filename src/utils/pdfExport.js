import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function fmtCurrency(n) {
  const v = Math.round(Number(n) || 0);
  return "KSh " + v.toLocaleString("en-US");
}

function niceDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function addPDFHeader(doc, title, subtitle) {
  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Header bar
  doc.setFillColor(20, 23, 29); // #14171D
  doc.rect(0, 0, pageWidth, 28, "F");

  // Rust accent line
  doc.setFillColor(193, 80, 47); // #C1502F
  doc.rect(0, 28, pageWidth, 2.5, "F");

  // Company Brand
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("HARDWAREFLOW", 14, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(232, 151, 126);
  doc.text("BUSINESS MANAGEMENT SYSTEM", 14, 21);

  // Document Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(title.toUpperCase(), pageWidth - 14, 14, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(170, 180, 195);
  const nowStr = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  doc.text(`Generated: ${nowStr}`, pageWidth - 14, 21, { align: "right" });

  // Subtitle / Filter notes below header
  if (subtitle) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(80, 90, 100);
    doc.text(subtitle, 14, 37);
  }
}

function addPDFFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(228, 230, 234);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 140, 150);
    doc.text("HardwareFlow · Confidential & Official Document", 14, pageHeight - 6);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 6, { align: "right" });
  }
}

/**
 * Export Customer Sales Receipt to PDF
 */
export function exportReceiptPDF({ sale, db }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" }); // A5 standard receipt format
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Top Header Banner
  doc.setFillColor(20, 23, 29);
  doc.rect(0, 0, pageWidth, 24, "F");
  doc.setFillColor(193, 80, 47);
  doc.rect(0, 24, pageWidth, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text("HARDWAREFLOW", 12, 11);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(232, 151, 126);
  doc.text("BUILDING & HARDWARE SUPPLIES", 12, 17);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("OFFICIAL SALES RECEIPT", pageWidth - 12, 11, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(170, 180, 195);
  doc.text("PROOF OF PAYMENT", pageWidth - 12, 17, { align: "right" });

  // Receipt Metadata Box
  doc.setFillColor(248, 249, 251);
  doc.roundedRect(12, 30, pageWidth - 24, 28, 2, 2, "F");
  doc.setDrawColor(228, 230, 234);
  doc.roundedRect(12, 30, pageWidth - 24, 28, 2, 2, "S");

  const cust = db.customers.find(c => c.id === sale.customerId);
  const paymentLabel = sale.payment === "mpesa" ? "M-PESA" 
    : sale.payment === "bank" ? "BANK TRANSFER"
    : sale.payment === "credit" ? "CREDIT ACCOUNT"
    : sale.payment === "split" ? `SPLIT (Cash ${fmtCurrency(sale.splitCash || 0)} + M-Pesa)`
    : "CASH";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 35, 42);
  doc.text(`Invoice / Receipt: ${sale.invoiceNo}`, 16, 37);
  doc.text(`Date & Time: ${niceDate(sale.date)} · ${sale.time || new Date().toTimeString().slice(0, 5)}`, 16, 44);
  doc.text(`Payment Mode: ${paymentLabel}`, 16, 51);

  doc.text(`Customer: ${cust ? cust.name : "Walk-in Customer"}`, pageWidth - 16, 37, { align: "right" });
  if (cust?.phone) {
    doc.setFont("helvetica", "normal");
    doc.text(`Phone: ${cust.phone}`, pageWidth - 16, 44, { align: "right" });
  }
  doc.setFont("helvetica", "normal");
  doc.text(`Served By: ${sale.employee || "Cashier"}`, pageWidth - 16, 51, { align: "right" });

  // Items Table
  const tableBody = sale.items.map((i, idx) => {
    const p = db.products.find(pp => pp.id === i.productId);
    return [
      idx + 1,
      p?.name || "Product Item",
      `${i.qty} ${p?.baseUnit || "pcs"}`,
      fmtCurrency(i.unitPrice),
      fmtCurrency(i.unitPrice * i.qty)
    ];
  });

  autoTable(doc, {
    startY: 62,
    head: [["#", "Item Description", "Qty", "Unit Price", "Total"]],
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [32, 40, 52],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: 2.5,
    },
    bodyStyles: {
      fontSize: 7.5,
      cellPadding: 2.2,
      textColor: [30, 35, 42],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: "auto", fontStyle: "bold" },
      2: { cellWidth: 20, halign: "right" },
      3: { cellWidth: 26, halign: "right" },
      4: { cellWidth: 28, halign: "right", fontStyle: "bold" },
    },
    margin: { left: 12, right: 12 },
  });

  // Total Summary & Thank You Box
  const endY = doc.lastAutoTable.finalY + 6;
  doc.setFillColor(245, 247, 250);
  doc.roundedRect(pageWidth - 68, endY, 56, 20, 2, 2, "F");
  doc.setDrawColor(220, 224, 230);
  doc.roundedRect(pageWidth - 68, endY, 56, 20, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(80, 90, 100);
  doc.text("TOTAL PAID", pageWidth - 40, endY + 7, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(47, 128, 80);
  doc.text(fmtCurrency(sale.total), pageWidth - 40, endY + 15, { align: "center" });

  // Receipt Footer
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(110, 120, 130);
  doc.text("Thank you for your business!", pageWidth / 2, pageHeight - 14, { align: "center" });
  doc.text("Goods once sold in good condition are not returnable without this valid receipt.", pageWidth / 2, pageHeight - 9, { align: "center" });

  doc.save(`Receipt-${sale.invoiceNo}.pdf`);
}

/**
 * Export Best-Selling Products Analytics Report to PDF
 */
export function exportBestSellersPDF({ bestSellers, totalRevenue, totalProfit, sortBy = "revenue" }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const totalUnits = (bestSellers || []).reduce((a, b) => a + b.qty, 0);

  const sortLabel = sortBy === "profit" ? "Gross Profit Generated" : sortBy === "qty" ? "Total Units Sold (Volume)" : "Total Revenue (Financial Impact)";
  const subtitle = `Ranked by: ${sortLabel} · Total Products: ${bestSellers.length} · Generated: ${new Date().toLocaleDateString("en-GB")}`;
  addPDFHeader(doc, "Best-Selling Products & Margin Analytics", subtitle);

  const startY = 42;
  const cardW = 42;
  const cardH = 18;
  const kpis = [
    { label: "Total Units Sold", val: `${totalUnits.toLocaleString()} units`, color: [30, 41, 59] },
    { label: "Total Revenue Generated", val: fmtCurrency(totalRevenue), color: [30, 41, 59] },
    { label: "Total Gross Profit", val: fmtCurrency(totalProfit), color: [47, 128, 80] },
    { label: "Average Profit Margin", val: totalRevenue > 0 ? `${Math.round((totalProfit / totalRevenue) * 100)}%` : "0%", color: [193, 80, 47] },
  ];

  kpis.forEach((k, idx) => {
    const x = 14 + idx * (cardW + 4);
    doc.setFillColor(245, 246, 248);
    doc.roundedRect(x, startY, cardW, cardH, 2, 2, "F");
    doc.setDrawColor(220, 224, 230);
    doc.roundedRect(x, startY, cardW, cardH, 2, 2, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(110, 120, 130);
    doc.text(k.label.toUpperCase(), x + cardW / 2, startY + 5.5, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(k.color[0], k.color[1], k.color[2]);
    doc.text(k.val, x + cardW / 2, startY + 13, { align: "center" });
  });

  const sortedList = [...(bestSellers || [])].sort((a, b) => {
    if (sortBy === "profit") return (b.profit || 0) - (a.profit || 0);
    if (sortBy === "qty") return (b.qty || 0) - (a.qty || 0);
    return (b.revenue || 0) - (a.revenue || 0);
  });

  const topMetricVal = sortedList[0] ? (sortBy === "profit" ? sortedList[0].profit : sortBy === "qty" ? sortedList[0].qty : sortedList[0].revenue) || 1 : 1;

  const tableBody = sortedList.map((item, idx) => {
    const metricVal = sortBy === "profit" ? item.profit : sortBy === "qty" ? item.qty : item.revenue;
    const sharePct = topMetricVal > 0 ? Math.round((metricVal / topMetricVal) * 100) : 0;
    const marginPct = item.revenue > 0 ? Math.round((item.profit / item.revenue) * 100) : 0;
    return [
      `#${idx + 1}`,
      item.name,
      item.category || "General",
      `${item.qty.toLocaleString()} units`,
      fmtCurrency(item.revenue),
      fmtCurrency(item.profit),
      `${marginPct}%`,
      `${sharePct}%`
    ];
  });

  autoTable(doc, {
    startY: startY + cardH + 10,
    head: [["Rank", "Product Name", "Category", "Units Sold", "Total Revenue", "Gross Profit", "Margin %", "Share"]],
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [32, 40, 52],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 35, 42],
    },
    alternateRowStyles: {
      fillColor: [248, 249, 251],
    },
    columnStyles: {
      0: { cellWidth: 14, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 50, fontStyle: "bold" },
      2: { cellWidth: 30 },
      3: { cellWidth: 22, halign: "right", fontStyle: sortBy === "qty" ? "bold" : "normal" },
      4: { cellWidth: 28, halign: "right", fontStyle: sortBy === "revenue" ? "bold" : "normal" },
      5: { cellWidth: 28, halign: "right", fontStyle: "bold", textColor: [47, 128, 80] },
      6: { cellWidth: 18, halign: "center" },
      7: { cellWidth: 16, halign: "center" },
    },
    margin: { left: 14, right: 14 },
  });

  addPDFFooter(doc);
  doc.save(`hardwareflow-best-selling-analytics-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Export Audit Log to PDF
 */
export function exportAuditLogPDF({ logs, userFilter = "all", query = "" }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  
  const subtitle = `Filter: User [${userFilter.toUpperCase()}] ${query ? `· Query: "${query}"` : ""} · Total Records: ${logs.length}`;
  addPDFHeader(doc, "System Audit Log Report", subtitle);

  const tableBody = logs.map((log, index) => [
    index + 1,
    log.time || "—",
    log.user || "System",
    log.action || "—",
    log.detail || "—",
  ]);

  autoTable(doc, {
    startY: 42,
    head: [["#", "Timestamp", "User", "Action Description", "Details / Reference"]],
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [32, 40, 52],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 35, 42],
    },
    alternateRowStyles: {
      fillColor: [248, 249, 251],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 32 },
      2: { cellWidth: 26, fontStyle: "bold" },
      3: { cellWidth: 68 },
      4: { cellWidth: "auto" },
    },
    margin: { left: 14, right: 14 },
  });

  addPDFFooter(doc);
  doc.save(`hardwareflow-audit-log-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Export Inventory Stock Report to PDF
 */
export function exportInventoryPDF({ products, suppliers }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  
  const totalStockItems = products.reduce((a, p) => a + Math.max(0, Number(p.stock) || 0), 0);
  const totalStockValue = products.reduce((a, p) => {
    const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
    const buy = Number(p.buyPrice) || 0;
    const unitCost = buy > 0 ? (buy / factor) : (Number(p.sellPrice) || 0);
    return a + Math.max(0, Number(p.stock) || 0) * unitCost;
  }, 0);
  const lowStockCount = products.filter(p => (Number(p.stock) || 0) <= (Number(p.minStock) || 0)).length;

  const subtitle = `Total Products: ${products.length} · Total Units: ${totalStockItems.toLocaleString()} · Low Stock Alerts: ${lowStockCount} · Real-Time Valuation: ${fmtCurrency(totalStockValue)}`;
  addPDFHeader(doc, "Inventory & Stock Valuation Report", subtitle);

  const tableBody = products.map((p, idx) => {
    const supplier = suppliers.find(s => s.id === p.supplierId)?.name || "—";
    const isLow = (Number(p.stock) || 0) <= (Number(p.minStock) || 0);
    const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
    const buy = Number(p.buyPrice) || 0;
    const unitCost = buy > 0 ? (buy / factor) : (Number(p.sellPrice) || 0);
    const lineVal = Math.max(0, Number(p.stock) || 0) * unitCost;

    return [
      idx + 1,
      p.name || "—",
      p.sku || "—",
      p.category || "—",
      `${p.stock} ${p.baseUnit || "pcs"}${isLow ? " (LOW)" : ""}`,
      p.minStock,
      `${fmtCurrency(p.buyPrice)} / ${p.purchaseUnit || p.baseUnit}`,
      fmtCurrency(p.sellPrice),
      fmtCurrency(lineVal),
      supplier,
    ];
  });

  autoTable(doc, {
    startY: 42,
    head: [["#", "Product Name", "SKU", "Category", "Stock", "Min", "Buy Price (Cost)", "Sell Price", "Total Value", "Supplier"]],
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [32, 40, 52],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 35, 42],
    },
    alternateRowStyles: {
      fillColor: [248, 249, 251],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 48, fontStyle: "bold" },
      2: { cellWidth: 22 },
      3: { cellWidth: 25 },
      4: { cellWidth: 26, halign: "right" },
      5: { cellWidth: 14, halign: "center" },
      6: { cellWidth: 32, halign: "right" },
      7: { cellWidth: 26, halign: "right" },
      8: { cellWidth: 30, halign: "right", fontStyle: "bold" },
      9: { cellWidth: "auto" },
    },
    margin: { left: 14, right: 14 },
    didParseCell: function (data) {
      if (data.column.index === 4 && data.cell.raw && data.cell.raw.includes("(LOW)")) {
        data.cell.styles.textColor = [193, 58, 46];
        data.cell.styles.fontStyle = "bold";
      }
    }
  });

  addPDFFooter(doc);
  doc.save(`hardwareflow-inventory-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Export Financial & Performance Report to PDF
 */
export function exportReportCenterPDF({ monthName, revenue, cogs, grossProfit, expenses, netProfit, rankedProducts, debts }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  
  const subtitle = `Period: ${monthName} · Financial Summary & Performance Analysis`;
  addPDFHeader(doc, "Executive Business Performance Report", subtitle);

  // Financial Summary Cards
  const startY = 42;
  const cardW = 34;
  const cardH = 20;
  const gap = 3.5;
  const kpis = [
    { label: "Revenue (Sales)", val: fmtCurrency(revenue), color: [30, 41, 59] },
    { label: "Cost of Goods", val: fmtCurrency(cogs), color: [100, 116, 139] },
    { label: "Gross Profit", val: fmtCurrency(grossProfit), color: [47, 128, 80] },
    { label: "Total Expenses", val: fmtCurrency(expenses), color: [180, 121, 15] },
    { label: netProfit >= 0 ? "Net Profit" : "Net Loss", val: fmtCurrency(netProfit), color: netProfit >= 0 ? [47, 128, 80] : [193, 58, 46] },
  ];

  kpis.forEach((k, idx) => {
    const x = 14 + idx * (cardW + gap);
    doc.setFillColor(245, 246, 248);
    doc.roundedRect(x, startY, cardW, cardH, 2, 2, "F");
    doc.setDrawColor(220, 224, 230);
    doc.roundedRect(x, startY, cardW, cardH, 2, 2, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(110, 120, 130);
    doc.text(k.label.toUpperCase(), x + cardW / 2, startY + 6, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(k.color[0], k.color[1], k.color[2]);
    doc.text(k.val, x + cardW / 2, startY + 14, { align: "center" });
  });

  // Top Products Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(20, 25, 32);
  doc.text("Top Selling & Most Profitable Products", 14, startY + cardH + 8);

  const productRows = (rankedProducts || []).slice(0, 10).map((p, i) => [
    `#${i + 1}`,
    p.name,
    p.qtySold ? `${p.qtySold} units` : "—",
    fmtCurrency(p.sales),
    fmtCurrency(p.profit),
  ]);

  autoTable(doc, {
    startY: startY + cardH + 11,
    head: [["Rank", "Product Name", "Units Sold", "Total Revenue", "Gross Profit"]],
    body: productRows.length > 0 ? productRows : [["—", "No sales recorded this period", "—", "—", "—"]],
    theme: "grid",
    headStyles: { fillColor: [40, 50, 65], fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 7.5, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      1: { cellWidth: 70, fontStyle: "bold" },
      2: { cellWidth: 26, halign: "right" },
      3: { cellWidth: 36, halign: "right" },
      4: { cellWidth: 36, halign: "right", fontStyle: "bold" },
    },
    margin: { left: 14, right: 14 },
    didParseCell: function (data) {
      if (data.column.index === 4 && data.section === "body") {
        data.cell.styles.textColor = [47, 128, 80];
      }
    }
  });

  // Outstanding Customer Debts
  const debtY = doc.lastAutoTable.finalY + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(20, 25, 32);
  doc.text("Outstanding Customer Credit Balances", 14, debtY);

  const debtRows = (debts || []).map((d, i) => [
    i + 1,
    d.name,
    d.phone || "—",
    fmtCurrency(d.creditLimit || 0),
    fmtCurrency(d.balance),
  ]);

  autoTable(doc, {
    startY: debtY + 3,
    head: [["#", "Customer Name", "Phone", "Credit Limit", "Current Balance Due"]],
    body: debtRows.length > 0 ? debtRows : [["—", "No outstanding customer debts", "—", "—", "KSh 0"]],
    theme: "grid",
    headStyles: { fillColor: [55, 65, 80], fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 7.5, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 14, halign: "center" },
      1: { cellWidth: 65, fontStyle: "bold" },
      2: { cellWidth: 35 },
      3: { cellWidth: 34, halign: "right" },
      4: { cellWidth: 34, halign: "right", fontStyle: "bold", textColor: [193, 58, 46] },
    },
    margin: { left: 14, right: 14 },
  });

  addPDFFooter(doc);
  doc.save(`hardwareflow-performance-report-${monthName.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

/**
 * Export Low Stock & Purchase Reorder List PDF
 */
export function exportReorderListPDF(lowStockProducts, suppliers = []) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  
  addPDFHeader(doc, "Low Stock & Purchase Reorder List", `Inventory depletion alerts & recommended vendor reorders as of ${dateStr}`);

  // Summary Metrics Header Card
  const totalItems = lowStockProducts.length;
  const outOfStockCount = lowStockProducts.filter(p => (p.stock || 0) <= 0).length;
  let estimatedTotalCost = 0;

  const rows = lowStockProducts.map((p, idx) => {
    const supp = suppliers.find(s => s.id === p.supplierId);
    const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
    const currentStock = Math.max(0, Number(p.stock) || 0);
    const minStock = Math.max(0, Number(p.minStock) || 0);
    const deficitUnits = Math.max(1, (minStock * 2) - currentStock);
    const recommendedPackages = Math.ceil(deficitUnits / factor);
    const packageCost = Number(p.buyPrice) || 0;
    const estItemCost = recommendedPackages * packageCost;
    estimatedTotalCost += estItemCost;

    return [
      idx + 1,
      `${p.name}\n${p.sku || "No SKU"} · ${p.category || "General"}`,
      `${currentStock} ${p.baseUnit || "pcs"}\n(Min: ${minStock})`,
      `${recommendedPackages} ${p.purchaseUnit || "pkg"}\n(= ${recommendedPackages * factor} ${p.baseUnit || "pcs"})`,
      supp ? `${supp.name}\n${supp.phone || "—"}` : "Unassigned",
      fmtCurrency(packageCost),
      fmtCurrency(estItemCost),
    ];
  });

  const startY = 44;
  doc.setFillColor(245, 247, 250);
  doc.roundedRect(14, startY, doc.internal.pageSize.getWidth() - 28, 16, 2, 2, "F");
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 25, 32);
  doc.text(`Total Low/Out of Stock Items: ${totalItems}  |  Critical (0 Stock): ${outOfStockCount}  |  Est. Reorder Budget: ${fmtCurrency(estimatedTotalCost)}`, 18, startY + 10);

  autoTable(doc, {
    startY: startY + 20,
    head: [["#", "Product / Category", "Current Stock", "Recommended Reorder", "Primary Supplier", "Pack Cost", "Est. Total Cost"]],
    body: rows.length > 0 ? rows : [["—", "All stock levels are healthy. No items below minimum threshold.", "—", "—", "—", "—", "KSh 0"]],
    theme: "grid",
    headStyles: { fillColor: [193, 80, 47], fontSize: 8, fontStyle: "bold" },
    bodyStyles: { fontSize: 7.5, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 48, fontStyle: "bold" },
      2: { cellWidth: 26, halign: "center" },
      3: { cellWidth: 32, halign: "center", fontStyle: "bold" },
      4: { cellWidth: 32 },
      5: { cellWidth: 20, halign: "right" },
      6: { cellWidth: 24, halign: "right", fontStyle: "bold" },
    },
    margin: { left: 14, right: 14 },
    didParseCell: function (data) {
      if (data.column.index === 2 && data.section === "body") {
        const text = String(data.cell.raw || "");
        if (text.startsWith("0 ")) {
          data.cell.styles.textColor = [193, 58, 46];
          data.cell.styles.fontStyle = "bold";
        }
      }
    }
  });

  addPDFFooter(doc);
  doc.save(`hardwareflow-reorder-list-${todayISO(0)}.pdf`);
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Export a Single Customer Price Quotation to PDF (Official Hardware Quotation)
 */
export function exportQuotationPDF({ quote, db }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const cust = db.customers.find(c => c.id === quote.customerId);
  const dateFormatted = niceDate(quote.date);
  const validUntil = niceDate(todayISO(30));

  // Top Header Banner
  doc.setFillColor(20, 23, 29); // #14171D
  doc.rect(0, 0, pageWidth, 28, "F");

  doc.setFillColor(193, 80, 47); // #C1502F Rust Accent
  doc.rect(0, 28, pageWidth, 2.5, "F");

  // Brand Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("HARDWAREFLOW", 14, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(232, 151, 126);
  doc.text("BUILDING MATERIALS & HARDWARE SUPPLIES", 14, 20);

  // Document Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text("OFFICIAL PRICE QUOTATION", pageWidth - 14, 13, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(170, 180, 195);
  const nowTime = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  doc.text(`Generated: ${dateFormatted} at ${nowTime}`, pageWidth - 14, 20, { align: "right" });

  // Metadata Grid Boxes
  const startY = 36;
  const boxW = (pageWidth - 34) / 2;
  const boxH = 28;

  // Box 1: Quotation Details
  doc.setFillColor(248, 249, 251);
  doc.roundedRect(14, startY, boxW, boxH, 2, 2, "F");
  doc.setDrawColor(220, 224, 230);
  doc.roundedRect(14, startY, boxW, boxH, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(110, 120, 130);
  doc.text("QUOTATION DETAILS", 18, startY + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(30, 35, 42);
  doc.text(`Quote Ref: ${quote.number}`, 18, startY + 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 70, 80);
  doc.text(`Issue Date: ${dateFormatted}`, 18, startY + 19);
  doc.text(`Validity: 30 Calendar Days (Until ${validUntil})`, 18, startY + 25);

  // Box 2: Customer / Client Details
  doc.setFillColor(248, 249, 251);
  doc.roundedRect(14 + boxW + 6, startY, boxW, boxH, 2, 2, "F");
  doc.setDrawColor(220, 224, 230);
  doc.roundedRect(14 + boxW + 6, startY, boxW, boxH, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(110, 120, 130);
  doc.text("PREPARED FOR (CLIENT)", 18 + boxW + 6, startY + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 35, 42);
  doc.text(cust ? cust.name : "Walk-in Client / Prospect", 18 + boxW + 6, startY + 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 70, 80);
  doc.text(`Contact: ${cust?.phone || "On Request"}`, 18 + boxW + 6, startY + 19);
  doc.text(`Status: ${(quote.status || "draft").toUpperCase()}`, 18 + boxW + 6, startY + 25);

  // Items Table
  let quoteTotal = 0;
  const tableBody = (quote.items || []).map((it, idx) => {
    const prod = db.products.find(p => p.id === it.productId);
    const qty = Number(it.qty) || 0;
    const unitPrice = Number(it.unitPrice) || prod?.sellPrice || 0;
    const lineTotal = qty * unitPrice;
    quoteTotal += lineTotal;

    return [
      idx + 1,
      prod?.name || "Hardware Item",
      prod?.sku || "—",
      `${qty} ${prod?.baseUnit || "pcs"}`,
      fmtCurrency(unitPrice),
      fmtCurrency(lineTotal),
    ];
  });

  autoTable(doc, {
    startY: startY + boxH + 8,
    head: [["#", "Item Description & Specification", "SKU / Code", "Quantity", "Unit Price", "Line Total"]],
    body: tableBody.length > 0 ? tableBody : [["—", "No items added to quotation", "—", "—", "—", "KSh 0"]],
    theme: "grid",
    headStyles: {
      fillColor: [32, 40, 52],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 35, 42],
    },
    alternateRowStyles: {
      fillColor: [248, 249, 251],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: "auto", fontStyle: "bold" },
      2: { cellWidth: 26 },
      3: { cellWidth: 26, halign: "right" },
      4: { cellWidth: 32, halign: "right" },
      5: { cellWidth: 34, halign: "right", fontStyle: "bold", textColor: [30, 41, 59] },
    },
    margin: { left: 14, right: 14 },
  });

  // Quotation Total Card
  const tableEndY = doc.lastAutoTable.finalY + 6;
  const totalBoxW = 75;
  const totalBoxH = 22;

  doc.setFillColor(245, 247, 250);
  doc.roundedRect(pageWidth - 14 - totalBoxW, tableEndY, totalBoxW, totalBoxH, 2, 2, "F");
  doc.setDrawColor(220, 224, 230);
  doc.roundedRect(pageWidth - 14 - totalBoxW, tableEndY, totalBoxW, totalBoxH, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(110, 120, 130);
  doc.text("TOTAL ESTIMATED VALUE", pageWidth - 14 - totalBoxW / 2, tableEndY + 7, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(47, 128, 80);
  doc.text(fmtCurrency(quoteTotal), pageWidth - 14 - totalBoxW / 2, tableEndY + 16, { align: "center" });

  // Terms & Payment Details Box
  const termsY = tableEndY + totalBoxH + 8;
  doc.setFillColor(252, 253, 254);
  doc.roundedRect(14, termsY, pageWidth - 28, 30, 2, 2, "F");
  doc.setDrawColor(228, 230, 234);
  doc.roundedRect(14, termsY, pageWidth - 28, 30, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(193, 80, 47);
  doc.text("PAYMENT METHODS & COMMERCIAL TERMS:", 18, termsY + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(70, 80, 90);
  doc.text("1. Accepted Payment: Cash, Direct Bank Transfer (EFT/RTGS), and Official M-Pesa Till / Paybill.", 18, termsY + 12);
  doc.text("2. Bank Details: Equity Bank / KCB Bank · Account Name: HardwareFlow Enterprises · Acc: 01100223344", 18, termsY + 17);
  doc.text("3. Delivery / Dispatch: Available on request across site locations. Offloading terms apply.", 18, termsY + 22);
  doc.text("4. Pricing Validity: Prices are guaranteed for 30 calendar days from issue date.", 18, termsY + 27);

  // Signature Block
  const sigY = pageHeight - 34;
  doc.setDrawColor(180, 185, 195);
  doc.line(14, sigY, 70, sigY);
  doc.line(pageWidth - 70, sigY, pageWidth - 14, sigY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(90, 100, 110);
  doc.text("Prepared By: Store Sales Desk", 14, sigY + 5);
  doc.text("Client Confirmation Signature", pageWidth - 70, sigY + 5);

  addPDFFooter(doc);
  doc.save(`Quotation-${quote.number}.pdf`);
}

/**
 * Export Quotations Register / Summary List to PDF
 */
export function exportQuotationsListPDF({ quotations, db, filterInfo = "" }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const count = (quotations || []).length;
  const totalValue = (quotations || []).reduce((acc, q) => {
    const qSum = (q.items || []).reduce((a, i) => a + (Number(i.unitPrice) || 0) * (Number(i.qty) || 0), 0);
    return acc + qSum;
  }, 0);

  const convertedCount = (quotations || []).filter(q => q.status === "converted").length;
  const draftCount = count - convertedCount;

  const subtitle = `Summary of Quotes · Total Quotes: ${count} · Converted: ${convertedCount} · Draft: ${draftCount} · Pipeline Value: ${fmtCurrency(totalValue)}${filterInfo ? ` · Filter: ${filterInfo}` : ""}`;
  addPDFHeader(doc, "Quotations Register & Pipeline Report", subtitle);

  const tableBody = (quotations || []).map((q, idx) => {
    const cust = db.customers.find(c => c.id === q.customerId);
    const qSum = (q.items || []).reduce((a, i) => a + (Number(i.unitPrice) || 0) * (Number(i.qty) || 0), 0);
    const itemsCount = (q.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);

    return [
      idx + 1,
      q.number || "—",
      niceDate(q.date),
      cust ? cust.name : "Walk-in Prospect",
      cust?.phone || "—",
      `${(q.items || []).length} items (${itemsCount} pcs)`,
      fmtCurrency(qSum),
      (q.status || "draft").toUpperCase(),
    ];
  });

  autoTable(doc, {
    startY: 42,
    head: [["#", "Quote Ref", "Date", "Customer Name", "Phone", "Items / Quantity", "Quoted Value", "Status"]],
    body: tableBody.length > 0 ? tableBody : [["—", "No quotations found matching criteria", "—", "—", "—", "—", "KSh 0", "—"]],
    theme: "grid",
    headStyles: {
      fillColor: [32, 40, 52],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 35, 42],
    },
    alternateRowStyles: {
      fillColor: [248, 249, 251],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 26, fontStyle: "bold" },
      2: { cellWidth: 24 },
      3: { cellWidth: 42, fontStyle: "bold" },
      4: { cellWidth: 26 },
      5: { cellWidth: 30 },
      6: { cellWidth: 28, halign: "right", fontStyle: "bold", textColor: [47, 128, 80] },
      7: { cellWidth: 22, halign: "center" },
    },
    margin: { left: 14, right: 14 },
    didParseCell: function (data) {
      if (data.column.index === 7 && data.section === "body") {
        const val = String(data.cell.raw || "");
        if (val === "CONVERTED") {
          data.cell.styles.textColor = [47, 128, 80];
          data.cell.styles.fontStyle = "bold";
        }
      }
    }
  });

  addPDFFooter(doc);
  doc.save(`Quotations-Register-${todayISO(0)}.pdf`);
}

/**
 * Export Official Customer Supply / Commercial Tax Invoice PDF
 * Supports single and multi-item purchases, custom/auto invoice numbers, bank transfer details
 */
export function exportInvoicePDF({ sale, db, customInvoiceNo = null }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const resolvedInvoiceNo = customInvoiceNo || sale.invoiceNo || `INV-${todayISO(0)}`;
  const cust = db.customers.find(c => c.id === sale.customerId);
  const dateFormatted = niceDate(sale.date);
  const timeFormatted = sale.time || new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const paymentLabel = sale.payment === "mpesa" ? "M-PESA" 
    : sale.payment === "bank" ? "BANK TRANSFER (PAID)"
    : sale.payment === "credit" ? "CREDIT / ON ACCOUNT"
    : sale.payment === "split" ? `SPLIT (Cash ${fmtCurrency(sale.splitCash || 0)} + M-Pesa)`
    : "CASH ON COUNTER";

  // Top Header Banner
  doc.setFillColor(20, 23, 29); // #14171D
  doc.rect(0, 0, pageWidth, 28, "F");

  doc.setFillColor(193, 80, 47); // #C1502F
  doc.rect(0, 28, pageWidth, 2.5, "F");

  // Company Brand
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("HARDWAREFLOW", 14, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(232, 151, 126);
  doc.text("BUILDING MATERIALS, HARDWARE & ELECTRICAL SUPPLIES", 14, 20);

  // Invoice Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text("TAX / COMMERCIAL INVOICE", pageWidth - 14, 13, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(170, 180, 195);
  doc.text("ORIGINAL SUPPLY DOCUMENT", pageWidth - 14, 20, { align: "right" });

  // Metadata Grid Boxes
  const startY = 36;
  const boxW = (pageWidth - 34) / 2;
  const boxH = 28;

  // Box 1: Invoice & Payment Information
  doc.setFillColor(248, 249, 251);
  doc.roundedRect(14, startY, boxW, boxH, 2, 2, "F");
  doc.setDrawColor(220, 224, 230);
  doc.roundedRect(14, startY, boxW, boxH, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(110, 120, 130);
  doc.text("INVOICE METADATA", 18, startY + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(30, 35, 42);
  doc.text(`Invoice No: ${resolvedInvoiceNo}`, 18, startY + 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 70, 80);
  doc.text(`Date & Time: ${dateFormatted} · ${timeFormatted}`, 18, startY + 19);
  doc.text(`Payment Mode: ${paymentLabel}`, 18, startY + 25);

  // Box 2: Billed To / Customer Details
  doc.setFillColor(248, 249, 251);
  doc.roundedRect(14 + boxW + 6, startY, boxW, boxH, 2, 2, "F");
  doc.setDrawColor(220, 224, 230);
  doc.roundedRect(14 + boxW + 6, startY, boxW, boxH, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(110, 120, 130);
  doc.text("BILLED TO / CUSTOMER", 18 + boxW + 6, startY + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 35, 42);
  doc.text(cust ? cust.name : "Walk-in Cash Customer", 18 + boxW + 6, startY + 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 70, 80);
  doc.text(`Phone / Mobile: ${cust?.phone || "Not Recorded"}`, 18 + boxW + 6, startY + 19);
  doc.text(`Served By: ${sale.employee || "Cashier"}`, 18 + boxW + 6, startY + 25);

  // Items Table
  const tableBody = (sale.items || []).map((it, idx) => {
    const prod = db.products.find(p => p.id === it.productId);
    const qty = Number(it.qty) || 0;
    const unitPrice = Number(it.unitPrice) || 0;
    const lineTotal = qty * unitPrice;

    return [
      idx + 1,
      prod?.name || "Product Item",
      prod?.sku || "—",
      `${qty} ${prod?.baseUnit || "pcs"}`,
      fmtCurrency(unitPrice),
      fmtCurrency(lineTotal),
    ];
  });

  autoTable(doc, {
    startY: startY + boxH + 8,
    head: [["#", "Supplied Item Description", "SKU / Code", "Quantity", "Unit Price", "Total Amount"]],
    body: tableBody.length > 0 ? tableBody : [["—", "No items recorded", "—", "—", "—", "KSh 0"]],
    theme: "grid",
    headStyles: {
      fillColor: [32, 40, 52],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 35, 42],
    },
    alternateRowStyles: {
      fillColor: [248, 249, 251],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: "auto", fontStyle: "bold" },
      2: { cellWidth: 26 },
      3: { cellWidth: 26, halign: "right" },
      4: { cellWidth: 32, halign: "right" },
      5: { cellWidth: 34, halign: "right", fontStyle: "bold", textColor: [30, 41, 59] },
    },
    margin: { left: 14, right: 14 },
  });

  // Total Summary Card
  const tableEndY = doc.lastAutoTable.finalY + 6;
  const totalBoxW = 75;
  const totalBoxH = 22;

  doc.setFillColor(245, 247, 250);
  doc.roundedRect(pageWidth - 14 - totalBoxW, tableEndY, totalBoxW, totalBoxH, 2, 2, "F");
  doc.setDrawColor(220, 224, 230);
  doc.roundedRect(pageWidth - 14 - totalBoxW, tableEndY, totalBoxW, totalBoxH, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(110, 120, 130);
  doc.text("TOTAL INVOICE AMOUNT", pageWidth - 14 - totalBoxW / 2, tableEndY + 7, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(47, 128, 80);
  doc.text(fmtCurrency(sale.total), pageWidth - 14 - totalBoxW / 2, tableEndY + 16, { align: "center" });

  // Bank & Settlement Instructions Box
  const termsY = tableEndY + totalBoxH + 8;
  doc.setFillColor(252, 253, 254);
  doc.roundedRect(14, termsY, pageWidth - 28, 28, 2, 2, "F");
  doc.setDrawColor(228, 230, 234);
  doc.roundedRect(14, termsY, pageWidth - 28, 28, 2, 2, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(193, 80, 47);
  doc.text("BANK TRANSFER & PAYMENT SETTLEMENT INSTRUCTIONS:", 18, termsY + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(70, 80, 90);
  doc.text("• Bank Account: Equity Bank / KCB Bank · Acc No: 01100223344 · Name: HardwareFlow Store", 18, termsY + 12);
  doc.text("• M-Pesa Paybill: 888999 · Account: Use Invoice No (" + resolvedInvoiceNo + ")", 18, termsY + 17);
  doc.text("• Goods once supplied in good order & accepted are not returnable without prior authorization.", 18, termsY + 22);

  // Signatures
  const sigY = pageHeight - 34;
  doc.setDrawColor(180, 185, 195);
  doc.line(14, sigY, 70, sigY);
  doc.line(pageWidth - 70, sigY, pageWidth - 14, sigY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(90, 100, 110);
  doc.text("Issued By: HardwareFlow Store", 14, sigY + 5);
  doc.text("Customer Goods Received & Stamp", pageWidth - 70, sigY + 5);

  addPDFFooter(doc);
  doc.save(`Invoice-${resolvedInvoiceNo}.pdf`);
}

