"use client";

import { useEffect, useState } from "react";
import { ConnectionState, RoomEvent, Track, createAudioAnalyser } from "livekit-client";
import type { Room, LocalAudioTrack, RemoteAudioTrack, RemoteTrack, RemoteParticipant, DataPacket_Kind } from "livekit-client";
import { LatencyTimer, type LatencyReading } from "./latencyTimer";

type Probe = ReturnType<typeof createAudioAnalyser> & { samples: Float32Array<ArrayBuffer> };

function probe(track: LocalAudioTrack | RemoteAudioTrack): Probe {
  const result = createAudioAnalyser(track, { fftSize: 512 });
  void (result.analyser.context as AudioContext).resume().catch(() => {});
  return { ...result, samples: new Float32Array(result.analyser.fftSize) };
}

function voiced(input: Probe): boolean {
  input.analyser.getFloatTimeDomainData(input.samples);
  let sum = 0;
  for (const value of input.samples) sum += value * value;
  return Math.sqrt(sum / input.samples.length) > 0.015;
}

export function VoiceLatencyTimer({ room, active }: { room: Room | null; active: boolean }) {
  const enabled = process.env.NEXT_PUBLIC_VOICE_LATENCY_TIMER === "true";
  const [reading, setReading] = useState<LatencyReading>({ phase: "idle", ms: 0 });
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!enabled || !room || !active) return;
    let timer = new LatencyTimer();
    let mic: LocalAudioTrack | undefined;
    let sequence = -1;
    const replies = new Map<RemoteAudioTrack, Probe>();
    let failed = false;
    setUnavailable(false);
    setReading({ phase: "idle", ms: 0 });
    function speechBoundary(payload: Uint8Array, participant?: RemoteParticipant,
      _kind?: DataPacket_Kind, topic?: string) {
      if (topic !== "voice.vad" || !participant?.isAgent || room?.state !== ConnectionState.Connected) return;
      const microphone = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (!microphone || microphone.isMuted) return;
      if (mic !== microphone) { mic = microphone; timer = new LatencyTimer(); }
      try {
        const event = JSON.parse(new TextDecoder().decode(payload));
        if (event.type !== "user_vad" || typeof event.speaking !== "boolean" ||
          !Number.isInteger(event.sequence) || event.sequence <= sequence) return;
        sequence = event.sequence;
        const confirmationMs = typeof event.confirmation_ms === "number" && Number.isFinite(event.confirmation_ms)
          ? Math.min(2000, Math.max(0, event.confirmation_ms)) : 0;
        setReading({ ...timer.speech(performance.now(), event.speaking, confirmationMs) });
      } catch { /* Ignore unrelated/malformed data; never use RMS as fallback VAD. */ }
    }
    function subscribe(track: RemoteTrack) {
      if (track.kind !== Track.Kind.Audio) return;
      const audio = track as RemoteAudioTrack;
      if (replies.has(audio)) return;
      try { replies.set(audio, probe(audio)); }
      catch { failed = true; setUnavailable(true); }
    }
    function unsubscribe(track: RemoteTrack) {
      const audio = track as RemoteAudioTrack;
      replies.get(audio)?.cleanup();
      replies.delete(audio);
    }
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        if (publication.track) subscribe(publication.track);
      }
    }
    room.on(RoomEvent.TrackSubscribed, subscribe);
    room.on(RoomEvent.TrackUnsubscribed, unsubscribe);
    room.on(RoomEvent.DataReceived, speechBoundary);
    const interval = setInterval(() => {
      if (failed) return;
      const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (track !== mic) {
        mic = track;
        timer = new LatencyTimer();
      }
      if (room.state !== ConnectionState.Connected || !mic || mic.isMuted) {
        timer = new LatencyTimer();
        setReading({ phase: "idle", ms: 0 });
        return;
      }
      const replyAudio = room.canPlaybackAudio && [...replies].some(([audio, input]) =>
        !audio.isMuted && audio.attachedElements.some(element =>
          !element.paused && !element.muted && element.volume > 0 && element.readyState >= 2
        ) && voiced(input)
      );
      const next = timer.sample(performance.now(), replyAudio);
      setReading(previous => previous.phase === next.phase && previous.ms === next.ms ? previous : { ...next });
    }, 40);
    return () => {
      clearInterval(interval);
      room.off(RoomEvent.TrackSubscribed, subscribe);
      room.off(RoomEvent.TrackUnsubscribed, unsubscribe);
      room.off(RoomEvent.DataReceived, speechBoundary);
      for (const input of replies.values()) input.cleanup();
    };
  }, [enabled, room, active]);

  if (!enabled || !room || !active) return null;
  const label = unavailable ? "Audio timing unavailable" : reading.phase === "speaking"
    ? "Speaking — timer reset" : reading.phase === "waiting" ? "Waiting for reply audio"
    : reading.phase === "done" ? "First reply audio" : "Speak to measure";
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-current/15 px-3 py-2 text-xs"
      title="Worker VAD speech boundaries to audible reply. Configured VAD silence is included approximately; data delivery and audio sampling add uncertainty. Excludes physical speaker output delay.">
      <span className="opacity-70">Response latency · client estimate</span>
      <strong className="tabular-nums" style={{ minWidth: "5em" }}>
        {unavailable || reading.phase === "idle" ? "—" : `${Math.round(reading.ms)} ms`}
      </strong>
      <span className="opacity-70">{label}</span>
    </div>
  );
}
