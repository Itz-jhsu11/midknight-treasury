/* Shared integer-cent calculations for the budget view and automated checks. */
(function(root){
  "use strict";
  const categories = ["Parts","Tools","Event registration","Travel","Materials","Outreach","Other"];
  function parseMoney(value){
    const text = String(value).trim().replace(/^\$\s*/, "");
    if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction=""] = text.replace(/,/g, "").split(".");
    const cents = Number(whole)*100 + Number(fraction.padEnd(2,"0"));
    return Number.isSafeInteger(cents) ? cents : null;
  }
  function calculateOrderCost({unitCost,qty,shipping=0,tax=0,discount=0}){
    if(!Number.isSafeInteger(qty) || qty<=0) throw new Error("Quantity must be a positive whole number");
    for(const [label,amount] of Object.entries({unitCost,shipping,tax,discount})){
      if(!Number.isSafeInteger(amount) || amount<0) throw new Error("Invalid "+label+" amount");
    }
    const subtotal=unitCost*qty, beforeDiscount=subtotal+shipping+tax;
    if(!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(beforeDiscount)) throw new Error("Order total is too large");
    if(discount>beforeDiscount) throw new Error("Discount cannot exceed the order cost");
    return {subtotal,totalCost:beforeDiscount-discount};
  }
  function recordOrderExpense(data,id,order,actor,now){
    const transactions=data.transactions || {};
    const matches=Object.entries(transactions).filter(([,item])=>item.poId===id && item.type==="expense");
    if(matches.length>1) throw new Error("Multiple expenses are linked to this order; ask a treasurer to review them");
    const [key,existing]=matches[0] || ["po_"+id,null];
    if(!existing && transactions[key]) throw new Error("The expense ID is already in use");
    const fields={type:"expense",amount:order.totalCost,category:order.category||"Parts",description:"PO: "+order.partName+" ×"+order.qty,poId:id};
    if(existing && Object.entries(fields).every(([key,value])=>existing[key]===value)) return false;
    const dateParts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now));
    const part=type=>dateParts.find(item=>item.type===type).value;
    const date=actor.date || part("year")+"-"+part("month")+"-"+part("day");
    data.transactions={...transactions,[key]:existing
      ? {...existing,...fields,updatedAt:now,updatedBy:actor.name}
      : {...fields,date,enteredBy:actor.name,enteredById:actor.id,createdAt:now}};
    return true;
  }
  function summarize(budgets, transactions, orders){
    const rows = categories.map(category=>({category, planned:null, spent:0, committed:0, pending:0}));
    const rowFor = category => rows.find(row=>row.category===category) || rows[rows.length-1];
    for(const budget of budgets){
      if(categories.includes(budget.category) && Number.isSafeInteger(budget.amount) && budget.amount>=0){
        rowFor(budget.category).planned = budget.amount;
      }
    }
    const paidOrders = new Set();
    for(const transaction of transactions){
      if(transaction.type!=="expense") continue;
      rowFor(transaction.category).spent += transaction.amount || 0;
      if(transaction.poId) paidOrders.add(transaction.poId);
    }
    for(const order of orders){
      if(order.expensed || paidOrders.has(order.id)) continue;
      const row = rowFor(order.category || "Parts");
      if(order.status==="approved" || order.status==="ordered") row.committed += order.totalCost || 0;
      if(order.status==="pending") row.pending += order.totalCost || 0;
    }
    for(const row of rows){
      row.remaining = row.planned===null ? null : row.planned-row.spent-row.committed;
    }
    const sum = key => rows.reduce((total,row)=>total+(row[key] || 0),0);
    const planned = sum("planned"), spent=sum("spent"), committed=sum("committed");
    return {rows, planned, spent, committed, pending:sum("pending"), remaining:planned-spent-committed,
      configured:rows.some(row=>row.planned!==null)};
  }
  const api = {categories, parseMoney, calculateOrderCost, recordOrderExpense, summarize};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.TreasuryBudget=api;
})(typeof window!=="undefined" ? window : globalThis);
