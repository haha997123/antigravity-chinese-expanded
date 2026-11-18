'use strict';

function bootstrapChineseTitles(options) {
  const fs=require('node:fs'),path=require('node:path'),https=require('node:https');
  const app=options.app;
  const directory=app.getPath('userData');
  const settingsFile=path.join(directory,'chinese-title-settings.json');
  const stateFile=path.join(directory,'chinese-title-state.json');
  const statusFile=path.join(directory,'chinese-title-status.json');
  let settings;
  try{settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));}catch{return null;}
  if(settings?.schemaVersion!==1 || settings.enabled!==true)return null;
  let stopped=false,worker;
  const active=new Set();
  const status={schemaVersion:1,startedAt:new Date().toISOString(),lastEvent:'starting',updatedTitles:0};
  function writeJson(file,value){
    const temporary=file+'.'+process.pid+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
    fs.renameSync(temporary,file);
  }
  function log(event){
    status.lastEvent=event;
    status.lastEventAt=new Date().toISOString();
    if(event==='title-updated')status.updatedTitles++;
    try{writeJson(statusFile,status);}catch{}
  }
  function connection(method,body,stream=false){return new Promise((resolve,reject)=>{
    const port=Number(options.getPort());
    if(stopped || !Number.isInteger(port) || port<1024 || port>65535){reject(Error('Service unavailable'));return;}
    let data=Buffer.from(JSON.stringify(body));
    if(stream){const frame=Buffer.alloc(data.length+5);frame.writeUInt32BE(data.length,1);data.copy(frame,5);data=frame;}
    let settled=false;
    const req=https.request({hostname:'127.0.0.1',port,path:'/exa.language_server_pb.LanguageServerService/'+method,method:'POST',rejectUnauthorized:false,
      headers:{'Content-Type':stream?'application/connect+json':'application/json','Connect-Protocol-Version':'1','x-codeium-csrf-token':options.csrf,'Content-Length':data.length},timeout:30000},res=>{
      let buffer=Buffer.alloc(0);
      function finish(error,value){if(settled)return;settled=true;active.delete(req);if(error)reject(error);else resolve(value);if(stream){res.destroy();req.destroy();}}
      if(res.statusCode!==200){res.resume();finish(Error('Service method failed'));return;}
      res.on('data',chunk=>{
        if(settled)return;
        if(buffer.length+chunk.length>3*1024*1024){finish(Error('Response exceeds limit'));req.destroy();return;}
        buffer=Buffer.concat([buffer,chunk]);
        if(stream && buffer.length>=5){
          const length=buffer.readUInt32BE(1);
          if(buffer[0]!==0 || length>3*1024*1024){finish(Error('Unsupported snapshot frame'));return;}
          if(buffer.length>=5+length)try{
            const value=JSON.parse(buffer.subarray(5,5+length).toString('utf8'));
            if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Invalid snapshot');
            finish(null,{trajectorySummaries:value.updates??{}});
          }catch{finish(Error('Invalid snapshot JSON'));}
        }
      });
      res.on('end',()=>{
        if(settled)return;
        if(stream){finish(Error('Snapshot ended without data'));return;}
        try{finish(null,JSON.parse(buffer.toString('utf8')));}catch{finish(Error('Invalid response JSON'));}
      });
      res.on('error',()=>finish(Error('Response unavailable')));
    });
    active.add(req);
    req.on('error',()=>{active.delete(req);if(!settled){settled=true;reject(Error('Service request unavailable'));}});
    req.on('timeout',()=>req.destroy(Error('Service request timeout')));
    req.end(data);
  });}
  const allowed=new Set(['GetModelResponse','UpdateConversationAnnotations']);
  const storage={
    async get(){try{return JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
    async set(_key,value){writeJson(stateFile,value);}
  };
  worker=options.startWorker({storage,logger:log,pollMs:10000,settleMs:1500,
    request:async(method,body)=>{
      if(method==='GetAllCascadeTrajectories'){
        const response=await connection('JetboxSubscribeToSummaries',{},true);
        status.lastSnapshotAt=new Date().toISOString();
        return response;
      }
      if(!allowed.has(method))throw Error('Method outside naming feature');
      return connection(method,body);
    }
  });
  function stop(){stopped=true;worker.stop();for(const req of active)req.destroy();active.clear();}
  app.once('before-quit',stop);
  worker.ready.then(()=>log('ready')).catch(()=>log('initialization-failed'));
  return {stop,worker};
}

module.exports={bootstrapChineseTitles};
