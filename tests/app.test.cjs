const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const {setTimeout:wait}=require('node:timers/promises');
let html=readFileSync(require.resolve('../index.html'),'utf8');
for(const name of ['budget.js','form-sync.js']) html=html.replace(`<script src="${name}"></script>`,()=>'<script>'+readFileSync(require.resolve('../'+name),'utf8')+'</script>');
const sheet='Timestamp,Email Address,Team,Part Name,Quantity,Vendor,Vendor SKU,Link,Price,Justification\n9/21/2026 12:00:00,student@example.test,Madness,Motor,2,Vendor,SKU,https://example.test/motor,20.00,Robot';
async function fixture(role='admin',integration=false){
  let data={accounts:{test:{name:'Test treasurer',role,active:true}},transactions:{},orders:{},budgets:{},integrations:integration?{googleForm:{enabled:true,sheetId:'test-sheet',gid:'1',seen:{}}}:{}};
  let version=1,puts=0, conflict=null;
  const errors=[];
  const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'dangerously',virtualConsole,
    beforeParse(window){
      window.TextEncoder=TextEncoder;window.TextDecoder=TextDecoder;
      Object.defineProperty(window,'crypto',{value:webcrypto});
      window.AbortSignal=AbortSignal;
      window.localStorage.setItem('mm_token','test-token');window.localStorage.setItem('mm_session','test');
      window.fetch=async (url,options={})=>{
        if(url.startsWith('https://docs.google.com/')) return new Response(sheet);
        if(!url.startsWith('https://api.github.com/repos/Itz-jhsu11/midknight-treasury-data/')) throw new Error('Unexpected network target');
        if(options.method==='PUT'){
          puts++;
          if(conflict){conflict(data);conflict=null;version++;return new Response('{}',{status:409});}
          const body=JSON.parse(options.body);
          if(body.sha!==String(version)) return new Response('{}',{status:409});
          data=JSON.parse(Buffer.from(body.content,'base64').toString());version++;
          return new Response(JSON.stringify({content:{sha:String(version)}}));
        }
        return new Response(JSON.stringify({sha:String(version),content:Buffer.from(JSON.stringify(data)).toString('base64')}),{headers:{ETag:'v'+version}});
      };
    }});
  await wait(50);
  return {dom,window:dom.window,get data(){return data;},get puts(){return puts;},errors,
    conflict(fn){conflict=fn;},close(){dom.window.close();}};
}

test('budget editing persists all categories and shows over-budget spending',async()=>{
  const app=await fixture();try{
    const w=app.window,d=w.document;
    d.querySelector('[data-tab="budget"]').click();
    assert.ok(d.querySelector('#pane-budget').classList.contains('on'));
    assert.equal(d.querySelector('#b-planned').textContent,'Not set');
    d.querySelector('#btn-edit-budget').click();
    d.querySelector('#budget-0').value='100';d.querySelector('#budget-1').value='25.50';
    d.querySelector('#budget-save').click();await wait(30);
    assert.equal(app.data.budgets.parts.amount,10000);assert.equal(app.data.budgets.tools.amount,2550);
    assert.equal(d.querySelector('#b-planned').textContent,'$125.50');
    assert.equal(d.querySelector('#ov-budget').classList.contains('open'),false);
    assert.equal(app.puts,1);assert.deepEqual(app.errors,[]);
  }finally{app.close();}
});

test('form link opens separately and automatic import remains duplicate-free after retries',async()=>{
  const app=await fixture('admin',true);try{
    const link=app.window.document.querySelector('#btn-add-po');
    assert.match(link.href,/1FAIpQLSdshetIBCvFgAF9a_3X4Ep1y6rSGhobmxnh1RNX8fI210uDBg/);
    assert.equal(link.target,'_blank');
    assert.equal(Object.keys(app.data.orders).length,1);assert.equal(app.puts,1);
    await app.window.eval('syncGoogleForm()');
    assert.equal(app.puts,1,'no empty GitHub commits from repeated checks');
    assert.equal(Object.values(app.data.orders)[0].totalCost,4000);
    assert.deepEqual(app.errors,[]);
  }finally{app.close();}
});

test('receipt and ledger expense are atomic and use refreshed order amounts after a conflict',async()=>{
  const app=await fixture();try{
    await app.window.eval('S.db.doc("orders/order1").set({partName:"Motor",vendor:"Vendor",qty:2,unitCost:1000,totalCost:2000,status:"ordered",expensed:false})');
    app.conflict(data=>{data.orders.order1.totalCost=3500;data.transactions.other={type:'income',amount:8000};});
    app.window.document.querySelector('[data-po-move="order1:received"]').click();await wait(50);
    assert.equal(app.data.orders.order1.status,'received');assert.equal(app.data.orders.order1.expensed,true);
    assert.equal(app.data.transactions.po_order1.amount,3500);assert.equal(app.data.transactions.other.amount,8000);
    assert.equal(Object.values(app.data.transactions).filter(t=>t.poId==='order1').length,1);
    assert.deepEqual(app.errors,[]);
  }finally{app.close();}
});

test('concurrent import preserves other team edits and does not reinsert a committed response',async()=>{
  const app=await fixture('admin',true);try{
    const id=Object.keys(app.data.orders)[0];
    // Simulate another browser recording a new transaction while a budget edit is pending.
    app.conflict(data=>{data.transactions.other={type:'expense',amount:123,category:'Tools'};data.orders[id].status='approved';});
    await app.window.eval('S.db.doc("budgets/tools").set({category:"Tools",amount:10000})');
    await app.window.eval('syncGoogleForm()');
    assert.equal(app.data.transactions.other.amount,123);
    assert.equal(app.data.orders[id].status,'approved');assert.equal(Object.keys(app.data.orders).length,1);
  }finally{app.close();}
});

test('members can view budgets and open the form but cannot edit allocations or enter manual orders',async()=>{
  const app=await fixture('member');try{
    const d=app.window.document;
    assert.equal(d.querySelector('#btn-edit-budget').style.display,'none');
    assert.equal(d.querySelector('#btn-add-po-manual').style.display,'none');
    assert.equal(d.querySelector('#btn-add-po').style.display,'');
    d.querySelector('#btn-edit-budget').click();
    assert.equal(d.querySelector('#ov-budget').classList.contains('open'),false);
  }finally{app.close();}
});
