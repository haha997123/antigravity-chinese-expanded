'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {buildInjectScript}=require('../patch.js');
const dictionary=JSON.parse(fs.readFileSync(path.join(__dirname,'..','dictionary.json'),'utf8'));
const injected=buildInjectScript(dictionary);

// Simulate actual MutationObserver delivery: text-node edits only reach an element
// observer when subtree is enabled, and replacing TITLE mutates HEAD instead.
function fixture(initialTitle,hostname='127.0.0.1') {
  const observers=[];
  let titleWrites=0;
  function notify(record) {
    for(const observer of observers) {
      for(const [target,options] of observer.targets) {
        let inside=record.target===target;
        if(options.subtree) for(let node=record.target.parentElement;node;node=node.parentElement) if(node===target) inside=true;
        if(inside && options[record.type]) {observer.records.push(record);break;}
      }
    }
  }
  class TextNode {
    constructor(value) {this.nodeType=3;this.value=value;this.parentElement=null;}
    get data(){return this.value;}
    set data(value){this.value=value;notify({type:'characterData',target:this});}
    get textContent(){return this.value;}
    set textContent(value){this.data=value;}
  }
  class Element {
    constructor(tag,children=[]) {
      this.nodeType=1;this.tagName=tag.toUpperCase();this.parentElement=null;this.childNodes=children;
      for(const child of children) child.parentElement=this;
    }
    get textContent(){return this.childNodes.map(node=>node.textContent).join('');}
    set textContent(value){
      for(const child of this.childNodes) child.parentElement=null;
      const text=new TextNode(value);text.parentElement=this;this.childNodes=[text];
      notify({type:'childList',target:this,addedNodes:[text]});
    }
    appendChild(child){child.parentElement=this;this.childNodes.push(child);notify({type:'childList',target:this,addedNodes:[child]});return child;}
    replaceChild(next,previous){
      const index=this.childNodes.indexOf(previous);assert.ok(index>=0);
      previous.parentElement=null;next.parentElement=this;this.childNodes[index]=next;
      notify({type:'childList',target:this,addedNodes:[next],removedNodes:[previous]});return previous;
    }
    getAttribute(){return null;}
    hasAttribute(){return false;}
    matches(){return false;}
    querySelectorAll(selector){
      const found=[];
      for(const child of this.childNodes) if(child.nodeType===1) {
        if(selector==='title' && child.tagName==='TITLE') found.push(child);
        found.push(...child.querySelectorAll(selector));
      }
      return found;
    }
  }
  class MutationObserver {
    constructor(callback){this.callback=callback;this.targets=new Map();this.records=[];observers.push(this);}
    observe(target,options){this.targets.set(target,{...options});}
    disconnect(){this.targets.clear();this.records=[];}
  }
  const head=new Element('head');
  if(initialTitle!==null) head.appendChild(new Element('title',[new TextNode(initialTitle)]));
  const body=new Element('body');
  const document={
    head,body,readyState:'complete',
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;},
    querySelectorAll(selector){return [...head.querySelectorAll(selector),...body.querySelectorAll(selector)];},
    get title(){return this.querySelector('title')?.textContent??'';},
    set title(value){
      titleWrites++;
      let title=this.querySelector('title');
      if(!title) title=head.appendChild(new Element('title'));
      title.textContent=value;
    }
  };
  function flush(){
    for(let turn=0;turn<30;turn++) {
      const ready=observers.map(observer=>[observer,observer.records.splice(0)]).filter(([,records])=>records.length);
      if(!ready.length) return;
      for(const [observer,records] of ready) observer.callback(records);
    }
    assert.fail('Title observer did not become idle; possible mutation loop');
  }
  vm.runInNewContext(injected,{window:{location:{protocol:'https:',hostname,pathname:'/'}},document,Node:{TEXT_NODE:3,ELEMENT_NODE:1},MutationObserver,console});
  flush();
  return {document,head,TextNode,Element,flush,get titleWrites(){return titleWrites;},observers};
}

for(const [source,expected] of [
  ['New Conversation','新建会话'],
  ['New Conversation - Antigravity','新建会话 - Antigravity'],
  ['Agent Manager - Antigravity','智能体管理器 - Antigravity'],
  ['Settings | Antigravity','设置 | Antigravity'],
  ['Customizations — Antigravity','自定义配置 — Antigravity'],
  ['Open Terminal - Antigravity','Open Terminal - Antigravity'],
  ['Reading Report - Antigravity','Reading Report - Antigravity'],
  ['Deploy Website From Project - Antigravity','Deploy Website From Project - Antigravity'],
  ['My Project - Settings','My Project - Settings'],
  ['Settings - ExampleProject','Settings - ExampleProject'],
  ['Antigravity','Antigravity']
]) {
  const f=fixture(source);
  assert.equal(f.document.title,expected,'Initial title: '+source);
  const writes=f.titleWrites;
  f.flush();f.flush();
  assert.equal(f.titleWrites,writes,'Stable titles must not trigger repeated writes');
}

const dynamic=fixture('Antigravity');
dynamic.document.title='New Conversation - Antigravity';dynamic.flush();
assert.equal(dynamic.document.title,'新建会话 - Antigravity','document.title changes must be localized');
dynamic.document.querySelector('title').childNodes[0].data='Settings - Antigravity';dynamic.flush();
assert.equal(dynamic.document.title,'设置 - Antigravity','Direct TITLE text-node data edits must be observed');
const replacement=new dynamic.Element('title',[new dynamic.TextNode('Agent Manager - Antigravity')]);
dynamic.head.replaceChild(replacement,dynamic.document.querySelector('title'));dynamic.flush();
assert.equal(dynamic.document.title,'智能体管理器 - Antigravity','Replacing the entire TITLE element must stay observed');
replacement.childNodes[0].data='New Conversation - Antigravity';dynamic.flush();
assert.equal(dynamic.document.title,'新建会话 - Antigravity','The replacement TITLE text node must remain observed');
dynamic.document.title='Open Terminal - Antigravity';dynamic.flush();
assert.equal(dynamic.document.title,'Open Terminal - Antigravity','User-generated conversation titles must remain unchanged');
const writes=dynamic.titleWrites;
for(let repeat=0;repeat<5;repeat++) dynamic.flush();
assert.equal(dynamic.titleWrites,writes,'Repeated title observer delivery must become idle');

const missing=fixture(null);
missing.head.appendChild(new missing.Element('title',[new missing.TextNode('New Conversation - Antigravity')]));missing.flush();
assert.equal(missing.document.title,'新建会话 - Antigravity','A TITLE added after startup must translate');
missing.document.querySelector('title').childNodes[0].data='Settings - Antigravity';missing.flush();
assert.equal(missing.document.title,'设置 - Antigravity','A late-added TITLE must remain observed');

const unrelated=fixture('Settings - Antigravity','example.com');
assert.equal(unrelated.document.title,'Settings - Antigravity','The patch must not translate unrelated origins');
assert.equal(unrelated.observers.length,0);
console.log('Window title localization regression checks passed.');
