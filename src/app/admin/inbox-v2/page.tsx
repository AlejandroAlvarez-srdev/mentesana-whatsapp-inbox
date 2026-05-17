"use client";

import { useEffect, useState } from "react";
import ConversationList, { ConvSummary } from "./_components/ConversationList";
import ChatPanel from "./_components/ChatPanel";
import InsightsPanel from "./_components/InsightsPanel";

const PURPLE = "#6A178C";

export default function InboxV2Page() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<ConvSummary | null>(null);

  // shortcut: cuando llegas con #id en URL
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (hash) setSelectedId(hash);
  }, []);

  return (
    <div style={{ height: "calc(100vh - 80px)", display: "flex", flexDirection: "column" }}>
      <header style={{ marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>📥 Inbox v2</h1>
          <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, background: "rgba(106,23,140,0.08)", color: PURPLE, fontWeight: 600 }}>READ-ONLY · Sprint 1</span>
          <span style={{ fontSize: 12, color: "#888" }}>Búsqueda semántica · resumen IA · sugerencia de respuesta basada en casos pagados</span>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "340px 1fr 380px",
          gap: 12,
          overflow: "hidden",
        }}
      >
        <ConversationList
          selectedId={selectedId}
          onSelect={(c) => {
            setSelectedId(c.id);
            setSelectedSummary(c);
          }}
        />
        <ChatPanel conversationId={selectedId} />
        <InsightsPanel conversationId={selectedId} selectedSummary={selectedSummary} />
      </div>
    </div>
  );
}
