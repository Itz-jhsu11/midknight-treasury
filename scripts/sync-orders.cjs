#!/usr/bin/env node
'use strict';
// Uses the owner's existing gh login. Never stores credentials or response rows.
const {execFileSync}=require('node:child_process');
const sync=require('../form-sync.js');
const budget=require('../budget.js');
const endpoint='repos/Itz-jhsu11/midknight-treasury-data/contents/data.json';

async function runSync({read,write,fetchSheet,apply=false,enableEstimatedTax=false,scheduled=false,now=Date.now}){
  for(let attempt=0;attempt<5;attempt++){
    const {sha,data}=await read(),before=JSON.stringify(data),config=data.integrations?.googleForm;
    if(!config?.enabled) throw new Error('The Google Form connection is disabled or missing.');
    if(!/^[a-zA-Z0-9_-]+$/.test(config.sheetId) || !/^\d+$/.test(String(config.gid))) throw new Error('Invalid response sheet connection.');
    if(enableEstimatedTax && !config.taxPolicy) config.taxPolicy={...budget.DEFAULT_TAX_POLICY};
    if(scheduled) config.scheduledEveryDays=3;
    const csv=await fetchSheet('https://docs.google.com/spreadsheets/d/'+config.sheetId+'/export?format=csv&gid='+config.gid);
    const responses=await sync.readResponses(csv,config);
    const result=sync.applyResponses(data,responses,now());
    const content=JSON.stringify(data),changed=content!==before;
    const summary={...result,changed,saved:false,
      sourceOrders:Object.values(data.orders||{}).filter(order=>order.source==='google-form').length,
      estimatedTaxCents:Object.values(data.orders||{}).filter(order=>order.source==='google-form'&&order.taxEstimated).reduce((sum,order)=>sum+order.tax,0)};
    if(!changed || !apply) return summary;
    try{
      const revision=await write({sha,content});
      // Read the exact saved revision so a concurrent later edit cannot cause a
      // false verification failure or tempt a rollback of another teammate's work.
      const verified=await read(revision);
      if(JSON.stringify(verified.data)!==content) throw new Error('Saved data could not be verified.');
      return {...summary,saved:true};
    }catch(error){
      if(error.status===409) continue;
      throw error;
    }
  }
  throw new Error('Concurrent edits prevented saving. Retry later.');
}

function gh(args,input){
  try{return JSON.parse(execFileSync('gh',args,{input,encoding:'utf8',maxBuffer:10_000_000,timeout:45_000,stdio:['pipe','pipe','pipe']}));}
  catch(error){
    const failure=new Error('GitHub request failed; check gh access to the private treasury data repository.');
    if(String(error.stderr).includes('HTTP 409')) failure.status=409;
    throw failure;
  }
}
async function main(){
  const flags=new Set(process.argv.slice(2));
  for(const flag of flags) if(!['--apply','--enable-estimated-tax','--scheduled'].includes(flag)) throw new Error('Unknown option: '+flag);
  const result=await runSync({apply:flags.has('--apply'),enableEstimatedTax:flags.has('--enable-estimated-tax'),scheduled:flags.has('--scheduled'),
    read:async revision=>{
      const file=gh(['api',endpoint+(revision?'?ref='+encodeURIComponent(revision):'')]);
      return {sha:file.sha,data:JSON.parse(Buffer.from(file.content,'base64').toString('utf8'))};
    },
    write:async({sha,content})=>gh(['api','--method','PUT',endpoint,'--input','-'],JSON.stringify({sha,content:Buffer.from(content).toString('base64'),message:'treasury: synchronize Madness orders, totals, and tax estimates'})).commit.sha,
    fetchSheet:async url=>{
      try{return execFileSync('curl',['--fail','--silent','--show-error','--location','--max-time','30','--max-filesize','2000000',url],{encoding:'utf8',maxBuffer:2_000_000,timeout:35_000,stdio:['ignore','pipe','pipe']});}
      catch{throw new Error('Could not read the Google response sheet; existing orders were kept.');}
    }
  });
  console.log(JSON.stringify({mode:flags.has('--apply')?'apply':'preview',...result},null,2));
  if(result.errors.length) process.exitCode=2;
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={runSync};
