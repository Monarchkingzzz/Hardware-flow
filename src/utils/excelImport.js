import * as XLSX from "xlsx";

/**
 * HardwareFlow Canonical Field Specifications
 */
export const CANONICAL_FIELDS = [
  { key: "name", label: "Product Name", required: true, desc: "Main product title or item description", example: "Cement 50kg, PVC Pipe 4-inch" },
  { key: "sellPrice", label: "Retail / Selling Price", required: true, desc: "Price charged to regular retail customers (KSh)", example: "780, KSh 1,250" },
  { key: "buyPrice", label: "Cost / Buying Price", required: false, desc: "Cost paid to supplier per unit/package (KSh)", example: "650, KSh 1,000" },
  { key: "stock", label: "Opening Stock (Qty)", required: false, desc: "Current quantity on hand in shop or store", example: "50, 200, 1000" },
  { key: "category", label: "Category / Department", required: false, desc: "Product department or group", example: "Cement, Plumbing, Electrical, Paint" },
  { key: "baseUnit", label: "Unit of Measure (UOM)", required: false, desc: "How it is measured or sold to customers", example: "piece, bag, kg, metre, tin, roll" },
  { key: "minStock", label: "Reorder Level (Min Alert)", required: false, desc: "Minimum stock threshold before alert triggers", example: "10, 20, 5" },
  { key: "contractorPrice", label: "Contractor Price", required: false, desc: "Special discounted price for builders/contractors", example: "750, 1200" },
  { key: "wholesalePrice", label: "Bulk / Wholesale Price", required: false, desc: "Discounted price for bulk wholesale orders", example: "730, 1150" },
  { key: "sku", label: "Item Code / SKU / Barcode", required: false, desc: "Stock code or manufacturer barcode", example: "CEM-001, ELEC-010" },
  { key: "brand", label: "Brand / Manufacturer", required: false, desc: "Product maker or brand name", example: "Bamburi, Crown, Kenpipe, SteelCo" },
  { key: "location", label: "Storage Location", required: false, desc: "Storage bin, yard, shelf or shop aisle", example: "Main Store, Yard, Shelf B" },
  { key: "description", label: "Description / Notes", required: false, desc: "Additional specifications or notes", example: "Portland cement for masonry" },
  { key: "supplier", label: "Supplier Name", required: false, desc: "Name of the supplier who distributes this item", example: "Bamburi Ltd, Doone" },
];

/**
 * Standard Hardware Template sample records
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
  ws["!cols"] = [
    { wch: 25 },
    { wch: 20 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 14 },
    { wch: 14 },
    { wch: 15 },
    { wch: 14 },
    { wch: 12 },
    { wch: 40 },
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
 * Comprehensive Synonym & Pattern Dictionary for Field Detection
 */
