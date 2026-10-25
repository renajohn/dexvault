import type { OutputSession } from './session';

/**
 * Asks each appliance where it is, as often as its session wants: every
 * second playing, every 5 s paused, ever less often when it is away, never
 * when nothing of ours plays there. No GENA events for now: they need the
 * appliance to call DexVault back, for little gained at a second's precision.
 */
export class Poller {
  private session: OutputSession;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** Stopped for good: a question under way asks no other once answered. */
  private stopped = false;

  constructor(session: OutputSession) {
    this.session = session;
  }

  /** Polling again as the session now wants it: after every command. */
  wake(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.schedule();
  }

  private schedule(delay: number | null = this.session.pollDelay()): void {
    if (delay == null || this.timer || this.running || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.session.pollDelay() == null) return;
      this.running = true;
      this.session.tick()
        .catch(() => undefined)
        .finally(() => {
          this.running = false;
          this.schedule();
        });
    }, delay);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
