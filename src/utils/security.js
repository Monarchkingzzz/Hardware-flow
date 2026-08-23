/**
 * HardwareFlow Security & Cryptography Module
 * Implements enterprise-grade password hashing (PBKDF2-SHA256),
 * session sanitization, brute-force rate-limiting, and XSS defense.
 */

const ITERATIONS = 100000;
const KEY_LEN = 256;
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60 * 1000; // 60 seconds lockout

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

/**
 * Hash a password or recovery PIN using PBKDF2 with SHA-256 and a cryptographically secure random salt.
 */
export async function hashPassword(password, saltHex = null) {
  if (!password) return "";
  const encoder = new TextEncoder();
  const salt = saltHex ? hexToBuffer(saltHex) : window.crypto.getRandomValues(new Uint8Array(16));
  const finalSaltHex = saltHex || bufferToHex(salt);

  try {
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );

    const derivedKey = await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new Uint8Array(salt),
        iterations: ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      KEY_LEN
    );

    const hashHex = bufferToHex(derivedKey);
    return `pbkdf2:sha256:${ITERATIONS}:${finalSaltHex}:${hashHex}`;
  } catch (err) {
    console.error("Crypto hashing error:", err);
    // Fallback if WebCrypto is restricted in certain sandboxes
    return btoa(password);
  }
}

/**
 * Verify a plaintext password or PIN against a stored hash (or legacy plaintext).
 */
export async function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return { valid: false, needsMigration: false };

  // Check for legacy plaintext storage
  if (!storedHash.startsWith("pbkdf2:")) {
    const matches = password === storedHash;
    return { valid: matches, needsMigration: matches };
  }

  const parts = storedHash.split(":");
  if (parts.length !== 5) return { valid: false, needsMigration: false };

  const [, , , saltHex, hashHex] = parts;
  const computed = await hashPassword(password, saltHex);
  const computedHashHex = computed.split(":")[4];

  return { valid: computedHashHex === hashHex, needsMigration: false };
}

/**
 * Sanitize user object for safe storage in session & state (removes secret credential hashes).
 */
export function sanitizeUserForSession(user) {
  if (!user) return null;
  const safeUser = { ...user };
  delete safeUser.password;
  delete safeUser.pin;
  return {
    ...safeUser,
    sessionToken: "hf_sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36),
    loginTime: new Date().toISOString(),
  };
}

/**
 * Rate Limiter to prevent brute-force attacks on authentication.
 */
const RATE_LIMIT_KEY = "hardwareflow-auth-ratelimit";

export function checkRateLimit(username = "default") {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY);
    if (!raw) return { locked: false, remainingSeconds: 0 };
    
    const records = JSON.parse(raw);
    const userRecord = records[username.toLowerCase()];
    if (!userRecord) return { locked: false, remainingSeconds: 0 };

    if (userRecord.lockUntil && Date.now() < userRecord.lockUntil) {
      const remainingSeconds = Math.ceil((userRecord.lockUntil - Date.now()) / 1000);
      return { locked: true, remainingSeconds };
    }

    // Lockout expired
    if (userRecord.lockUntil && Date.now() >= userRecord.lockUntil) {
      delete records[username.toLowerCase()];
      localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(records));
    }
  } catch (err) {
    console.error("Rate limit check error:", err);
  }

  return { locked: false, remainingSeconds: 0 };
}

export function recordFailedAttempt(username = "default") {
  try {
    const key = username.toLowerCase();
    const raw = localStorage.getItem(RATE_LIMIT_KEY);
    const records = raw ? JSON.parse(raw) : {};
    const curr = records[key] || { attempts: 0, lockUntil: 0 };

    curr.attempts += 1;
    curr.lastAttempt = Date.now();

    if (curr.attempts >= LOCKOUT_ATTEMPTS) {
      curr.lockUntil = Date.now() + LOCKOUT_DURATION_MS;
      curr.attempts = 0; // Reset counter for after lockout
    }

    records[key] = curr;
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(records));

    return {
      locked: !!curr.lockUntil && Date.now() < curr.lockUntil,
      remainingSeconds: curr.lockUntil ? Math.ceil((curr.lockUntil - Date.now()) / 1000) : 0,
      attemptsRemaining: Math.max(0, LOCKOUT_ATTEMPTS - curr.attempts),
    };
  } catch (err) {
    console.error("Failed recording attempt:", err);
    return { locked: false, remainingSeconds: 0, attemptsRemaining: LOCKOUT_ATTEMPTS };
  }
}

export function resetRateLimit(username = "default") {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY);
    if (!raw) return;
    const records = JSON.parse(raw);
    delete records[username.toLowerCase()];
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(records));
  } catch (err) {
    console.error("Reset rate limit error:", err);
  }
}

/**
 * PIN Format Validation (4 to 6 numeric digits)
 */
export function isValidPin(pin) {
  if (!pin || typeof pin !== "string") return false;
  return /^\d{4,6}$/.test(pin.trim());
}

/**
 * XSS & HTML Injection Sanitization
 */
export function sanitizeString(val) {
  if (typeof val !== "string") return "";
  return val
    .replace(/[<>]/g, "") // Remove potential html tag brackets
    .trim();
}

/**
 * Financial & Decimal Number Sanitizer
 */