const SYNONYMS_DICTIONARY = {
  name: [
    /^(product(\s*name)?|item(\s*name)?|item(\s*description)?|description|product(\s*description)?|stock(\s*item)?|material|particulars|item\s*desc|prod\s*name|article|goods|product\s*details|item\s*title|item|desc)$/i,
    /(product|item|particulars|material|goods|article|stock\s*item)/i
  ],
  buyPrice: [
    /^(cost(\s*price)?|buying(\s*price)?|buy(\s*price)?|purchase(\s*price)?|purchase(\s*cost)?|buying(\s*rate)?|buy(\s*rate)?|unit\s*cost|b\.?p\.?|cost\s*rate|purchase\s*rate|c\.?p\.?|in\s*price|supplier\s*price|dealer\s*price|cost)$/i,
    /(buying|purchase|buy\s*price|cost\s*price|unit\s*cost)/i
  ],
  sellPrice: [
    /^(retail(\s*price)?|selling(\s*price)?|sell(\s*price)?|sales(\s*price)?|selling(\s*rate)?|sell(\s*rate)?|unit\s*selling\s*price|s\.?price|s\.?p\.?|retail|price|sales\s*rate|out\s*price|mrp|sale\s*price|unit\s*price|rate)$/i,
    /(selling|retail|sales\s*price|sell\s*price|unit\s*price)/i
  ],
  contractorPrice: [
    /^(contractor(\s*price)?|builder(\s*price)?|builder(\s*rate)?|builders|trade(\s*price)?|contractors|contractor\s*rate)$/i,
    /(contractor|builder|trade\s*price)/i
  ],
  wholesalePrice: [
    /^(wholesale(\s*price)?|wholesale|bulk(\s*price)?|bulk(\s*rate)?|wholesaler|ws\s*price|distributor\s*price|wholesale\s*rate)$/i,
    /(wholesale|bulk\s*price|distributor)/i
  ],
  stock: [
    /^(opening(\s*stock)?|stock|qty|quantity|current(\s*stock)?|available(\s*stock)?|balance|closing(\s*stock)?|stock\s*balance|on\s*hand|units\s*in\s*stock|physical\s*stock|total\s*qty|inventory|bal|stock\s*qty|qty\s*on\s*hand|qoh)$/i,
    /(opening\s*stock|current\s*stock|qty\s*on\s*hand|physical\s*stock|available\s*stock|stock\s*balance)/i
  ],
  category: [
    /^(category|dept|department|group|product\s*group|item\s*group|section|class|classification|family|type|cat|dept\s*\/?\s*category|dept\s*\/?\s*cat)$/i,
    /(category|department|dept|group|section)/i
  ],
  baseUnit: [
    /^(unit|units|base\s*unit|uom|unit\s*of\s*measure|measure|measurement|pack|packaging|package|pkg|packing|unit\s*\/?\s*spec|unit\s*\/?\s*specification)$/i,
    /(unit|uom|measure|pack|packaging|specification)/i
  ],
  minStock: [
    /^(reorder(\s*level)?|reorder|reorder\s*point|min(\s*stock)?|minimum(\s*stock)?|alert(\s*level)?|min(\s*level)?|threshold|minimum\s*qty|min\s*qty|safety\s*stock|rol)$/i,
    /(reorder|min\s*stock|alert\s*level|threshold|safety\s*stock)/i
  ],
  sku: [
    /^(sku|code|item\s*code|product\s*code|barcode|stock\s*no|stock\s*code|part\s*no|part\s*number|ref|reference|item\s*no|stock\s*code)$/i,
    /(sku|barcode|item\s*code|product\s*code|stock\s*no|stock\s*code)/i
  ],
  brand: [
    /^(brand|maker|manufacturer|mfg|make|producer)$/i,
    /(brand|maker|manufacturer)/i
  ],
  location: [
    /^(location|store|storage|shelf|aisle|yard|bin|bin\s*number|rack|warehouse)$/i,
    /(location|shelf|yard|aisle|bin|storage)/i
  ],
  description: [
    /^(description|details|specs|specification|notes|remarks|comment|info)$/i,
    /(description|details|specs|notes|remarks)/i
  ],
  supplier: [
    /^(supplier|vendor|source|supplier\s*name|distributor)$/i,
    /(supplier|vendor|distributor)/i
  ],
};

/**
 * Inspect an uploaded file and extract sheets with 2D grid matrix
 */
export async function inspectWorkbook(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error("The uploaded file does not contain any sheets.");
  }

  const sheetsData = workbook.SheetNames.map(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    // Read raw 2D array matrix including empty cells
    const rawGrid = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    const headerInfo = detectHeaderRow(rawGrid);

    return {
      sheetName,
      rawGrid,
      headerRowIndex: headerInfo.headerRowIndex,
      headers: headerInfo.headers,
      dataRows: headerInfo.dataRows,
      dataRowsCount: headerInfo.dataRows.length,
      sampleRows: headerInfo.dataRows.slice(0, 5),
    };
  });

  return {
    filename: file.name,
    sheetNames: workbook.SheetNames,
    sheetsData,
  };
}

