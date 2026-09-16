import test from 'node:test';import assert from 'node:assert/strict';
import {createBlobStore,digest} from '../server/office-store.mjs';
import {BlobPreconditionFailedError} from '@vercel/blob';
function memoryBlob(){const files=new Map();let serial=0;const writes=[];
 return {files,writes,blobGet:async(path,options)=>{assert.equal(options.useCache,false);assert.equal(options.headers['Accept-Encoding'],'identity');const saved=files.get(path);return saved?{blob:{etag:saved.etag},stream:new Blob([saved.body]).stream()}:null},blobPut:async(path,body,options)=>{await new Promise(r=>setImmediate(r));const old=files.get(path);writes.push({path,options});if(options.ifMatch&&options.ifMatch!==old?.etag)throw new BlobPreconditionFailedError();if(old&&options.allowOverwrite===false)throw new Error('Vercel Blob: This blob already exists, use allowOverwrite');const saved={body,etag:String(++serial)};files.set(path,saved);return saved}}
}
test('Blob simultaneous first writes retry create conflicts without losing either change',async()=>{
 const transport=memoryBlob(),a=createBlobStore({...transport,prefix:'fresh'}),b=createBlobStore({...transport,prefix:'fresh'}),token='a'.repeat(64);
 const add=ws=>{ws.counter=(ws.counter||0)+1;return ws.counter};const results=await Promise.all([a.transact(token,add),b.transact(token,add)]);assert.deepEqual(results.sort(),[1,2]);assert.equal(await a.transact(token,ws=>ws.counter),2);assert.ok(transport.writes.slice(2).every(w=>w.options.ifMatch));
});
test('Blob upgrades copy legacy data to new prefix, preserve original and remove legacy bundle key',async()=>{
 const transport=memoryBlob(),token='b'.repeat(64),old=createBlobStore({...transport,prefix:'legacy'});await old.transact(token,ws=>{ws.counter=8});const oldPath='legacy/'+digest(token)+'.json';const saved=transport.files.get(oldPath);saved.body=JSON.stringify({...JSON.parse(saved.body),key:'legacy-encryption-key'});const before=saved.body;
 const upgraded=createBlobStore({...transport,prefix:'new',legacyPrefix:'legacy'});assert.equal(await upgraded.transact(token,ws=>++ws.counter),9);assert.equal(transport.files.get(oldPath).body,before);assert.equal(JSON.parse(transport.files.get('new/'+digest(token)+'.json').body).key,undefined);assert.equal(await old.transact(token,ws=>ws.counter),8);
});
test('Blob conditional writes retry at most three times and never relax business version guards',async()=>{
 const transport=memoryBlob(),token='c'.repeat(64),store=createBlobStore({...transport,prefix:'conflict'});await store.transact(token,()=>{});let attempts=0;
 const blocked=createBlobStore({...transport,prefix:'conflict',blobPut:async()=>{attempts++;throw new BlobPreconditionFailedError()}});await assert.rejects(()=>blocked.transact(token,ws=>{ws.counter=1}),{code:'STORAGE_CONFLICT'});assert.equal(attempts,3);assert.equal(await store.transact(token,ws=>ws.counter),undefined);
 attempts=0;await assert.rejects(()=>blocked.transact(token,()=>{throw Object.assign(new Error('version changed'),{code:'STALE_VERSION'})}),{code:'STALE_VERSION'});assert.equal(attempts,0);
});
test('durable site quota CAS does not lose parallel increments',async()=>{
 const transport=memoryBlob(),a=createBlobStore(transport),b=createBlobStore(transport);await Promise.all([a.quota(q=>++q.count),b.quota(q=>++q.count)]);assert.equal(await a.quota(q=>q.count),2);
});
