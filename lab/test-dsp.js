global.window=global; global.document={createElement:()=>({}),head:{appendChild(){}}};
require('./engines.js');
const E=global.App.Engines;
let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS ':'  FAIL ')+n+(x&&!c?'  '+x:''))};
const mn=a=>{let v=Infinity;for(const x of a)if(x<v)v=x;return v};
const mx=a=>{let v=-Infinity;for(const x of a)if(x>v)v=x;return v};

const N=512,k0=32; let re=new Float32Array(N),im=new Float32Array(N);
for(let i=0;i<N;i++)re[i]=Math.cos(2*Math.PI*k0*i/N);
E._fft(re,im);
const mag=Array.from({length:N/2},(_,k)=>Math.hypot(re[k],im[k]));
ok('FFT peak bin', mag.indexOf(mx(mag))===k0);
ok('FFT leakage <1%', mag.filter((_,k)=>k!==k0).reduce((a,b)=>a+b,0) < mag[k0]*0.01);
re=new Float32Array(N).fill(1);im=new Float32Array(N);E._fft(re,im);
ok('DC -> bin 0 only', Math.abs(re[0]-N)<1e-3 && Math.abs(re[1])<1e-6);
re=new Float32Array(N);im=new Float32Array(N);
for(let i=0;i<N;i++)re[i]=Math.sin(i*0.7)+0.3*Math.cos(i*3.1);
const eT=re.reduce((a,x)=>a+x*x,0);E._fft(re,im);
let eF=0;for(let k=0;k<N;k++)eF+=re[k]*re[k]+im[k]*im[k];
ok('Parseval', Math.abs(eF/N-eT)/eT<1e-5);

const w=E._hann(400);
ok('Hann w[0]=0',Math.abs(w[0])<1e-9);
ok('Hann centre~1',Math.abs(w[200]-1)<1e-3);
ok('Hann symmetric',Math.abs(w[1]-w[399])<1e-9);

const fb=E._melFilterbank(80,400,16000);
ok('80 filters',fb.length===80);
ok('201 bins each',fb.every(r=>r.length===201));
ok('non-negative',fb.every(r=>r.every(v=>v>=0)));
ok('EVERY filter has energy',fb.every(r=>r.some(v=>v>0)),
   'empty rows: '+fb.map((r,i)=>r.some(v=>v>0)?null:i).filter(x=>x!==null).join(','));
const c=fb.map(r=>r.indexOf(mx(Array.from(r))));
ok('centres non-decreasing',c.every((x,i)=>i===0||x>=c[i-1]));
ok('centres actually span the range',c[79]>c[0]+100,'c0='+c[0]+' c79='+c[79]);
const sums=fb.map(r=>r.reduce((a,b)=>a+b,0));
ok('Slaney: no filter dominates', mx(sums)/mn(sums) < 60, 'ratio '+(mx(sums)/mn(sums)).toFixed(1));

const pcm=new Float32Array(16000);
for(let i=0;i<pcm.length;i++)pcm[i]=0.5*Math.sin(2*Math.PI*440*i/16000);
const t0=Date.now();const mel=E._logMel(pcm);const ms=Date.now()-t0;
ok('shape 80x3000',mel.length===240000);
ok('all finite',mel.every(v=>Number.isFinite(v)));
// Whisper clamps to 8dB below peak then (x+4)/4, so the SPAN is exactly 2.0.
// It is not centred on zero — the absolute position tracks the peak.
ok('dynamic range spans exactly 2.0',Math.abs((mx(mel)-mn(mel))-2)<1e-4,'span '+(mx(mel)-mn(mel)).toFixed(4));
// A 440 Hz tone should light up low mel bins, not high ones.
const rowE=[];for(let m=0;m<80;m++){let s=0;for(let t=0;t<300;t++)s+=mel[m*3000+t];rowE.push(s)}
const hot=rowE.indexOf(mx(rowE));
ok('440Hz tone lands in a low mel bin',hot<25,'hottest bin '+hot);
console.log('    logMel(30s) '+ms+' ms');
console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);
