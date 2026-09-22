const {test}=require('node:test');
const assert=require('node:assert/strict');
const budget=require('../budget.js');
const sync=require('../form-sync.js');
const config={enabled:true,sheetId:'example-sheet',gid:'123',seen:{}};
const headers='Timestamp,Email Address,Team,Part Name,Quantity,Vendor,Vendor SKU,Link,Price,Justification,Status';
const line=(team='Madness',date='9/21/2026 12:00:00',price='12.50',qty='2')=>`${date},student@example.test,${team},Wheel,${qty},Vendor,SKU,https://example.test/wheel,${price},Robot,Ordered`;

test('money parsing uses integer cents and rejects partial, negative, and unsafe amounts',()=>{
  assert.equal(budget.parseMoney('$1,234.50'),123450);
  assert.equal(budget.parseMoney('0'),0);
  assert.equal(budget.parseMoney('0.01'),1);
  for(const value of ['','12abc','-1','1e3','3.141','1,23','Infinity','99999999999999999999']) assert.equal(budget.parseMoney(value),null,value);
});

test('budget separates pending, committed, and actual expenses without double counting',()=>{
  const result=budget.summarize([{category:'Parts',amount:10000}],
    [{type:'expense',category:'Parts',amount:2000,poId:'received'},{type:'income',amount:50000}],
    [{id:'received',status:'received',totalCost:2000,expensed:true},
     {id:'approved',status:'approved',totalCost:3000},
     {id:'ordered',status:'ordered',totalCost:1000},
     {id:'pending',status:'pending',totalCost:9000},
     {id:'denied',status:'denied',totalCost:10000},
     {id:'received',status:'ordered',totalCost:2000}]);
  assert.equal(result.spent,2000);assert.equal(result.committed,4000);
  assert.equal(result.remaining,4000);assert.equal(result.pending,9000);
  assert.equal(result.rows[1].planned,null);
});

test('zero budgets, unbudgeted expenses, and overspending stay visible',()=>{
  const result=budget.summarize([{category:'Parts',amount:0}],
    [{type:'expense',category:'Unknown legacy category',amount:2000}],
    [{status:'approved',totalCost:1000}]);
  assert.equal(result.configured,true);assert.equal(result.remaining,-3000);
  assert.equal(result.rows[0].remaining,-1000);assert.equal(result.rows.at(-1).spent,2000);
  assert.equal(budget.summarize([],[],[]).configured,false);
});

test('CSV parser handles quoted commas, newlines, escaped quotes, BOM and CRLF',()=>{
  assert.deepEqual(sync.parseCSV('\uFEFFa,b\r\n"motor, large","a ""quote""\nand newline"\r\n'),[['a','b'],['motor, large','a "quote"\nand newline']]);
  assert.throws(()=>sync.parseCSV('a,"unfinished'),/Incomplete/);
});

test('imports Madness only as pending and ignores source status',async()=>{
  const responses=await sync.readResponses([headers,line(),line('Mayhem'),line('Shared')].join('\n'),config);
  assert.equal(responses.length,1);
  const data={integrations:{googleForm:structuredClone(config)},orders:{},transactions:{existing:{amount:7}},budgets:{parts:{amount:8}},accounts:{admin:{role:'admin'}}};
  const result=sync.applyResponses(data,responses,123);
  assert.equal(result.imported,1);assert.equal(result.errors.length,0);
  const order=Object.values(data.orders)[0];
  assert.equal(order.totalCost,2500);assert.equal(order.unitCost,1250);assert.equal(order.qty,2);
  assert.equal(order.status,'pending');assert.equal(order.expensed,false);
  assert.equal(order.requestedBy,'student@example.test');
  assert.deepEqual(data.transactions,{existing:{amount:7}});assert.equal(data.budgets.parts.amount,8);
  order.status='approved';
  assert.equal(sync.applyResponses(data,responses,456).imported,0);
  assert.equal(order.status,'approved');assert.equal(data.integrations.googleForm.lastImportedAt,123);
  delete data.orders[responses[0].id];
  assert.equal(sync.applyResponses(data,responses,789).imported,0,'deleted imports stay deleted');
});

test('baseline skips existing orders and new submissions catch up after a closed session',async()=>{
  const old=await sync.readResponses([headers,line()].join('\n'),config);
  const data={integrations:{googleForm:{...structuredClone(config),seen:{[old[0].id]:true}}},orders:{}};
  const updated=await sync.readResponses([headers,line('Madness','9/22/2026 13:00:00'),line()].join('\n'),config);
  assert.equal(sync.applyResponses(data,updated,111).imported,1);
  assert.equal(Object.keys(data.orders).length,1);
});

test('invalid rows are flagged without blocking valid responses or leaking email in errors',async()=>{
  const rows=await sync.readResponses([headers,line('Madness','9/21/2026 12:01:00','12x'),line('Madness','9/21/2026 12:02:00','12','1.5'),line()].join('\n'),config);
  const data={integrations:{googleForm:structuredClone(config)}};
  const result=sync.applyResponses(data,rows,123);
  assert.equal(result.imported,1);assert.equal(result.errors.length,2);
  assert.ok(result.errors.every(error=>!error.includes('student@')));
});

test('duplicate identities fail safely, and changed headers cannot silently clear orders',async()=>{
  const rows=await sync.readResponses([headers,line(),line()].join('\n'),config);
  const result=sync.applyResponses({integrations:{googleForm:structuredClone(config)}},rows,123);
  assert.equal(result.imported,0);assert.equal(result.errors.length,2);
  await assert.rejects(sync.readResponses('<html>Sign in</html>',config),/unavailable/);
  const unsafe=await sync.readResponses([headers,line().replace('https://example.test/wheel','javascript:alert(1)')].join('\n'),config);
  assert.equal(sync.applyResponses({integrations:{googleForm:structuredClone(config)}},unsafe,1).imported,0);
});