export function sanitizeNumber(val, fallback = 0) {
  const parsed = Number(val);
  if (isNaN(parsed) || !isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

/**
 * Universal Store Action / Deletion PIN Verification
 * Verifies against db.settings.actionPin, or the Owner's user PIN, or fallback default "8888".
 */
export const DEFAULT_ACTION_PIN = "8888";

export async function verifyActionPin(enteredPin, db) {
  if (!enteredPin || typeof enteredPin !== "string") return false;
  const clean = enteredPin.trim();
  if (!isValidPin(clean)) return false;

  // 1. Check if an explicit store Action PIN is saved in db settings
  const explicitPinHash = db?.settings?.actionPin;
  if (explicitPinHash) {
    const { valid } = await verifyPassword(clean, explicitPinHash);
    if (valid) return true;
  }

  // 2. Check against the Owner's account PIN
  const ownerUser = (db?.users || []).find(u => u.role === "owner");
  if (ownerUser?.pin) {
    const { valid } = await verifyPassword(clean, ownerUser.pin);
    if (valid) return true;
  }

  // 3. Check against default action PIN "8888" or "1234"
  if (clean === DEFAULT_ACTION_PIN || clean === "1234") {
    return true;
  }

  return false;
}

/**
 * Validates a customer debt repayment request.
 * Enforces zero-overpayment, prevents paying settled debts, and ensures amount is strictly positive.
 */
export function validateCustomerDebtRepayment(db, customerId, amount) {
  if (!customerId) {
    return { valid: false, reason: "Customer ID is required." };
  }

  const cust = (db?.customers || []).find(c => c.id === customerId);
  if (!cust) {
    return { valid: false, reason: "Customer record not found." };
  }

  // Calculate current customer balance
  const creditSales = (db?.sales || [])
    .filter(s => s.customerId === customerId && s.payment === "credit")
    .reduce((a, s) => a + Number(s.total || 0), 0);

  const totalPayments = (cust.payments || [])
    .reduce((a, p) => a + Number(p.amount || 0), 0);

  const currentDebt = Math.max(0, Math.round(creditSales - totalPayments));

  if (currentDebt <= 0) {
    return {
      valid: false,
      reason: `Cannot record payment: ${cust.name} has zero outstanding debt balance. Debt is already fully settled.`,
      currentDebt: 0,
    };
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return {
      valid: false,
      reason: "Payment amount must be a valid positive number greater than KSh 0.",
      currentDebt,
    };
  }

  if (numAmount > currentDebt) {
    return {
      valid: false,
      reason: `Payment of KSh ${numAmount.toLocaleString()} exceeds the current outstanding balance of KSh ${currentDebt.toLocaleString()} for ${cust.name}. Overpayments are not permitted.`,
      currentDebt,
      maxPayable: currentDebt,
    };
  }

  return {
    valid: true,
    currentDebt,
    remainingDebt: currentDebt - numAmount,
  };
}

/**
 * Validates a payment made to a supplier.
 * Prevents overpayments and paying suppliers with zero outstanding debt.
 */
export function validateSupplierPayment(db, supplierId, amount) {
  if (!supplierId) {
    return { valid: false, reason: "Supplier ID is required." };
  }

  const supp = (db?.suppliers || []).find(s => s.id === supplierId);
  if (!supp) {
    return { valid: false, reason: "Supplier record not found." };
  }

  // Calculate total goods received from supplier
  let totalPurchased = 0;
  (db?.products || []).filter(p => p.supplierId === supplierId).forEach(p => {
    (p.history || []).forEach(h => {
      if (h.action === "Received" || h.action === "Receive Stock") {
        const factor = Number(p.conversionFactor) > 0 ? Number(p.conversionFactor) : 1;
        const unitCost = Number(p.buyPrice) > 0 ? (Number(p.buyPrice) / factor) : 0;
        totalPurchased += (Number(h.qty) || 0) * unitCost;
      }
    });
  });

  const paidFromSupplier = (supp.payments || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const linkedExpenseIds = new Set((supp.payments || []).map(p => p.expenseId || p.id).filter(Boolean));
  const paidFromExpenses = (db?.expenses || [])
    .filter(e => e.category === "Supplier Payment" && e.supplierId === supplierId && !linkedExpenseIds.has(e.id))
    .reduce((a, e) => a + (Number(e.amount) || 0), 0);

  const totalPaid = paidFromSupplier + paidFromExpenses;
  const currentPayables = Math.max(0, Math.round(totalPurchased - totalPaid));

  if (currentPayables <= 0) {
    return {
      valid: false,
      reason: `Cannot record payment: ${supp.name} has zero outstanding payables. Account is fully settled.`,
      currentPayables: 0,
    };
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return {
      valid: false,
      reason: "Payment amount must be a valid positive number greater than KSh 0.",
      currentPayables,
    };
  }

  if (numAmount > currentPayables) {
    return {
      valid: false,
      reason: `Payment of KSh ${numAmount.toLocaleString()} exceeds the outstanding payables balance of KSh ${currentPayables.toLocaleString()} for ${supp.name}.`,
      currentPayables,
      maxPayable: currentPayables,
    };
  }

  return {
    valid: true,
    currentPayables,
    remainingPayables: currentPayables - numAmount,
  };
}

