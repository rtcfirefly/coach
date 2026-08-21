// Regression test for Android's cumulative-final behaviour, using the exact
// transcripts a Pixel-class device produced in the lab on 2026-08-21.
global.window=global; global.document={addEventListener(){}};
let rec=null;
global.SpeechRecognition=class{constructor(){rec=this}start(){}stop(){}abort(){}};
global.speechSynthesis=null;
global.App={Store:{getLang:()=>'en-US',getVoice:()=>''}};
require('../js/speech.js');
let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS ':'  FAIL ')+n+(!c&&x?'\n         got: '+x:''))};
function run(finals){
  const got=[];
  App.Speech.create({onFinal:t=>got.push(t)},{continuous:true});
  rec.onstart();
  const results=[];
  finals.forEach(t=>{results.push({0:{transcript:t},isFinal:true}); rec.onresult({results:results.slice()});});
  return got.join(' ');
}
ok('cumulative "yes" collapses', run(['yes','yes'])==='yes', run(['yes','yes']));
const no=['no','no that','no that was','no that was the','no that was the last','no that was the last set'];
ok('"no that was the last set"', run(no)==='no that was the last set', run(no));
const rn=['I','I did','I did 20','I did 20 minute','I did 20 minute run','I did 20 minute run on','I did 20 minute run on my','I did 20 minute run on my left','I did 20 minute run on my left shoulder'];
ok('long cumulative utterance', run(rn)==='I did 20 minute run on my left shoulder', run(rn));
ok('incremental still concatenates', run(['three sets','of ten','at one thirty five'])==='three sets of ten at one thirty five');
ok('distinct utterances kept', run(['yes','next set'])==='yes next set');
ok('case-insensitive prefix', run(['I did','I did 20'])==='I did 20');
console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);
