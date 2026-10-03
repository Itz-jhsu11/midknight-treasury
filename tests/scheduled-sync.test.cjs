const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runSync}=require('../scripts/sync-orders.cjs');
const csv='Timestamp,Email Address,Team,Part Name,Quantity,Vendor,Link,Price,Status\n10/1/2026 10:00:00,test@example.test,Madness,Wheel,2,Vendor,https://example.test,10,Received';
function fixture(){
  let data={integrations:{googleForm:{enabled:true,sheetId:'example',gid:'123',syncStatuses:true}},accounts:{a:{name:'Example'}},budgets:{parts:{amount:10000}},orders:{manual:{totalCost:12}},transactions:{unrelated:{type:'income',amount:5}}},version=1,conflict=false,writes=0;
  const revisions={};
  return {
    get data(){return data;},get writes(){return writes;},conflict(){conflict=true;},
    options:{enableEstimatedTax:true,apply:true,now:()=>1791000000000,fetchSheet:async()=>csv,
      read:async revision=>({sha:String(version),data:structuredClone(revision?revisions[revision]:data)}),
      write:async({sha,content})=>{
        writes++;
        if(conflict){conflict=false;data.budgets.tools={amount:321};version++;throw Object.assign(new Error('Conflict'),{status:409});}
        assert.equal(sha,String(version));data=JSON.parse(content);version++;const revision='commit'+version;revisions[revision]=structuredClone(data);return revision;
      }
    }
  };
}
test('scheduled sync retries conflicts, preserves other edits, and skips unchanged writes',async()=>{
  const f=fixture();f.conflict();const result=await runSync(f.options);
  assert.equal(result.saved,true);assert.equal(result.imported,1);assert.equal(result.expenses,1);assert.equal(f.writes,2);
  assert.equal(f.data.budgets.tools.amount,321);assert.equal(f.data.transactions.unrelated.amount,5);assert.equal(f.data.orders.manual.totalCost,12);
  const order=Object.values(f.data.orders).find(o=>o.source==='google-form');assert.equal(order.tax,195);assert.equal(order.totalCost,2195);
  assert.equal((await runSync(f.options)).changed,false);assert.equal(f.writes,2);
});
test('preview and source failures never write live data',async()=>{
  const f=fixture();const result=await runSync({...f.options,apply:false});assert.equal(result.changed,true);assert.equal(result.saved,false);assert.equal(f.writes,0);
  await assert.rejects(runSync({...f.options,fetchSheet:async()=>'<html>Sign in</html>'}),/unavailable/);
  assert.equal(f.writes,0);
});
