"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Room, RoomEvent, Track } from "livekit-client";
import type { RemoteTrack } from "livekit-client";
import { MIC_CAPTURE, VOICE_ROOM_OPTIONS } from "../../components/voice/useCallQuality";
import {
  Package,
  ShieldCheck,
  Send,
  AlertTriangle,
  FileText,
  CheckCircle2,
  RefreshCw,
  PhoneCall,
  Info,
  ChevronDown,
  ChevronUp,
  Building2,
  LifeBuoy,
  UserCheck,
  Clock,
  Mail,
  X,
  Phone,
  Mic,
  MicOff,
} from "lucide-react";
import "./product-support.css";
import { extractApiErrorMessage, formatClientError } from "../../lib/apiErrors";

interface ProductInfo {
  name: string;
  model_number: string;
  category: string | null;
  short_description: string | null;
  support_disclaimer: string | null;
}

interface Citation {
  filename: string;
  page_number?: number | null;
  snippet?: string;
}

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  citations?: Citation[];
  isSafetyWarning?: boolean;
  isAbstention?: boolean;
  isRetrievalFailure?: boolean;
}

interface ServiceRequestReceipt {
  request_id: string;
  name: string;
  reply_to: string;
  preferred_time?: string;
  message: string;
  created_at: string;
  status: string;
}

interface VoiceTranscriptLine {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export default function PublicProductQrPage() {
  const params = useParams();
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);

