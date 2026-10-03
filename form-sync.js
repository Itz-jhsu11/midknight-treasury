/* Google response-sheet import. No credentials or response data belong in this file. */
(function(root){
  "use strict";
  const budget = typeof module!=="undefined" && module.exports ? require("./budget.js") : root.TreasuryBudget;
  function parseCSV(text){
    text = text.replace(/^\uFEFF/, "");
    const rows=[]; let row=[], field="", quoted=false, closed=false;
    for(let index=0;index<text.length;index++){
      const ch=text[index];
      if(quoted){
        if(ch==='"'){
          if(text[index+1]==='"'){field+='"';index++;} else {quoted=false;closed=true;}
        }else field+=ch;
      }else if(ch==='"'){
        if(field || closed) throw new Error("Invalid response-sheet CSV.");
        quoted=true;
      }else if(ch===","){
        row.push(field);field="";closed=false;
      }else if(ch==='\r' || ch==='\n'){
        if(ch==='\r' && text[index+1]==='\n') index++;
        row.push(field);rows.push(row);row=[];field="";closed=false;
      }else{
        if(closed) throw new Error("Invalid response-sheet CSV.");
        field+=ch;
      }
    }
    if(quoted) throw new Error("Incomplete response-sheet CSV.");
    if(field || row.length || closed){row.push(field);rows.push(row);}
    return rows.filter(row=>row.some(value=>value.trim()));
  }
  async function responseId(config, timestamp, email){
    const bytes = new TextEncoder().encode([config.sheetId, config.gid, timestamp, email.toLowerCase()].join("|"));
    const digest = await crypto.subtle.digest("SHA-256",bytes);
    return "gf_"+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
  }
  async function readResponses(csv,config){
    if(csv.length>2_000_000) throw new Error("The response sheet is too large to import.");
    const rows=parseCSV(csv);
    const headers=(rows.shift() || []).map(value=>value.trim());
    const required=["Timestamp","Email Address","Team","Part Name","Quantity","Vendor","Link","Price"];
    if(required.some(name=>headers.filter(header=>header===name).length!==1)){
      throw new Error("The response sheet is unavailable or its column names have changed.");
    }
    const optionalColumns={shipping:["Shipping","Shipping Cost"],tax:["Tax","Sales Tax"],discount:["Discount"]};
    const costColumns={};
    for(const [key,names] of Object.entries(optionalColumns)){
      const matches=headers.filter(header=>names.some(name=>name.toLowerCase()===header.toLowerCase()));
      if(matches.length>1) throw new Error("Ambiguous "+key+" columns in the response sheet");
      if(matches.length) costColumns[key]=matches[0];
    }
    const responses=[];
    for(let index=0;index<rows.length;index++){
      const row=rows[index];
      const value=name=>String(row[headers.indexOf(name)] || "").trim();
      // This treasury belongs to Madness; never import Mayhem or Shared costs.
      if(value("Team")!=="Madness") continue;
      const timestamp=value("Timestamp"), email=value("Email Address");
      if(!timestamp || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        responses.push({row:index+2,error:"Missing timestamp or requester email"}); continue;
      }
      const id=await responseId(config,timestamp,email);
      responses.push({id,row:index+2,values:{timestamp,email,partName:value("Part Name"),qty:value("Quantity"),vendor:value("Vendor"),vendorSku:value("Vendor SKU"),link:value("Link"),price:value("Price"),notes:value("Justification"),status:value("Status"),...Object.fromEntries(Object.entries(costColumns).map(([key,column])=>[key,value(column)]))}});
    }
    // The sheet exposes timestamps at second precision. Ambiguous identities need
    // review instead of silently dropping or duplicating a purchase request.
    const counts=new Map();
    for(const response of responses) if(response.id) counts.set(response.id,(counts.get(response.id)||0)+1);
    for(const response of responses) if(counts.get(response.id)>1) response.error="Two responses share the same timestamp and requester";
    return responses;
  }
  function sourceStatus(value){
    const text=String(value||"").trim().toLowerCase();
    if(["received","delivered","finished"].includes(text)) return "received";
    if(["ordered","purchased"].includes(text)) return "ordered";
    if(text==="approved") return "approved";
    if(["denied","rejected","cancelled","canceled"].includes(text)) return "denied";
    if(text==="pending" || text.startsWith("on hold")) return "pending";
    return null;
  }
  function toOrder(response,now,existing={},policy){
    const value=response.values;
    if(response.error) throw new Error(response.error);
    const unitCost=budget.parseMoney(value.price);
    const qty=/^\d+$/.test(value.qty) ? Number(value.qty) : NaN;
    if(unitCost===null || unitCost<=0) throw new Error("Price must be a positive dollar amount with up to 2 decimal places");
    const extras={},sourceCostFields=[];
    for(const key of ["shipping","tax","discount"]){
      if(Object.hasOwn(value,key) && !(key==="tax" && value[key]==="" && policy?.enabled)){
        sourceCostFields.push(key);
        extras[key]=value[key]==="" ? 0 : budget.parseMoney(value[key]);
        if(extras[key]===null) throw new Error("Invalid "+key+" amount");
      }else extras[key]=existing[key] || 0;
    }
    let costs;
    if(policy?.enabled){
      const legacyConfirmed=!existing.taxMode && (existing.costsReviewed || existing.tax>0);
      const taxMode=sourceCostFields.includes("tax") ? "sheet" : existing.taxMode==="manual" || legacyConfirmed ? "manual" : "estimate";
      costs=budget.priceOrder({unitCost,qty,...extras,taxMode,taxTreatment:existing.taxTreatment||"taxable"},policy);
    }else costs=budget.calculateOrderCost({unitCost,qty,...extras});
    if(!value.partName || !value.vendor) throw new Error("Part name and vendor are required");
    // A missing product link must not hide a real purchase or its expense.
    let link="";
    try{
      const candidate=new URL(value.link);
      if(["https:","http:"].includes(candidate.protocol)) link=candidate.href;
    }catch{}
    if(Object.values(value).some(text=>text.length>5000)) throw new Error("A response field is too long");
    return {...existing,partName:value.partName,vendor:value.vendor,vendorSku:value.vendorSku,link,linkNeedsReview:!link,
      unitCost,qty,...extras,...costs,category:existing.category||"Parts",team:"Madness",
      requestedBy:value.email,requestedById:existing.requestedById||"",neededBy:existing.neededBy||"",notes:value.notes,
      status:existing.status||"pending",expensed:existing.expensed||false,createdAt:existing.createdAt||now,submittedAt:value.timestamp,
      source:"google-form",sourceResponseId:response.id,sourceStatus:value.status||"",sourceCostFields,
      costsReviewed:existing.costsReviewed || (sourceCostFields.includes("shipping") && sourceCostFields.includes("tax"))};
  }
  function applyResponses(data,responses,now){
    const config=data.integrations?.googleForm;
    if(!config?.enabled) return {imported:0,updated:0,expenses:0,errors:[]};
    config.seen = config.seen || {};
    data.orders = data.orders || {};
    let imported=0,updated=0,expenses=0;const errors=[];
    for(const response of responses){
      const existing=response.id ? data.orders[response.id] : null;
      const backfill=(config.backfillIds || []).includes(response.id);
      if(response.id && config.seen[response.id] && !existing && !backfill) continue;
      try{
        const order=toOrder(response,now,existing||{},config.taxPolicy);
        const linkedExpense=Object.values(data.transactions || {}).some(item=>item.poId===response.id && item.type==="expense");
        if(config.syncStatuses && (!existing || !existing.sourceStatusSyncEnabled || existing.sourceStatus!==order.sourceStatus)){
          const status=sourceStatus(order.sourceStatus);
          if(status && status!==order.status){
            if((order.expensed || linkedExpense) && status!=="received"){
              order.sourceStatusConflict=true;
            }else{
              order.status=status;order.statusBy="Google Form sync";order.statusAt=now;
              order.sourceStatusConflict=false;
            }
          }else if(status===order.status){order.sourceStatusConflict=false;}
        }
        order.sourceStatusSyncEnabled=!!config.syncStatuses;
        if(order.sourceStatusConflict) errors.push("Row "+response.row+": spreadsheet status conflicts with a recorded expense; review it in the treasury.");
        // Stage the expense so validation failure never commits half an order.
        const staged={transactions:data.transactions || {}};
        let expenseChanged=false;
        if(order.status==="received" || order.expensed || linkedExpense){
          expenseChanged=budget.recordOrderExpense(staged,response.id,order,{name:"Google Form sync",id:"google-form"},now);
          order.expensed=true;
        }
        if(!existing) imported++;
        else if(JSON.stringify(existing)!==JSON.stringify(order)) updated++;
        data.orders[response.id]=order;
        if(expenseChanged){data.transactions=staged.transactions;expenses++;}
        config.seen[response.id]=true;
        if(backfill) config.backfillIds=config.backfillIds.filter(id=>id!==response.id);
      }catch(error){errors.push("Row "+response.row+": "+error.message+".");}
    }
    if(imported) config.lastImportedAt=now;
    if(imported || updated || expenses) config.lastReconciledAt=now;
    return {imported,updated,expenses,errors};
  }
  const api={parseCSV,responseId,readResponses,sourceStatus,toOrder,applyResponses};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.TreasuryFormSync=api;
})(typeof window!=="undefined" ? window : globalThis);
