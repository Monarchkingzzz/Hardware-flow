import * as XLSX from "xlsx";

/**
 * Standard Hardware Template columns and sample records
 */
export const TEMPLATE_COLUMNS = [
  "Product Name",
  "Category",
  "Unit",
  "Cost Price",
  "Retail Price",
  "Contractor Price",
  "Wholesale Price",
  "Opening Stock",
  "Reorder Level",
  "Brand",
  "Location",
  "SKU",
  "Description",
];

export const SAMPLE_PRODUCTS = [
  {
    "Product Name": "Cement 50kg",
    "Category": "Cement & Building",
    "Unit": "bag",
    "Cost Price": 650,
    "Retail Price": 780,
    "Contractor Price": 750,
    "Wholesale Price": 730,
    "Opening Stock": 200,
    "Reorder Level": 20,
    "Brand": "Bamburi",
    "Location": "Main Store",
    "SKU": "CEM-001",
    "Description": "Portland all-purpose building cement for masonry & concrete work.",
  },
  {
    "Product Name": "PVC Pipe 4-inch",
    "Category": "Plumbing",
    "Unit": "piece",
    "Cost Price": 180,
    "Retail Price": 250,
    "Contractor Price": 230,
    "Wholesale Price": 220,
    "Opening Stock": 100,
    "Reorder Level": 15,
    "Brand": "Kenpipe",
    "Location": "Yard",
    "SKU": "PVC-004",
    "Description": "Heavy duty underground drainage and waste water PVC pipe (6m length).",
  },
  {
    "Product Name": "Electrical Cable 2.5mm",
    "Category": "Electrical",
    "Unit": "metre",
    "Cost Price": 85,
    "Retail Price": 110,
    "Contractor Price": 100,
    "Wholesale Price": 95,
    "Opening Stock": 385,
    "Reorder Level": 200,
    "Brand": "Doone",
    "Location": "Main Store",
    "SKU": "ELEC-010",
    "Description": "Single core pure copper conduit wiring cable (100m roll).",
  },
  {
    "Product Name": "Nails 4-inch",
    "Category": "Fasteners & Hardware",
    "Unit": "kg",
    "Cost Price": 120,
    "Retail Price": 150,
    "Contractor Price": 145,
    "Wholesale Price": 135,
    "Opening Stock": 50,
    "Reorder Level": 15,
    "Brand": "SteelCo",
    "Location": "Store",
    "SKU": "NAIL-004",
    "Description": "Timber construction wire nails for roofing & formwork.",
  },
  {
    "Product Name": "Gloss Paint 4L",
    "Category": "Paint & Finishes",
    "Unit": "tin",
    "Cost Price": 1000,
    "Retail Price": 1450,
    "Contractor Price": 1380,
    "Wholesale Price": 1300,
    "Opening Stock": 24,
    "Reorder Level": 8,
    "Brand": "Crown",
    "Location": "Shop",
    "SKU": "PNT-004",
    "Description": "Brilliant white super gloss oil paint for wood & metal.",
  },
];

/**
 * Generate and download an Excel (.xlsx) product import template.
 */
