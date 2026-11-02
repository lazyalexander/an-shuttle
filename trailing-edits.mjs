// The delay is an application choice. Invalidate the view synchronously
// before enqueueing the save. At most one save is in flight.
export function trailingEdits({delay, save, failed, clock = globalThis}) {
  let timer = null, pending = null, busy = false, closed = false;
  async function drain() {
    if (closed || busy || timer !== null || !pending) return;
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
    push(item) {
      if (closed) return;
      pending = item;
      clock.clearTimeout(timer);
      timer = clock.setTimeout(() => { timer = null; void drain(); }, delay);
    },
    close() { closed = true; clock.clearTimeout(timer); pending = null; },
  };
}
