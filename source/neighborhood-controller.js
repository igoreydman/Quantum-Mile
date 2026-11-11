/* Binary green patterns. Queue terms and neighboring-flow terms form a QUBO.
   This is a queue-based surrogate, not an exact traffic forecast. One QAOA layer
   is simulated locally; exhaustive classical search remains the small-case reference. */
(function(scope){
 const M=scope.TwoWayTraffic,Q=scope.QueueSignalController,H=30,DECISION=12;
 const clone=x=>JSON.parse(JSON.stringify(x));
 const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
 const traffic=w=>w.kind==='routed'?scope.RoutedTraffic:M;
 function phase(index,i){return (index>>i&1)?0:1;}
 function problem(w){
  if(w.kind==='routed')return routedProblem(w);
  const n=w.signals.length,linear=Array(n).fill(0),pairs=[],queues=Q.queues(w),locks=Array(n).fill(null);let constant=0;
  const demand=queues.map(q=>q.slice());
  w.routes.forEach((r,l)=>w.lanes[l].cars.forEach(c=>{if(c.stopped)return;const gate=r.gates.find(g=>c.x<=g.stopAt);if(gate){const eta=(gate.stopAt-c.x)/M.SPEED;if(eta<H)demand[gate.signal][r.group]+=1-eta/H;}}));
  w.signals.forEach((s,i)=>{
   const age=w.time-s.greenSince;
   if(s.pending!==null)locks[i]=s.pending===0?1:0;
   else if(s.phaseChanges>0&&age<8-1e-7)locks[i]=s.phase===0?1:0;
   else if(age>=20&&queues[i][1-s.phase]>0)locks[i]=s.phase===0?0:1;
   const cost0=demand[i][0]*H+demand[i][1]*(s.phase===1?0:M.CLEARANCE);
   const cost1=demand[i][1]*H+demand[i][0]*(s.phase===0?0:M.CLEARANCE);
   constant+=cost0;linear[i]+=cost1-cost0;
  });
  w.routes.forEach((r,l)=>{
   for(let k=0;k<r.gates.length-1;k++){
    const a=r.gates[k],b=r.gates[k+1],travel=(b.stopAt-a.exitAt)/M.SPEED;
    const released=Math.min(demand[a.signal][r.group],H*M.SPEED/M.GAP);
    const occupied=w.lanes[l].cars.filter(c=>c.x>a.exitAt&&c.x<=b.stopAt).length;
    const room=Math.max(0,Math.floor((b.stopAt-a.exitAt)/M.GAP)-occupied);
    const weight=released*Math.max(0,H-travel)/2+Math.max(0,released-room)*H/2;
    if(weight<1e-9)continue;
    const values=[0,0,0,0],open=r.group===0?1:0;values[open+2*(1-open)]=weight;
    const [c00,c10,c01,c11]=values;constant+=c00;linear[a.signal]+=c10-c00;linear[b.signal]+=c01-c00;
    pairs.push({i:a.signal,j:b.signal,weight:c11-c10-c01+c00,route:r.name});
   }
  });
  return {n,constant,linear,pairs,locks,demand,queues,horizon:H};
 }
 function routedProblem(w){
  const info=scope.RoutedTraffic.demand(w,H),n=w.signals.length,linear=Array(n).fill(0),pairs=[],locks=Array(n).fill(null);let constant=0;
  w.signals.forEach((s,i)=>{
   const age=w.time-s.greenSince,q=info.queues[i],d=info.counts[i];
   if(s.pending!==null)locks[i]=s.pending===0?1:0;
   else if(s.phaseChanges>0&&age<8-1e-7)locks[i]=s.phase===0?1:0;
   else if(age>=20&&q[1-s.phase]>0)locks[i]=s.phase===0?0:1;
   const c0=d[0]*H+d[1]*(s.phase===1?0:M.CLEARANCE),c1=d[1]*H+d[0]*(s.phase===0?0:M.CLEARANCE);
   constant+=c0;linear[i]+=c1-c0;
  });
  for(const flow of info.flows){
   const weight=flow.count*Math.max(0,H-flow.travel)/2+Math.max(0,flow.count-flow.freeSlots)*H/2;if(weight<1e-9)continue;
   const table=[0,0,0,0],open=flow.group===0?1:0,closed=flow.nextGroup===0?0:1;table[open+2*closed]=weight;
   const [a,b,c,d]=table;constant+=a;linear[flow.i]+=b-a;linear[flow.j]+=c-a;
   pairs.push({i:flow.i,j:flow.j,weight:d-b-c+a,outgoing:flow.outgoing,turnAware:true});
  }
  return {n,constant,linear,pairs,locks,demand:info.counts,queues:info.queues,horizon:H,objectiveModel:'Destination-aware queue and receiving-space surrogate'};
 }
 function cost(p,index){return p.constant+p.linear.reduce((sum,a,i)=>sum+a*(index>>i&1),0)+p.pairs.reduce((sum,e)=>sum+e.weight*(index>>e.i&1)*(index>>e.j&1),0);}
 function allowed(p,index){return p.locks.every((value,i)=>value===null||(index>>i&1)===value);}
 function state(p,gamma,beta,{phaseCost=true,mix=true}={}){
  const size=2**p.n,eligible=Array.from({length:size},(_,i)=>i).filter(i=>allowed(p,i));
  const costs=eligible.map(i=>cost(p,i)),min=Math.min(...costs),range=Math.max(...costs)-min||1;
  const amplitudes=Array.from({length:size},()=>[0,0]),a=1/Math.sqrt(eligible.length);
  eligible.forEach(i=>{const angle=phaseCost?-gamma*(cost(p,i)-min)/range:0;amplitudes[i]=[a*Math.cos(angle),a*Math.sin(angle)];});
  if(mix){const c=Math.cos(beta),s=Math.sin(beta);for(let q=0;q<p.n;q++)if(p.locks[q]===null)for(let i=0;i<size;i++)if(!(i>>q&1)){
   const j=i|1<<q,[ar,ai]=amplitudes[i],[br,bi]=amplitudes[j];amplitudes[i]=[c*ar+s*bi,c*ai-s*br];amplitudes[j]=[c*br+s*ai,c*bi-s*ar];
  }}
  return {amplitudes,probabilities:amplitudes.map(([a,b])=>a*a+b*b),min,range};
 }
 function lessonProblem(w){
  if(w.signals.length!==2)throw new Error('The street lesson requires two signals.');
  const forecasts=Array.from({length:4},(_,index)=>{const copy=clone(w);for(let tick=0;tick<H/M.DT;tick++){drive(copy,index);M.step(copy);}return {delay:copy.delay-w.delay,vehicles:copy.requested-w.completed};});
  const [a,b,c,d]=forecasts.map(f=>f.delay);
  return {n:2,constant:a,linear:[b-a,c-a],pairs:[{i:0,j:1,weight:d-b-c+a,route:'Exact four-plan street forecast'}],locks:[null,null],forecasts,horizon:H};
 }
 function evaluate(w,{lesson=false,tune=true}={}){
  const p=lesson?lessonProblem(w):problem(w),costs=Array.from({length:2**p.n},(_,i)=>cost(p,i));
  const eligible=costs.map((_,i)=>i).filter(i=>allowed(p,i)),best=eligible.reduce((a,b)=>costs[a]<=costs[b]?a:b);
  if(!tune)return {problem:p,costs,best,eligible,quantum:null,expected:costs[best]};
  let result={gamma:0,beta:0,...state(p,0,0)},expected=eligible.reduce((s,i)=>s+costs[i],0)/eligible.length;
  for(let g=1;g<=16;g++)for(let b=-16;b<=16;b++){
   const candidate=state(p,g*.4,b*Math.PI/32),value=candidate.probabilities.reduce((s,a,i)=>s+a*costs[i],0);
   if(value<expected-1e-9){expected=value;result={gamma:g*.4,beta:b*Math.PI/32,...candidate};}
  }
  return {problem:p,costs,best,eligible,quantum:result,expected};
 }
 function drive(w,index){return w.signals.map((s,i)=>{const desired=phase(index,i),before=clone(s);let status;
  if(desired!==s.phase&&(s.phaseChanges??0)>0&&w.time-s.greenSince<8-1e-7)status='minimum-green';
  else{const changed=traffic(w).command(w,i,desired);status=changed?'changing':s.pending!==null?'changing':'already-green';}
  return {site:i,desired,status,before,after:clone(s)};
 });}
 function metric(w,snapshot,tracker,stops,arrivals){if(w.kind==='routed')return scope.RoutedTraffic.metric(w,snapshot,tracker,stops,arrivals);const count=w.requested-snapshot.completed;return {meanDelay:count?(w.delay-snapshot.delay)/count:0,maxDelay:tracker.summary().maxDelay,finished:w.completed-snapshot.completed,waiting:w.lanes.reduce((n,l)=>n+l.backlog.length+l.cars.filter(c=>c.stopped).length,0),vehicles:count};}
 function experiment(topology,{seconds,seed,routing,scenario},routes){
  if(!['open','blocked-mile'].includes(scenario))throw new Error('Unknown network scenario.');
  const timeline=[];
  if(scenario==='blocked-mile'){
   const link=topology.links.find(l=>l.start===0&&l.end===1&&l.name==='Miracle Mile eastbound');
   if(!link)throw new Error('Roadblock scenario requires the Salzedo–Ponce eastbound link.');
   timeline.push({tick:100,type:'block',id:'mile-work',link:link.id,at:link.length*.45},{tick:360,type:'reopen',id:'mile-work',link:link.id});
  }
  return freeze({schema:1,scenario,seconds,seed,routing,periods:routes.map(r=>r.period),sourceSha256:topology.sourceSha256,timeline});
 }
 function applyEvents(t){
  if(!t.experiment)return;
  while(t.eventCursor<t.experiment.timeline.length&&t.experiment.timeline[t.eventCursor].tick<=t.ticks){const event=t.experiment.timeline[t.eventCursor++];
   for(const w of Object.values(t.worlds)){w.blocks=w.blocks.filter(b=>b.id!==event.id);if(event.type==='block')w.blocks.push({id:event.id,link:event.link,at:event.at});}
   t.events.push(freeze({...event,atSeconds:t.ticks*M.DT}));
  }
 }
 function decisionInput(w){const {topology,completedTrips,movementLog,...input}=w;return clone(input);}
 function archive(t,name,commands){
  if(!t.experiment)return;const plan=t.plans[name],history=t.decisions[name];if(history.at(-1)?.tick===plan.tick)return;
  history.push(freeze({id:`${name}-${plan.tick}`,controller:name,at:plan.at,tick:plan.tick,input:plan.input,evaluation:clone(plan.evaluation),index:plan.index,draw:plan.draw,commands:clone(commands),counters:{delay:plan.input.delay,completed:plan.input.completed}}));
  delete plan.input;
 }
 function decisionWindow(t,name,index){
  const history=t.decisions[name],d=history[index];if(!d)return null;const next=history[index+1],end=next?.at??t.ticks*M.DT,counters=next?.counters??t.worlds[name];
  return {from:d.at,to:end,closed:!!next||t.done,finished:counters.completed-d.counters.completed,addedDelay:counters.delay-d.counters.delay};
 }
 function create(routes,{seconds=30,seed=20261105,opening=null,lesson=false,topology=null,routing='mixed',scenario='open',profile=false,observeStops=true,observeArrivals=true,initialWorld=null}={}){
  const snapshot=topology?scope.RoutedTraffic.create(topology,{periods:routes.map(r=>r.period),seed,routing}):initialWorld?clone(initialWorld):M.create(clone(routes)),names=lesson?['your','fixed','quantum']:['fixed','exact','quantum'];
  const started=profile?performance.now():0,initial=evaluate(snapshot,{lesson}),sharedInitialEvaluationMs=profile?performance.now()-started:0;
  return {snapshot,worlds:Object.fromEntries(names.map(n=>[n,clone(snapshot)])),meters:Object.fromEntries(names.map(n=>[n,M.createDelayTracker()])),stopMeters:Object.fromEntries(names.map(n=>[n,topology&&observeStops?scope.RoutedTraffic.createStopTracker(snapshot):null])),arrivalMeters:Object.fromEntries(names.map(n=>[n,topology&&observeArrivals?scope.RoutedTraffic.createSignalArrivalTracker(snapshot):null])),names,seconds,ticks:0,done:false,running:false,opening,lesson,plans:{},replans:0,rng:scope.TrafficScenarios.random(seed),samples:[],initial,experiment:topology?experiment(topology,{seconds,seed,routing,scenario},routes):null,eventCursor:0,events:[],decisions:{quantum:[],exact:[]},performance:profile?{sharedInitialEvaluationMs,controllers:Object.fromEntries(names.map(n=>[n,{stepMs:0,decisionMs:0,trafficAndMetricsMs:0,decisions:0}]))}:null};
 }
 function selectPlan(t,name='quantum'){
  if(!t.names.includes(name)||!['exact','quantum'].includes(name))throw new Error('Unknown sampled/search controller.');
  if(t.plans[name]?.tick===t.ticks)return t.plans[name];
  const started=t.performance?performance.now():0;
  const w=t.worlds[name],e=t.ticks===0?t.initial:evaluate(w,{tune:name==='quantum'}),draw=name==='quantum'?t.rng():null,index=name==='exact'?e.best:scope.LocalSignalPlanner.sample(e.quantum.probabilities,draw);
  t.plans[name]={evaluation:e,index,draw,at:t.ticks*M.DT,tick:t.ticks,...(t.experiment?{input:decisionInput(w)}:{})};if(name==='quantum')t.replans++;if(t.performance){const p=t.performance.controllers[name];p.decisionMs+=performance.now()-started;p.decisions++;}return t.plans[name];
 }
 function step(t){
  if(!t.running||t.done)return false;
  applyEvents(t);
  for(const name of t.names){const w=t.worlds[name],started=t.performance?performance.now():0;
   if(name==='your')drive(w,t.opening);
   else if(name==='fixed')drive(w,Math.floor(t.ticks*M.DT/15)%2===0?2**w.signals.length-1:0);
   else{
    const refresh=!t.plans[name]||(!t.lesson&&t.ticks%Math.round(DECISION/M.DT)===0);
    if(refresh)selectPlan(t,name);
    const commands=drive(w,t.plans[name].index);archive(t,name,commands);
   }
   const physicsStart=t.performance?performance.now():0;traffic(w).step(w,t.meters[name].observe);t.stopMeters[name]?.observe(w);t.arrivalMeters[name]?.observe(w);
   if(t.performance){const p=t.performance.controllers[name];p.trafficAndMetricsMs+=performance.now()-physicsStart;p.stepMs+=performance.now()-started;}
  }
  t.ticks++;applyEvents(t);if(t.ticks%50===0)t.samples.push({seconds:t.ticks*M.DT,results:results(t)});
  if(t.ticks>=Math.round(t.seconds/M.DT)){t.done=true;t.running=false;}return true;
 }
 function results(t){return Object.fromEntries(t.names.map(n=>[n,metric(t.worlds[n],t.snapshot,t.meters[n],t.stopMeters[n],t.arrivalMeters[n])]))}
 scope.NeighborhoodControl={problem,cost,allowed,state,evaluate,phase,drive,create,selectPlan,step,results,decisionWindow,H,DECISION};
})(globalThis);
