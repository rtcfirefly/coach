// Utterance buffering: many recogniser fragments must become ONE turn.
// Android emits a final per word, so without this a sentence fires a turn per word.
global.window=global;
global.document={addEventListener(){},hidden:false,currentScript:null};
let rec=null;
global.SpeechRecognition=class{constructor(){rec=this}start(){}stop(){}abort(){}};
global.speechSynthesis=null;
global.navigator={};
const turns=[];
global.App={
  Store:{getLang:()=>'en-US',getVoice:()=>'',getApiKey:()=>'k'},
  UI:{setCallState(){},setCallTimer(){},setUserCaption(){},openCall(){},closeCall(){},
      setComposerEnabled(){},setCallMuted(){},addAssistantBubble(){},addUserMessage(t){turns.push(t)},
      appendAssistantDelta(){},finishAssistant(){},hideTyping(){},showTyping(){},toast(){},
      refreshHistory(){},refreshSessions(){},addLogChip(){},addSessionChip(){},startTimer(){},showScreen(){}},
  // Resolve immediately: a pending turn makes call.js QUEUE the next utterance
  // rather than dispatch it, which is correct behaviour but hides what we test.
  Api:{runTurn:()=>Promise.resolve()},
  Vad:{start:()=>Promise.resolve(false),stop(){},setSensitivity(){}}
};
require('../js/speech.js');
require('../js/call.js');

let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS ':'  FAIL ')+n+(!c&&x?'  got: '+JSON.stringify(x):''))};

App.Call.start();
// Android pattern: cumulative finals, one per word.
const words=['I','I did','I did 20','I did 20 minute','I did 20 minute run'];
const results=[];
words.forEach(t=>{results.push({0:{transcript:t},isFinal:true}); rec.onresult({results:results.slice()});});

ok('nothing dispatched while still speaking', turns.length===0, turns);

setTimeout(()=>{
  ok('exactly one turn after the gap', turns.length===1, turns);
  ok('turn text is the whole utterance', turns[0]==='I did 20 minute run', turns[0]);

  // A second utterance in the SAME session: e.results keeps growing, it does
  // not reset, so the new finals land at higher indices in the same list.
  ['next','next set'].forEach(t=>{results.push({0:{transcript:t},isFinal:true}); rec.onresult({results:results.slice()});});
  setTimeout(()=>{
    ok('second utterance is a separate turn', turns.length===2, turns);
    ok('second turn text correct', turns[1]==='next set', turns[1]);

    // Ending the call must not leave a fragment queued to fire afterwards.
    results.push({0:{transcript:'stray'},isFinal:true}); rec.onresult({results:results.slice()});
    App.Call.end();
    setTimeout(()=>{
      ok('no turn fires after the call ends', turns.length===2, turns);
      console.log('\n'+p+' passed, '+f+' failed');
      process.exit(f?1:0);
    },1000);
  },1000);
},1000);
