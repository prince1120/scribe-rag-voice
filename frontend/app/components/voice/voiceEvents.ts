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
  BOOKING_RESCHEDULED: "booking_rescheduled",
  BOOKING_CANCELLED: "booking_cancelled",
} as const;

export type VoiceDataPacketType =
  (typeof VOICE_DATA_PACKETS)[keyof typeof VOICE_DATA_PACKETS];