export function downloadExcelTemplate() {
  const ws = XLSX.utils.json_to_sheet(SAMPLE_PRODUCTS, { header: TEMPLATE_COLUMNS });
  
  // Set column widths for clean viewing in Excel
  ws["!cols"] = [
    { wch: 25 }, // Product Name
    { wch: 20 }, // Category
    { wch: 10 }, // Unit
    { wch: 12 }, // Cost Price
    { wch: 12 }, // Retail Price
    { wch: 15 }, // Contractor Price
    { wch: 15 }, // Wholesale Price
    { wch: 14 }, // Opening Stock
    { wch: 14 }, // Reorder Level
    { wch: 15 }, // Brand
    { wch: 14 }, // Location
    { wch: 12 }, // SKU
    { wch: 40 }, // Description
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products Template");
  XLSX.writeFile(wb, "HardwareFlow_Product_Import_Template.xlsx");
}

/**
 * Generate and download a CSV (.csv) product import template.
 */
export function downloadCSVTemplate() {
  const ws = XLSX.utils.json_to_sheet(SAMPLE_PRODUCTS, { header: TEMPLATE_COLUMNS });
  const csvContent = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "HardwareFlow_Product_Import_Template.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Normalize header names to handle variations in user spreadsheets.
 */
function normalizeHeaderKey(key) {
  const clean = String(key || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  
  if (/^(productname|name|itemname|item|product|descriptionname)$/.test(clean)) return "name";
  if (/^(category|dept|department|group|section)$/.test(clean)) return "category";
  if (/^(unit|baseunit|uom|measure|measurement)$/.test(clean)) return "baseUnit";
  if (/^(costprice|cost|buyprice|buyingprice|unitcost|purchaseprice|bp)$/.test(clean)) return "buyPrice";
  if (/^(retailprice|retail|sellprice|sellingprice|price|sp|normalprice)$/.test(clean)) return "sellPrice";
  if (/^(contractorprice|contractor|builderprice|contractors)$/.test(clean)) return "contractorPrice";
  if (/^(wholesaleprice|wholesale|bulkprice|wholesaler)$/.test(clean)) return "wholesalePrice";
  if (/^(openingstock|stock|initialstock|startingstock|qty|quantity|count|onhand)$/.test(clean)) return "stock";
  if (/^(reorderlevel|reorder|minstock|minimumstock|alertlevel|minlevel|threshold)$/.test(clean)) return "minStock";
  if (/^(brand|maker|manufacturer)$/.test(clean)) return "brand";
  if (/^(sku|code|barcode|itemcode|productcode)$/.test(clean)) return "sku";
  if (/^(location|store|storage|shelf|aisle|yard)$/.test(clean)) return "location";
  if (/^(description|desc|notes|details|info)$/.test(clean)) return "description";

  return null;
}

/**
 * Parse an Excel (.xlsx, .xls) or CSV file into valid HardwareFlow products.
 */
export async function parseProductFile(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("The uploaded file does not contain any sheets.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  if (!rawRows || rawRows.length === 0) {
    throw new Error("No data rows found in the uploaded file. Please ensure the file contains a header row and product records.");
  }

  const parsedProducts = [];
  const errors = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for 0-index, +1 for header
    const normalized = {};

    // Map each cell to normalized product field
    Object.keys(row).forEach(rawKey => {
      const normKey = normalizeHeaderKey(rawKey);
      if (normKey) {
        normalized[normKey] = row[rawKey];
      }
    });

    const name = String(normalized.name || "").trim();
    if (!name) {
      // Empty row or missing required product name
      return;
    }

    const buyPrice = Math.max(0, Number(normalized.buyPrice) || 0);
    const sellPrice = Math.max(0, Number(normalized.sellPrice) || 0);
    const contractorPrice = Math.max(0, Number(normalized.contractorPrice) || (sellPrice > 0 ? sellPrice : buyPrice));
    const wholesalePrice = Math.max(0, Number(normalized.wholesalePrice) || (sellPrice > 0 ? sellPrice : buyPrice));
    const stock = Math.max(0, Number(normalized.stock) || 0);
    const minStock = Math.max(0, Number(normalized.minStock) || 10);
    const category = String(normalized.category || "General").trim() || "General";
    const baseUnit = String(normalized.baseUnit || "piece").trim() || "piece";
    const brand = String(normalized.brand || "").trim();
    const sku = String(normalized.sku || "").trim();
    const location = String(normalized.location || "Main Store").trim() || "Main Store";
    const description = String(normalized.description || "").trim();

    if (sellPrice <= 0 && buyPrice <= 0) {
      errors.push(`Row ${rowNumber} ("${name}") has no valid selling or buying price.`);
    }

    parsedProducts.push({
      _rowNumber: rowNumber,
      name,
      category,
      brand,
      sku,
      description,
      baseUnit,
      purchaseUnit: baseUnit,
      conversionFactor: 1,
      buyPrice,
      sellPrice: sellPrice > 0 ? sellPrice : (buyPrice > 0 ? Math.round(buyPrice * 1.2) : 0),
      contractorPrice,
      wholesalePrice,
      minStock,
      stock,
      location,
      isValid: name.length > 0 && (sellPrice > 0 || buyPrice > 0),
    });
  });

  return {
    filename: file.name,
    totalRows: parsedProducts.length,
    validRows: parsedProducts.filter(p => p.isValid),
    invalidRows: parsedProducts.filter(p => !p.isValid),
    errors,
  };
}
