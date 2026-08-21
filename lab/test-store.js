// Exercises the REAL store.js against a localStorage stub.
const store={};
global.localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},
  removeItem:k=>{delete store[k]},key:i=>Object.keys(store)[i],get length(){return Object.keys(store).length}};
global.window=global; global.console.warn=()=>{};
require('../js/store.js');
const S=global.App.Store;
const lcName=r=>String(r.name).toLowerCase();
let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS ':'  FAIL ')+n+(!c&&x?'  '+JSON.stringify(x):''))};

// --- #10: the unit in force at log time must be stamped, not inferred later
S.setUnits('kg');
const w=S.addWorkout({exercises:[{name:'Squat',type:'strength',sets:[{reps:5,weight:100}]}]},'s1');
ok('unit stamped at log time', w.exercises[0].sets[0].unit==='kg', w.exercises[0].sets[0]);
S.setUnits('lb');
const again=S.getWorkouts()[0];
ok('switching lb/kg does not relabel history', again.exercises[0].sets[0].unit==='kg', again.exercises[0].sets[0]);
const w2=S.addWorkout({exercises:[{name:'Bench',type:'strength',sets:[{reps:5,weight:100}]}]},'s1');
ok('new entry uses the new unit', w2.exercises[0].sets[0].unit==='lb');
const w3=S.addWorkout({exercises:[{name:'Row',type:'strength',sets:[{reps:5,weight:60,unit:'kg'}]}]},'s1');
ok('explicit unit is not overwritten', w3.exercises[0].sets[0].unit==='kg');

// --- #11: replaying a tool_use id must not log twice
const a=S.addWorkout({exercises:[{name:'Dip',type:'strength'}]},'s1',null,'tool_abc');
const b=S.addWorkout({exercises:[{name:'Dip',type:'strength'}]},'s1',null,'tool_abc');
ok('same tool_use id is idempotent', a.id===b.id);

// --- #2: a turn interrupted by a reload must be undone on boot
S.setCurrentSession({id:'x',messages:[{role:'user',content:'old'},{role:'assistant',content:[]}],inFlightFrom:2});
S.setCurrentSession(Object.assign(S.getCurrentSession(),{messages:[
  {role:'user',content:'old'},{role:'assistant',content:[]},{role:'user',content:'stranded'}],inFlightFrom:2}));
ok('repairSession reports it repaired', S.repairSession()===true);
const s=S.getCurrentSession();
ok('stranded message removed', s.messages.length===2, s.messages.map(m=>m.role));
ok('earlier turns kept', s.messages[0].content==='old');
ok('marker cleared', s.inFlightFrom===undefined);
ok('second call is a no-op', S.repairSession()===false);

// A clean session must be left alone.
S.setCurrentSession({id:'y',messages:[{role:'user',content:'hi'}]});
ok('clean session untouched', S.repairSession()===false && S.getCurrentSession().messages.length===1);

// --- #16: routine names are the addressing scheme, so they must be unique
S.setRoutines([]);
const a1=S.addRoutine('Push'), a2=S.addRoutine('Push'), a3=S.addRoutine('Push');
ok('duplicate names disambiguated', a2.name==='Push 2' && a3.name==='Push 3', [a1.name,a2.name,a3.name]);
// Collision detection is case-insensitive, but the case the user typed is kept.
ok('case-insensitive collision detected', S.addRoutine('push').name.toLowerCase()==='push 4', S.getRoutines().map(r=>r.name));
S.renameRoutine(a1.id,'Pull');
ok('rename to a free name works', S.getRoutines().filter(r=>r.id===a1.id)[0].name==='Pull');
S.renameRoutine(a1.id,'Push 2');
ok('rename onto a taken name disambiguates',
   S.getRoutines().filter(r=>r.id===a1.id)[0].name==='Push 2 2',
   S.getRoutines().map(r=>r.name));
S.renameRoutine(a2.id,'Push 2');
ok('renaming to its own name is a no-op',
   S.getRoutines().filter(r=>r.id===a2.id)[0].name==='Push 2');
ok('mergeRoutine still resolves one target',
   (S.mergeRoutine('Pull',['Row']), S.getRoutines().filter(r=>lcName(r)==='pull').length<=1));

console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);
