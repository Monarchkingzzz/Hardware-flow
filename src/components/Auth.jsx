import { useState } from "react";
import {
  Lock, User, KeyRound, Eye, EyeOff, ShieldCheck,
  CheckCircle, ArrowRight, X, Sparkles, Sun, Moon,
  Shield, UserCheck, RefreshCw, Key
} from "lucide-react";

export function LoginScreen({ db, onLogin, onForgotPassword, notify, theme, onToggleTheme }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(e) {
    if (e) e.preventDefault();
    setError("");

    const trimmedUser = username.trim().toLowerCase();
    const found = (db.users || []).find(
      u => (u.username.toLowerCase() === trimmedUser || u.phone === trimmedUser) && u.password === password
    );

    if (found) {
      onLogin(found);
    } else {
      setError("Invalid username or password. Please try again or use Forgot Password.");
      notify("error", "Login Failed", "Incorrect username or password entered.");
    }
  }

  function quickLogin(u, p) {
    setUsername(u);
    setPassword(p);
    const found = (db.users || []).find(
      user => user.username.toLowerCase() === u.toLowerCase() && user.password === p
    );
    if (found) {
      onLogin(found);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: "20px 16px",
        position: "relative",
      }}
    >
      {/* Theme toggle on login screen */}
      <button
        onClick={onToggleTheme}
        className="hf-btn hf-btn-ghost"
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          padding: "8px 12px",
          borderRadius: 10,
        }}
        title="Toggle Light/Dark Theme"
      >
        {theme === "dark" ? <Sun size={16} color="#FBBF24" /> : <Moon size={16} color="#4B5563" />}
        <span style={{ fontSize: 12 }}>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
      </button>

      <div
        className="hf-card"
        style={{
          width: 440,
          maxWidth: "94vw",
          padding: "32px 28px",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        {/* Logo & Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "linear-gradient(155deg, #C7573A, var(--rust-dark))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 12px",
              boxShadow: "0 6px 16px -4px rgba(193, 80, 47, 0.6)",
            }}
          >
            <ShieldCheck size={26} color="#fff" />
          </div>
          <div className="disp" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "0.02em" }}>
            HARDWARE<span style={{ color: "var(--rust)" }}>FLOW</span>
          </div>
          <div style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 4 }}>
            Secure Business Management & Stock System
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "var(--red-tint)",
              border: "1px solid var(--red)",
              color: "var(--red)",
              padding: "10px 14px",
              borderRadius: 9,
              fontSize: 13,
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Lock size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Username / Phone</div>
            <div style={{ position: "relative" }}>
              <User size={16} style={{ position: "absolute", left: 11, top: 11, color: "var(--ink-soft)" }} />
              <input
                className="hf-input"
                style={{ paddingLeft: 34 }}
                placeholder="e.g. owner, cashier, store"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(""); }}
                autoFocus
              />
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div className="hf-kpi-label">Password</div>
              <button
                type="button"
                onClick={onForgotPassword}
                style={{ background: "none", border: "none", color: "var(--rust)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}
              >
                Forgot Password?
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <KeyRound size={16} style={{ position: "absolute", left: 11, top: 11, color: "var(--ink-soft)" }} />
              <input
                className="hf-input"
                type={showPassword ? "text" : "password"}
                style={{ paddingLeft: 34, paddingRight: 36 }}
                placeholder="Enter your account password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: 10,
                  top: 10,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--ink-soft)",
                  padding: 2,
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="hf-btn hf-btn-primary"
            style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 14, fontWeight: 700 }}
          >
            Sign In to System <ArrowRight size={16} />
          </button>
        </form>

        {/* Quick Demo Access Bar */}
        <div style={{ marginTop: 24, borderTop: "1px dashed var(--line)", paddingTop: 16 }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", textAlign: "center", marginBottom: 10 }}>
            Quick-Login Demo Credentials
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ fontSize: 11.5, padding: "6px 8px", justifyContent: "center" }}
              onClick={() => quickLogin("owner", "admin123")}
              title="Full system access + margins"
            >
              👑 Owner
            </button>
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ fontSize: 11.5, padding: "6px 8px", justifyContent: "center" }}
              onClick={() => quickLogin("cashier", "cashier123")}
              title="POS & Sales operations"
            >
              🛒 Cashier
            </button>
            <button
              type="button"
              className="hf-btn hf-btn-ghost"
              style={{ fontSize: 11.5, padding: "6px 8px", justifyContent: "center" }}
              onClick={() => quickLogin("store", "store123")}
              title="Inventory & Receiving"
            >
              📦 Storekeeper
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ForgotPasswordModal({ db, setDb, onClose, notify }) {
  const [step, setStep] = useState(1);
  const [ident, setIdent] = useState("");
  const [pin, setPin] = useState("");
  const [matchedUser, setMatchedUser] = useState(null);
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [error, setError] = useState("");

  function handleVerify() {
    setError("");
    const trimmed = ident.trim().toLowerCase();
    const user = (db.users || []).find(
      u => u.username.toLowerCase() === trimmed || u.phone === trimmed
    );

    if (!user) {
      setError("No account found with this username or phone.");
      return;
    }

    if (user.pin !== pin.trim()) {
      setError("Incorrect Security Recovery PIN. (Default Owner PIN is 8888).");
      return;
    }

    setMatchedUser(user);
    setStep(2);
  }

  function handleReset() {
    setError("");
    if (!newPass || newPass.length < 4) {
      setError("Password must be at least 4 characters long.");
      return;
    }
    if (newPass !== confirmPass) {
      setError("Passwords do not match. Please retype carefully.");
      return;
    }

    setDb(prev => ({
      ...prev,
      users: (prev.users || []).map(u => u.id === matchedUser.id ? { ...u, password: newPass } : u),
      auditLog: [
        {
          id: "LOG-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
          time: new Date().toISOString().slice(0, 10) + " " + new Date().toTimeString().slice(0, 5),
          user: matchedUser.name,
          role: matchedUser.role,
          category: "Security",
          action: `Password reset via Security Recovery PIN for ${matchedUser.username}`,
          detail: "Credentials updated",
          target: matchedUser.username,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Password Reset Successful", `New password set for ${matchedUser.name}. You can now log in.`);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onClose}>
      <div className="hf-card" style={{ width: 440, maxWidth: "92vw", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>Password Recovery</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        {error && (
          <div style={{ background: "var(--red-tint)", color: "var(--red)", border: "1px solid var(--red)", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
            {error}
          </div>
        )}

        {step === 1 ? (
          <div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
              Enter your username or registered phone number along with your 4-digit Security Recovery PIN.
            </div>

            <div style={{ marginBottom: 12 }}>
              <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Username or Phone</div>
              <input
                className="hf-input"
                placeholder="e.g. owner or 0722 000 111"
                value={ident}
                onChange={e => { setIdent(e.target.value); setError(""); }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="hf-kpi-label" style={{ marginBottom: 4 }}>4-Digit Recovery PIN</div>
              <input
                className="hf-input mono"
                type="password"
                maxLength={6}
                placeholder="Default: Owner is 8888, Cashier is 1111"
                value={pin}
                onChange={e => { setPin(e.target.value); setError(""); }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="hf-btn hf-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="hf-btn hf-btn-primary" onClick={handleVerify} disabled={!ident || !pin}>
                Verify Identity <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: "var(--green)", fontWeight: 600, marginBottom: 12 }}>
              ✓ Identity verified for {matchedUser?.name} ({matchedUser?.username}). Enter your new password below:
            </div>

            <div style={{ marginBottom: 12 }}>
              <div className="hf-kpi-label" style={{ marginBottom: 4 }}>New Password</div>
              <input
                className="hf-input"
                type="password"
                placeholder="Enter new password"
                value={newPass}
                onChange={e => { setNewPass(e.target.value); setError(""); }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="hf-kpi-label" style={{ marginBottom: 4 }}>Confirm New Password</div>
              <input
                className="hf-input"
                type="password"
                placeholder="Re-type new password"
                value={confirmPass}
                onChange={e => { setConfirmPass(e.target.value); setError(""); }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="hf-btn hf-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="hf-btn hf-btn-primary" onClick={handleReset}>
                <CheckCircle size={14} /> Set New Password
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileModal({ currentUser, db, setDb, onUserUpdate, onClose, notify }) {
  const [username, setUsername] = useState(currentUser.username || "");
  const [name, setName] = useState(currentUser.name || "");
  const [phone, setPhone] = useState(currentUser.phone || "");
  const [pin, setPin] = useState(currentUser.pin || "8888");
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [error, setError] = useState("");

  function handleSave() {
    setError("");

    const trimmedUser = username.trim().toLowerCase();
    if (!trimmedUser) {
      setError("Username cannot be empty.");
      return;
    }

    // Check if new username is taken by someone else
    const duplicate = (db.users || []).find(
      u => u.id !== currentUser.id && u.username.toLowerCase() === trimmedUser
    );
    if (duplicate) {
      setError(`The username "${username}" is already taken by another account.`);
      return;
    }

    // If changing password, verify current password
    if (newPass) {
      if (currentPass !== currentUser.password) {
        setError("Current password is incorrect.");
        return;
      }
      if (newPass !== confirmPass) {
        setError("New passwords do not match.");
        return;
      }
      if (newPass.length < 4) {
        setError("New password must be at least 4 characters.");
        return;
      }
    }

    const updatedUser = {
      ...currentUser,
      username: trimmedUser,
      name: name.trim() || currentUser.name,
      phone: phone.trim(),
      pin: pin.trim(),
      password: newPass ? newPass : currentUser.password,
    };

    setDb(prev => ({
      ...prev,
      users: (prev.users || []).map(u => u.id === currentUser.id ? updatedUser : u),
      auditLog: [
        {
          id: "LOG-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
          time: new Date().toISOString().slice(0, 10) + " " + new Date().toTimeString().slice(0, 5),
          user: currentUser.name,
          role: currentUser.role,
          category: "Security",
          action: `Updated profile & credentials (Username: ${trimmedUser})`,
          detail: newPass ? "Password & credentials updated" : "Profile details updated",
          target: trimmedUser,
        },
        ...prev.auditLog
      ]
    }));

    if (onUserUpdate) {
      onUserUpdate(updatedUser);
    }

    notify("success", "Profile Updated", "Your account settings and username have been saved.");
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onClose}>
      <div className="hf-card" style={{ width: 480, maxWidth: "92vw", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>Account Profile & Credentials</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        {error && (
          <div style={{ background: "var(--red-tint)", color: "var(--red)", border: "1px solid var(--red)", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <Field label="Username (Login ID) *" help="Used to sign in to your account">
              <input className="hf-input mono" value={username} onChange={e => setUsername(e.target.value)} />
            </Field>
          </div>
          <div>
            <Field label="Display Name" help="Your full name or title">
              <input className="hf-input" value={name} onChange={e => setName(e.target.value)} />
            </Field>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <Field label="Phone Number" help="For contact & identification">
              <input className="hf-input" value={phone} onChange={e => setPhone(e.target.value)} />
            </Field>
          </div>
          <div>
            <Field label="Security Recovery PIN" help="Used if you forget password">
              <input className="hf-input mono" value={pin} onChange={e => setPin(e.target.value)} maxLength={6} />
            </Field>
          </div>
        </div>

        <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 12, marginBottom: 12 }}>
          <div className="hf-kpi-label" style={{ marginBottom: 8, color: "var(--ink)" }}>Change Password (Leave blank to keep current)</div>
          <div style={{ display: "grid", gap: 8 }}>
            <input className="hf-input" type="password" placeholder="Current Password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} />
            <input className="hf-input" type="password" placeholder="New Password" value={newPass} onChange={e => setNewPass(e.target.value)} />
            <input className="hf-input" type="password" placeholder="Confirm New Password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="hf-btn hf-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="hf-btn hf-btn-primary" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, help, children }) {
  return (
    <div>
      <div className="hf-kpi-label" style={{ marginBottom: 3 }}>{label}</div>
      {children}
      {help && <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{help}</div>}
    </div>
  );
}

export function UserManagementModal({ currentUser, db, setDb, onClose, notify }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", name: "", role: "cashier", password: "", phone: "", pin: "1234" });

  function handleAddStaff() {
    if (!newUser.username || !newUser.password || !newUser.name) {
      notify("error", "Missing Fields", "Username, name, and password are required.");
      return;
    }

    const trimmedUser = newUser.username.trim().toLowerCase();
    const exists = (db.users || []).find(u => u.username.toLowerCase() === trimmedUser);
    if (exists) {
      notify("error", "Username Taken", `Username "${newUser.username}" already exists.`);
      return;
    }

    const created = {
      id: "u-" + Math.random().toString(36).slice(2, 7),
      ...newUser,
      username: trimmedUser,
    };

    setDb(prev => ({
      ...prev,
      users: [...(prev.users || []), created],
      auditLog: [
        {
          id: "LOG-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
          time: new Date().toISOString().slice(0, 10) + " " + new Date().toTimeString().slice(0, 5),
          user: currentUser.name,
          role: "Owner",
          category: "Security",
          action: `Created new staff account: ${created.name} (${created.role})`,
          detail: `Username: ${created.username}`,
          target: created.username,
        },
        ...prev.auditLog
      ]
    }));

    notify("success", "Staff Account Created", `${created.name} (${created.username}) can now log in.`);
    setShowAdd(false);
    setNewUser({ username: "", name: "", role: "cashier", password: "", phone: "", pin: "1234" });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,30,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onClose}>
      <div className="hf-card" style={{ width: 560, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div className="disp" style={{ fontSize: 22, fontWeight: 700 }}>Staff & User Accounts</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Manage employee logins, roles, and access credentials.</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <table className="hf-table">
            <thead>
              <tr><th>Name</th><th>Username</th><th>Role</th><th>PIN</th></tr>
            </thead>
            <tbody>
              {(db.users || []).map(u => (
                <tr key={u.id}>
                  <td><b>{u.name}</b><div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{u.phone}</div></td>
                  <td className="mono">{u.username}</td>
                  <td>
                    <span className="hf-pill" style={{
                      background: u.role === "owner" ? "var(--rust-tint)" : "var(--line)",
                      color: u.role === "owner" ? "var(--rust)" : "var(--ink)"
                    }}>
                      {u.role.toUpperCase()}
                    </span>
                  </td>
                  <td className="mono">{u.pin || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showAdd ? (
          <div style={{ background: "var(--surface-hover)", padding: 14, borderRadius: 10, marginBottom: 16 }}>
            <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Add New Staff Member</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input className="hf-input" placeholder="Full Name (e.g. David — Cashier)" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} />
              <input className="hf-input" placeholder="Username (e.g. david)" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} />
              <select className="hf-input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                <option value="cashier">Cashier</option>
                <option value="storekeeper">Storekeeper</option>
                <option value="owner">Owner (Admin)</option>
              </select>
              <input className="hf-input" type="password" placeholder="Password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="hf-btn hf-btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="hf-btn hf-btn-primary" onClick={handleAddStaff}>Create Account</button>
            </div>
          </div>
        ) : (
          <button className="hf-btn hf-btn-ghost" onClick={() => setShowAdd(true)} style={{ width: "100%", justifyContent: "center", marginBottom: 14 }}>
            + Add New Employee Account
          </button>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="hf-btn hf-btn-dark" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