/**
 * Smart Header Row Detection
 * Scans the first 25 rows to identify the real column headers while ignoring title rows and banners.
 */
export function detectHeaderRow(rawGrid) {
  if (!rawGrid || rawGrid.length === 0) {
    return { headerRowIndex: 0, headers: [], dataRows: [] };
  }

  const maxScan = Math.min(25, rawGrid.length);
  let bestRowIndex = 0;
  let highestScore = -1;

  for (let r = 0; r < maxScan; r++) {
    const row = rawGrid[r] || [];
    const nonBlankCells = row.map(c => String(c || "").trim()).filter(Boolean);

    if (nonBlankCells.length === 0) continue;

    // Calculate row header characteristics
    let synonymMatches = 0;
    let textCellCount = 0;
    let numericCellCount = 0;

    nonBlankCells.forEach(cellStr => {
      // Is numeric or price?
      if (/^[\d,.\s/KShKES$=-]+$/.test(cellStr) && /\d/.test(cellStr)) {
        numericCellCount++;
      } else {
        textCellCount++;
      }

      // Check if it matches any header synonym
      const clean = cellStr.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const field of Object.keys(SYNONYMS_DICTIONARY)) {
        const [exactRegex] = SYNONYMS_DICTIONARY[field];
        if (exactRegex.test(cellStr) || exactRegex.test(clean)) {
          synonymMatches++;
          break;
        }
      }
    });

    // Scoring:
    // +5 points per recognized header synonym
    // +1.5 points per text cell
    // -2 points if row is mostly numeric (likely a data row)
    // -8 points if single cell banner row (e.g. "ABC HARDWARE LTD")
    let score = (synonymMatches * 5) + (textCellCount * 1.5) - (numericCellCount * 2);
    if (nonBlankCells.length <= 1) score -= 8;

    if (score > highestScore) {
      highestScore = score;
      bestRowIndex = r;
    }
  }

  // Extract detected headers
  const headerRow = (rawGrid[bestRowIndex] || []).map((h, colIdx) => {
    const val = String(h || "").trim();
    return val || `Column_${colIdx + 1}`;
  });

  // Extract subsequent data rows (filter out empty rows or summary/total rows)
  const dataRows = [];
  for (let r = bestRowIndex + 1; r < rawGrid.length; r++) {
    const row = rawGrid[r] || [];
    const hasValues = row.some(cell => String(cell || "").trim() !== "");
    if (!hasValues) continue;

    // Check if it's a summary row (e.g. "Total", "Grand Total")
    const firstCell = String(row[0] || "").trim().toLowerCase();
    if (/^(total|grand total|subtotal|sum|summary)/.test(firstCell)) continue;

    dataRows.push(row);
  }

  return {
    headerRowIndex: bestRowIndex,
    headers: headerRow,
    dataRows,
  };
}

/**
 * Context & Data-Driven Column Mapping & Confidence Analyzer
 */
