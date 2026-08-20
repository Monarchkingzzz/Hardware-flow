import { useState, useEffect } from "react";
import {
  Cloud, CloudUpload, CloudDownload, Database, CheckCircle2,
  AlertCircle, RefreshCw, X, Key, Globe, Shield, Copy, Check
} from "lucide-react";
import {
  getSupabaseCredentials,
  saveSupabaseCredentials,
  pushDatabaseToSupabase,
  pullDatabaseFromSupabase,
  getSupabaseClient
} from "../utils/supabaseClient";

export function SupabaseSyncModal({ db, setDb, onClose, notify }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [source, setSource] = useState("none");
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    const creds = getSupabaseCredentials();
    setUrl(creds.url || "");
    setKey(creds.key || "");
    setSource(creds.source);
  }, []);

  const isConfigured = !!(url && key);

  function handleSaveCredentials() {
    if (!url.trim() || !key.trim()) {
      notify("error", "Missing Credentials", "Please enter both the Supabase URL and Anon API Key.");
      return;
    }
    saveSupabaseCredentials(url, key);
    setSource("local");
    notify("success", "Supabase Settings Saved", "Credentials stored. You can now push/pull database records.");
  }

  async function handlePush() {
    if (!url.trim() || !key.trim()) {
      notify("error", "Missing Credentials", "Please enter your Supabase URL and Anon Key.");
      return;
    }
    saveSupabaseCredentials(url, key);

    setIsPushing(true);
    setStatusMsg({ type: "info", text: "Connecting to Supabase and uploading tables..." });

    try {
      const results = await pushDatabaseToSupabase(db);
      setStatusMsg({
        type: "success",
        text: `✓ Successfully synced: ${results.products} products, ${results.sales} sales, ${results.customers} customers, ${results.suppliers} suppliers, ${results.expenses} expenses, ${results.users} users, and ${results.auditLog} audit events to Supabase!`,
      });
      notify("success", "Supabase Sync Complete", "Your entire database was pushed to Supabase successfully.");
    } catch (err) {
      console.error(err);
      setStatusMsg({
        type: "error",
        text: `Push failed: ${err.message}. Ensure you have run the schema script in your Supabase SQL Editor.`,
      });
      notify("error", "Push Failed", err.message);
    } finally {
      setIsPushing(false);
    }
  }

  async function handlePull() {
    if (!url.trim() || !key.trim()) {
      notify("error", "Missing Credentials", "Please enter your Supabase URL and Anon Key.");
      return;
    }
    saveSupabaseCredentials(url, key);

    if (!confirm("Pulling from Supabase will replace your local browser cache with the cloud database. Continue?")) {
      return;
    }

    setIsPulling(true);
    setStatusMsg({ type: "info", text: "Pulling tables from Supabase cloud..." });

    try {
      const cloudDb = await pullDatabaseFromSupabase();
      setDb(cloudDb);
      setStatusMsg({
        type: "success",
        text: `✓ Successfully loaded database from Supabase: ${cloudDb.products.length} products, ${cloudDb.sales.length} sales.`,
      });
      notify("success", "Supabase Data Loaded", "Local state updated from Supabase.");
    } catch (err) {
      console.error(err);
      setStatusMsg({
        type: "error",
        text: `Pull failed: ${err.message}`,
      });
      notify("error", "Pull Failed", err.message);
    } finally {
      setIsPulling(false);
    }
  }

  function handleCopySQLInfo() {
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
    notify("info", "Schema Location", "The SQL schema script is located at 'supabase_schema.sql' in your project root.");
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,24,30,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="hf-card"
        style={{
          width: 560,
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 26,
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "linear-gradient(135deg, #3ECF8E, #1E8256)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Database size={20} />
            </div>
            <div>
              <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>Supabase Cloud Database Sync</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
                Push & sync your HardwareFlow data to your Supabase PostgreSQL cloud database.
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        {/* Step 1: SQL Schema Setup Note */}
        <div
          style={{
            background: "var(--surface-hover)",
            border: "1px solid var(--line)",
            padding: 12,
            borderRadius: 10,
            marginBottom: 16,
            fontSize: 12.5,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Shield size={14} color="var(--rust)" /> Step 1: Initialize Database Tables in Supabase
          </div>
          <div style={{ color: "var(--ink-soft)", lineHeight: 1.4 }}>
            Open your <b>Supabase Dashboard $\rightarrow$ SQL Editor</b>, paste and run the included <code>supabase_schema.sql</code> file to create the tables.
          </div>
        </div>

        {/* Status Message Box */}
        {statusMsg && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 16,
              background: statusMsg.type === "success" ? "var(--green-tint)" : statusMsg.type === "error" ? "var(--red-tint)" : "var(--amber-tint)",
              color: statusMsg.type === "success" ? "var(--green)" : statusMsg.type === "error" ? "var(--red)" : "var(--amber)",
              border: `1px solid ${statusMsg.type === "success" ? "var(--green)" : statusMsg.type === "error" ? "var(--red)" : "var(--amber)"}`,
            }}
          >
            {statusMsg.text}
          </div>
        )}

        {/* Step 2: Supabase Credentials */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Step 2: Enter Supabase Connection Keys</div>
          
          <div style={{ marginBottom: 10 }}>
            <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Project URL</div>
            <div style={{ position: "relative" }}>
              <Globe size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-soft)" }} />
              <input
                className="hf-input mono"
                style={{ paddingLeft: 32 }}
                placeholder="https://xyzproject.supabase.co"
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Anon Public API Key</div>
            <div style={{ position: "relative" }}>
              <Key size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-soft)" }} />
              <input
                className="hf-input mono"
                type="password"
                style={{ paddingLeft: 32 }}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={key}
                onChange={e => setKey(e.target.value)}
              />
            </div>
          </div>

          <button
            type="button"
            className="hf-btn hf-btn-ghost"
            style={{ fontSize: 12, padding: "5px 10px" }}
            onClick={handleSaveCredentials}
          >
            Save Credentials
          </button>
        </div>

        {/* Step 3: Push / Pull Actions */}
        <div style={{ borderTop: "1.5px dashed var(--line)", paddingTop: 16, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Step 3: Push Local Data to Supabase</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              className="hf-btn hf-btn-primary"
              style={{
                justifyContent: "center",
                padding: "12px",
                fontSize: 13.5,
                background: "linear-gradient(135deg, #10B981, #059669)",
                borderColor: "#059669",
              }}
              onClick={handlePush}
              disabled={isPushing || isPulling || !url || !key}
            >
              {isPushing ? (
                <>
                  <RefreshCw size={16} className="spin" /> Pushing to Supabase...
                </>
              ) : (
                <>
                  <CloudUpload size={16} /> Push Local Database to Supabase
                </>
              )}
            </button>

            <button
              className="hf-btn hf-btn-ghost"
              style={{ justifyContent: "center", padding: "12px", fontSize: 13.5 }}
              onClick={handlePull}
              disabled={isPushing || isPulling || !url || !key}
            >
              {isPulling ? (
                <>
                  <RefreshCw size={16} className="spin" /> Pulling Cloud Data...
                </>
              ) : (
                <>
                  <CloudDownload size={16} /> Pull from Supabase
                </>
              )}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button className="hf-btn hf-btn-dark" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
