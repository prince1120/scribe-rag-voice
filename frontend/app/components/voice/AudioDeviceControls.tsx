"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Room } from "livekit-client";
import { RoomEvent, Track } from "livekit-client";
import { Mic, Headphones, Volume2, Check, RefreshCw, ChevronDown } from "lucide-react";

export interface AudioDeviceState {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  activeInputId: string;
  activeOutputId: string;
  micLevel: number;
  sinkIdSupported: boolean;
  deviceError: string;
  selectInput: (deviceId: string) => Promise<void>;
  selectOutput: (deviceId: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
}

export function useAudioDevices(room: Room | null): AudioDeviceState {
  const [deviceError, setDeviceError] = useState("");
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [activeInputId, setActiveInputId] = useState<string>("default");
  const [activeOutputId, setActiveOutputId] = useState<string>("default");
  const [micLevel, setMicLevel] = useState<number>(0);
  const [sinkIdSupported, setSinkIdSupported] = useState<boolean>(true);

  const testRafRef = useRef<number>(0);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inDevs = all.filter((d) => d.kind === "audioinput");
      const outDevs = all.filter((d) => d.kind === "audiooutput");

      setInputs(inDevs);
      setOutputs(outDevs);

      // Check if current active device is still valid
      if (activeInputId !== "default" && !inDevs.some((d) => d.deviceId === activeInputId)) {
        setActiveInputId("default");
      }
      if (activeOutputId !== "default" && !outDevs.some((d) => d.deviceId === activeOutputId)) {
        setActiveOutputId("default");
      }
    } catch {
      /* ignore */
    }
  }, [activeInputId, activeOutputId]);

  // Initial enumeration & devicechange listener
  useEffect(() => {
    if (typeof window !== "undefined") {
      setSinkIdSupported("setSinkId" in HTMLMediaElement.prototype);
    }

    void refreshDevices();

    const onDeviceChange = () => {
      void refreshDevices();
    };

    navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", onDeviceChange);
    };
  }, [refreshDevices]);

  // Sync with live room active devices if room is connected
  useEffect(() => {
    if (!room) return;
    const sync = () => { try {
      const liveInput = room.getActiveDevice("audioinput");
      if (liveInput) setActiveInputId(liveInput);

      const liveOutput = room.getActiveDevice("audiooutput");
      if (liveOutput) setActiveOutputId(liveOutput);
    } catch {
      /* ignore */
    } };
    sync();
    room.on(RoomEvent.ActiveDeviceChanged, sync);
    return () => { room.off(RoomEvent.ActiveDeviceChanged, sync); };
  }, [room]);

  // Observe the call's existing microphone track. Never open a preview stream.
  useEffect(() => {
    if (!room) {
      cancelAnimationFrame(testRafRef.current);
      setMicLevel(0);
      return;
    }

    let isCancelled = false;
    let audioCtx: AudioContext | null = null;
    const clearMeter = () => {
      cancelAnimationFrame(testRafRef.current);
      void audioCtx?.close().catch(() => {});
      audioCtx = null;
    };

    const monitorMicrophone = () => {
      clearMeter();
      try {
        const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
        if (!track) return;
        const stream = new MediaStream([track]);

        if (isCancelled) {
          return;
        }

        // Re-read devices now that permission is definitely granted (labels become visible!)
        void refreshDevices();

        const AudioContextClass = window.AudioContext;
        if (!AudioContextClass) return;
        audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (isCancelled) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Normalise to 0..1 with emphasis on human voice volume
          const norm = Math.min(1, Math.max(0, avg / 60));
          setMicLevel(norm);
          testRafRef.current = requestAnimationFrame(tick);
        };
        testRafRef.current = requestAnimationFrame(tick);
      } catch {
        /* Metering is optional; it must not interrupt the existing call. */
      }
    };

    monitorMicrophone();
    room.on(RoomEvent.LocalTrackPublished, monitorMicrophone);
    room.on(RoomEvent.LocalTrackUnpublished, monitorMicrophone);

    return () => {
      isCancelled = true;
      room.off(RoomEvent.LocalTrackPublished, monitorMicrophone);
      room.off(RoomEvent.LocalTrackUnpublished, monitorMicrophone);
      clearMeter();
      setMicLevel(0);
    };
  }, [room, activeInputId, refreshDevices]);

  const selectInput = useCallback(
    async (deviceId: string) => {
      try {
        if (room && !(await room.switchActiveDevice("audioinput", deviceId))) throw new Error("Device unavailable");
        setActiveInputId(deviceId);
        setDeviceError("");
      } catch {
        setDeviceError("Could not switch microphone. Your previous microphone remains selected.");
      }
    },
    [room]
  );

  const selectOutput = useCallback(
    async (deviceId: string) => {
      try {
        if (room && !(await room.switchActiveDevice("audiooutput", deviceId))) throw new Error("Device unavailable");
        setActiveOutputId(deviceId);
        setDeviceError("");
      } catch {
        setDeviceError("Could not switch speakers. Your previous output remains selected.");
      }
    },
    [room]
  );

  return {
    inputs,
    outputs,
    activeInputId,
    activeOutputId,
    micLevel,
    sinkIdSupported,
    deviceError,
    selectInput,
    selectOutput,
    refreshDevices,
  };
}

