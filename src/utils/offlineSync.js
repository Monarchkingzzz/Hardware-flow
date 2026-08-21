import { useState, useEffect, useCallback } from "react";
import { pushDatabaseToSupabase } from "./supabaseClient";

const OFFLINE_QUEUE_KEY = "hardwareflow-offline-sales-queue-v1";

/**
 * Retrieve queued offline sales from localStorage
 */
export function getOfflineSalesQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to read offline sales queue:", err);
    return [];
  }
}

/**
 * Enqueue a sale to the offline queue
 */
export function enqueueOfflineSale(sale) {
  try {
    const queue = getOfflineSalesQueue();
    // Avoid duplicate entries
    if (!queue.some(s => s.id === sale.id || s.invoiceNo === sale.invoiceNo)) {
      queue.push({
        ...sale,
        queuedAt: new Date().toISOString(),
      });
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      window.dispatchEvent(new CustomEvent("hardwareflow-offline-queue-changed", { detail: { count: queue.length } }));
    }
    return queue.length;
  } catch (err) {
    console.error("Failed to enqueue offline sale:", err);
    return 0;
  }
}

/**
 * Clear or remove processed sales from offline queue
 */
export function clearOfflineSalesQueue() {
  try {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    window.dispatchEvent(new CustomEvent("hardwareflow-offline-queue-changed", { detail: { count: 0 } }));
  } catch (err) {
    console.error("Failed to clear offline sales queue:", err);
  }
}

export function removeOfflineSale(saleId) {
  try {
    const queue = getOfflineSalesQueue().filter(s => s.id !== saleId);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    window.dispatchEvent(new CustomEvent("hardwareflow-offline-queue-changed", { detail: { count: queue.length } }));
  } catch (err) {
    console.error("Failed to remove offline sale from queue:", err);
  }
}

/**
 * React hook to track online status and offline queue size in real-time
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [queuedCount, setQueuedCount] = useState(() => getOfflineSalesQueue().length);

  const refreshQueueCount = useCallback(() => {
    setQueuedCount(getOfflineSalesQueue().length);
  }, []);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    function handleQueueChange(e) {
      if (e?.detail?.count !== undefined) {
        setQueuedCount(e.detail.count);
      } else {
        refreshQueueCount();
      }
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("hardwareflow-offline-queue-changed", handleQueueChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("hardwareflow-offline-queue-changed", handleQueueChange);
    };
  }, [refreshQueueCount]);

  return { isOnline, queuedCount, refreshQueueCount };
}

/**
 * Push offline sales queue to Supabase cloud when back online
 */
export async function syncOfflineQueue(db, notify) {
  const queue = getOfflineSalesQueue();
  if (queue.length === 0) return { success: true, count: 0 };

  try {
    // Ensure all queued sales are in db.sales
    const existingIds = new Set((db.sales || []).map(s => s.id));
    const newSales = queue.filter(q => !existingIds.has(q.id));
    
    const targetDb = {
      ...db,
      sales: [...newSales, ...(db.sales || [])],
    };

    await pushDatabaseToSupabase(targetDb);
    clearOfflineSalesQueue();

    if (notify) {
      notify("success", "Offline Sales Synchronized", `${queue.length} offline transaction(s) pushed to Supabase cloud.`);
    }

    return { success: true, count: queue.length };
  } catch (err) {
    console.warn("Failed to sync offline queue to Supabase:", err);
    if (notify) {
      notify("warning", "Sync Pending", "Could not reach cloud database. Will retry automatically when connection stabilizes.");
    }
    return { success: false, error: err };
  }
}
