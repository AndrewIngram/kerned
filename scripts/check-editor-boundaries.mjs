import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const files=(await readdir('src/editor')).filter(name=>name.endsWith('.ts'));
for(const name of files){
 const source=await readFile(`src/editor/${name}`,'utf8');
 for(const [,specifier] of source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)){
  assert.ok(specifier.startsWith('./')&&!specifier.slice(2).includes('/'),`Core ${name} imports outside its boundary: ${specifier}`);
 }
}
const independent=await readFile('src/editor-extension-checks.ts','utf8');
for(const [,specifier] of independent.matchAll(/from\s*['"]([^'"]+)['"]/g))assert.equal(specifier,'./editor','Independent extension tests must use only the public entry point');
for(const file of ['src/editor-container-checks.ts','src/editor-selection-checks.ts','src/extensions/cell-selection.ts']){
 const source=await readFile(file,'utf8');
 for(const [,specifier] of source.matchAll(/from\s*['"]([^'"]+)['"]/g))assert.ok(specifier==='./editor'||specifier==='../editor'||specifier.startsWith('./extensions/'),`${file} bypasses the public API: ${specifier}`);
}
console.log(`Checked ${files.length} core modules and public-only extension fixtures`);
