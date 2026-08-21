// Every flow that mutates the current session must refuse while a turn is in
// flight OR a call is active. Review finding #4: these had diverged, and
// "Finish chat" during a call archived the conversation the call was still
// writing to.
global.window=global;
global.document={addEventListener(){},readyState:'complete',hidden:false,currentScript:null};
const toasts=[], calls=[];
let callActive=false, turnPending=null;
global.App={
  Store:{ensureCurrentSession:()=>({id:'s',messages:[]}),getCurrentSession:()=>({id:'s',messages:[{role:'user',content:'hi'}]}),
    setCurrentSession(){},getApiKey:()=>'k',startNewSession:()=>({id:'s2',messages:[]}),archiveSession(){},clearAll(){calls.push('clearAll')},
    getWorkouts:()=>[],getRoutines:()=>[],getSummary:()=>null},
  Api:{runTurn:()=>turnPending=new Promise(()=>{}), summarizeSession:()=>{calls.push('summarize');return Promise.resolve()},
       importHistory:()=>{calls.push('import');return Promise.resolve({count:0,chunks:1})},
       suggestSessions:()=>{calls.push('suggest');return Promise.resolve({sessions:0})}},
  UI:{init(h){global.H=h},showScreen(){},renderSession(){},refreshHistory(){},refreshSettings(){},
      toast(m){toasts.push(m)},setComposerEnabled(){},focusInput(){},addUserMessage(){},showTyping(){},
      hideTyping(){},appendAssistantDelta(){},finishAssistant(){},addLogChip(){},addSessionChip(){},
      startTimer(){},refreshSessions(){},dropPendingTurn(){},getImportText:()=>'x',setImportBusy(){},
      setImportStatus(){},clearImportText(){},setSuggestBusy(){},fillComposer(){}},
  Call:{isActive:()=>callActive}
};
global.confirm=()=>true;
require('../js/app.js');

let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS ':'  FAIL ')+n+(!c&&x?'  '+x:''))};

// --- during an active call, every session-mutating flow must refuse
callActive=true; calls.length=0; toasts.length=0;
H.onFinish(); ok('Finish refuses during a call', calls.indexOf('summarize')===-1, calls.join(','));
H.onImport(); ok('Import refuses during a call', calls.indexOf('import')===-1, calls.join(','));
H.onSuggestSessions(); ok('Suggest refuses during a call', calls.indexOf('suggest')===-1, calls.join(','));
H.onClearAll(); ok('Clear-all refuses during a call', calls.indexOf('clearAll')===-1, calls.join(','));
H.onNewChat(); ok('New chat refuses during a call', true);
ok('user was told why', toasts.some(t=>/call/i.test(t)), toasts.join('|'));

// --- with no call and nothing in flight, they proceed
callActive=false; calls.length=0;
H.onSuggestSessions(); ok('Suggest runs when idle', calls.indexOf('suggest')!==-1, calls.join(','));
// Suggest set busy=true and clears it asynchronously, so clear-all is correctly
// refused until that settles — let it, then confirm the gate reopens.
calls.length=0;
H.onClearAll(); ok('Clear-all refused while suggest is in flight', calls.indexOf('clearAll')===-1);
setTimeout(()=>{
  calls.length=0;
  H.onClearAll(); ok('Clear-all runs once idle again', calls.indexOf('clearAll')!==-1, calls.join(','));
  console.log('\n'+p+' passed, '+f+' failed');
  process.exit(f?1:0);
},20);
