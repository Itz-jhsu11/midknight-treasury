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
      responses.push({id,row:index+2,values:{timestamp,email,partName:value("Part Name"),qty:value("Quantity"),vendor:value("Vendor"),vendorSku:value("Vendor SKU"),link:value("Link"),price:value("Price"),notes:value("Justification")}});
    }
    // The sheet exposes timestamps at second precision. Ambiguous identities need
    // review instead of silently dropping or duplicating a purchase request.
    const counts=new Map();
    for(const response of responses) if(response.id) counts.set(response.id,(counts.get(response.id)||0)+1);
    for(const response of responses) if(counts.get(response.id)>1) response.error="Two responses share the same timestamp and requester";
    return responses;
  }
  function toOrder(response,now){
    const value=response.values;
    if(response.error) throw new Error(response.error);
    const unitCost=budget.parseMoney(value.price);
    const qty=/^\d+$/.test(value.qty) ? Number(value.qty) : NaN;
    if(unitCost===null || unitCost<=0) throw new Error("Price must be a positive dollar amount with up to 2 decimal places");
    if(!Number.isSafeInteger(qty) || qty<=0) throw new Error("Quantity must be a positive whole number");
    if(!Number.isSafeInteger(unitCost*qty)) throw new Error("Order total is too large");
    if(!value.partName || !value.vendor) throw new Error("Part name and vendor are required");
    let link;
    try{link=new URL(value.link);}catch{throw new Error("A full purchase link is required");}
    if(!["https:","http:"].includes(link.protocol)) throw new Error("Purchase link must use https or http");
    if(Object.values(value).some(text=>text.length>5000)) throw new Error("A response field is too long");
    return {partName:value.partName,vendor:value.vendor,vendorSku:value.vendorSku,link:link.href,
      unitCost,qty,shipping:0,totalCost:unitCost*qty,category:"Parts",team:"Madness",
      requestedBy:value.email,requestedById:"",neededBy:"",notes:value.notes,
      status:"pending",expensed:false,createdAt:now,submittedAt:value.timestamp,
      source:"google-form",sourceResponseId:response.id};
  }
  function applyResponses(data,responses,now){
    const config=data.integrations?.googleForm;
    if(!config?.enabled) return {imported:0,errors:[]};
    config.seen = config.seen || {};
    data.orders = data.orders || {};
    let imported=0;const errors=[];
    for(const response of responses){
      if(response.id && (config.seen[response.id] || data.orders[response.id])) continue;
      try{
        const order=toOrder(response,now);
        data.orders[response.id]=order;
        config.seen[response.id]=true;
        imported++;
      }catch(error){ errors.push("Row "+response.row+": "+error.message+"."); }
    }
    if(imported) config.lastImportedAt=now;
    return {imported,errors};
  }
  const api={parseCSV,responseId,readResponses,toOrder,applyResponses};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.TreasuryFormSync=api;
})(typeof window!=="undefined" ? window : globalThis);
