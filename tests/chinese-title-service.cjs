'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),{EventEmitter}=require('node:events'),path=require('node:path');
const {bootstrapChineseTitles}=require('../features/chinese-title-service.js');
async function main(){
 const files=new Map(),calls=[],hooks=new Map();let deps;
 const folder=path.resolve('synthetic-profile');
 const settings=path.join(folder,'chinese-title-settings.json');
 const fs={readFileSync(name){if(!files.has(name)){const e=Error('Missing');e.code='ENOENT';throw e;}return files.get(name);},writeFileSync(name,value){files.set(name,value);},renameSync(from,to){files.set(to,files.get(from));files.delete(from);}};
 const https={request(options,callback){
  assert.equal(options.hostname,'127.0.0.1');assert.equal(options.port,45678);assert.equal(options.headers['x-codeium-csrf-token'],'synthetic-secret');
  const req=new EventEmitter();req.destroy=()=>{};
  req.end=body=>queueMicrotask(()=>{
   calls.push({options,body:Buffer.from(body)});
   const res=new EventEmitter();res.statusCode=200;res.destroy=()=>{};res.resume=()=>{};callback(res);
   const value=options.path.endsWith('/JetboxSubscribeToSummaries')?{updates:{'synthetic-new-id':{summary:'Synthetic title'}}}:{response:'合成标题'};
   let data=Buffer.from(JSON.stringify(value));
   if(options.headers['Content-Type']==='application/connect+json'){const frame=Buffer.alloc(data.length+5);frame.writeUInt32BE(data.length,1);data.copy(frame,5);data=frame;}
   res.emit('data',data);res.emit('end');
  });return req;
 }};
 const bootstrap=vm.runInNewContext('('+bootstrapChineseTitles.toString()+')',{require(name){if(name==='node:fs')return fs;if(name==='node:path')return path;if(name==='node:https')return https;throw Error('Unexpected module');},Buffer,process:{pid:123},Date,Set,JSON,Number,Error});
 const options={app:{getPath(name){assert.equal(name,'userData');return folder;},once(event,callback){hooks.set(event,callback);}},getPort:()=>45678,csrf:'synthetic-secret',startWorker(value){deps=value;return{ready:Promise.resolve(),stop(){hooks.set('stopped',true);}};}};
 assert.equal(bootstrap(options),null,'No model activity without explicit opt-in');
 files.set(settings,JSON.stringify({schemaVersion:1,enabled:false}));
 assert.equal(bootstrap(options),null,'Disabled feature must remain inactive');
 files.set(settings,JSON.stringify({schemaVersion:1,enabled:true}));
 const service=bootstrap(options);assert.ok(service);
 const snapshot=await deps.request('GetAllCascadeTrajectories',{excludeSubtrajectories:true});
 assert.equal(snapshot.trajectorySummaries['synthetic-new-id'].summary,'Synthetic title');
 assert.equal(calls[0].body[0],0);assert.deepEqual(JSON.parse(calls[0].body.subarray(5).toString()),{});
 assert.equal((await deps.request('GetModelResponse',{model:312,prompt:'Synthetic title'})).response,'合成标题');
 await assert.rejects(deps.request('DeleteCascadeTrajectory',{}),/outside naming feature/);
 await deps.storage.set('ignored',{schemaVersion:1,handled:{'synthetic-new-id':{reason:'success'}}});
 assert.equal((await deps.storage.get('ignored')).handled['synthetic-new-id'].reason,'success');
 deps.logger('title-updated');
 assert.ok(![...files.values()].join('').includes('synthetic-secret'),'Secrets must never enter feature state/status files');
 assert.equal(JSON.parse(files.get(path.join(folder,'chinese-title-status.json'))).updatedTitles,1);
 hooks.get('before-quit')();assert.equal(hooks.get('stopped'),true);
 await assert.rejects(deps.request('GetModelResponse',{model:312,prompt:'After stop'}),/unavailable/);
 console.log('Chinese title service boundaries passed: opt-in, localhost, framed snapshots, RPC allowlist, metadata and shutdown.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
