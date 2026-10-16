const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {merge,clone} = require('../js/cloud-merge.js');
const source = fs.readFileSync(path.join(__dirname,'../js/firebase-sync.js'),'utf8');
const initial = () => ({vendas:[],produtos:[{id:'a',nome:'Bala',estoque:10,preco:2},{id:'b',nome:'Bolo',estoque:8,preco:5}],clientes:[],despesas:[]});
function server(payload = initial()) {
  let doc = {payload:clone(payload),revision:0}, catalog;
  const listeners = [];
  const snap = value => ({exists:true,data:()=>clone(value),metadata:{fromCache:false,hasPendingWrites:false}});
  const ref = {get:async options=>{assert.equal(options.source,'server');return snap(doc);},onSnapshot:(options,callback)=>{listeners.push(callback);return()=>{};}};
  const catalogRef = {};
  let commits = 0;
  return {
    get doc(){return clone(doc);},get catalog(){return catalog;},get commits(){return commits;},
    db:{collection:name=>({doc:()=>name==='businesses'?ref:catalogRef}),runTransaction:async work=>{
      for(let attempt=0;attempt<10;attempt++) {
        const before=clone(doc), writes=[];
        const result=await work({get:async()=>snap(before),set:(ref,value)=>writes.push([ref,clone(value)])});
        if(doc.revision!==before.revision)continue;
        for(const [target,value] of writes) {if(target===ref)doc=value;else catalog=value;}
        commits++; const committed=clone(doc);listeners.forEach(fn=>queueMicrotask(()=>fn(snap(committed))));
        return result;
      }
      throw Error('Retry limit');
    }}
  };
}
async function client(backend) {
  let state, busy=false, poll;
  const events=[], removed=[];
  const auth={setPersistence:async()=>{},onAuthStateChanged:callback=>{queueMicrotask(()=>callback({email:'viniciusferpa70@gmail.com'}));return()=>{};}};
  const firestore=()=>backend.db;firestore.FieldValue={serverTimestamp:()=>({serverTimestamp:true})};
  const authFn=()=>auth;authFn.Auth={Persistence:{LOCAL:'LOCAL'}};
  const sandbox={console,location:{hostname:'test'},navigator:{onLine:true},document:{getElementById:()=>null},localStorage:{getItem:()=>{throw Error('Must never read browser records');},setItem:()=>{throw Error('Must never write browser records');},removeItem:key=>removed.push(key)},firebase:{initializeApp:()=>{},auth:authFn,firestore},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail;}},setInterval:callback=>{poll=callback;}};
  sandbox.window={VinicinhoMerge:{merge,clone,equal:require('../js/cloud-merge.js').equal},dispatchEvent:event=>events.push(event),addEventListener:()=>{}};
  vm.runInNewContext(source,sandbox);
  const cloud=sandbox.window.VinicinhoCloud;
  state=await cloud.ready;
  cloud.bind({read:()=>state,busy:()=>busy,apply:data=>{state=clone(data);}});
  return {cloud,events,removed,get data(){return state;},set data(value){state=value;},set busy(value){busy=value;},poll:()=>poll(),offline:()=>{sandbox.navigator.onLine=false;}};
}
test('startup uses Firebase only, removes legacy records and never writes on login',async()=>{
  const db=server(),a=await client(db);assert.deepEqual(a.data,initial());assert.equal(db.commits,0);assert.equal(a.removed.length,1);
});
test('two computers merge unrelated writes and receive live updates; catalog is atomic',async()=>{
  const db=server(),a=await client(db),b=await client(db);
  a.data.clientes.push({id:'c1',nome:'Ana'});b.data.produtos[1].preco=7;
  await Promise.all([a.cloud.save(a.data),b.cloud.save(b.data)]);a.poll();b.poll();
  assert.equal(db.doc.payload.clientes.length,1);assert.equal(db.doc.payload.produtos[1].preco,7);
  assert.deepEqual(a.data,db.doc.payload);assert.deepEqual(b.data,db.doc.payload);
  assert.equal(db.catalog.revision,db.doc.revision);assert.equal(db.doc.syncVersion,2);
});
test('same-stock concurrent sales conflict instead of silently losing a decrement',async()=>{
  const db=server(),a=await client(db),b=await client(db);
  a.data.produtos[0].estoque--;a.data.vendas.push({id:'s1'});
  b.data.produtos[0].estoque--;b.data.vendas.push({id:'s2'});
  const outcomes=await Promise.allSettled([a.cloud.save(a.data),b.cloud.save(b.data)]);
  assert.equal(outcomes.filter(v=>v.status==='rejected').length,1);
  assert.equal(db.doc.payload.vendas.length,1);assert.equal(db.doc.payload.produtos[0].estoque,9);
});
test('stale computer does not resurrect records deleted elsewhere',()=>{
  const base={clientes:[{id:'a',nome:'Ana'}],meta:100},local=clone(base),remote={clientes:[],meta:100};local.meta=200;
  assert.deepEqual(merge(base,local,remote),{clientes:[],meta:200});
  local.clientes[0].nome='Outra';assert.throws(()=>merge(base,local,remote),{code:'sync/conflict'});
});
test('legacy named records merge; ambiguous arrays reject concurrent edits',()=>{
  const base={produtos:[{nome:'Bala',preco:1},{nome:'Bolo',preco:2}]},a=clone(base),b=clone(base);
  a.produtos[0].preco=3;b.produtos[1].preco=4;assert.deepEqual(merge(base,a,b).produtos.map(p=>p.preco),[3,4]);
  assert.throws(()=>merge([1],[1,2],[1,3]),{code:'sync/conflict'});
});
test('queued saves preserve subsequent edits and do not use a delayed local write',async()=>{
  const db=server(),a=await client(db);a.data.clientes.push({id:'c1'});const first=a.cloud.save(a.data);
  a.data.clientes.push({id:'c2'});const second=a.cloud.save(a.data);
  await Promise.all([first,second]);assert.equal(db.doc.payload.clientes.length,2);assert.deepEqual(a.data,db.doc.payload);
});
test('live update waits while user edits, then refreshes without browser persistence',async()=>{
  const db=server(),a=await client(db),b=await client(db);b.busy=true;
  a.data.clientes.push({id:'c1'});await a.cloud.save(a.data);assert.equal(b.data.clientes.length,0);
  b.busy=false;b.poll();assert.equal(b.data.clientes.length,1);
});
test('offline save is rejected, retained only in memory and reported as unsaved',async()=>{
  const db=server(),a=await client(db);a.offline();a.data.clientes.push({id:'c1'});
  await assert.rejects(a.cloud.save(a.data));assert.equal(db.commits,0);assert.equal(a.cloud.blocked,true);
  assert.ok(a.events.some(event=>event.type==='vinicinho-cloud-error'));
  await a.cloud.reload();assert.equal(a.cloud.blocked,false);assert.equal(a.data.clientes.length,0);
});
