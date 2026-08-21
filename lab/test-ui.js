// Minimal DOM + speech stubs: enough to run lab.js's wiring and click handlers.
const els={};
function el(tag){return{tagName:tag,className:'',textContent:'',children:[],style:{},value:'',disabled:false,
  hidden:false,checked:true,_html:'',
  get innerHTML(){return this._html;},
  // Real browsers drop all children when innerHTML is assigned; model that, or a
  // re-render that relies on it looks like a duplicate-append bug.
  set innerHTML(v){this._html=v; if(v==='')this.children=[];},
  appendChild(c){this.children.push(c);return c},
  removeChild(c){this.children=this.children.filter(x=>x!==c)},
  addEventListener(k,f){(this._h=this._h||{})[k]=f},
  setAttribute(){},getAttribute(){return null},hasAttribute(){return false},
  querySelector(){return null},querySelectorAll(){return []},
  get firstChild(){return this.children[0]||null}, get nextSibling(){return null},
  classList:{add(){},remove(){},toggle(){}}};}
global.document={createElement:el,getElementById(id){return els[id]||(els[id]=el('div'))},
  head:el('head'),body:el('body'),addEventListener(){},
  querySelectorAll(){return []},readyState:'complete'};
global.window=global;
global.navigator={userAgent:'smoke',hardwareConcurrency:8,mediaDevices:{}};
global.performance={now:()=>Date.now()};
global.matchMedia=()=>({matches:false});
const spoken=[];
global.SpeechSynthesisUtterance=function(t){this.text=t;};
global.speechSynthesis={
  getVoices:()=>[{name:'Alpha',lang:'en-US',localService:true},
                 {name:'Beta',lang:'en-GB',localService:false},
                 {name:'Gamma',lang:'fr-FR',localService:true}],
  speak(u){spoken.push(u.text); setTimeout(()=>{u.onstart&&u.onstart(); u.onend&&u.onend();},0);},
  cancel(){}};
global.fetch=()=>Promise.resolve({json:()=>Promise.resolve({assets:{}})});
global.App={Vad:{start:()=>Promise.resolve(false),stop(){}}};
global.crypto={subtle:{}};

require('./lab.js');

let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log((c?'  PASS ':'  FAIL ')+n)};
const fire=(id,ev='click')=>{const h=els[id]&&els[id]._h&&els[id]._h[ev]; if(!h) throw new Error('no handler '+id); h.call(els[id],{});};

ok('voice select populated', els['tts-voice'].children.length>=2);
try{ fire('tts-speak'); ok('Speak does not throw', true);}catch(e){ok('Speak does not throw: '+e.message,false);}
try{ fire('tts-all');   ok('Play all does not throw', true);}catch(e){ok('Play all does not throw: '+e.message,false);}
try{ fire('tts-star');  ok('Shortlist does not throw', true);}catch(e){ok('Shortlist does not throw: '+e.message,false);}
ok('shortlist rendered a chip', els['tts-shortlist'].children.length===1);
try{ fire('tts-star');  ok('Shortlist dedupes', els['tts-shortlist'].children.length===1);}catch(e){ok('dedupe: '+e.message,false);}
try{ fire('tts-stop');  ok('Stop does not throw', true);}catch(e){ok('Stop does not throw: '+e.message,false);}


// --- deltaFrom: the shared cumulative/incremental reconciler
{
  const src=require('fs').readFileSync('./lab.js','utf8');
  const body=src.slice(src.indexOf('function deltaFrom'), src.indexOf('// Build an element'));
  const deltaFrom=new Function(body+'; return deltaFrom;')();
  const d=(a,b)=>deltaFrom(a,b);
  ok('cumulative growth trimmed', d('I did','I did 20')==='20');
  ok('verbatim repeat dropped', d('yes','yes')==='');
  ok('case-insensitive prefix', d('i did','I did 20')==='20');
  ok('new fragment kept whole', d('three sets','of ten')==='of ten');
  ok('empty prev passes through', d('','yes')==='yes');
  ok('empty next is empty', d('yes','')==='');
}

setTimeout(()=>{ console.log('\n'+p+' passed, '+f+' failed'); process.exit(f?1:0); },80);