  // Chat states
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Voice states
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStatusMsg, setVoiceStatusMsg] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState<VoiceTranscriptLine[]>([]);
  const [voiceConsentAccepted, setVoiceConsentAccepted] = useState(false);
  const [voiceHasConnected, setVoiceHasConnected] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceStartedAt, setVoiceStartedAt] = useState<number | null>(null);
  const [voiceDurationSeconds, setVoiceDurationSeconds] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);

  // Expanded citations map
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  useEffect(() => {
    if (!voiceStartedAt) return;
    const updateDuration = () => setVoiceDurationSeconds(Math.floor((Date.now() - voiceStartedAt) / 1000));
    updateDuration();
    const interval = window.setInterval(updateDuration, 1000);
    return () => window.clearInterval(interval);
  }, [voiceStartedAt]);

  const formatVoiceDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const remainder = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  };

  // Open QR Link on mount
  useEffect(() => {
    if (!token) return;

    const openLink = async () => {
      setLoading(true);
      setErrorStatus(null);
      setErrorMessage(null);

      try {
        const res = await fetch(`/api/v1/product-qr/public/${token}/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });

        if (!res.ok) {
          setErrorStatus(res.status);
          const detail = await extractApiErrorMessage(res, "Unable to open product support link.");
          setErrorMessage(detail);
          return;
        }

        const data = await res.json();
        setProduct(data.product);
        if (data.business?.business_name) {
          setBusinessName(data.business.business_name);
        }
        // Add welcome message
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content: `Hello! I am your official support assistant for the ${data.product.name} (Model: ${data.product.model_number}). Ask me anything about setup, troubleshooting, error codes, or maintenance.`,
          },
        ]);
      } catch (err: any) {
        setErrorStatus(500);
        setErrorMessage(formatClientError(err, "Failed to reach product support service."));
      } finally {
        setLoading(false);
      }
    };

    openLink();
  }, [token]);

  // Support Request modal states
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [supportTrigger, setSupportTrigger] = useState<"manual" | "abstention" | "safety">("manual");
  const [supportName, setSupportName] = useState("");
  const [supportReplyTo, setSupportReplyTo] = useState("");
  const [supportPreferredTime, setSupportPreferredTime] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportConsent, setSupportConsent] = useState(false);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportFieldErrors, setSupportFieldErrors] = useState<{
    name?: string;
    reply_to?: string;
    message?: string;
    consent?: string;
  }>({});
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [supportReceipt, setSupportReceipt] = useState<ServiceRequestReceipt | null>(null);
  const supportRequestIdRef = useRef<string | null>(null);
  const isSubmittingRef = useRef(false);

  // Rate-limit countdown timer
  useEffect(() => {
    if (retryAfterSeconds === null || retryAfterSeconds <= 0) return;
    const timer = setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfterSeconds]);

  // Keyboard accessibility for modal
  useEffect(() => {
    if (!supportModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !supportSubmitting) {
        handleDismissSupportModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [supportModalOpen, supportSubmitting]);

  const openSupportModal = (
    trigger: "manual" | "abstention" | "safety",
    defaultMessage?: string
  ) => {
    setSupportTrigger(trigger);
    if (!supportReceipt) {
      if (!supportRequestIdRef.current) {
        supportRequestIdRef.current =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      }
    }
    if (defaultMessage && !supportMessage) {
      setSupportMessage(defaultMessage);
    }
    setSupportError(null);
    setSupportFieldErrors({});
    setSupportModalOpen(true);
  };

  const handleDismissSupportModal = () => {
    if (supportSubmitting) return;
    setSupportModalOpen(false);
    if (supportReceipt) {
      setSupportReceipt(null);
      setSupportName("");
      setSupportReplyTo("");
      setSupportPreferredTime("");
      setSupportMessage("");
      setSupportConsent(false);
      supportRequestIdRef.current = null;
    }
  };

  const validateSupportForm = () => {
    const errors: { name?: string; reply_to?: string; message?: string; consent?: string } = {};
    if (!supportName.trim()) {
      errors.name = "Please enter your name.";
    }
    const cleanReply = supportReplyTo.trim();
    if (!cleanReply) {
      errors.reply_to = "Please provide an email address or phone number.";
    } else {
      const isEmail = cleanReply.includes("@") && cleanReply.includes(".");
      const digitsOnly = cleanReply.replace(/\D/g, "");
      const isPhone = digitsOnly.length >= 7;
      if (!isEmail && !isPhone) {
        errors.reply_to = "Please enter a valid email address or phone number (minimum 7 digits).";
      }
    }
    if (!supportMessage.trim()) {
      errors.message = "Please describe what you need assistance with.";
    }
    if (!supportConsent) {
      errors.consent = "Please agree to be contacted regarding this request.";
    }
    setSupportFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitSupport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmittingRef.current || supportSubmitting) return;

    if (!validateSupportForm()) return;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSupportError("You appear to be offline. Please check your internet connection and try again.");
      return;
    }

    if (!supportRequestIdRef.current) {
      supportRequestIdRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }
    const reqId = supportRequestIdRef.current;

    setSupportSubmitting(true);
    isSubmittingRef.current = true;
    setSupportError(null);
    setRetryAfterSeconds(null);

    try {
      const res = await fetch("/api/v1/product-qr/public/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          request_id: reqId,
          session_token: token || "",
          name: supportName.trim(),
          reply_to: supportReplyTo.trim(),
          preferred_time: supportPreferredTime.trim() || undefined,
          message: supportMessage.trim(),
          trigger: supportTrigger,
          consent: true,
        }),
      });

      if (res.status === 429) {
        const retryHeader = res.headers.get("Retry-After");
        const seconds = retryHeader ? parseInt(retryHeader, 10) : 60;
        const finalSecs = !isNaN(seconds) && seconds > 0 ? seconds : 60;
        setRetryAfterSeconds(finalSecs);
        setSupportError(`Support request limit reached. Please wait ${finalSecs} seconds before trying again.`);
        return;
      }

      if (res.status === 403 || res.status === 404) {
        setSupportError("Human support is unavailable or this product link has expired.");
        return;
      }

      if (!res.ok) {
        const detail = await extractApiErrorMessage(res, "Could not submit your support request right now.");
        throw new Error(detail);
      }

      const data = await res.json();
      setSupportReceipt({
        request_id: data.request_id || reqId,
        name: supportName.trim(),
        reply_to: supportReplyTo.trim(),
        preferred_time: supportPreferredTime.trim() || undefined,
        message: supportMessage.trim(),
        created_at: data.created_at || new Date().toISOString(),
        status: data.status || "open",
      });
      // Clear idempotent UUID ref only upon success
      supportRequestIdRef.current = null;
    } catch (err: any) {
      setSupportError(
        formatClientError(err, "We encountered an issue submitting your request. Your details are saved—please retry.")
      );
      // Keep supportRequestIdRef.current intact for idempotent retry!
    } finally {
      setSupportSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  // Send Chat message
  const handleSendMessage = async (queryText?: string) => {
    const textToSend = (queryText || input).trim();
    if (!textToSend || sending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: textToSend,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!queryText) setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/v1/product-qr/public/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: textToSend }),
      });

      if (!res.ok) {
        const detail = await extractApiErrorMessage(res, "Failed to get response from product support.");
        throw new Error(detail);
      }

      const data = await res.json();
      const isSafety = Boolean(data.is_safety_escalation);
      const abstentionPhrases = [
        "couldn't find that information",
        "could not find that information",
        "not found in the official manual",
        "not mentioned in this product's official",
      ];
      const isAbstention = Boolean(
        data.is_abstention ||
        (data.reply && abstentionPhrases.some((p) => data.reply.toLowerCase().includes(p)))
      );
      const isRetrievalFailure = Boolean(data.is_retrieval_failure);

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.reply,
        citations: data.citations || [],
        isSafetyWarning: isSafety,
        isAbstention: isAbstention,
        isRetrievalFailure: isRetrievalFailure,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: formatClientError(err, "Sorry, I had trouble processing that question. Please try again in a moment."),
          isRetrievalFailure: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const teardownVoice = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        room.disconnect();
      } catch {
        // The room may already be disconnected.
      }
    }
    for (const element of audioElementsRef.current) {
      try {
        element.pause();
        element.remove();
      } catch {
        // Best-effort DOM cleanup.
      }
    }
    audioElementsRef.current = [];
    setVoiceActive(false);
    setVoiceConnecting(false);
    setVoiceMuted(false);
    setVoiceStartedAt(null);
  }, []);

  useEffect(() => () => teardownVoice(), [teardownVoice]);

  // Start a real LiveKit WebRTC voice session.
  const handleStartVoice = async () => {
    if (voiceActive) {
      teardownVoice();
      setVoiceStatusMsg("Voice session ended.");
      return;
    }

    if (!voiceConsentAccepted) {
      setVoiceStatusMsg("Please confirm voice processing and transcript consent before connecting.");
      return;
    }

    setVoiceConnecting(true);
    setVoiceUnavailable(false);
    setVoiceStatusMsg(null);

    try {
      const res = await fetch("/api/v1/product-qr/public/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent_accepted: voiceConsentAccepted }),
        credentials: "include",
      });

      if (res.status === 403) {
        setVoiceUnavailable(true);
        setVoiceStatusMsg("Voice support is unavailable for this product. Text support remains available below.");
        return;
      }

      if (res.status === 429) {
        setVoiceUnavailable(true);
        setVoiceStatusMsg("Voice troubleshooting rate limit reached. Please wait a moment or use text chat below.");
        return;
      }

      if (res.status === 502 || res.status === 503) {
        setVoiceUnavailable(true);
        setVoiceStatusMsg(
          "Voice troubleshooting service is temporarily offline. Please use text chat below for instant assistance."
        );
        return;
      }

      if (!res.ok) {
        const detail = await extractApiErrorMessage(res, "Voice service unavailable");
        throw new Error(detail);
      }

      const data = await res.json();
      const room = new Room(VOICE_ROOM_OPTIONS);
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach() as HTMLAudioElement;
        element.autoplay = true;
        element.style.display = "none";
        document.body.appendChild(element);
        audioElementsRef.current.push(element);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((element) => element.remove());
        audioElementsRef.current = audioElementsRef.current.filter((element) =>
          document.body.contains(element)
        );
      });

      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        const role: VoiceTranscriptLine["role"] =
          participant?.identity === room.localParticipant.identity ? "user" : "assistant";
        setVoiceTranscript((current) => {
          const next = [...current];
          for (const segment of segments) {
            const line = { id: segment.id, role, text: segment.text, final: segment.final };
            const existing = next.findIndex((item) => item.id === segment.id);
            if (existing >= 0) next[existing] = line;
            else next.push(line);
          }
          return next.slice(-40);
        });
      });

      room.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        audioElementsRef.current.forEach((element) => element.remove());
        audioElementsRef.current = [];
        setVoiceActive(false);
        setVoiceConnecting(false);
        setVoiceMuted(false);
        setVoiceStartedAt(null);
        setVoiceStatusMsg("Voice session ended. Text support remains available.");
      });

      await room.connect(data.url, data.token);
      await room.localParticipant.setMicrophoneEnabled(true, { ...MIC_CAPTURE });
      setVoiceActive(true);
      setVoiceHasConnected(true);
      setVoiceMuted(false);
      setVoiceStartedAt(Date.now());
      setVoiceDurationSeconds(0);
      setVoiceStatusMsg("Voice support connected. You can speak now.");
    } catch (err: any) {
      teardownVoice();
      setVoiceUnavailable(true);
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError" || err?.message?.toLowerCase().includes("permission")) {
        setVoiceStatusMsg("Microphone access was denied. Please allow microphone permissions in your browser to speak, or use text chat below.");
      } else {
        setVoiceStatusMsg(formatClientError(err, "Could not connect to voice support. Text chat remains available."));
      }
    } finally {
      setVoiceConnecting(false);
    }
  };

  const handleToggleMute = async () => {
    const room = roomRef.current;
    if (!room || !voiceActive) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(voiceMuted, { ...MIC_CAPTURE });
      setVoiceMuted((muted) => !muted);
    } catch (err) {
      setVoiceStatusMsg(formatClientError(err, "Could not change microphone status."));
    }
  };

  // Toggle citations accordion
  const toggleCitation = (msgId: string) => {
    setExpandedCitations((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  // Render Loading
  if (loading) {
    return (
      <div className="product-support-page min-h-screen bg-[#F0EEE6] text-[#181818] flex flex-col items-center justify-center p-6 space-y-4">
        <RefreshCw className="w-8 h-8 text-[#4854A8] animate-spin" />
        <p className="text-sm text-[#87847A] font-medium">Opening official product support...</p>
      </div>
    );
  }

  // Render Errors (404, 410, 500)
  if (errorStatus || !product) {
    return (
      <div className="product-support-page min-h-screen bg-[#F0EEE6] text-[#181818] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full p-6 sm:p-8 rounded-3xl bg-[#FAF9F5] border border-[#DDD9CC] text-center space-y-5 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-bold text-[#181818]">
              {errorStatus === 410 ? "Support Link Expired" : "Support Link Unavailable"}
            </h1>
            <p className="text-sm text-[#87847A] leading-relaxed">
              {errorMessage || "The product QR link you scanned is invalid, expired, or has been revoked."}
            </p>
          </div>

          <div className="pt-3 text-xs text-[#87847A] border-t border-[#DDD9CC]">
            If you need warranty service or repair, please contact the manufacturer or authorized vendor directly.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="product-support-page min-h-screen bg-[#F0EEE6] text-[#181818] flex flex-col antialiased">
      {/* Top Header with Business Branding */}
      <header className="sticky top-0 z-20 bg-[#FAF9F5]/90 backdrop-blur-md border-b border-[#DDD9CC] px-4 py-3 sm:px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#DEE2F2] border border-[#4854A8]/20 text-[#4854A8] flex items-center justify-center shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                {businessName && (
                  <span className="text-[11px] font-semibold text-[#87847A] flex items-center gap-1 shrink-0">
                    <Building2 className="w-3 h-3" />
                    {businessName} •
                  </span>
                )}
                <h1 className="text-sm font-semibold text-[#181818] truncate max-w-[170px] sm:max-w-md">
                  {product.name}
                </h1>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#DEE2F2] text-[#4854A8] border border-[#4854A8]/20 shrink-0">
                  {product.model_number}
                </span>
              </div>
              <p className="text-[11px] text-emerald-700 font-medium flex items-center gap-1 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> Official Support Grounded in Manuals
              </p>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openSupportModal("manual")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white hover:bg-[#F5F3EB] text-[#181818] border border-[#DDD9CC] shadow-2xs transition min-h-[44px]"
              title="Request Human Support"
            >
              <LifeBuoy className="w-4 h-4 text-[#4854A8]" />
              <span className="hidden sm:inline">Human Help</span>
            </button>

            {!voiceActive && (
              <button
                onClick={handleStartVoice}
                disabled={voiceConnecting}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition border shrink-0 min-h-[44px] ${
                  voiceConnecting
                  ? "bg-[#F5F3EB] text-[#87847A] border-[#DDD9CC] cursor-wait"
                  : "bg-white hover:bg-[#F5F3EB] text-[#181818] border-[#DDD9CC] shadow-xs"
                }`}
              >
                {voiceConnecting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-[#4854A8]" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <PhoneCall className="w-4 h-4 text-[#4854A8]" />
                  <span>{voiceHasConnected ? "Reconnect Voice" : "Voice Help"}</span>
                </>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Voice Status Alert */}
      {voiceStatusMsg && !voiceActive && !voiceConnecting && (
        <div
          role="status"
          className={`px-4 py-2.5 text-xs text-center border-b font-medium ${
            voiceUnavailable
              ? "bg-amber-50 border-amber-200 text-amber-900"
              : "bg-emerald-50 border-emerald-200 text-emerald-900"
          }`}
        >
          {voiceStatusMsg}
        </div>
      )}

      {/* Visible Support Disclaimer */}
      <div className="bg-[#FAF9F5]/70 border-b border-[#DDD9CC] py-2 px-4 text-center">
        <p className="text-[11px] text-[#87847A] max-w-3xl mx-auto flex items-center justify-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-[#4854A8] shrink-0" />
          <span>
            {product.support_disclaimer ||
              "Official brand support. Answers are grounded exclusively in authorized product documentation."}
          </span>
        </p>
      </div>

      {(voiceActive || voiceConnecting) && (
        <section className="voice-session-bar" aria-label="Voice support controls">
          <div className="voice-session-bar__inner">
            <div className="voice-session-bar__status">
              <span className={voiceActive ? "voice-session-bar__pulse" : "voice-session-bar__pulse is-connecting"} aria-hidden="true" />
              <div>
                <strong>{voiceActive ? "Voice support is live" : "Connecting voice support"}</strong>
                <small>{voiceActive ? (voiceMuted ? "Your microphone is muted" : "Speak naturally. Your transcript appears below.") : "Preparing a secure support call"}</small>
              </div>
            </div>
            {voiceActive && (
              <div className="voice-session-bar__actions">
                <span className="voice-session-bar__timer" aria-label={`Call duration ${formatVoiceDuration(voiceDurationSeconds)}`}>
                  <Clock className="w-3.5 h-3.5" /> {formatVoiceDuration(voiceDurationSeconds)}
                </span>
                <button type="button" onClick={handleToggleMute} className="voice-session-bar__quiet-button">
                  {voiceMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  {voiceMuted ? "Unmute" : "Mute"}
                </button>
                <button type="button" onClick={handleStartVoice} className="voice-session-bar__end-button">
                  <Phone className="w-4 h-4" /> End call
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {!voiceConsentAccepted && !voiceActive && (
        <div className="voice-consent">
          <label>
            <input
              type="checkbox"
              checked={voiceConsentAccepted}
              onChange={(event) => setVoiceConsentAccepted(event.target.checked)}
            />
            <span>I agree that my voice will be processed and the transcript saved for product support.</span>
          </label>
        </div>
      )}

      {/* Main Chat Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-5">
        {(voiceActive || voiceTranscript.length > 0) && (
          <section className={`voice-transcript${voiceActive ? " is-active" : ""}`} aria-label="Live voice transcript" aria-live="polite">
            <div className="voice-transcript__header">
              <div>
                <span className={voiceActive ? "is-live" : ""} aria-hidden="true" />
                <strong>{voiceActive ? "Live voice transcript" : "Voice transcript"}</strong>
              </div>
              <small>{voiceActive ? "Updating as you speak" : "Voice session ended"}</small>
            </div>
            <div className="voice-transcript__lines">
              {voiceTranscript.length === 0 && voiceActive && (
                <p className="voice-transcript__empty">Listening for your question...</p>
              )}
              {voiceTranscript.map((line) => (
                <div key={line.id} className={`voice-transcript__line is-${line.role}${line.final ? "" : " is-interim"}`}>
                  <b>{line.role === "user" ? "You" : "Assistant"}</b>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {messages.length <= 1 && !voiceActive && !voiceConnecting && (
        <div className="suggestion-row flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none text-xs">
          <span className="text-[#87847A] shrink-0 font-medium">Suggestions:</span>
          {["Common error codes", "Reset instructions", "Cleaning & maintenance", "Warranty details"].map(
            (chip) => (
              <button
                key={chip}
                onClick={() => handleSendMessage(chip)}
                className="shrink-0 px-3.5 py-1.5 rounded-full bg-white hover:bg-[#F5F3EB] border border-[#DDD9CC] text-[#2C2B28] hover:text-[#181818] transition shadow-2xs min-h-[36px]"
              >
                {chip}
              </button>
            )
          )}
        </div>
        )}

        {/* Message Stream */}
        <div className="message-stream flex-1 w-full max-w-3xl mx-auto space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[88%] sm:max-w-[80%] rounded-2xl p-4 text-sm leading-relaxed shadow-xs ${
                  msg.role === "user"
                    ? "bg-[#4854A8] text-white rounded-br-xs"
                    : msg.isSafetyWarning
                    ? "bg-rose-50 border border-rose-200 text-rose-950 rounded-bl-xs"
                    : "bg-[#FAF9F5] border border-[#DDD9CC] text-[#181818] rounded-bl-xs"
                }`}
              >
                {/* Safety Warning Header */}
                {msg.isSafetyWarning && (
                  <div className="flex items-center gap-2 text-rose-700 font-semibold text-xs mb-2 pb-2 border-b border-rose-200">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Physical Safety & Hazard Warning
                  </div>
                )}

                <div className="whitespace-pre-wrap">{msg.content}</div>

                {/* Safety Escalation Action */}
                {msg.isSafetyWarning && (
                  <div className="mt-3 pt-2.5 border-t border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="text-rose-900 font-medium">
                      Immediate human specialist assistance is advised for safety hazards.
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        openSupportModal(
                          "safety",
                          `Safety assistance needed regarding ${product.name}: ${msg.content.slice(0, 150)}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium shrink-0 transition"
                    >
                      <LifeBuoy className="w-3.5 h-3.5" />
                      Request Human Help
                    </button>
                  </div>
                )}

                {/* Abstention Escalation Action */}
                {msg.isAbstention && (
                  <div className="mt-3 pt-2.5 border-t border-[#DDD9CC] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="text-[#666] font-medium">
                      Not covered in official documentation? Our support specialists can help.
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        openSupportModal(
                          "abstention",
                          `Question regarding ${product.name} (not covered in manuals)`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4854A8] hover:bg-[#353F8A] text-white font-medium shrink-0 transition"
                    >
                      <LifeBuoy className="w-3.5 h-3.5" />
                      Ask Our Team
                    </button>
                  </div>
                )}

                {/* Retrieval Failure Escalation Action */}
                {msg.isRetrievalFailure && (
                  <div className="mt-3 pt-2.5 border-t border-[#DDD9CC] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="text-[#666] font-medium">
                      Need direct help from a person?
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        openSupportModal(
                          "manual",
                          `Troubleshooting request for ${product.name}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#DDD9CC] hover:bg-[#F5F3EB] text-[#181818] font-medium shrink-0 transition"
                    >
                      <LifeBuoy className="w-3.5 h-3.5 text-[#4854A8]" />
                      Request Human Support
                    </button>
                  </div>
                )}

                {/* Grounding Citations Accordion */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-[#DDD9CC] text-xs">
                    <button
                      onClick={() => toggleCitation(msg.id)}
                      className="flex items-center gap-1.5 text-[#4854A8] hover:text-[#353F8A] font-medium transition"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#4854A8]" />
                      <span>{msg.citations.length} verified manual source(s)</span>
                      {expandedCitations[msg.id] ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {expandedCitations[msg.id] && (
                      <div className="mt-2 space-y-2 pl-3 py-1 border-l-2 border-[#4854A8] bg-[#F5F3EB] rounded-r-lg">
                        {msg.citations.map((c, idx) => (
                          <div key={idx} className="space-y-0.5 text-[#2C2B28]">
                            <p className="font-semibold text-[#181818]">
                              {c.filename} {c.page_number ? `(Page ${c.page_number})` : ""}
                            </p>
                            {c.snippet && (
                              <p className="text-[11px] text-[#555] italic">
                                &ldquo;{c.snippet}&rdquo;
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex items-start">
              <div className="rounded-2xl rounded-bl-xs p-4 bg-[#FAF9F5] border border-[#DDD9CC] text-[#87847A] text-xs flex items-center gap-2 shadow-xs">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#4854A8]" />
                Checking official product documentation...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Chat Input Bar - Available immediately */}
      <footer className="sticky bottom-0 z-20 bg-[#FAF9F5]/95 backdrop-blur-md border-t border-[#DDD9CC] p-3 sm:p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="max-w-5xl mx-auto flex items-center gap-2"
        >
          <input
            type="text"
            placeholder={`Ask about ${product.name}...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            autoFocus
            className="flex-1 px-4 py-3 rounded-xl bg-white border border-[#DDD9CC] text-[#181818] placeholder-[#87847A] text-sm focus:outline-none focus:ring-2 focus:ring-[#4854A8]/30 focus:border-[#4854A8] transition shadow-2xs min-h-[44px]"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="px-4 py-3 rounded-xl bg-[#4854A8] hover:bg-[#353F8A] disabled:opacity-30 text-white transition shadow-sm shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center font-medium"
            title="Send Question"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </footer>

      {/* Human Support Request Modal Dialog */}
      {supportModalOpen && (
        <div
          className="support-modal-backdrop"
          onClick={handleDismissSupportModal}
          role="presentation"
        >
          <div
            className="support-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[#DDD9CC] flex items-center justify-between gap-3 bg-[#FAF9F5]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                    supportReceipt
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : supportTrigger === "safety"
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : "bg-[#DEE2F2] text-[#4854A8] border-[#4854A8]/20"
                  }`}
                >
                  {supportReceipt ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <LifeBuoy className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2
                    id="support-dialog-title"
                    className="text-base font-bold text-[#181818] truncate"
                  >
                    {supportReceipt ? "Request Received" : "Request Human Support"}
                  </h2>
                  <p className="text-xs text-[#87847A] truncate">
                    {product.name} ({product.model_number})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDismissSupportModal}
                disabled={supportSubmitting}
                className="p-1.5 rounded-lg text-[#87847A] hover:text-[#181818] hover:bg-[#EAE7DD] transition disabled:opacity-30"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(90dvh-130px)] space-y-4">
              {supportReceipt ? (
                /* Success Receipt View */
                <div className="space-y-4 text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                    <UserCheck className="w-6 h-6" />
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-[#181818]">
                      We have received your support request
                    </h3>
                    <p className="text-xs text-[#87847A] max-w-sm mx-auto">
                      A product specialist has been notified and will reach out via your preferred contact method.
                    </p>
                  </div>

                  {/* Receipt Details Card */}
                  <div className="bg-white border border-[#DDD9CC] rounded-xl p-4 text-left space-y-2.5 text-xs text-[#181818]">
                    <div className="flex items-center justify-between border-b border-[#DDD9CC] pb-2">
                      <span className="text-[#87847A]">Reference ID:</span>
                      <code className="font-mono text-[11px] bg-[#F5F3EB] px-2 py-0.5 rounded text-[#4854A8] font-bold">
                        {supportReceipt.request_id}
                      </code>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[#87847A]">Status:</span>
                      <span className="business-status is-open">{supportReceipt.status}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[#87847A]">Contact:</span>
                      <span className="font-medium text-[#181818]">{supportReceipt.reply_to}</span>
                    </div>

                    {supportReceipt.preferred_time && (
                      <div className="flex items-center justify-between">
                        <span className="text-[#87847A]">Preferred Time:</span>
                        <span className="font-medium text-[#181818]">{supportReceipt.preferred_time}</span>
                      </div>
                    )}

                    <div className="border-t border-[#DDD9CC] pt-2">
                      <span className="text-[#87847A] block mb-1">Message:</span>
                      <p className="text-xs bg-[#FAF9F5] p-2 rounded border border-[#DDD9CC] whitespace-pre-wrap">
                        {supportReceipt.message}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#87847A] pt-1">
                      <span>Submitted:</span>
                      <span>{new Date(supportReceipt.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleDismissSupportModal}
                    className="w-full py-2.5 rounded-xl bg-[#4854A8] hover:bg-[#353F8A] text-white font-medium text-sm transition shadow-xs min-h-[44px]"
                  >
                    Done
                  </button>
                </div>
              ) : (
                /* Support Form View */
                <form onSubmit={handleSubmitSupport} className="space-y-4">
                  {/* Context Banner */}
                  {supportTrigger === "safety" && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-950 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                      <div>
                        <strong>Safety Escalation:</strong> This request is marked with priority so our team can address the hazard safely.
                      </div>
                    </div>
                  )}

                  {supportTrigger === "abstention" && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 flex items-start gap-2">
                      <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <strong>Manual Gap:</strong> We will connect you directly with a specialist who has access to engineering and field service notes.
                      </div>
                    </div>
                  )}

                  {/* Error Notification */}
                  {supportError && (
                    <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p>{supportError}</p>
                        {retryAfterSeconds && (
                          <p className="mt-1 font-semibold text-rose-900">
                            Countdown: {retryAfterSeconds}s remaining
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Name field */}
                  <div className="space-y-1">
                    <label htmlFor="support-name" className="text-xs font-semibold text-[#181818] block">
                      Your Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="support-name"
                      type="text"
                      maxLength={100}
                      value={supportName}
                      onChange={(e) => {
                        setSupportName(e.target.value);
                        if (supportFieldErrors.name) {
                          setSupportFieldErrors((prev) => ({ ...prev, name: undefined }));
                        }
                      }}
                      disabled={supportSubmitting}
                      placeholder="e.g. Alex Morgan"
                      className={`w-full px-3.5 py-2 rounded-xl bg-white border text-sm text-[#181818] focus:outline-none focus:ring-2 focus:ring-[#4854A8]/30 transition min-h-[42px] ${
                        supportFieldErrors.name ? "border-rose-400 bg-rose-50/30" : "border-[#DDD9CC]"
                      }`}
                    />
                    {supportFieldErrors.name && (
                      <p className="text-xs text-rose-600">{supportFieldErrors.name}</p>
                    )}
                  </div>

                  {/* Reply To field */}
                  <div className="space-y-1">
                    <label htmlFor="support-reply-to" className="text-xs font-semibold text-[#181818] block">
                      Email or Phone Number <span className="text-rose-600">*</span>
                    </label>
                    <div className="relative">
                      <input
                        id="support-reply-to"
                        type="text"
                        maxLength={120}
                        value={supportReplyTo}
                        onChange={(e) => {
                          setSupportReplyTo(e.target.value);
                          if (supportFieldErrors.reply_to) {
                            setSupportFieldErrors((prev) => ({ ...prev, reply_to: undefined }));
                          }
                        }}
                        disabled={supportSubmitting}
                        placeholder="alex@example.com or (555) 123-4567"
                        className={`w-full px-3.5 py-2 pl-9 rounded-xl bg-white border text-sm text-[#181818] focus:outline-none focus:ring-2 focus:ring-[#4854A8]/30 transition min-h-[42px] ${
                          supportFieldErrors.reply_to ? "border-rose-400 bg-rose-50/30" : "border-[#DDD9CC]"
                        }`}
                      />
                      <Mail className="w-4 h-4 text-[#87847A] absolute left-3 top-3 pointer-events-none" />
                    </div>
                    {supportFieldErrors.reply_to && (
                      <p className="text-xs text-rose-600">{supportFieldErrors.reply_to}</p>
                    )}
                  </div>

                  {/* Preferred Time Window */}
                  <div className="space-y-1">
                    <label htmlFor="support-preferred-time" className="text-xs font-semibold text-[#181818] block">
                      Preferred Contact Time <span className="text-[#87847A] font-normal">(optional)</span>
                    </label>
                    <select
                      id="support-preferred-time"
                      value={supportPreferredTime}
                      onChange={(e) => setSupportPreferredTime(e.target.value)}
                      disabled={supportSubmitting}
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-[#DDD9CC] text-sm text-[#181818] focus:outline-none focus:ring-2 focus:ring-[#4854A8]/30 transition min-h-[42px]"
                    >
                      <option value="">Any time during standard hours</option>
                      <option value="Morning (9:00 AM – 12:00 PM)">Morning (9:00 AM – 12:00 PM)</option>
                      <option value="Afternoon (12:00 PM – 5:00 PM)">Afternoon (12:00 PM – 5:00 PM)</option>
                      <option value="Evening (5:00 PM – 8:00 PM)">Evening (5:00 PM – 8:00 PM)</option>
                      <option value="Urgent (As soon as possible)">Urgent (As soon as possible)</option>
                    </select>
                  </div>

                  {/* Issue description message */}
                  <div className="space-y-1">
                    <label htmlFor="support-message" className="text-xs font-semibold text-[#181818] block">
                      How can our team help? <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      id="support-message"
                      rows={3}
                      maxLength={2000}
                      value={supportMessage}
                      onChange={(e) => {
                        setSupportMessage(e.target.value);
                        if (supportFieldErrors.message) {
                          setSupportFieldErrors((prev) => ({ ...prev, message: undefined }));
                        }
                      }}
                      disabled={supportSubmitting}
                      placeholder="Describe what you were trying to do or what issue occurred..."
                      className={`w-full px-3.5 py-2 rounded-xl bg-white border text-sm text-[#181818] focus:outline-none focus:ring-2 focus:ring-[#4854A8]/30 transition resize-y min-h-[80px] ${
                        supportFieldErrors.message ? "border-rose-400 bg-rose-50/30" : "border-[#DDD9CC]"
                      }`}
                    />
                    {supportFieldErrors.message && (
                      <p className="text-xs text-rose-600">{supportFieldErrors.message}</p>
                    )}
                  </div>

                  {/* Explicit Consent Checkbox */}
                  <div className="pt-1">
                    <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#2C2B28]">
                      <input
                        type="checkbox"
                        id="support-consent"
                        checked={supportConsent}
                        onChange={(e) => {
                          setSupportConsent(e.target.checked);
                          if (supportFieldErrors.consent) {
                            setSupportFieldErrors((prev) => ({ ...prev, consent: undefined }));
                          }
                        }}
                        disabled={supportSubmitting}
                        className="mt-0.5 rounded border-[#DDD9CC] text-[#4854A8] focus:ring-[#4854A8]"
                      />
                      <span className="leading-snug">
                        I agree to be contacted by {businessName || "the support team"} regarding this product assistance request.
                      </span>
                    </label>
                    {supportFieldErrors.consent && (
                      <p className="text-xs text-rose-600 mt-1">{supportFieldErrors.consent}</p>
                    )}
                  </div>

                  {/* Modal Actions */}
                  <div className="pt-3 border-t border-[#DDD9CC] flex items-center justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={handleDismissSupportModal}
                      disabled={supportSubmitting}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-[#181818] bg-transparent hover:bg-[#EAE7DD] border border-[#DDD9CC] transition min-h-[42px]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={supportSubmitting || (retryAfterSeconds !== null && retryAfterSeconds > 0)}
                      className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-[#4854A8] hover:bg-[#353F8A] disabled:opacity-40 transition shadow-sm flex items-center gap-1.5 min-h-[42px]"
                    >
                      {supportSubmitting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Submitting...</span>
                        </>
                      ) : supportError ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Retry Request</span>
                        </>
                      ) : (
                        <span>Submit Request</span>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
