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
  const safeData={integrations:{googleForm:structuredClone(config)}};
  assert.equal(sync.applyResponses(safeData,unsafe,1).imported,1);
  assert.equal(Object.values(safeData.orders)[0].link,'');
  assert.equal(Object.values(safeData.orders)[0].linkNeedsReview,true);
});

test('calculates unit price times packs, with order-level shipping, tax, and discount exactly once',()=>{
  assert.deepEqual(budget.calculateOrderCost({unitCost:590,qty:15,shipping:799,tax:708,discount:500}),{subtotal:8850,totalCost:9857});
  assert.deepEqual(budget.calculateOrderCost({unitCost:10,qty:3,tax:2}),{subtotal:30,totalCost:32});
  assert.throws(()=>budget.calculateOrderCost({unitCost:100,qty:1,discount:101}),/Discount/);
  assert.throws(()=>budget.calculateOrderCost({unitCost:Number.MAX_SAFE_INTEGER,qty:2}),/large/);
  assert.throws(()=>budget.calculateOrderCost({unitCost:100,qty:1,tax:-1}),/tax/);
});

test('backfills selected existing rows, follows statuses, and records each received expense once',async()=>{
  const csv=[headers,line().replace('Robot,Ordered','Robot,RECEIVED'),line('Madness','9/22/2026 13:00:00')].join('\n');
  const rows=await sync.readResponses(csv,config);
  const data={integrations:{googleForm:{...structuredClone(config),syncStatuses:true,seen:{[rows[0].id]:true},backfillIds:[rows[0].id]}},transactions:{unrelated:{type:'expense',amount:99}}};
  const result=sync.applyResponses(data,rows,1791000000000);
  assert.equal(result.imported,2);assert.equal(result.expenses,1);
  assert.equal(data.orders[rows[0].id].status,'received');assert.equal(data.orders[rows[1].id].status,'ordered');
  assert.equal(data.transactions['po_'+rows[0].id].amount,2500);
  const snapshot=JSON.stringify(data);
  assert.deepEqual(sync.applyResponses(data,rows,1791000100000),{imported:0,updated:0,expenses:0,errors:[]});
  assert.equal(JSON.stringify(data),snapshot);
  assert.equal(data.transactions.unrelated.amount,99);assert.deepEqual(data.integrations.googleForm.backfillIds,[]);
});

test('source price and quantity corrections update the same expense and preserve entered extra charges',async()=>{
  const original=await sync.readResponses([headers,line().replace('Robot,Ordered','Robot,RECEIVED')].join('\n'),config);
  const data={integrations:{googleForm:{...structuredClone(config),syncStatuses:true}}};
  sync.applyResponses(data,original,1791000000000);
  const id=original[0].id;
  Object.assign(data.orders[id],{shipping:1000,tax:150,discount:200,costsReviewed:true,category:'Tools'});
  const revised=await sync.readResponses([headers,line('Madness','9/21/2026 12:00:00','11.25','3').replace('Robot,Ordered','Robot,RECEIVED')].join('\n'),config);
  assert.equal(sync.applyResponses(data,revised,1791000100000).expenses,1);
  assert.equal(data.orders[id].totalCost,4325);assert.equal(data.transactions['po_'+id].amount,4325);
  assert.equal(data.transactions['po_'+id].category,'Tools');assert.equal(Object.keys(data.transactions).length,1);
  assert.equal(data.transactions['po_'+id].createdAt,1791000000000);
});

test('optional sheet charges override app charges and reject ambiguous or invalid amounts',async()=>{
  const rows=await sync.readResponses([headers+',Shipping,Tax,Discount',line()+',5.00,2.50,3.00'].join('\n'),config);
  const order=sync.toOrder(rows[0],1,{shipping:9999});
  assert.equal(order.totalCost,2950);assert.deepEqual(order.sourceCostFields,['shipping','tax','discount']);assert.equal(order.costsReviewed,true);
  await assert.rejects(sync.readResponses(headers+',Shipping,Shipping Cost\n'+line()+',1,2',config),/Ambiguous/);
  const invalid=await sync.readResponses(headers+',Tax\n'+line()+',8%',config);
  assert.throws(()=>sync.toOrder(invalid[0],1),/tax/);
});

