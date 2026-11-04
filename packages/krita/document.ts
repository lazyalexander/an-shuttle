import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
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
