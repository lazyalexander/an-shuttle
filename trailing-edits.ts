type Timer = number | ReturnType<typeof globalThis.setTimeout>;
interface Clock {
  setTimeout(callback: () => void, delay: number): Timer;
  clearTimeout(timer: Timer): void;
}

interface EditOptions<Edit> {
  delay: number;
  save(item: Edit): void | Promise<void>;
  failed(error: unknown, item: Edit): void;
  clock?: Clock;
}

// The delay is an application choice. Invalidate the view synchronously
// before enqueueing the save. At most one save is in flight.
export function trailingEdits<Edit extends object>({delay, save, failed, clock = globalThis}: EditOptions<Edit>) {
  let timer: Timer | null = null, pending: Edit | null = null;
  let busy = false, closed = false;
  async function drain() {
    if (closed || busy || timer !== null || pending === null) return;
    const item = pending;
    pending = null;
    busy = true;
    try { await save(item); } catch (error) { failed(error, item); }
    finally {
      busy = false;
      if (pending && timer === null) void drain();
    }
  }
  return {
    push(item: Edit) {
      if (closed) return;
      pending = item;
      if (timer !== null) clock.clearTimeout(timer);
      timer = clock.setTimeout(() => { timer = null; void drain(); }, delay);
    },
    close() {
      closed = true;
      if (timer !== null) clock.clearTimeout(timer);
      pending = null;
    },
  };
}
