/** Deliver only an original host-accepted OpenRaster artifact to the existing GUI bridge. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openInKrita} from './document.js';

export async function openAccepted(host: string, instance: string, run: string, target: string) {
  const execute = promisify(execFile);
  const inventory = JSON.parse((await execute(host, ['spool-artifacts', instance, run, '--output', 'painting.ora'], {maxBuffer: 2 ** 20})).stdout);
  const binding = inventory.output.binding;
  if (binding.status !== 'succeeded' || !/^[a-f0-9]{64}$/.test(binding.revision)) throw Error('Accepted revision required');
  await execute(host, ['artifact-checkout', inventory.catalog, binding.revision, target], {maxBuffer: 2 ** 20});
  await openInKrita(target);
  return {revision: binding.revision, opened: true, scope: 'first-frame reference; GUI save remains operator-owned'};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [host, instance, run, target, ...extra] = process.argv.slice(2);
  if (!host || !instance || !run || !target || extra.length) throw Error('Usage: accepted.js HOST INSTANCE RUN NEW_ORA_PATH');
  console.log(JSON.stringify(await openAccepted(host, instance, run, target)));
}
