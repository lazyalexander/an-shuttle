import {createServer,type ServerResponse} from 'node:http';
import {readFile,mkdir,mkdtemp,stat} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {parseArgs,promisify} from 'node:util';

const cutExecutable = process.env.CUT_SPOOL_BIN;
const configuredCut = cutExecutable
  ? (file: string) => promisify(execFile)(cutExecutable, [file], {timeout: 120_000}).then(() => {})
  : null;
import {defaultCamera} from '@an-shuttle/cad/scene.js';
import {benchVise,parameterInput,saveDrawing,type Model,type MeshDrawing,type SavedDrawing} from '@an-shuttle/cad/drawing.js';
import {openInKrita} from '@an-shuttle/krita/document.js';
import {paint,paintStandalone} from './spool.js';
import {authorizeMaterialDisclosure,readPreviousMaterial} from './host.js';
import {codexMaterialTurn} from './codex-material.js';
import {verifyMaterial} from './verify-material.js';

export function studio(port=4183,{output=resolve('paintings'),render=paint,open=openInKrita,cut=configuredCut,drawing=benchVise as Model,readMaterial=readPreviousMaterial,materialTurn=codexMaterialTurn,authorizeMaterial=authorizeMaterialDisclosure}={}) {
  const referencePart=drawing.id==='handwheel' ? 'grip' : drawing.id==='vise' ? 'movingJaw' : null;
  const materialReader=(render===paint || readMaterial!==readPreviousMaterial) && referencePart ? process.env.CAD_MATERIAL_READER : undefined;
  let pendingLookup:AbortController|undefined;
  let lastAccepted:{folder:string;revision:number}|undefined;
  const epoch=randomUUID();
  let revision=0, locked=false;
  let scene:SavedDrawing={...parameterInput(drawing.parameter.initial,drawing),camera:defaultCamera,materials:drawing.materials};
  let direction='';
  let message='就绪', artifact:string|null=null;
  let paintingFile: string|null = null;
  let cutStatus: 'ready'|'sending'|'sent' = 'ready';
  const clients=new Set<ServerResponse>();
  const state=()=>({epoch,revision,locked,drawingId:drawing.id,scene,direction,message,artifact,canCut:!!cut,canCancelLookup:!!pendingLookup && !pendingLookup.signal.aborted,cutStatus,materialReference:materialReader && lastAccepted ? {part:referencePart,revision:lastAccepted.revision} : null,gripReference:materialReader && referencePart==='grip' ? lastAccepted?.revision ?? null : null});
  function publish() {
    for(const client of clients) client.write('data: '+JSON.stringify(state())+'\n\n');
  }
  const server=createServer(async (req,res)=>{
    const host='127.0.0.1:'+req.socket.localPort, url=req.url ?? '';
    const send=(code:number,type:string,data:string|Buffer)=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);};
    if(req.headers.host!==host) return send(403,'text/plain','Loopback host required');
    try {
      if(req.method==='GET') {
        if(url==='/events') {
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
          clients.add(res);res.write('data: '+JSON.stringify(state())+'\n\n');res.on('close',()=>clients.delete(res));return;
        }
        if(url==='/model.json') return send(200,'application/json',JSON.stringify(drawing));
        if(url==='/drawing.js') return send(200,'text/javascript',await readFile(new URL(import.meta.resolve('@an-shuttle/cad/drawing.js'))));
        if(url==='/state') return send(200,'application/json',JSON.stringify(state()));
        if(url==='/' || url==='/app.js' || url==='/scene.js') {
          const file=url==='/'?new URL('../index.html',import.meta.url):url==='/app.js'?new URL('app.js',import.meta.url):new URL(import.meta.resolve('@an-shuttle/cad/scene.js'));
          return send(200,url==='/'?'text/html; charset=utf-8':'text/javascript',await readFile(file));
        }
        const match=/^\/assets\/((?:vise|drawing)-[a-zA-Z0-9]+)\/(painting\.ora|beauty\.png)$/.exec(url);
        if(match && await stat(join(output,match[1],'painting.ora')).catch(()=>null))
          return send(200,match[2]==='beauty.png'?'image/png':'application/octet-stream',await readFile(join(output,match[1],match[2])));
      }
      if(req.method!=='POST'||(url!=='/save'&&url!=='/cut'&&url!=='/cancel-material')) return send(404,'text/plain','Unknown route');
      if(req.headers.origin!=='http://'+host || req.headers['content-type']!=='application/json') return send(403,'text/plain','Same-origin JSON required');
      let body='';
      for await(const chunk of req) { body+=chunk; if(Buffer.byteLength(body)>8192) return send(413,'text/plain','Scene too large'); }
      const input=JSON.parse(body);
      if (url === '/cancel-material') {
        if (input.epoch!==epoch || input.revision!==revision || !pendingLookup || pendingLookup.signal.aborted)
          return send(409,'text/plain','No matching material lookup');
        pendingLookup.abort(new Error('材质查证已取消'));
        publish();
        return send(202,'text/plain','Cancellation requested');
      }
      if (url === '/cut') {
        if (!cut) return send(503,'text/plain','No local cutting spool configured');
        if (locked || !paintingFile || !artifact || input.epoch!==epoch || input.artifact!==artifact)
          return send(409,'text/plain','Painting changed or unavailable');
        if (cutStatus!=='ready') return send(200,'text/plain',cutStatus);
        const selected=paintingFile;
        cutStatus='sending'; publish();
        try {
          await cut(selected);
          if (paintingFile===selected) cutStatus='sent';
          return send(200,'text/plain','sent');
        } catch {
          if (paintingFile===selected) cutStatus='ready';
          return send(502,'text/plain','切割 spool 接收失败，可以重试');
        } finally {publish();}
      }
      if(locked || input.epoch!==epoch || input.revision!==revision) return send(409,'text/plain','CAD locked or revision changed');
      const frozen=saveDrawing(input.scene,drawing);
      const selection=input.materialHistory;
      const exact=input.reuseMaterial ?? (referencePart==='grip' ? input.reuseGrip : undefined);
      if (selection!==undefined && (selection!=='last-accepted' || exact!==undefined))
        return send(400,'text/plain','Invalid material history request');
      const previous=selection!==undefined || exact!==undefined ? lastAccepted : undefined;
      if ((selection!==undefined || exact!==undefined) &&
          (!materialReader || !referencePart || !previous || (exact!==undefined && previous.revision!==exact) ||
           frozen.materials[referencePart]))
        return send(409,'text/plain','材质引用已变化，或与本次手动材质冲突');
      const nextDirection=input.direction ?? '';
      if(typeof nextDirection!=='string' || nextDirection.length>500) return send(400,'text/plain','Invalid painting direction');
      direction=nextDirection;
      const lookup=selection ? new AbortController() : undefined;
      pendingLookup=lookup;
      locked=true; scene=frozen; revision++; artifact=null; paintingFile=null; cutStatus='ready'; message='CAD 已锁定 · 正在绘制';publish();
      try {
        await mkdir(output,{recursive:true});
        const folder=await mkdtemp(join(output,'drawing-'));
        const reused=previous && materialReader && referencePart
          ? await (async()=>{
            const read=()=>readMaterial(materialReader,previous.folder,drawing.id,epoch,previous.revision,referencePart,!!lookup,lookup?.signal);
            if (!lookup) return read();
            const scope={document:drawing.id,part:referencePart,revision:previous.revision};
            await authorizeMaterial(materialReader,scope.document,scope.part,lookup.signal);
            return verifyMaterial(scope,read,lookup.signal,materialTurn(folder));
          })()
          : undefined;
        lookup?.signal.throwIfAborted();
        if (lookup) {pendingLookup=undefined;publish();}
        const file=await render(frozen,revision,folder,drawing,epoch,direction,()=>{
          message='等待宿主确认绘制终止 · CAD 保持锁定';publish();
        },reused);
        lastAccepted={folder,revision};
        paintingFile=file;
        artifact='/assets/'+basename(folder);
        message='素材已生成，可下载后在 Krita 中打开';
        // The accepted pair is ready. A slow external app must not hold this CAD revision.
        void Promise.resolve().then(()=>open(file)).then(()=>{
          if (paintingFile===file) {message='素材已生成，已请求 Krita 打开';publish();}
        },()=>{});
      } catch(error) {message='绘制失败 · '+(error instanceof Error?error.message:String(error)).slice(0,220);return send(500,'text/plain',message);}
      finally {pendingLookup=undefined;locked=false;publish();}
      send(200,'application/json',JSON.stringify(state()));
    } catch(error) {send(400,'text/plain',String(error).slice(0,300));}
  });
  server.on('close',()=>{for(const client of clients)client.end();});
  return server.listen(port,'127.0.0.1');
}
export async function loadDrawing(folder:string): Promise<MeshDrawing> {
  // Both files belong to the local CAD operator. HTTP requests cannot select a filesystem path.
  const [settings, meshes] = await Promise.all(['model.json','meshes.json'].map(async file =>
    JSON.parse(await readFile(resolve(folder,file),'utf8'))));
  const model:MeshDrawing = {...settings, meshes};
  const colors = new Set<string>();
  for (const [id, part] of Object.entries(model.parts)) {
    const color=part.color.toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/i.test(id) || !/^#[0-9a-f]{6}$/.test(color) ||
        color==='#000000' || colors.has(color) || !model.meshes[id]?.faces.length)
      throw Error('Invalid CAD part or ownership color: '+id);
    colors.add(color);
  }
  return model;
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const {values,positionals}=parseArgs({options:{standalone:{type:'boolean'}},allowPositionals:true});
  if(positionals.length>1) throw Error('Expected one optional CAD directory');
  const [folder]=positionals;
  const drawing=folder ? await loadDrawing(folder) : benchVise;
  const port=Number(process.env.PORT ?? 4183);
  studio(port,{drawing,render:values.standalone ? paintStandalone : paint}).on('listening',()=>console.log('Open http://127.0.0.1:'+port));
}