export function analyzeColumnsAndSuggestMapping(headers = [], sampleRows = []) {
  const suggestions = [];

  // First Pass: Direct Synonym Pattern Matching with Confidence
  headers.forEach((header, colIdx) => {
    const rawHeader = String(header || "").trim();
    const clean = rawHeader.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Get sample non-empty values for this column
    const sampleValues = sampleRows
      .map(r => r[colIdx])
      .filter(v => v !== undefined && v !== null && String(v).trim() !== "")
      .slice(0, 4)
      .map(v => String(v).trim());

    let bestMatch = null;
    let confidence = 0;

    for (const [fieldKey, patterns] of Object.entries(SYNONYMS_DICTIONARY)) {
      const [exactRegex, broadRegex] = patterns;

      if (exactRegex.test(rawHeader) || exactRegex.test(clean)) {
        bestMatch = fieldKey;
        confidence = 98;
        break;
      } else if (broadRegex.test(rawHeader) && confidence < 75) {
        bestMatch = fieldKey;
        confidence = 75;
      }
    }

    // Check if header or data looks like a date/time (e.g. Last Count, Date, 2026-08-23)
    const isDateHeader = /date|time|last\s*count|counted|updated|created|expiry|timestamp/i.test(rawHeader);
    const isDateValue = sampleValues.some(v => /^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(v));

    if (isDateHeader || isDateValue) {
      bestMatch = null;
      confidence = 0;
    } else {
      // Inspect data context
      if (sampleValues.length > 0) {
        const allNumbers = sampleValues.every(v => /^[\d,.\s/KShKES$=-]+$/.test(v) && /\d/.test(v));
        const hasCurrency = sampleValues.some(v => /(ksh|kes|\/=|\$)/i.test(v));
        const looksLikeUnit = sampleValues.some(v => /^(pcs|piece|pieces|bag|bags|kg|kgs|metre|metres|m|tin|tins|roll|rolls|box|carton|ctn|pair|set)$/i.test(v));

        if (looksLikeUnit && (!bestMatch || confidence < 90)) {
          bestMatch = "baseUnit";
          confidence = 92;
        } else if (hasCurrency && (!bestMatch || bestMatch === "name")) {
          bestMatch = "sellPrice";
          confidence = 88;
        } else if (!bestMatch && allNumbers) {
          // Numeric column without obvious header
          if (/price|rate|amt|amount/i.test(rawHeader)) {
            bestMatch = "sellPrice";
            confidence = 80;
          } else if (/qty|count|bal|stock/i.test(rawHeader)) {
            bestMatch = "stock";
            confidence = 80;
          }
        }
      }
    }

    suggestions.push({
      columnIndex: colIdx,
      originalHeader: rawHeader,
      suggestedField: bestMatch,
      confidence: confidence || (bestMatch ? 60 : 0),
      sampleValues,
    });
  });

  // Second Pass: Disambiguation & Conflict Resolution
  // 1. If multiple columns mapped to 'sellPrice' or 'buyPrice', disambiguate:
  const priceCols = suggestions.filter(s => s.suggestedField === "sellPrice" || s.suggestedField === "buyPrice");
  if (priceCols.length > 1) {
    priceCols.forEach(col => {
      const h = col.originalHeader.toLowerCase();
      if (/cost|buy|purchase|bp|c\.p/i.test(h)) {
        col.suggestedField = "buyPrice";
        col.confidence = 97;
      } else if (/sell|retail|sale|sp|s\.p|mrp/i.test(h)) {
        col.suggestedField = "sellPrice";
        col.confidence = 99;
      } else if (/rate|price/i.test(h)) {
        // If another col is cost, this rate is sellPrice
        const hasCost = priceCols.some(p => /cost|buy|purchase/i.test(p.originalHeader));
        if (hasCost) {
          col.suggestedField = "sellPrice";
          col.confidence = 95;
        }
      }
    });
  }

  // 2. Prevent duplicate assignments for single-instance fields (stock, sku, category, minStock)
  const singleFields = ["stock", "sku", "category", "minStock", "name", "baseUnit"];
  singleFields.forEach(fieldKey => {
    const matchingCols = suggestions.filter(s => s.suggestedField === fieldKey);
    if (matchingCols.length > 1) {
      // Sort by confidence descending
      matchingCols.sort((a, b) => b.confidence - a.confidence);
      // Keep first, reset the rest to null / skip
      for (let i = 1; i < matchingCols.length; i++) {
        matchingCols[i].suggestedField = null;
        matchingCols[i].confidence = 0;
      }
    }
  });

  // 3. If 'name' is missing, look for description column
  const hasName = suggestions.some(s => s.suggestedField === "name");
  if (!hasName) {
    const descCol = suggestions.find(s => s.suggestedField === "description" || /desc|particulars|item|material/i.test(s.originalHeader));
    if (descCol) {
      descCol.suggestedField = "name";
      descCol.confidence = 95;
    }
  }

  return suggestions;
}

