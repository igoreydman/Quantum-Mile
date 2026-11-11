/* Thin orchestration/read adapter for the existing routed neighborhood engine.
   Inspection never evaluates, tunes, draws, drives or advances a controller. */
(function(scope){
 const C=scope.NeighborhoodControl,R=scope.RoutedTraffic;
 const clone=value=>JSON.parse(JSON.stringify(value));
 function create(data,{pattern='balanced',seconds=60,scenario='open'}={}){
  if(!['balanced','mile','andalusia','cross'].includes(pattern))throw new Error('Unknown neighborhood traffic pattern.');
  if(!Number.isFinite(seconds)||seconds<=0)throw new Error('Positive finite experiment length required.');
  if(!data?.network?.routes||!data?.routing)throw new Error('Neighborhood routes and routed topology required.');
  const routes=clone(data.network.routes);
  // Keep these adjustments aligned with the existing traffic-demo networkRoutes.
  routes.forEach(route=>{
   if(pattern==='mile'&&route.name.startsWith('Miracle'))route.period=3;
   if(pattern==='andalusia'&&route.name.startsWith('Andalusia'))route.period=3;
   if(pattern==='cross'&&route.group===1)route.period=4;
  });
  return C.create(routes,{seconds,topology:clone(data.routing),scenario});
 }
 function world(session,method){
  if(!session?.names?.includes(method)||!session.worlds?.[method])throw new Error('Unknown neighborhood controller.');
  const value=session.worlds[method];
  if(value.kind!=='routed')throw new Error('Routed neighborhood session required.');
  return value;
 }
 function decision(session,method='quantum'){
  world(session,method);
  return session.decisions?.[method]?.at(-1)??null;
 }
 function receiving(w,site){
  const links=[...new Set(w.topology.movements.filter(m=>m.signal===site).map(m=>m.outgoing))];
  return links.map(link=>({link,name:w.topology.links[link].name,
   freeSlots:Math.max(0,R.receivingSlots(w,link)),blocked:w.blocks.some(block=>block.link===link)}));
 }
 function approaching(demand,queues){return demand.map((value,i)=>value-queues[i]);}
 function lockReason(record,site){
  const p=record.evaluation.problem,lock=p.locks[site];
  if(lock===null)return 'unlocked';
  const signal=record.input.signals[site],age=record.input.time-signal.greenSince;
  if(signal.pending!==null)return 'clearance';
  if(signal.phaseChanges>0&&age<8-1e-7)return 'minimum-green';
  if(age>=20&&p.queues[site][1-signal.phase]>0)return 'maximum-green';
  return 'engine-constraint';
 }
 function inspect(session,method='quantum',site=0){
  const w=world(session,method),n=w.signals.length;
  if(!Number.isInteger(site)||site<0||site>=n)throw new Error('Unknown neighborhood site.');
  const labels=w.topology.signals[site],info=R.demand(w,C.H),metrics=clone(C.results(session)[method]);
  const current={provenance:'current-world',at:w.time,queues:info.queues[site].slice(),
   demand:info.counts[site].slice(),approaching:approaching(info.counts[site],info.queues[site]),
   receiving:receiving(w,site),signal:clone(w.signals[site]),
   legalGreen:w.signals[site].pending===null?w.signals[site].phase:null,
   metrics:{...metrics,unfinished:metrics.vehicles-metrics.finished}};
  const record=decision(session,method);let archived=null;
  if(record){
   const e=record.evaluation,p=e.problem,input={...record.input,topology:session.snapshot.topology};
   const probabilities=method==='quantum'?e.quantum.probabilities:null;
   archived={provenance:'archived-decision-time',record,id:record.id,at:record.at,tick:record.tick,
    queues:p.queues[site].slice(),demand:p.demand[site].slice(),
    approaching:approaching(p.demand[site],p.queues[site]),receiving:receiving(input,site),
    index:record.index,bits:record.index.toString(2).padStart(p.n,'0'),
    requests:w.topology.signals.map((signal,i)=>{
     const bit=(record.index>>i)&1,lock=p.locks[i];
     return {site:i,name:signal.name,bit,requestedGroup:bit?0:1,
      requestedStreet:bit?signal.road:signal.cross,lock,lockReason:lockReason(record,i),
      requiredStreet:lock===null?null:lock?signal.road:signal.cross};
    }),
    locks:p.locks,costs:e.costs,best:e.best,eligible:e.eligible,
    chosenCost:e.costs[record.index],bestCost:e.costs[e.best],probabilities,
    chosenChance:probabilities?probabilities[record.index]:null,horizon:p.horizon,
    objective:p.objectiveModel??'Queue and receiving-space surrogate',units:'model points'};
  }
  return {method,site,signalCount:n,patternCount:2**n,groupLabels:[labels.road,labels.cross],current,archived,
   provenance:{
    current:'Current selected controller world, after its most recent physics tick.',
    archived:record?'Actual most recent archived decision before its command/physics tick.':
     method==='fixed'?'Fixed cycle follows its preset; no archived search/sample decision.':'No controller decision has been archived yet; initial evaluation is not a draw.',
    demand:'Stopped/source queues plus ETA-weighted moving approaches over the existing 30-second surrogate horizon; not a forecast count of future arrivals.',
    receiving:'Available slots on unique outgoing links at this site, derived by the existing receiving-space function from the labeled world; includes reservations and blockage limits.',
    costs:'Archived classical queue/receiving-space surrogate scores in model points, not observed seconds or an exact delay forecast.',
    metrics:'Current accumulated experiment results; mean added delay is seconds per requested trip, including unfinished trips and source queues.',
    divergence:'Controllers share initial cars and external inputs; their queues and subsequent decision inputs diverge as they run.'}};
 }
 scope.NeighborhoodWorkspace={create,decision,inspect};
})(globalThis);
