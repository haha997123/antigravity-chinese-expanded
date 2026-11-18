'use strict';
const assert=require('node:assert/strict');
const {startChineseTitleWorker}=require('../features/chinese-title-worker.js');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const baseTime=Date.parse('2026-11-18T08:00:00.000Z');
function summary(created,title='Build a weather dashboard',extra={}) {
  return {summary:title,createdTime:new Date(created).toISOString(),annotations:{pinned:true,tags:['sample']},trajectoryMetadata:{},trajectoryType:'CASCADE',status:'IDLE',...extra};
}
function harness(options={}) {
  let time=baseTime,stored=clone(options.stored),worker;
  const calls=[],logs=[],timers=new Map();let timerId=0;
  const h={summaries:clone(options.summaries??{}),snapshotErrors:0,modelErrors:0,writeErrors:0,modelResult:'构建天气仪表板',modelHook:null,storageFails:false,storageReadsFail:false};
  const storage={
    async get(){if(h.storageReadsFail)throw new Error('private storage error');return clone(stored);},
    async set(key,value){if(h.storageFails)throw new Error('private storage error');stored=clone(value);}
  };
  async function request(method,body){
    calls.push({method,body:clone(body)});
    if(method==='GetAllCascadeTrajectories') {
      assert.deepEqual(body,{excludeSubtrajectories:true});
      if(h.snapshotErrors-->0)throw new Error('private service error');
      return {trajectorySummaries:clone(h.summaries)};
    }
    if(method==='GetModelResponse') {
      assert.equal(body.model,312);
      assert.equal(Object.keys(body).sort().join(','),'model,prompt');
      if(h.modelHook)await h.modelHook();
      if(h.modelErrors-->0)throw new Error('private model error');
      return {response:h.modelResult};
    }
    if(method==='UpdateConversationAnnotations') {
      assert.equal(body.mergeAnnotations,true);
      assert.equal(Object.keys(body.annotations).join(','),'title');
      assert.equal(body.cascadeIds.length,1);
      if(h.writeErrors-->0)throw new Error('private write error');
      const id=body.cascadeIds[0];
      h.summaries[id].annotations={...h.summaries[id].annotations,...body.annotations};
      return {};
    }
    assert.fail('Unexpected RPC '+method);
  }
  function start(extra={}) {
    worker=startChineseTitleWorker({request,storage,clock:()=>time,logger:event=>logs.push(event),autoSchedule:false,settleMs:0,
      setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);},...extra});
    return worker;
  }
  Object.assign(h,{calls,logs,timers,start,advance(ms=1000){time+=ms;},get time(){return time;},get stored(){return clone(stored);},get worker(){return worker;},count(method){return calls.filter(call=>call.method===method).length;}});
  // Object.assign evaluates getters, so install these explicitly.
  Object.defineProperties(h,{time:{get:()=>time},stored:{get:()=>clone(stored)},worker:{get:()=>worker}});
  return h;
}
async function main(){
  const h=harness({summaries:{'existing-old':summary(baseTime-86400000),'existing-clock-skew':summary(baseTime+100)}});
  await h.start().ready;
  assert.equal(h.count('GetModelResponse'),0,'The initial existing-ID baseline must never translate');
  h.advance();h.summaries['future-normal']=summary(h.time,'Build a weather dashboard');
  const oldAnnotations=clone(h.summaries['future-normal'].annotations);
  await h.worker.runOnce();
  assert.equal(h.count('GetModelResponse'),1);
  assert.equal(h.count('UpdateConversationAnnotations'),1);
  assert.equal(h.summaries['future-normal'].annotations.title,'构建天气仪表板');
  assert.equal(h.summaries['future-normal'].summary,'Build a weather dashboard','The automatic server summary must remain unchanged');
  assert.deepEqual({...h.summaries['future-normal'].annotations,title:undefined},{...oldAnnotations,title:undefined});
  const serialized=JSON.stringify(h.stored);
  assert.ok(!serialized.includes('weather') && !serialized.includes('构建') && !serialized.includes('prompt'),'Persistent metadata must not contain source/translated titles or prompts');
  for(let repeat=0;repeat<5;repeat++)await h.worker.runOnce();
  assert.equal(h.count('GetModelResponse'),1,'Repeated snapshots must not regenerate the same title');
  h.worker.stop();await h.start().ready;
  assert.equal(h.count('GetModelResponse'),1,'A restart must respect completed IDs');
  assert.ok(h.logs.every(event=>!event.includes('private') && !event.includes('weather')),'Logs must contain event names only');
  h.worker.stop();

  const mirrored=harness();await mirrored.start().ready;mirrored.advance();
  mirrored.summaries['new-auto-mirror']=summary(mirrored.time,'Build a weather dashboard',{annotations:{title:'Build a weather dashboard',pinned:true}});
  await mirrored.worker.runOnce();
  assert.equal(mirrored.summaries['new-auto-mirror'].annotations.title,'构建天气仪表板','A server-mirrored automatic title must also translate');
  assert.equal(mirrored.summaries['new-auto-mirror'].annotations.pinned,true);
  mirrored.worker.stop();

  const protectedCases=[
    ['cloud',{cloud:true}],
    ['child',{trajectoryMetadata:{parentConversationId:'parent-id'}}],
    ['fork',{forkParentConversationId:'parent-id'}],
    ['nested',{trajectoryMetadata:{nestingDepth:1}}],
    ['subagent',{trajectoryMetadata:{subagentSpec:{typeName:'sample'}}}],
    ['hidden',{trajectoryMetadata:{sourceMetadata:{hideFromConversationList:true}}}],
    ['tool-owned',{trajectoryMetadata:{sourceMetadata:{tool:{name:'example'}}}}],
    ['sidecar-owned',{trajectoryMetadata:{sourceMetadata:{payload:{case:'sidecar',value:{}}}}}],
    ['archived',{annotations:{archived:true}}],
    ['custom',{annotations:{title:'My custom title'}}],
    ['special',{trajectoryType:'COMMIT_MESSAGE_GENERATION'}]
  ];
  const p=harness();await p.start().ready;p.advance();
  for(const [name,extra] of protectedCases)p.summaries['skip-'+name]=summary(p.time,'A synthetic title',extra);
  p.summaries['skip-chinese']=summary(p.time,'修复项目设置');
  p.summaries['skip-old-late']=summary(baseTime-1000);
  p.summaries['skip-no-time']={summary:'No creation timestamp',annotations:{}};
  p.summaries['skip-too-long']=summary(p.time,'x'.repeat(161));
  p.summaries['skip-newline']=summary(p.time,'Line one\nLine two');
  p.summaries['skip-number']=summary(p.time,'123456');
  p.summaries['skip-empty']=summary(p.time,'');
  p.summaries['skip-placeholder']=summary(p.time,'New Conversation');
  p.summaries['']=summary(p.time);
  p.summaries['bad/id']=summary(p.time);
  await p.worker.runOnce();
  assert.equal(p.count('GetModelResponse'),0,'Protected and invalid summaries must not cost model requests');
  assert.equal(p.count('UpdateConversationAnnotations'),0);
  p.worker.stop();

  const race=harness();await race.start().ready;race.advance();race.summaries['race-rename']=summary(race.time);
  race.modelHook=()=>{race.summaries['race-rename'].annotations.title='User renamed while translating';};
  await race.worker.runOnce();
  assert.equal(race.count('GetModelResponse'),1);
  assert.equal(race.count('UpdateConversationAnnotations'),0,'A user rename during translation must win');
  race.worker.stop();await race.start().ready;
  assert.equal(race.summaries['race-rename'].annotations.title,'User renamed while translating');
  assert.equal(race.count('GetModelResponse'),1,'A restart must not override the custom title');
  race.worker.stop();

  const changed=harness();await changed.start().ready;changed.advance();changed.summaries['race-summary']=summary(changed.time);
  changed.modelHook=()=>{changed.summaries['race-summary'].summary='Configure project permissions';changed.modelHook=null;};
  await changed.worker.runOnce();
  assert.equal(changed.count('UpdateConversationAnnotations'),0,'A stale translation must never be applied to a changed summary');
  changed.advance(60000);changed.modelResult='配置项目权限';await changed.worker.runOnce();
  assert.equal(changed.count('GetModelResponse'),2);
  assert.equal(changed.summaries['race-summary'].annotations.title,'配置项目权限');
  changed.worker.stop();

  const failure=harness();await failure.start().ready;failure.advance();failure.summaries['fail-model']=summary(failure.time);failure.modelErrors=5;
  await failure.worker.runOnce();
  for(let repeat=0;repeat<10;repeat++)await failure.worker.runOnce();
  assert.equal(failure.count('GetModelResponse'),1,'Backoff must suppress rapid repeated model attempts');
  failure.worker.stop();await failure.start().ready;
  assert.equal(failure.count('GetModelResponse'),1,'Retry backoff must survive restart');
  failure.advance(60000);await failure.worker.runOnce();
  assert.equal(failure.count('GetModelResponse'),2);
  failure.advance(600000);for(let repeat=0;repeat<5;repeat++)await failure.worker.runOnce();
  assert.equal(failure.count('GetModelResponse'),2,'A conversation must have at most two model attempts');
  failure.worker.stop();await failure.start().ready;failure.advance(600000);await failure.worker.runOnce();
  assert.equal(failure.count('GetModelResponse'),2,'The two-attempt ceiling must survive restart');failure.worker.stop();

  for(const invalid of ['English title','第一行\n第二行','中'.repeat(61),'中'+'x'.repeat(80),'中文标题：这里是解释','```中文```']){
    const invalidCase=harness();await invalidCase.start().ready;invalidCase.advance();invalidCase.summaries['invalid-output']=summary(invalidCase.time);invalidCase.modelResult=invalid;
    await invalidCase.worker.runOnce();invalidCase.advance(60000);await invalidCase.worker.runOnce();
    assert.equal(invalidCase.count('UpdateConversationAnnotations'),0,'Invalid output must not be persisted');
    assert.equal(invalidCase.count('GetModelResponse'),2);invalidCase.worker.stop();
  }
  const quoted=harness();await quoted.start().ready;quoted.advance();quoted.summaries['quoted-title']=summary(quoted.time);quoted.modelResult='“配置项目权限”';
  await quoted.worker.runOnce();assert.equal(quoted.summaries['quoted-title'].annotations.title,'配置项目权限');quoted.worker.stop();

  const service=harness();service.snapshotErrors=1;await service.start().ready;
  assert.equal(service.count('GetModelResponse'),0);await service.worker.runOnce();
  service.advance();service.summaries['service-new']=summary(service.time);service.snapshotErrors=1;
  await service.worker.runOnce();assert.equal(service.count('GetModelResponse'),0,'Service read failure must never proceed to a model/write');
  await service.worker.runOnce();assert.equal(service.count('UpdateConversationAnnotations'),1);service.worker.stop();

  const beforeWrite=harness();await beforeWrite.start().ready;beforeWrite.advance();beforeWrite.summaries['prewrite-failure']=summary(beforeWrite.time);
  beforeWrite.modelHook=()=>{beforeWrite.snapshotErrors=1;};
  await beforeWrite.worker.runOnce();assert.equal(beforeWrite.count('UpdateConversationAnnotations'),0,'Failed prewrite verification must abort the write');beforeWrite.worker.stop();

  const persistFailure=harness();await persistFailure.start().ready;persistFailure.advance();persistFailure.summaries['storage-failure']=summary(persistFailure.time);persistFailure.storageFails=true;
  await persistFailure.worker.runOnce();assert.equal(persistFailure.count('GetModelResponse'),0,'Attempt counters must be saved before spending quota');persistFailure.worker.stop();

  const stop=harness();await stop.start().ready;stop.advance();stop.summaries['stop-in-model']=summary(stop.time);stop.modelHook=()=>stop.worker.stop();
  await stop.worker.runOnce();assert.equal(stop.count('UpdateConversationAnnotations'),0,'Stopping while awaiting a model response must prevent writes');

  const stable=harness();await stable.start({settleMs:1000}).ready;stable.advance();stable.summaries['stable-title']=summary(stable.time);
  await stable.worker.runOnce();assert.equal(stable.count('GetModelResponse'),0,'A title should settle before being translated');
  stable.advance(1000);await stable.worker.runOnce();assert.equal(stable.count('GetModelResponse'),1);stable.worker.stop();

  const timer=harness();await timer.start({autoSchedule:true}).ready;
  assert.equal(timer.timers.size,1);timer.worker.stop();assert.equal(timer.timers.size,0,'stop() must cancel polling');
  console.log('Future Chinese conversation title worker regression checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
