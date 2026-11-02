import test from 'node:test';
import assert from 'node:assert/strict';
import {serve} from './helpers.mjs';

test('UI release preserves prefixed routes and existing auth; Production Link is absent',async t=>{
 const base=await serve(t,{});
 const home=await (await fetch(base+'/Houdini/')).text();
 assert.match(home,/scene-review\.js/);
 assert.match(home,/영상 검수/);
 for(const route of ['static/scene-review.js','static/scene-review.json','api/overview','api/media','api/reports','healthz'])assert.equal((await fetch(base+'/Houdini/'+route)).status,200,route);
 const manifest=await (await fetch(base+'/Houdini/static/scene-review.json')).json();
 assert.equal(manifest.schema,'tc-scene-review/1');
 assert.deepEqual(manifest.assets,[],'no invented Houdini outputs');
 assert.equal((await fetch(base+'/Houdini/api/jobs')).status,404,'unreviewed Production Link not integrated');
 const locked=await serve(t,{authMode:'basic',users:''});
 for(const route of ['static/scene-review.js','static/scene-review.json'])assert.equal((await fetch(locked+'/Houdini/'+route)).status,401,'new assets use existing auth');
});
