import {createServer} from 'node:http';
import {isSourceVersion} from '@an-shuttle/view/protocol.js';
import {hasDimensions, type Finding, type Plate} from './plate-data.js';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// An in-memory example document; the check also runs with no connected view.
export function plateStore() {
  const epoch = randomUUID();
  let revision = 0, bore = 20, thickness = 8;
  const version = () => ({document:'plate', epoch, revision});
  function inspect(): Finding {
    const parameter = thickness < 6 ? 'thickness' : bore > 18 ? 'bore' : null;
    return {...version(), parameter};
  }
  let result = inspect();
  return {
    read: (): Plate => ({...version(), bore, thickness}),
    check: () => ({...result}),
    save(edit: unknown): Plate {
      if (!isSourceVersion(edit) || edit.document !== 'plate' || edit.epoch !== epoch || edit.revision !== revision) throw Error('Stale document');
      if (!hasDimensions(edit)) throw Error('Expected dimensions from 1 to 30');
      bore = edit.bore; thickness = edit.thickness; revision++;
      result = inspect();
      return {...version(), bore, thickness};
    },
  };
}

export function serve(port = 4182) {
  const store = plateStore();
  const files = new Map([
    ['/', '../index.html'], ['/plate', '../plate.html'], ['/owner.js', 'owner.js'], ['/plate.js', 'plate.js'],
    ['/protocol.js', 'protocol.js'], ['/plate-data.js', 'plate-data.js'], ['/view.js', 'view.js'],
    ['/trailing-edits.js', 'trailing-edits.js'],
  ]);
  const server = createServer(async (req, res) => {
    const expected = '127.0.0.1:'+req.socket.localPort;
    const end = (status: number, type: string, value: string | Buffer) => {
      res.writeHead(status, {'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
      res.end(value);
    };
    if (req.headers.host !== expected) return end(403,'text/plain','Loopback host required');
    try {
      if (req.method === 'GET') {
        if (req.url === '/api/plate') return end(200,'application/json',JSON.stringify(store.read()));
        if (req.url === '/api/check') return end(200,'application/json',JSON.stringify(store.check()));
        const file = files.get((req.url ?? '').replace(/\.mjs$/, '.js'));
        if (file) {
          const location = ['view.js','protocol.js','trailing-edits.js'].includes(file)
            ? new URL(import.meta.resolve('@an-shuttle/view/'+file)) : new URL(file,import.meta.url);
          return end(200,file.endsWith('html') ? 'text/html; charset=utf-8' : 'text/javascript',await readFile(location));
        }
      }
      if (req.method === 'PUT' && req.url === '/api/plate') {
        if (req.headers.origin !== 'http://'+expected || req.headers['content-type'] !== 'application/json') return end(403,'text/plain','Same-origin JSON required');
        let body = '';
        for await (const chunk of req) {
          if (body.length + chunk.length > 2048) return end(413,'text/plain','Edit too large');
          body += chunk;
        }
        return end(200,'application/json',JSON.stringify(store.save(JSON.parse(body))));
      }
      end(404,'text/plain','Not found');
    } catch (error) { end(409,'text/plain',error instanceof Error ? error.message : String(error)); }
  });
  return server.listen(port,'127.0.0.1');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = serve();
  server.on('listening', () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log('Open http://127.0.0.1:'+address.port);
  });
}
