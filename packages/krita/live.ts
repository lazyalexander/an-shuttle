// Krita live shuttle client.
//
// The studio asks a plugin running inside Krita to update one working document.
// Agent-rendered layers live in a locked render group and are replaced in place;
// the hand-painted group is never written. The plugin applies an update inside
// one Qt event-loop turn, so the user is only locked out for the replacement.
import {createConnection} from 'node:net';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const protocol = 'an-shuttle-krita-live-v1';

export interface KritaReceipt {
  document: string;
  revision: number;
  stage: 'preview'|'final';
  /** SHA-256 of each render layer's pixels after the update. */
  layers: Record<string, string>;
  /** Render layers the user had painted on; they were moved into the hand group first. */
  preserved: string[];
  created: boolean;
}

export interface KritaLive {
  /** Show that a newer CAD revision is being rendered. The document stays editable. */
  pending(document: string, revision: number): Promise<void>;
  /** Replace the render layers with an accepted OpenRaster product. */
  /** `session` scopes revision order: numbers restart when a new studio session begins. */
  apply(document: string, revision: number, ora: string, stage?: 'preview'|'final', session?: string): Promise<KritaReceipt>;
}

export class KritaRefusal extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function defaultSocket() {
  return process.env.AN_SHUTTLE_KRITA_SOCKET ?? join(homedir(), '.an-shuttle', 'krita.sock');
}

const limit = 64 * 1024;

export function call(socket: string, request: object, timeout = 30_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let text = '', settled = false;
    const finish = (error: Error | null, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true; clearTimeout(timer); connection.destroy();
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(Error('Krita shuttle did not answer in time')), timeout);
    connection.setEncoding('utf8');
    connection.on('connect', () => connection.write(JSON.stringify({protocol, ...request}) + '\n'));
    connection.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > limit) return finish(Error('Krita shuttle reply too large'));
      const end = text.indexOf('\n');
      if (end < 0) return;
      let reply: unknown;
      try { reply = JSON.parse(text.slice(0, end)); } catch { return finish(Error('Malformed Krita shuttle reply')); }
      if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return finish(Error('Malformed Krita shuttle reply'));
      const record = reply as Record<string, unknown>;
      if (record.protocol !== protocol) return finish(Error('Unsupported Krita shuttle protocol'));
      if (record.ok !== true) {
        return finish(new KritaRefusal(String(record.code ?? 'refused'), String(record.message ?? 'Krita refused the update').slice(0, 300)));
      }
      finish(null, record);
    });
    connection.on('error', error => finish(error));
    connection.on('close', () => finish(Error('Krita shuttle closed without a reply')));
  });
}

function receipt(value: Record<string, unknown>, document: string, revision: number, stage: 'preview'|'final'): KritaReceipt {
  const layers = value.layers, preserved = value.preserved;
  if (value.document !== document || value.revision !== revision || value.stage !== stage ||
      !layers || typeof layers !== 'object' || Array.isArray(layers) ||
      !Object.values(layers).every(digest => typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest)) ||
      !Array.isArray(preserved) || !preserved.every(name => typeof name === 'string') ||
      typeof value.created !== 'boolean')
    throw Error('Krita receipt does not match the requested update');
  return {document, revision, stage, layers: layers as Record<string, string>, preserved: preserved as string[], created: value.created};
}

export function kritaLive(socket = defaultSocket()): KritaLive {
  return {
    async pending(document, revision) {
      await call(socket, {method: 'pending', document, revision}, 5_000);
    },
    async apply(document, revision, ora, stage = 'final', session) {
      return receipt(await call(socket, {method: 'apply', document, revision, ora, stage, ...(session ? {session} : {})}),
                     document, revision, stage);
    },
  };
}