/**
 * Resilient Normalization Functions
 */

// Price Normalizer (handles "KSh 650", "KES 1,250/=", "650.00", "1,250", etc.)
export function normalizePrice(val, fallback = 0) {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "number") return Math.max(0, isNaN(val) ? fallback : val);

  let clean = String(val)
    .trim()
    .replace(/ksh|kes|\/=|usd|\$|,/gi, "")
    .trim();

  const num = parseFloat(clean);
  return !isNaN(num) && num >= 0 ? num : fallback;
}

// Quantity / Stock Normalizer
export function normalizeQty(val, fallback = 0) {
  if (val === undefined || val === null || val === "") return fallback;
  if (typeof val === "number") return Math.max(0, isNaN(val) ? fallback : Math.round(val));

  const clean = String(val).trim().replace(/,/g, "");
  const num = parseFloat(clean);
  return !isNaN(num) && num >= 0 ? num : fallback;
}

// Unit Normalizer (Standardize Kenyan hardware units)
export function normalizeUnit(val, fallback = "piece") {
  if (!val) return fallback;
  const clean = String(val).trim().toLowerCase();

  if (/^(pcs|pc|piece|pieces|each|ea|nos|no|items|item|pk)$/.test(clean)) return "piece";
  if (/^(bag|bags|bg)$/.test(clean)) return "bag";
  if (/^(kg|kgs|kilo|kilogram|kilograms)$/.test(clean)) return "kg";
  if (/^(m|mtr|mtrs|metre|metres|meter|meters)$/.test(clean)) return "metre";
  if (/^(tin|tins|can|cans|bucket|buckets|ltr|litre|litres|liter|liters)$/.test(clean)) return "tin";
  if (/^(roll|rolls|rl)$/.test(clean)) return "roll";
  if (/^(pkt|packet|packets|pkts|pack|packs)$/.test(clean)) return "packet";
  if (/^(box|boxes|carton|cartons|ctn)$/.test(clean)) return "box";
  if (/^(bundle|bundles|bndl)$/.test(clean)) return "bundle";
  if (/^(pair|pairs)$/.test(clean)) return "pair";
  if (/^(set|sets)$/.test(clean)) return "set";
  if (/^(sheet|sheets)$/.test(clean)) return "sheet";
  if (/^(length|lengths|bar|bars|pipe|pipes)$/.test(clean)) return "piece";

  return clean || fallback;
}

// Clean Text Normalizer
export function normalizeText(val, fallback = "") {
  if (val === undefined || val === null) return fallback;
  return String(val).replace(/\s+/g, " ").trim() || fallback;
}

/**
 * Process Raw Sheets with User-Approved Mapping and Global Defaults
 */
