"use client";

import { useEffect, useRef } from "react";
import { createClient, RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_BLOG_SUPABASE_ANON_KEY!;

// Singleton del cliente (un solo WebSocket compartido entre componentes).
let _client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return _client;
}

/**
 * Subscribe a INSERT/UPDATE en messages_mentesana filtrado por conversation_id.
 * Llama onInsert con cada mensaje nuevo y onUpdate con cada cambio de estado.
 */
export function useMessagesRealtime(
  conversationId: string | null,
  handlers: {
    onInsert?: (row: any) => void;
    onUpdate?: (row: any, oldRow: any) => void;
  },
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!conversationId) return;
    const sb = getClient();
    const channel: RealtimeChannel = sb
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages_mentesana", filter: `conversation_id=eq.${conversationId}` },
        (payload) => handlersRef.current.onInsert?.(payload.new),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages_mentesana", filter: `conversation_id=eq.${conversationId}` },
        (payload) => handlersRef.current.onUpdate?.(payload.new, payload.old),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [conversationId]);
}

/**
 * Subscribe global a INSERT/UPDATE en conversations_mentesana para refrescar la lista del inbox.
 */
export function useConversationsRealtime(handlers: { onChange?: (row: any, event: "INSERT" | "UPDATE" | "DELETE") => void }) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    const sb = getClient();
    const channel = sb
      .channel("conversations:global")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations_mentesana" }, (payload) => {
        const ev = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        handlersRef.current.onChange?.(payload.new ?? payload.old, ev);
      })
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, []);
}
