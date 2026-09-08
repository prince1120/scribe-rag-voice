/**
 * Real-time voice data channel packet types exchanged between
 * the LiveKit worker and the browser client.
 *
 * Centralizes all protocol-level packet types to avoid magic strings across screens.
 */
export const VOICE_DATA_PACKETS = {
  INTERRUPT: "interrupt",
  CALL_ENDED: "call_ended",
  END_CALL: "end_call",
  BOOKING_CONFIRMED: "booking_confirmed",
  BOOKING_PENDING: "booking_pending",
  BOOKING_FAILED: "booking_failed",
  BOOKING_RESCHEDULED: "booking_rescheduled",
  BOOKING_CANCELLED: "booking_cancelled",
  AGENT_UNAVAILABLE: "agent_unavailable",
  TELEMETRY: "telemetry",
} as const;

export type VoiceDataPacketType =
  (typeof VOICE_DATA_PACKETS)[keyof typeof VOICE_DATA_PACKETS];

export interface TurnTelemetry {
  e2e_ms?: number;
  ttft_ms?: number;
  ttfb_ms?: number;
  eot_ms?: number;
  stt_ms?: number;
  model?: string;
  timestamp?: number;
}

export interface PostCallIntelligence {
  summary: string;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  key_points: string[];
  action_items: string[];
  unanswered_questions?: string[];
  needs_follow_up?: boolean;
}
