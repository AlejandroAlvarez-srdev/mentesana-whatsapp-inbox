export default function InboxLoading() {
  return (
    <div
      style={{
        minHeight: "calc(100dvh - 80px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 14,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        background: "#FFFAF2",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 16,
            height: 16,
            border: "2px solid rgba(106,23,140,0.18)",
            borderTopColor: "#6A178C",
            borderRadius: "50%",
            animation: "ms-spin 0.7s linear infinite",
            display: "inline-block",
          }}
        />
        <span style={{ color: "#6A178C", fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>Cargando inbox…</span>
      </div>
      <style>{`@keyframes ms-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
