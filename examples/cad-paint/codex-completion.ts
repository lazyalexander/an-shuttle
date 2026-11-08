import type {MaterialBrief} from '@an-loom/cad-paint-spool/agent';
import {completionTask} from '@an-spool/cad-material-policy';
import {runCodex} from './codex.js';

export async function completeMaterials(brief:MaterialBrief,folder:string,signal:AbortSignal) {
  const task=completionTask(brief);
  return task ? runCodex(folder,task,signal) : {};
}
