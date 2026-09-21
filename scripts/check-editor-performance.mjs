import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const report=process.argv[2];

assert.ok(report,'Pass a benchmark:editor-foundation report JSON path');

const [baseline,current]=await Promise.all(['artifacts/editor-foundation/baseline.json',report].map(async path=>JSON.parse(await readFile(path,'utf8'))));

assert.ok(current.trials.length>=3,'At least three serial trials are required');

const failures=[];

for(const key of Object.keys(baseline.summary)){
 const value=current.summary[key];
 assert.ok(value&&Number.isFinite(value.max)&&value.max>=0,`Missing or invalid metric: ${key}`);
 const original=baseline.summary[key].max;
 const limit=key==='loadedHeapBytes'?original*1.15:key==='typingFrameMs'||key==='pagingFrameMs'?original+16.7:original*1.2;
 console.log(`${key}: ${value.max.toFixed(1)} <= ${limit.toFixed(1)}`);

 if(value.max>limit)failures.push(key);
}

assert.deepEqual(failures,[],'Editor performance regression budgets exceeded');
