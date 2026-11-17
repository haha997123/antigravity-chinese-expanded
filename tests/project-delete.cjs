'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {buildInjectScript}=require('../patch.js');
const dictionary=JSON.parse(fs.readFileSync(path.join(__dirname,'..','dictionary.json'),'utf8'));
const injected=buildInjectScript(dictionary);
class TextNode {
  constructor(value){this.nodeType=3;this.value=value;this.writes=0;}
  get textContent(){return this.value;}
  set textContent(value){this.value=value;this.writes++;}
}
class Element {
  constructor(tag,children=[],attributes={}){
    this.nodeType=1;this.tagName=tag.toUpperCase();this.childNodes=children;this.attributes={...attributes};
    for(const child of children) child.parentElement=this;
  }
  get textContent(){return this.childNodes.map(node=>node.textContent).join('');}
  getAttribute(name){return this.attributes[name]??null;}
  hasAttribute(name){return Object.hasOwn(this.attributes,name);}
  setAttribute(name,value){this.attributes[name]=value;}
  matches(selector){
    return selector.split(',').some(part=>{
      part=part.trim();
      if(part.startsWith('[data-testid=')) return part.includes('"'+this.attributes['data-testid']+'"');
      if(part.startsWith('[contenteditable]')) return this.attributes.contenteditable && this.attributes.contenteditable!=='false';
      if(/^[a-z]+$/i.test(part)) return this.tagName===part.toUpperCase();
      return part.startsWith('.') && (this.attributes.class||'').split(' ').includes(part.slice(1));
    });
  }
  querySelectorAll(selector){
    const found=[];
    for(const child of this.childNodes) if(child.nodeType===1){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}
    return found;
  }
}
function deletionRow(name='ExampleProject',count='1 active conversation',mixed=false){
  const projectName=new TextNode(name);
  const strongName=new Element('strong',[projectName]);
  const prefix=new TextNode(mixed?'永久删除':'Permanently delete');
  const space=new TextNode(' ');
  const including=new TextNode(' including ');
  const countText=new TextNode(count);
  const strongCount=new Element('strong',[countText]);
  const stop=new TextNode('.');
  const inner=new Element('span',count===null?[prefix,space,strongName,stop]:[prefix,space,strongName,including,strongCount,stop]);
  const description=new Element('span',[inner],{class:'text-sm text-muted-foreground whitespace-pre-wrap'});
  const label=new Element('span',[new TextNode('Delete Project')]);
  const column=new Element('div',[new Element('div',[label],{class:'flex items-center gap-1.5'}),description],{class:'flex-1 flex flex-col gap-0.5'});
  const button=new Element('button',[new TextNode('Delete Project')],{'data-testid':'delete-project-button','data-action':'delete-project',disabled:'disabled'});
  const right=new Element('div',[button],{class:'shrink-0'});
  const row=new Element('div',[column,right],{class:'py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center'});
  return {row,inner,description,column,button,projectName,strongName,prefix,including,countText,strongCount,stop};
}
function run(children,hostname='127.0.0.1'){
  const body=new Element('body',children),observers=[];
  class Observer{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}}
  vm.runInNewContext(injected,{window:{location:{protocol:'https:',hostname,pathname:'/settings'}},document:{body,readyState:'complete',title:'Antigravity',querySelector(){return null;},querySelectorAll(selector){return body.querySelectorAll(selector);}},Node:{TEXT_NODE:3,ELEMENT_NODE:1},MutationObserver:Observer,console});
  return {body,observer:observers[0]};
}
for(const [count,translated] of [
  ['1 active conversation','1 个进行中的对话'],
  ['12 active conversations','12 个进行中的对话'],
  ['1 archived conversation','1 个已归档的对话'],
  ['23 archived conversations','23 个已归档的对话'],
  ['1 active conversation and 2 archived conversations','1 个进行中的对话和 2 个已归档的对话'],
  ['10 active conversations and 1 archived conversation','10 个进行中的对话和 1 个已归档的对话'],
  ['1 个进行中的对话','1 个进行中的对话']
]){
  const f=deletionRow('网站设置',count,true);
  const beforeAttributes={...f.button.attributes};
  const {observer}=run([f.row]);
  assert.equal(f.inner.textContent,'永久删除 网站设置，包括 '+translated+'。');
  assert.equal(f.projectName.textContent,'网站设置');
  assert.equal(f.countText.textContent,translated);
  assert.equal(f.strongName.parentElement,f.inner);
  assert.equal(f.strongCount.parentElement,f.inner);
  assert.deepEqual(f.button.attributes,beforeAttributes,'Translation must not change deletion controls or their state');
  const writes=[f.prefix,f.including,f.countText,f.stop].map(node=>node.writes);
  for(let repeat=0;repeat<5;repeat++) observer.callback([{type:'characterData',target:f.countText}]);
  assert.deepEqual([f.prefix,f.including,f.countText,f.stop].map(node=>node.writes),writes,'Stable descriptions must not be rewritten');
}
for(const name of ['Settings','including','Permanently delete','1 active conversation','New Conversation','网站设置']){
  const f=deletionRow(name);
  const {observer}=run([f.row]);
  assert.equal(f.projectName.textContent,name,'Project names must remain data, even when matching a dictionary entry');
  const replacement=new TextNode('Settings');replacement.parentElement=f.strongName;f.strongName.childNodes=[replacement];
  observer.callback([{type:'childList',target:f.strongName,addedNodes:[replacement]}]);
  assert.equal(replacement.textContent,'Settings','Name protection must survive text-node replacement');
}
const noCount=deletionRow('Settings',null);
run([noCount.row]);
assert.equal(noCount.inner.textContent,'永久删除 Settings。','Descriptions without conversations must retain the project name');
const existing=deletionRow('FirstProject');
const dynamic=run([existing.row]);
const late=deletionRow('SecondProject','3 active conversations and 4 archived conversations');
late.row.parentElement=dynamic.body;dynamic.body.childNodes.push(late.row);
dynamic.observer.callback([{type:'childList',target:dynamic.body,addedNodes:[late.row]}]);
assert.equal(late.inner.textContent,'永久删除 SecondProject，包括 3 个进行中的对话和 4 个已归档的对话。','New settings rows must translate after initial load');
late.countText.textContent='5 active conversations';
dynamic.observer.callback([{type:'characterData',target:late.countText}]);
assert.equal(late.countText.textContent,'5 个进行中的对话','Changing conversation counts must stay localized');

