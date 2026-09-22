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
  const api = {categories, parseMoney, summarize};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.TreasuryBudget=api;
})(typeof window!=="undefined" ? window : globalThis);
