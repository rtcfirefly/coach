// Validates everything in the Kokoro path except the ONNX call itself, using the
// real published vocab and the real style-file dimensions (522240 bytes =
// 130560 float32 = exactly 510 rows of 256).
import { G2P } from '../lab/vendor/g2p/index.js';
import fs from 'fs';
const vocab = JSON.parse(fs.readFileSync(new URL('./fixtures/kokoro-vocab.json', import.meta.url), 'utf8'));
const MAXID = Math.max(...Object.values(vocab));
const ROWS = 522240 / 4 / 256;      // 510
const g2p = await G2P.create({ languages: ['en'] });

let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS ':'  FAIL ')+n+(!c&&x?'  '+x:''))};

function build(text){
  const toks=g2p.phonemize(text,'en').tokens;
  const body=[]; let dropped=0;
  for(const t of toks){ if(Object.prototype.hasOwnProperty.call(vocab,t)) body.push(vocab[t]); else dropped++; }
  let truncated=0;
  if(body.length>510){ truncated=body.length-510; body.length=510; }
  const row=Math.min(body.length, ROWS-1);
  return {ids:[0,...body,0], row, dropped, truncated};
}

const a=build('Three sets of ten at one thirty five');
ok('no phonemes dropped', a.dropped===0);
ok('padded both ends', a.ids[0]===0 && a.ids.at(-1)===0);
// The vocab is SPARSE — ids run past the entry count, so bound by the real max.
ok('ids within the published id range', a.ids.every(i=>Number.isInteger(i)&&i>=0&&i<=MAXID), 'max '+Math.max(...a.ids)+' vs '+MAXID);
ok('style row = UNPADDED body length', a.row===a.ids.length-2);
ok('row is a valid index', a.row>=0 && a.row<ROWS);

const long=build('Romanian deadlift '.repeat(120));
ok('over-long input truncated', long.truncated>0);
ok('fits the 512 context', long.ids.length<=512, 'len '+long.ids.length);
// The style file has 510 rows (0..509) while the reference asserts len<=510,
// so index 510 is out of range. Our clamp is stricter than the reference.
ok('never indexes the out-of-range row 510', long.row!==510 && long.row<=ROWS-1, 'row '+long.row);

ok('empty text does not crash', build('').ids.length===2);
console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);