test('on hold stays pending; a changed status cannot erase a recorded expense',async()=>{
  const data={integrations:{googleForm:{...structuredClone(config),syncStatuses:true}}};
  const received=await sync.readResponses(headers+'\n'+line().replace('Robot,Ordered','Robot,RECEIVED'),config);
  sync.applyResponses(data,received,1791000000000);
  const onHold=await sync.readResponses(headers+'\n'+line().replace('Robot,Ordered','Robot,ON HOLD Must justify'),config);
  const result=sync.applyResponses(data,onHold,1791000100000);
  assert.equal(result.errors.length,1);assert.equal(data.orders[received[0].id].status,'received');
  assert.equal(data.transactions['po_'+received[0].id].amount,2500);
  assert.equal(sync.sourceStatus('ON HOLD Must justify'),'pending');assert.equal(sync.sourceStatus('Purchased'),'ordered');
});

test('duplicate expenses block a row update without partially changing its order',async()=>{
  const rows=await sync.readResponses(headers+'\n'+line().replace('Robot,Ordered','Robot,RECEIVED'),config);
  const id=rows[0].id,data={integrations:{googleForm:{...structuredClone(config),syncStatuses:true}},orders:{},transactions:{a:{type:'expense',poId:id,amount:1},b:{type:'expense',poId:id,amount:2}}};
  const result=sync.applyResponses(data,rows,1791000000000);
  assert.match(result.errors[0],/Multiple expenses/);assert.equal(data.orders[id],undefined);assert.equal(data.transactions.a.amount,1);
});

test('tax estimates use exact cents, discounted merchandise, and exclude shipping',()=>{
  const price=input=>budget.priceOrder({unitCost:590,qty:15,taxMode:'estimate',...input});
  assert.equal(price({}).tax,863);assert.equal(price({}).totalCost,9713);
  assert.equal(price({shipping:1000,discount:500}).tax,814);
  assert.equal(price({unitCost:10000,qty:1}).tax,975);
  assert.equal(price({taxTreatment:'non-taxable'}).tax,0);
  assert.equal(price({taxMode:'manual',tax:0}).taxEstimated,false);
  assert.equal(price({taxMode:'sheet',tax:123}).tax,123);
  assert.throws(()=>price({taxMode:'manual',tax:null}),/tax/);
  assert.throws(()=>price({qty:1.5}),/Quantity/);
  assert.throws(()=>price({discount:100000}),/Discount/);
});

test('estimated tax updates with quantity and discount, while manual and sheet zero override it',async()=>{
  const policy=budget.DEFAULT_TAX_POLICY;
  const responses=await sync.readResponses(headers+'\n'+line(),config);
  const order=sync.toOrder(responses[0],1,{},policy);
  assert.equal(order.tax,244);assert.equal(order.taxEstimated,true);
  const changed=structuredClone(responses[0]);changed.values.qty='3';changed.values.discount='5';
  assert.equal(sync.toOrder(changed,2,order,policy).tax,317);
  const manual={...order,tax:0,taxMode:'manual'};
  assert.equal(sync.toOrder(changed,2,manual,policy).tax,0);
  assert.equal(sync.toOrder(changed,2,manual,policy).taxEstimated,false);
  const zero=structuredClone(responses[0]);zero.values.tax='0';
  assert.equal(sync.toOrder(zero,2,order,policy).taxMode,'sheet');
  assert.equal(sync.toOrder(zero,2,order,policy).tax,0);
  zero.values.tax='';
  assert.equal(sync.toOrder(zero,2,order,policy).tax,244);
  assert.equal(sync.toOrder(zero,2,order,policy).sourceCostFields.includes('tax'),false);
  assert.equal(sync.toOrder(responses[0],1,{costsReviewed:true,tax:0},policy).taxMode,'manual');
});

test('confirmed tax replaces the estimate in one existing expense and repeat imports do nothing',async()=>{
  const data={integrations:{googleForm:{...structuredClone(config),syncStatuses:true,taxPolicy:budget.DEFAULT_TAX_POLICY}}};
  const rows=await sync.readResponses(headers+'\n'+line().replace('Robot,Ordered','Robot,Received'),config);
  sync.applyResponses(data,rows,1791000000000);
  const id=rows[0].id,expense=data.transactions['po_'+id];
  assert.equal(expense.amount,2744);assert.equal(expense.taxEstimated,true);assert.equal(expense.estimatedTax,244);
  const snapshot=JSON.stringify(data);
  assert.deepEqual(sync.applyResponses(data,rows,1791000100000),{imported:0,updated:0,expenses:0,errors:[]});
  assert.equal(JSON.stringify(data),snapshot);
  rows[0].values.tax='1.00';sync.applyResponses(data,rows,1791000200000);
  assert.equal(data.transactions['po_'+id].amount,2600);
  assert.equal(data.transactions['po_'+id].taxEstimated,false);assert.equal(data.transactions['po_'+id].estimatedTax,0);
  assert.equal(Object.keys(data.transactions).length,1);
});
