export type LatencyReading = { phase: "idle" | "speaking" | "waiting" | "done"; ms: number };

// Local audio estimate: reject brief noise and timestamp the last voiced sample,
// rather than adding the silence-confirmation delay to the measured latency.
export class LatencyTimer {
  private onset: number | null = null;
  private lastVoice = 0;
  private started: number | null = null;
  private firstReply: number | null = null;
  private reading: LatencyReading = { phase: "idle", ms: 0 };

  sample(now: number, userAudio: boolean, replyAudio: boolean): LatencyReading {
    if (userAudio) {
      this.firstReply = null;
      this.onset ??= now;
      this.lastVoice = now;
      if (now - this.onset >= 80) {
        this.started = null;
        this.reading = { phase: "speaking", ms: 0 };
      }
      return this.reading;
    }
    this.onset = null;
    if (this.reading.phase === "speaking") {
      if (replyAudio) this.firstReply ??= now;
      if (now - this.lastVoice < 150) return this.reading;
      this.started = this.lastVoice;
      this.reading = this.firstReply === null
        ? { phase: "waiting", ms: now - this.lastVoice }
        : { phase: "done", ms: this.firstReply - this.lastVoice };
    }
    if (this.reading.phase === "waiting" && this.started !== null) {
      this.reading = { phase: replyAudio ? "done" : "waiting", ms: now - this.started };
    }
    return this.reading;
  }
}