export function processDataWithMapping(sheetsData = [], columnMapping = {}, globalDefaults = {}) {
  const defaultCategory = normalizeText(globalDefaults.defaultCategory, "General");
  const defaultSupplierId = normalizeText(globalDefaults.defaultSupplierId, "");
  const defaultMinStock = normalizeQty(globalDefaults.defaultMinStock, 10);
  const defaultUnit = normalizeUnit(globalDefaults.defaultUnit, "piece");
  const autoMarkupPercent = Number(globalDefaults.autoMarkupPercent) || 20;

  const validRows = [];
  const invalidRows = [];
  let totalScanned = 0;

  sheetsData.forEach(sheet => {
    const sheetDataRows = sheet.dataRows || [];
    const sheetDefaultCategory = sheet.sheetName && sheet.sheetName.toLowerCase() !== "sheet1"
      ? normalizeText(sheet.sheetName, defaultCategory)
      : defaultCategory;

    sheetDataRows.forEach((row, rowIdx) => {
      totalScanned++;
      const rowNumber = (sheet.headerRowIndex || 0) + rowIdx + 2; // +1 0-idx, +1 header
      const extracted = {};

      // Extract values according to columnMapping: { [colIndex]: canonicalFieldKey }
      Object.entries(columnMapping).forEach(([colIdxStr, fieldKey]) => {
        if (!fieldKey || fieldKey === "skip") return;
        const colIdx = parseInt(colIdxStr, 10);
        extracted[fieldKey] = row[colIdx];
      });

      // Normalize extracted fields
      const name = normalizeText(extracted.name);
      const buyPriceRaw = extracted.buyPrice;
      const sellPriceRaw = extracted.sellPrice;
      const buyPrice = normalizePrice(buyPriceRaw, 0);
      let sellPrice = normalizePrice(sellPriceRaw, 0);

      // Auto-compute sellPrice if only buyPrice was provided
      if (sellPrice <= 0 && buyPrice > 0) {
        sellPrice = Math.round(buyPrice * (1 + (autoMarkupPercent / 100)));
      }

      const stock = normalizeQty(extracted.stock, 0);
      const minStock = normalizeQty(extracted.minStock, defaultMinStock);
      const category = normalizeText(extracted.category, sheetDefaultCategory);
      const baseUnit = normalizeUnit(extracted.baseUnit, defaultUnit);
      const brand = normalizeText(extracted.brand, "");
      const sku = normalizeText(extracted.sku, "");
      const location = normalizeText(extracted.location, "Main Store");
      const description = normalizeText(extracted.description, "");
      const contractorPrice = normalizePrice(extracted.contractorPrice, sellPrice > 0 ? sellPrice : buyPrice);
      const wholesalePrice = normalizePrice(extracted.wholesalePrice, sellPrice > 0 ? sellPrice : buyPrice);
      const supplierName = normalizeText(extracted.supplier, "");

      // Validation Checks
      const errors = [];
      if (!name) {
        errors.push("Missing product name or description");
      }
      if (sellPrice <= 0 && buyPrice <= 0) {
        errors.push("Missing both selling price and buying cost");
      }

      const rowData = {
        _rowNumber: rowNumber,
        _sheetName: sheet.sheetName,
        name,
        category,
        brand,
        sku: sku || `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
        description: description || (name ? `Imported: ${name}` : ""),
        baseUnit,
        purchaseUnit: baseUnit,
        conversionFactor: 1,
        buyPrice,
        sellPrice,
        contractorPrice,
        wholesalePrice,
        stock,
        minStock,
        location,
        supplierId: defaultSupplierId,
        supplierName,
        rawRow: row,
      };

      if (errors.length === 0) {
        validRows.push(rowData);
      } else {
        invalidRows.push({
          ...rowData,
          reasons: errors,
        });
      }
    });
  });

  const totalEstimatedStockValue = validRows.reduce((sum, r) => {
    const costBasis = r.buyPrice > 0 ? r.buyPrice : r.sellPrice;
    return sum + (r.stock * costBasis);
  }, 0);

  return {
    totalScanned,
    validRows,
    invalidRows,
    totalEstimatedStockValue,
  };
}

/**
 * Export Invalid Problem Rows to CSV for user correction
 */
export function exportInvalidRowsCSV(invalidRows = []) {
  if (invalidRows.length === 0) return;

  const exportData = invalidRows.map(r => ({
    "Row Number": r._rowNumber,
    "Sheet": r._sheetName || "Sheet1",
    "Product Name": r.name || "MISSING",
    "Category": r.category,
    "Unit": r.baseUnit,
    "Buying Price": r.buyPrice,
    "Selling Price": r.sellPrice,
    "Stock": r.stock,
    "Problem Identified": r.reasons ? r.reasons.join(" | ") : "Validation issue",
  }));

  const ws = XLSX.utils.json_to_sheet(exportData);
  const csvContent = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "HardwareFlow_Import_Problem_Rows.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

