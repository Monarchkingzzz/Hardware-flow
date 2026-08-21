import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

export function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: 380,
        width: "90vw",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const isSuccess = t.type === "success";
        const isError = t.type === "error";
        const isWarning = t.type === "warning";

        const bg = isSuccess
          ? "#F0FDF4"
          : isError
          ? "#FEF2F2"
          : isWarning
          ? "#FFFBEB"
          : "#F0F9FF";

        const border = isSuccess
          ? "#86EFAC"
          : isError
          ? "#FCA5A5"
          : isWarning
          ? "#FDE68A"
          : "#BAE6FD";

        const textCol = isSuccess
          ? "#166534"
          : isError
          ? "#991B1B"
          : isWarning
          ? "#92400E"
          : "#075985";

        const Icon = isSuccess
          ? CheckCircle2
          : isError
          ? AlertCircle
          : isWarning
          ? AlertTriangle
          : Info;

        return (
          <div
            key={t.id}
            style={{
              pointerEvents: "auto",
              background: bg,
              border: `1.5px solid ${border}`,
              borderRadius: 12,
              padding: "12px 14px",
              boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              animation: "hf-toast-slide .25s cubic-bezier(0.16, 1, 0.3, 1)",
              color: textCol,
            }}
          >
            <Icon size={20} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>
                {t.message}
              </div>
              {t.detail && (
                <div
                  style={{
                    fontSize: 12,
                    marginTop: 3,
                    opacity: 0.9,
                    lineHeight: 1.4,
                  }}
                >
                  {t.detail}
                </div>
              )}
            </div>
            <button
              onClick={() => onDismiss(t.id)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 2,
                color: textCol,
                opacity: 0.6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = 0.6)}
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes hf-toast-slide {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
