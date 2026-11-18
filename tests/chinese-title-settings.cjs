'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {setEnabled}=require('../configure-chinese-titles.cjs');
const temporaryRoot=fs.realpathSync(os.tmpdir());
const root=fs.mkdtempSync(path.join(temporaryRoot,'antigravity-title-settings-'));
try{
  const profile=path.join(root,'profile');
  assert.deepEqual(setEnabled(profile,true),{enabled:true,requiresRestart:true});
  const settings=path.join(profile,'chinese-title-settings.json');
  assert.equal(fs.readFileSync(settings)[0],123,'Settings must be UTF-8 without a BOM');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings,'utf8')),{schemaVersion:1,enabled:true});
  const state=path.join(profile,'chinese-title-state.json');
  fs.writeFileSync(state,'{"schemaVersion":1,"baselineInitialized":true}');
  const existingState=fs.readFileSync(state);
  fs.writeFileSync(settings,'\uFEFF'+JSON.stringify({schemaVersion:1,enabled:true,customSetting:'preserve'}));
  assert.deepEqual(setEnabled(profile,false),{enabled:false,requiresRestart:true});
  assert.deepEqual(JSON.parse(fs.readFileSync(settings,'utf8')),{schemaVersion:1,enabled:false,customSetting:'preserve'});
  assert.ok(fs.readFileSync(state).equals(existingState),'Toggling must preserve historical-ID state');
  fs.writeFileSync(settings,'malformed-json');
  assert.throws(()=>setEnabled(profile,true),/无法解析/);
  assert.equal(fs.readFileSync(settings,'utf8'),'malformed-json');
  fs.writeFileSync(settings,'{"schemaVersion":2,"enabled":false}');
  assert.throws(()=>setEnabled(profile,true),/版本不受支持/);
  assert.equal(fs.readFileSync(settings,'utf8'),'{"schemaVersion":2,"enabled":false}');
  assert.equal(fs.readdirSync(profile).filter(name=>name.endsWith('.tmp')).length,0);
  console.log('Chinese title settings checks passed: opt-in, BOM handling, preserve state, malformed/version rejection.');
}finally{
  if(path.dirname(fs.realpathSync(root))!==temporaryRoot || fs.lstatSync(root).isSymbolicLink())throw Error('Test cleanup containment check failed');
  fs.rmSync(root,{recursive:true,force:true});
}
