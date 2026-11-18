'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

function setEnabled(directory,enabled) {
  if(typeof enabled!=='boolean')throw Error('启用选项必须为布尔值。');
  const target=path.join(path.resolve(directory),'chinese-title-settings.json');
  let settings={schemaVersion:1};
  try{settings=JSON.parse(fs.readFileSync(target,'utf8').replace(/^\uFEFF/,''));}
  catch(error){if(error.code!=='ENOENT')throw Error('现有自动标题设置无法解析，未覆盖原文件。');}
  if(!settings || Array.isArray(settings) || settings.schemaVersion!==1)throw Error('现有自动标题设置版本不受支持，未修改。');
  const temporary=target+'.'+crypto.randomUUID()+'.tmp';
  fs.mkdirSync(path.dirname(target),{recursive:true});
  try{
    fs.writeFileSync(temporary,JSON.stringify({...settings,enabled},null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
    fs.renameSync(temporary,target);
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return {enabled,requiresRestart:true};
}

module.exports={setEnabled};
if(require.main===module){
  try{
    if(process.platform!=='win32')throw Error('此设置工具仅支持 Windows Antigravity。');
    const args=process.argv.slice(2);
    if(args.length!==1 || !['--enable','--disable'].includes(args[0]))throw Error('用法：node configure-chinese-titles.cjs --enable 或 --disable');
    if(!process.env.APPDATA)throw Error('未找到当前用户的 APPDATA 目录。');
    const result=setEnabled(path.join(process.env.APPDATA,'Antigravity'),args[0]==='--enable');
    console.log(result.enabled?'已启用自动中文会话标题。':'已关闭自动中文会话标题。');
    console.log('设置将在下次启动 Antigravity 时生效，请保存工作后自行重新启动。');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
