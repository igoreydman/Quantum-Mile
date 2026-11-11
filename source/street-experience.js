/* UI orchestration over the existing engines. Moving traffic is a playground;
   every suggestion explicitly targets the unchanged initial 0:00 replay. */
(function(scope){
 const clone=x=>JSON.parse(JSON.stringify(x)),freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
 // Automatic turns use actual green time, not a wall-clock timer. Requests
 // override one turn only; repeated input cannot extend it indefinitely.
 function playground(routes,{opening=3,warmup=5,initialWorld=null}={}){
  const C=scope.NeighborhoodControl,M=scope.TwoWayTraffic,GREEN_SECONDS=15,EPS=1e-7,world=initialWorld?clone(initialWorld):M.create(clone(routes));
  let request=opening??world.signals.reduce((bits,s,i)=>bits|((s.pending??s.phase)===0?1<<i:0),0);const history=[],overrides=world.signals.map(()=>null);
  function setDirection(site,direction){request=direction===0?request|1<<site:request&~(1<<site);}
  function step(){
   world.signals.forEach((s,site)=>{
    if(s.pending!==null)return;
    const manual=overrides[site];
    if(manual){
     if(s.phase!==manual.direction)return;
     if(manual.servedAt===null)manual.servedAt=world.time;
     if(world.time-manual.servedAt+EPS< GREEN_SECONDS)return;
     overrides[site]=null;setDirection(site,1-s.phase);
    }else if(s.phaseChanges>0&&world.time-s.greenSince+EPS>=GREEN_SECONDS){setDirection(site,1-s.phase);}
   });
   C.drive(world,request);M.step(world);
  }
  function requestGreen(site,direction){
   if(!Number.isInteger(site)||!world.signals[site]||![0,1].includes(direction))throw new Error('Unknown crossing or direction.');
   const next=direction===0?request|1<<site:request&~(1<<site);
   if(next===request)return false;
   request=next;const s=world.signals[site];overrides[site]={direction,servedAt:s.phase===direction&&s.pending===null?world.time:null};
   const commands=C.drive(world,request);history.push(freeze({at:world.time,site,index:request,status:commands[site].status}));return true;
  }
  function toggle(site){if(!Number.isInteger(site)||!world.signals[site])throw new Error('Unknown crossing.');return requestGreen(site,1-C.phase(request,site));}
  function status(site){
   const s=world.signals[site];if(!s)throw new Error('Unknown crossing.');
   const manual=overrides[site],desired=C.phase(request,site),age=world.time-s.greenSince;
   if(s.pending!==null)return {mode:manual?'temporary':'automatic',stage:M.signalStage(world,site),seconds:Math.max(0,Math.ceil(s.until-world.time-EPS)),next:s.pending};
   if(desired!==s.phase)return {mode:manual?'temporary':'automatic',stage:'queued',seconds:Math.max(0,Math.ceil(8-age-EPS)),next:desired};
   return {mode:manual?'temporary':'automatic',stage:'green',seconds:Math.max(0,Math.ceil(GREEN_SECONDS-(manual?world.time-(manual.servedAt??world.time):age)-EPS)),next:1-s.phase};
  }
  for(let i=0;i<Math.round(warmup/M.DT);i++)step();
  return {world,step,toggle,requestGreen,status,get request(){return request;},get history(){return history.slice();}};
 }
 function preparedScene(routes,seconds=60){
  if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid preparation duration.');
  const w=playground(routes,{warmup:seconds}).world,elapsed=w.time;
  w.lanes.forEach(l=>{l.next-=elapsed;});w.signals.forEach(s=>{s.until-=elapsed;s.greenSince-=elapsed;Object.values(s.decisions??{}).forEach(d=>{d.reactUntil-=elapsed;d.until-=elapsed;});});
  w.time=0;w.delay=0;w.completed=0;w.passed=w.routes.map(()=>0);w.requested=w.lanes.reduce((n,l)=>n+l.cars.length+l.backlog.length,0);w.preparedSeconds=seconds;
  return w;
 }
 function create(routes,{seed=20261105,initialWorld=null}={}){
  const C=scope.NeighborhoodControl,D=scope.CircuitDecision,modelRoutes=clone(routes),reference=freeze(initialWorld?clone(initialWorld):scope.TwoWayTraffic.create(clone(modelRoutes))),evaluation=freeze(C.evaluate(clone(reference),{lesson:true}));
  const trace=D.trace(evaluation.problem,evaluation.quantum.gamma,evaluation.quantum.beta);
  let decision=scope.LessonDecision.create(evaluation,{seed,initialWorld:reference}),revision=1,current=null,consumed=false;
  function suggest(){if(consumed)throw new Error('Return to the street before suggesting another plan.');current=decision.sample(trace);return current;}
  function cancel(){revision++;current=null;consumed=false;decision=scope.LessonDecision.create(evaluation,{seed,initialWorld:reference});}
  function use(expected=current){
   if(consumed||!current||expected!==current)throw new Error('This proposal is stale or has already been used.');
   const t=decision.apply(modelRoutes);
   // The original lesson reserves a manual world. Reuse its identical initial
   // state/tracker as the exact-search comparator, with the existing lesson
   // objective and one held setting. No controller/dynamics rewrite.
   for(const field of ['worlds','meters','stopMeters','arrivalMeters']){t[field].exact=t[field].your;delete t[field].your;}
   t.names=['fixed','exact','quantum'];C.drive(t.worlds.exact,evaluation.best);C.drive(t.worlds.fixed,2**reference.signals.length-1);
   t.referenceID=`initial-street-${revision}`;t.replayContract='Fresh initial 0:00 street replay; not continuation of playground queues.';
   consumed=true;return t;
  }
  function experiment({costs=true,mixing=100}={}){
   if(!Number.isFinite(mixing)||mixing<0||mixing>100)throw new Error('Mixing must be between 0 and 100.');
   return D.trace(evaluation.problem,costs?evaluation.quantum.gamma:0,evaluation.quantum.beta*mixing/100);
  }
  return {reference,evaluation,suggest,cancel,use,experiment,get pending(){return consumed?null:current;},get used(){return consumed;},get revision(){return revision;}};
 }
 scope.StreetExperience={playground,preparedScene,create};
})(globalThis);