export function AudioDeviceSelector({
  state,
  compact = false,
  showTitle = true,
}: {
  state: AudioDeviceState;
  compact?: boolean;
  showTitle?: boolean;
}) {
  const {
    inputs,
    outputs,
    activeInputId,
    activeOutputId,
    micLevel,
    sinkIdSupported,
    selectInput,
    selectOutput,
  } = state;

  return (
    <div
      className={`rounded-2xl border bg-white/90 backdrop-blur-sm shadow-sm transition-all ${
        compact ? "p-3 space-y-2 text-xs" : "p-4 space-y-3.5 text-xs w-full max-w-sm"
      }`}
      style={{ borderColor: "var(--claude-border, #DDD9CC)" }}
    >
      {showTitle && (
        <div className="flex items-center justify-between pb-1.5 border-b border-gray-100">
          <div className="flex items-center gap-1.5 font-bold text-gray-800">
            <Headphones size={14} className="text-[var(--claude-accent, #4854A8)]" />
            <span>Audio Devices</span>
          </div>
          <span className="text-[10px] text-gray-400 font-medium">Auto-detected</span>
        </div>
      )}

      {/* Microphone Selection */}
      {state.deviceError && <p role="alert" className="text-xs text-red-700">{state.deviceError}</p>}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold text-gray-600 flex items-center gap-1">
            <Mic size={12} className="text-indigo-600" />
            <span>Microphone</span>
          </label>
          {/* Live mic level meter bar */}
          <div className="flex items-center gap-1">
            <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-75"
                style={{ width: `${Math.round(micLevel * 100)}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-gray-400">
              {micLevel > 0.05 ? "Voice" : "Mic"}
            </span>
          </div>
        </div>

        <div className="relative">
          <select
            aria-label="Microphone"
            value={activeInputId}
            onChange={(e) => void selectInput(e.target.value)}
            className="w-full h-8.5 pl-2.5 pr-7 rounded-xl border bg-gray-50/70 hover:bg-gray-50 focus:bg-white text-[11.5px] font-medium text-gray-800 outline-none focus:ring-1 focus:ring-indigo-300 transition-colors appearance-none cursor-pointer truncate"
            style={{ borderColor: "var(--claude-border, #DDD9CC)" }}
          >
            {inputs.length === 0 ? (
              <option value="default">Default System Microphone</option>
            ) : (
              inputs.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))
            )}
          </select>
          <ChevronDown
            size={13}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
        </div>
      </div>

      {/* Headphone / Speaker Selection */}
      {sinkIdSupported && outputs.length > 0 && (
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-gray-600 flex items-center gap-1">
            <Volume2 size={12} className="text-indigo-600" />
            <span>Headphones / Speakers</span>
          </label>

          <div className="relative">
            <select
              aria-label="Headphones or speakers"
              value={activeOutputId}
              onChange={(e) => void selectOutput(e.target.value)}
              className="w-full h-8.5 pl-2.5 pr-7 rounded-xl border bg-gray-50/70 hover:bg-gray-50 focus:bg-white text-[11.5px] font-medium text-gray-800 outline-none focus:ring-1 focus:ring-indigo-300 transition-colors appearance-none cursor-pointer truncate"
              style={{ borderColor: "var(--claude-border, #DDD9CC)" }}
            >
              {outputs.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Speaker / Headphones ${i + 1}`}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
