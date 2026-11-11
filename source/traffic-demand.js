/* FDOT 872534 nearby directional proxy, July 22–24, 2025.
   Each hour is averaged across the three observed days, never across clock hours.
   Exact headways and all cross-street demand remain modeled. */
(function(scope){
 const source='https://tdaappsprod.dot.state.fl.us/fto/reports/Concatenated_SynopsisReports_2025/872534.pdf';
 const hours=[{"hour":0,"east":146.0,"west":131.0,"samples":3},{"hour":1,"east":71.0,"west":88.33333333333333,"samples":3},{"hour":2,"east":58.333333333333336,"west":56.666666666666664,"samples":3},{"hour":3,"east":44.666666666666664,"west":56.0,"samples":3},{"hour":4,"east":67.33333333333333,"west":85.66666666666667,"samples":3},{"hour":5,"east":166.33333333333334,"west":154.66666666666666,"samples":3},{"hour":6,"east":448.0,"west":483.0,"samples":3},{"hour":7,"east":861.3333333333334,"west":948.6666666666666,"samples":3},{"hour":8,"east":1029.0,"west":1437.6666666666667,"samples":3},{"hour":9,"east":994.3333333333334,"west":1180.0,"samples":3},{"hour":10,"east":952.3333333333334,"west":932.6666666666666,"samples":3},{"hour":11,"east":950.6666666666666,"west":980.0,"samples":3},{"hour":12,"east":982.6666666666666,"west":1060.3333333333333,"samples":3},{"hour":13,"east":1062.3333333333333,"west":1110.0,"samples":3},{"hour":14,"east":1107.0,"west":1208.3333333333333,"samples":3},{"hour":15,"east":1105.0,"west":1217.0,"samples":3},{"hour":16,"east":1129.6666666666667,"west":1351.0,"samples":3},{"hour":17,"east":1261.0,"west":1318.3333333333333,"samples":3},{"hour":18,"east":1074.6666666666667,"west":1224.6666666666667,"samples":3},{"hour":19,"east":932.6666666666666,"west":908.0,"samples":3},{"hour":20,"east":845.3333333333334,"west":703.3333333333334,"samples":3},{"hour":21,"east":654.0,"west":540.3333333333334,"samples":3},{"hour":22,"east":488.0,"west":407.3333333333333,"samples":3},{"hour":23,"east":264.6666666666667,"west":275.0,"samples":3}];
 const clock=h=>`${h%12||12}:00 ${h<12?'AM':'PM'}`;
 function get(id){
  const hour=id==='regular'?10:id==='rush'?17:/^hour-(\d+)$/.test(id)?Number(id.slice(5)):-1;
  if(!Number.isInteger(hour)||hour<0||hour>23)throw new Error('Unknown traffic condition.');
  return {...hours[hour],id,name:id==='regular'?'Regular':id==='rush'?'Rush hour':clock(hour),window:clock(hour)+'–'+clock((hour+1)%24),source};
 }
 function apply(routes,id){
  const p=get(id),offsets=[.17,.71,.39,.83,.53,.97];
  return routes.map((route,i)=>{
   const direction=route.name==='Miracle Mile eastbound'?'east':route.name==='Miracle Mile westbound'?'west':null;
   const period=direction?3600/p[direction]:route.period;
   return {...JSON.parse(JSON.stringify(route)),period,arrivalOffset:period*offsets[i%offsets.length],arrivalPattern:'varied',arrivalSeed:20261105+i,demandBasis:direction?'FDOT 872534 nearby corridor proxy':'assumed cross-street demand',trafficCondition:id};
  });
 }
 scope.TrafficDemand={get,apply,source,hours:hours.map(h=>({...h}))};
})(globalThis);
