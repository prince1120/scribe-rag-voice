export type LatencyReading = { phase: "idle" | "speaking" | "waiting" | "done"; ms: number };

// Speech boundaries come from worker VAD, never microphone volume.
export class LatencyTimer {
  private started: number | null = null;
  private reading: LatencyReading = { phase: "idle", ms: 0 };

  speech(now: number, speaking: boolean, confirmationMs = 0): LatencyReading {
    if (speaking) {
      this.started = null;
      this.reading = { phase: "speaking", ms: 0 };
    } else if (this.reading.phase === "speaking") {
      // Approximate the last voiced sample by subtracting configured VAD silence.
      this.started = now - Math.max(0, confirmationMs);
      this.reading = { phase: "waiting", ms: now - this.started };
    }
    return this.reading;
  }

  sample(now: number, replyAudio: boolean): LatencyReading {
    if (this.reading.phase === "waiting" && this.started !== null) {
      this.reading = { phase: replyAudio ? "done" : "waiting", ms: Math.max(0, now - this.started) };
    }
    return this.reading;
  }
}