for(const [tag,attributes] of [
  ['div',{'data-testid':'user-message'}],['div',{'data-testid':'agent-response'}],
  ['div',{'data-testid':'commentable-content'}],['div',{'data-testid':'live-user-turn'}],
  ['div',{'data-testid':'live-agent-turn'}],['pre',{}],['code',{}],
  ['div',{class:'monaco-editor'}],['div',{class:'cm-editor'}],['div',{contenteditable:'true'}]
]){
  const f=deletionRow('ExampleProject');
  run([new Element(tag,[f.row],attributes)]);
  assert.equal(f.inner.textContent,'Permanently delete ExampleProject including 1 active conversation.','Deletion lookalikes in protected content must remain untouched');
}
const unrelated=deletionRow('ExampleProject');
unrelated.button.attributes['data-testid']='some-other-button';
run([unrelated.row]);
assert.equal(unrelated.including.textContent,' including ','A dedicated delete-project control must identify the settings row');
const wrongShape=deletionRow('ExampleProject');
wrongShape.row.attributes.class='ordinary-panel';
run([wrongShape.row]);
assert.equal(wrongShape.including.textContent,' including ','Arbitrary prose with a similar button must remain outside the composed translator');
const ordinary=new TextNode('including');
run([new Element('span',[ordinary])]);
assert.equal(ordinary.textContent,'including','The word including must not gain a global translation');
const remote=deletionRow('ExampleProject');
run([remote.row],'example.com');
assert.equal(remote.inner.textContent,'Permanently delete ExampleProject including 1 active conversation.');
console.log('Project deletion description regression checks passed.');
