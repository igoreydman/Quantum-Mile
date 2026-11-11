/* Synthetic, repeatable demand; no observed municipal arrival data. */
(function(scope){
  const M=scope.TwoWayTraffic,P=scope.LocalSignalPlanner;
  const definitions=[
    {id:'original',name:'Everyday flow',periods:[4,8],warmup:0,seed:20261105},
    {id:'mile-busy',name:'Miracle Mile rush',periods:[2,12],warmup:30,seed:20261106},
    {id:'cross-busy',name:'Cross-street rush',periods:[12,3],warmup:30,seed:20261107}
  ];
  function get(id){const d=definitions.find(s=>s.id===id);if(!d)throw new Error('Unknown traffic scenario.');return d;}
  function create(routes,id){
    const d=get(id),w=M.create(routes.map(r=>({...r,period:d.periods[r.group]})));
    for(let tick=0;tick<Math.round(d.warmup/M.DT);tick++){P.drive(w,P.FIXED_PLAN,Math.floor((w.time+1e-7)/P.HORIZON)*P.HORIZON);M.step(w);}
    return w;
  }
  function random(seed){let x=(seed>>>0)||1;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
  function draw(seed){return random(seed)();}
  scope.TrafficScenarios={definitions,get,create,draw,random};
})(globalThis);
