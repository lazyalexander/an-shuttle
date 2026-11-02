import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// An in-memory example document; the check also runs with no connected view.
export function plateStore() {
  const epoch = randomUUID();
  let revision = 0, bore = 20, thickness = 8, result;
  const version = () => ({document:'plate', epoch, revision});
  function inspect() {
    const parameter = thickness < 6 ? 'thickness' : bore > 18 ? 'bore' : null;
    result = {...version(), parameter};
  }
  inspect();
  return {
    read: () => ({...version(), bore, thickness}),
    check: () => ({...result}),
    save(edit) {
      if (edit?.document !== 'plate' || edit.epoch !== epoch || edit.revision !== revision) throw Error('Stale document');
      if (![edit.bore, edit.thickness].every(n => Number.isInteger(n) && n >= 1 && n <= 30)) throw Error('Expected dimensions from 1 to 30');
      bore = edit.bore; thickness = edit.thickness; revision++;
      inspect();
      return {...version(), bore, thickness};
    },
  };
}

export function serve(port = 4182) {
  const store = plateStore();
  const files = new Map([['/','index.html'], ['/plate','plate.html'], ['/owner.mjs','owner.mjs'],
    ['/plate.mjs','plate.mjs'], ['/view.mjs','view.mjs'], ['/trailing-edits.mjs','trailing-edits.mjs']]);
  const server = createServer(async (req, res) => {
    const expected = '127.0.0.1:'+server.address().port;
    const end = (status, type, value) => {
      res.writeHead(status, {'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
      res.end(value);
    };
    if (req.headers.host !== expected) return end(403,'text/plain','Loopback host required');
    try {
      if (req.method === 'GET') {
        if (req.url === '/api/plate') return end(200,'application/json',JSON.stringify(store.read()));
        if (req.url === '/api/check') return end(200,'application/json',JSON.stringify(store.check()));
        const file = files.get(req.url);
        if (file) return end(200,file.endsWith('html') ? 'text/html; charset=utf-8' : 'text/javascript',await readFile(new URL(file,import.meta.url)));
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
    } catch (error) { end(409,'text/plain',error.message); }
  });
  return server.listen(port,'127.0.0.1');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = serve();
  server.on('listening',()=>console.log('Open http://127.0.0.1:'+server.address().port));
}
