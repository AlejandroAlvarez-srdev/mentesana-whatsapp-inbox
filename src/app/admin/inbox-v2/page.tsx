"use client";

import { useEffect, useState } from "react";
import ConversationList, { ConvSummary } from "./_components/ConversationList";
import ChatPanel from "./_components/ChatPanel";
import InsightsPanel from "./_components/InsightsPanel";
import { useBreakpoint } from "./_hooks/useBreakpoint";

const PURPLE = "#6A178C";

type View = "list" | "chat" | "insights";

export default function InboxV2Page() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<ConvSummary | null>(null);
  const bp = useBreakpoint();
  const [view, setView] = useState<View>("list");
  const [insightsOpen, setInsightsOpen] = useState(false);

  // Sincroniza con el hash del URL al mount y a cada hashchange
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        setSelectedId(hash);
        setView("chat");
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  // si seleccionas conversación en móvil, salta al chat automáticamente
  useEffect(() => {
    if (bp === "mobile" && selectedId) setView("chat");
  }, [selectedId, bp]);

  const isDesktop = bp === "desktop";
  const isTablet = bp === "tablet";
  const isMobile = bp === "mobile";

  // grid template adaptativo
  const gridCols = isDesktop
    ? "320px minmax(0,1fr) 380px"
    : isTablet
    ? "300px minmax(0,1fr)"
    : "minmax(0,1fr)";

  return (
    <div
      style={{
        height: "calc(100dvh - 64px)",
        display: "flex",
        flexDirection: "column",
        margin: isMobile ? "-20px -20px 0" : "-8px 0 0",
        padding: isMobile ? "10px 10px 0" : 0,
      }}
    >
      {/* Header compacto */}
      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: isMobile ? "6px 4px 12px" : "0 0 12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 22 }}>📥</span>
          <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: "#1a1a2e", margin: 0, letterSpacing: -0.3 }}>
            Inbox <span style={{ color: PURPLE }}>v2</span>
          </h1>
          {!isMobile && (
            <span style={{ fontSize: 11, color: "#999", marginLeft: 6 }}>
              Búsqueda semántica · IA estratégica · multi-número
            </span>
          )}
        </div>

        <nav style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <PillLink href="/admin/inbox-v2/expiring" tone="amber">⏰ Por cerrar</PillLink>
          <PillLink href="/admin/inbox-v2/health" tone="ghost">🩺 Salud</PillLink>
          <PillLink href="/admin/inbox-v2/numbers" tone="ghost">📱 Números</PillLink>
          {!isMobile && <PillLink href="/admin/inbox-v2/settings" tone="ghost">⚙️</PillLink>}
        </nav>
      </header>

      {/* Tabs móvil */}
      {isMobile && (
        <div style={{ display: "flex", gap: 4, padding: "0 0 10px", flexShrink: 0 }}>
          <MobileTab active={view === "list"} onClick={() => setView("list")}>📋 Conversaciones</MobileTab>
          <MobileTab active={view === "chat"} onClick={() => setView("chat")} disabled={!selectedId}>💬 Chat</MobileTab>
          <MobileTab active={view === "insights"} onClick={() => setView("insights")} disabled={!selectedId}>✨ IA</MobileTab>
        </div>
      )}

      {/* Grid principal */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: gridCols,
          gap: 10,
          overflow: "hidden",
        }}
      >
        {/* Lista */}
        <div style={{ display: isMobile && view !== "list" ? "none" : "flex", minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
            <ConversationList
              selectedId={selectedId}
              onSelect={(c) => {
                setSelectedId(c.id);
                setSelectedSummary(c);
                if (typeof window !== "undefined") window.history.replaceState(null, "", `#${c.id}`);
              }}
            />
          </div>
        </div>

        {/* Chat */}
        <div style={{ display: isMobile && view !== "chat" ? "none" : "flex", minHeight: 0, position: "relative" }}>
          {isMobile && selectedId && (
            <button
              onClick={() => setView("list")}
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                zIndex: 5,
                background: "#fff",
                border: "1px solid rgba(0,0,0,0.1)",
                borderRadius: 8,
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
            >
              ← Lista
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
            <ChatPanel conversationId={selectedId} />
          </div>

          {/* Toggle insights en tablet (FAB) */}
          {isTablet && selectedId && (
            <button
              onClick={() => setInsightsOpen(true)}
              title="Abrir panel IA"
              style={{
                position: "absolute",
                bottom: 80,
                right: 12,
                background: PURPLE,
                color: "#fff",
                border: "none",
                borderRadius: "50%",
                width: 48,
                height: 48,
                fontSize: 20,
                cursor: "pointer",
                boxShadow: "0 6px 20px rgba(106,23,140,0.4)",
                zIndex: 5,
              }}
            >
              ✨
            </button>
          )}
        </div>

        {/* Insights desktop (columna fija) */}
        {isDesktop && (
          <div style={{ display: "flex", minHeight: 0 }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
              <InsightsPanel conversationId={selectedId} selectedSummary={selectedSummary} />
            </div>
          </div>
        )}

        {/* Insights móvil (panel completo en vista IA) */}
        {isMobile && (
          <div style={{ display: view !== "insights" ? "none" : "flex", minHeight: 0, gridColumn: "1 / -1" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
              <InsightsPanel conversationId={selectedId} selectedSummary={selectedSummary} />
            </div>
          </div>
        )}
      </div>

      {/* Insights drawer en tablet */}
      {isTablet && insightsOpen && (
        <>
          <div
            onClick={() => setInsightsOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              zIndex: 40,
              animation: "fadeIn 0.18s",
            }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "min(420px, 90vw)",
              background: "#fff",
              zIndex: 41,
              boxShadow: "-12px 0 40px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              animation: "slideInRight 0.22s",
            }}
          >
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <strong style={{ fontSize: 14, color: "#1a1a2e" }}>✨ Panel IA</strong>
              <button
                onClick={() => setInsightsOpen(false)}
                style={{ background: "transparent", border: "none", fontSize: 22, color: "#666", cursor: "pointer" }}
              >
                ×
              </button>
            </header>
            <div style={{ flex: 1, minHeight: 0, padding: 8, display: "flex" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
                <InsightsPanel conversationId={selectedId} selectedSummary={selectedSummary} />
              </div>
            </div>
          </aside>
        </>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </div>
  );
}

function PillLink({ href, tone, children }: { href: string; tone: "amber" | "ghost"; children: React.ReactNode }) {
  const bg = tone === "amber" ? "rgba(245,158,11,0.12)" : "rgba(0,0,0,0.04)";
  const fg = tone === "amber" ? "#92400e" : "#666";
  return (
    <a
      href={href}
      style={{
        fontSize: 11,
        padding: "5px 10px",
        borderRadius: 6,
        background: bg,
        color: fg,
        textDecoration: "none",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </a>
  );
}

function MobileTab({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "9px 6px",
        border: "none",
        borderRadius: 8,
        background: active ? PURPLE : "rgba(0,0,0,0.04)",
        color: active ? "#fff" : disabled ? "#ccc" : "#666",
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.15s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
