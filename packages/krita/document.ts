import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export async function packPainting(folder: string) {
  const script=fileURLToPath(new URL('../pack.py',import.meta.url));
  const ora=fileURLToPath(import.meta.resolve('@an-loom/cad-paint-spool/ora'));
  await promisify(execFile)(process.env.PYTHON_BIN ?? 'python3',[script,folder,ora],{timeout:60_000});
  return join(folder,'painting.ora');
}
export async function openInKrita(file: string) {
  if (process.platform === 'darwin' && !process.env.KRITA_BIN) {
    await promisify(execFile)('/usr/bin/open', ['-a', 'Krita', file], {timeout: 15_000});
    return;
  }
  const binary = process.env.KRITA_BIN ?? 'krita';
  const child = spawn(binary,[file],{detached:true,stdio:'ignore'});
  await new Promise<void>((resolve,reject)=>{ child.once('spawn',resolve); child.once('error',reject); });
  child.unref();
}
