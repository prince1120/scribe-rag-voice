"use client";

import { useEffect, useState } from "react";
import { ConnectionState, RoomEvent, Track, createAudioAnalyser } from "livekit-client";
import type { Room, LocalAudioTrack, RemoteAudioTrack, RemoteTrack } from "livekit-client";
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
    let micProbe: Probe | undefined;
    const replies = new Map<RemoteAudioTrack, Probe>();
    let failed = false;
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
    const interval = setInterval(() => {
      if (failed) return;
      const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (track !== mic) {
        micProbe?.cleanup();
        mic = track;
        micProbe = undefined;
        try { if (mic) micProbe = probe(mic); }
        catch { failed = true; setUnavailable(true); return; }
        timer = new LatencyTimer();
      }
      if (room.state !== ConnectionState.Connected || !mic || mic.isMuted) {
        timer = new LatencyTimer();
        setReading({ phase: "idle", ms: 0 });
        return;
      }
      const userAudio = !!micProbe && voiced(micProbe);
      const replyAudio = room.canPlaybackAudio && [...replies].some(([audio, input]) =>
        !audio.isMuted && audio.attachedElements.some(element =>
          !element.paused && !element.muted && element.volume > 0 && element.readyState >= 2
        ) && voiced(input)
      );
      const next = timer.sample(performance.now(), userAudio, replyAudio);
      setReading(previous => previous.phase === next.phase && previous.ms === next.ms ? previous : { ...next });
    }, 40);
    return () => {
      clearInterval(interval);
      room.off(RoomEvent.TrackSubscribed, subscribe);
      room.off(RoomEvent.TrackUnsubscribed, unsubscribe);
      micProbe?.cleanup();
      for (const input of replies.values()) input.cleanup();
    };
  }, [enabled, room, active]);

  if (!enabled || !room || !active) return null;
  const label = unavailable ? "Audio timing unavailable" : reading.phase === "speaking"
    ? "Speaking — timer reset" : reading.phase === "waiting" ? "Waiting for reply audio"
    : reading.phase === "done" ? "First reply audio" : "Speak to measure";
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-current/15 px-3 py-2 text-xs"
      title="Client audio estimate. Includes silence detection and network delivery; excludes physical speaker output delay. Background noise and echo may affect detection.">
      <span className="opacity-70">Response latency · client estimate</span>
      <strong className="tabular-nums" style={{ minWidth: "5em" }}>
        {unavailable || reading.phase === "idle" ? "—" : `${Math.round(reading.ms)} ms`}
      </strong>
      <span className="opacity-70">{label}</span>
    </div>
  );
}
