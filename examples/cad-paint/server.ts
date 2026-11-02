import {createServer,type ServerResponse} from 'node:http';
import {readFile,mkdir,mkdtemp,stat} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {defaultCamera, snapshot, type Scene} from '@an-shuttle/cad/scene.js';
import {openInKrita} from '@an-shuttle/krita/document.js';
import {paint} from './spool.js';

export function studio(port=4183,{output=resolve('paintings'),render=paint,open=openInKrita}={}) {
  const epoch=randomUUID();
  let revision=0, locked=false;
  let scene:Scene={gap:18,camera:defaultCamera,materials:{rail:{finish:'ground steel',color:'#bdc9cb'}}};
  let message='就绪', artifact:string|null=null;
  const clients=new Set<ServerResponse>();
  const state=()=>({epoch,revision,locked,scene,message,artifact});
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
        if(url==='/state') return send(200,'application/json',JSON.stringify(state()));
        if(url==='/' || url==='/app.js' || url==='/scene.js') {
          const file=url==='/'?new URL('../index.html',import.meta.url):url==='/app.js'?new URL('app.js',import.meta.url):new URL(import.meta.resolve('@an-shuttle/cad/scene.js'));
          return send(200,url==='/'?'text/html; charset=utf-8':'text/javascript',await readFile(file));
        }
        const match=/^\/assets\/(vise-[a-zA-Z0-9]+)\/(painting\.ora|beauty\.png)$/.exec(url);
        if(match && await stat(join(output,match[1],'painting.ora')).catch(()=>null))
          return send(200,match[2]==='beauty.png'?'image/png':'application/octet-stream',await readFile(join(output,match[1],match[2])));
      }
      if(req.method!=='POST'||url!=='/save') return send(404,'text/plain','Unknown route');
      if(req.headers.origin!=='http://'+host || req.headers['content-type']!=='application/json') return send(403,'text/plain','Same-origin JSON required');
      let body='';
      for await(const chunk of req) { body+=chunk; if(Buffer.byteLength(body)>8192) return send(413,'text/plain','Scene too large'); }
      const input=JSON.parse(body);
      if(locked || input.epoch!==epoch || input.revision!==revision) return send(409,'text/plain','CAD locked or revision changed');
      const frozen=snapshot(input.scene);
      locked=true; scene=frozen; revision++; artifact=null; message='CAD 已锁定 · 正在绘制';publish();
      try {
        await mkdir(output,{recursive:true});
        const folder=await mkdtemp(join(output,'vise-'));
        const file=await render(frozen,revision,folder);
        artifact='/assets/'+basename(folder);
        try {await open(file);message='素材已生成，已请求 Krita 打开';}
        catch {message='素材已生成，可下载后在 Krita 中打开';}
      } catch(error) {message='绘制失败 · '+(error instanceof Error?error.message:String(error)).slice(0,220);return send(500,'text/plain',message);}
      finally {locked=false;publish();}
      send(200,'application/json',JSON.stringify(state()));
    } catch(error) {send(400,'text/plain',String(error).slice(0,300));}
  });
  server.on('close',()=>{for(const client of clients)client.end();});
  return server.listen(port,'127.0.0.1');
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  studio().on('listening',()=>console.log('Open http://127.0.0.1:4183'));
}
