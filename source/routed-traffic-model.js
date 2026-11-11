/* Destination-based traffic with movement reservations: platoons follow through
   green and disjoint movements can overlap. Crossing/merging paths yield, with
   permissive left turns yielding to conflicting oncoming straight/right traffic.
   Exit storage is reserved before entry. All dimensions remain illustrative. */
(function(scope){
 const DT=.1,SPEED=8,GAP=8,YELLOW=3,CLEARANCE=YELLOW,EPS=1e-7;
 const CONFLICT_GAP=3,matrices=new Map(),topologyMatrices=new WeakMap();
 function segmentDistance(a,b,c,d){
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  if(cross(a,b,c)*cross(a,b,d)<=EPS&&cross(c,d,a)*cross(c,d,b)<=EPS&&
   Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))+EPS&&
   Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]))+EPS)return 0;
  function point(p,x,y){const dx=y[0]-x[0],dy=y[1]-x[1],t=Math.max(0,Math.min(1,((p[0]-x[0])*dx+(p[1]-x[1])*dy)/(dx*dx+dy*dy||1)));return (p[0]-x[0]-t*dx)**2+(p[1]-x[1]-t*dy)**2;}
  return Math.min(point(a,c,d),point(b,c,d),point(c,a,b),point(d,a,b));
 }
 function conflictMatrix(topology){
  if(topologyMatrices.has(topology))return topologyMatrices.get(topology);
  const key=JSON.stringify(topology.movements.map(m=>[m.signal,m.incoming,m.outgoing,m.points]));
  let matrix=matrices.get(key);
  if(!matrix){matrix=topology.movements.map(a=>topology.movements.map(b=>{
   if(a.signal!==b.signal||a.id===b.id)return false;
   if(a.incoming===b.incoming||a.outgoing===b.outgoing)return true;
   for(let i=1;i<a.points.length;i++)for(let j=1;j<b.points.length;j++)if(segmentDistance(a.points[i-1],a.points[i],b.points[j-1],b.points[j])<CONFLICT_GAP**2-EPS)return true;
   return false;
  }));matrices.set(key,matrix);}
  topologyMatrices.set(topology,matrix);return matrix;
 }
 function conflicts(topology,a,b){return conflictMatrix(topology)[a][b];}
 function hash(x){x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return (x^(x>>>16))>>>0;}
 function choosePath(w,source,id){
  const all=w.topology.paths.filter(p=>p.source===source),through=all.find(p=>p.destination===source&&!p.turns.length);
  const options=all.filter(p=>p.turns.length>0&&p.turns.length<=2),u=hash(w.seed^Math.imul(id+1,0x9e3779b1));
  if(w.routing==='through'||u/4294967296<.4||!options.length)return through;
  return options[hash(u^0xa511e9b3)%options.length];
 }
 function request(w,source,position=0){
  const id=w.serial++,path=choosePath(w,source,id),car={id,source,path:path.id,leg:0,position,state:'source',stopped:true,requestedAt:w.time,delay:0,turns:0,visitedLinks:[path.links[0]],completedMovements:[],freeFlowSeconds:path.freeFlowSeconds-position/SPEED};
  w.requested++;return car;
 }
 function create(topology,{periods=null,seed=20261105,routing='mixed',initialQueues=true}={}){
  if(!['mixed','through'].includes(routing))throw new Error('Unknown trip mix.');
  const w={modelVersion:3,kind:'routed',topology,seed,routing,time:0,serial:0,requested:0,completed:0,delay:0,blocks:[],
   signals:topology.signals.map(()=>({phase:1,pending:null,transition:'green',until:0,greenSince:0,phaseChanges:0})),
   links:topology.links.map(()=>({cars:[]})),junctions:topology.signals.map(()=>({cars:[],lastIncoming:-1})),
   sources:topology.sources.map((s,i)=>({link:s.link,period:periods?.[i]??s.period,next:0,backlog:[]})),
   turns:{left:0,right:0,straight:0},completedTrips:[],movementLog:[]};
  if(w.sources.some(s=>!Number.isFinite(s.period)||s.period<=0))throw new Error('Positive finite arrival periods required.');
  if(initialQueues)topology.sources.forEach(s=>{const link=topology.links[s.link],offsets=link.group===0?[3,11,19]:[3];for(const offset of offsets){const x=link.length-offset;if(x<0)continue;const car=request(w,s.id,x);car.state='road';w.links[s.link].cars.push(car);}});
  return w;
 }
 function active(w,{backlogs=true}={}){return [...w.links.flatMap(l=>l.cars),...w.junctions.flatMap(j=>j.cars),...(backlogs?w.sources.flatMap(s=>s.backlog):[])];}
 function command(w,i,phase){const s=w.signals[i];if(!s||s.pending!==null||s.phase===phase||![0,1].includes(phase))return false;s.pending=phase;s.transition='yellow';s.until=w.time+YELLOW;return true;}
 function canGo(w,signal,group){const s=w.signals[signal];return s.pending===null&&s.phase===group;}
 function charge(w,c,seconds,observe){const lost=Math.max(0,Math.min(DT,seconds));w.delay+=lost;c.delay+=lost;if(observe)observe(c.id,lost);}
 function path(w,c){return w.topology.paths[c.path];}
 function movement(w,c){return w.topology.movements[path(w,c).movements[c.leg]];}
 function entrySpace(w,linkId){const cars=w.links[linkId].cars;return !cars.length||cars.at(-1).position>=GAP-EPS;}
 function blockedAt(w,linkId,position){let at=Infinity;for(const b of w.blocks)if(b.link===linkId&&position<=b.at+EPS)at=Math.min(at,b.at);return at;}
 function reserved(w,linkId){return w.junctions.reduce((n,j)=>n+j.cars.filter(c=>movement(w,c).outgoing===linkId).length,0);}
 function receivingSlots(w,linkId){
  const end=Math.min(w.topology.links[linkId].length,blockedAt(w,linkId,0));
  return Math.max(0,Math.floor((end+EPS)/GAP))-w.links[linkId].cars.filter(c=>c.position<=end+EPS).length-reserved(w,linkId);
 }
 function leftYields(w,m){
  if(m.turn!=='left')return false;
  return w.topology.links.some((link,i)=>{
   if(i===m.incoming||link.end!==m.signal||link.group!==m.group||!canGo(w,m.signal,link.group))return false;
   const c=w.links[i].cars[0];if(!c||blockedAt(w,i,c.position)<link.length-EPS)return false;
   const other=movement(w,c);
   return other.turn!=='left'&&conflicts(w.topology,m.id,other.id)&&receivingSlots(w,other.outgoing)>0&&(link.length-c.position)/SPEED<m.length/m.speed+GAP/SPEED;
  });
 }
 function finish(w,c,withinTick){w.completed++;c.state='finished';w.completedTrips.push({id:c.id,source:c.source,destination:path(w,c).destination,path:c.path,requestedAt:c.requestedAt,completedAt:w.time+withinTick,delay:c.delay,freeFlowSeconds:c.freeFlowSeconds,turns:c.turns,visitedLinks:c.visitedLinks.slice(),completedMovements:c.completedMovements.slice()});}
 function step(w,observe=null){
  w.signals.forEach((s,i)=>{if(s.pending===null||w.time+EPS<s.until)return;s.transition='clearance';if(!w.junctions[i].cars.length){s.phase=s.pending;s.pending=null;s.transition='green';s.greenSince=w.time;s.phaseChanges++;}});
  w.sources.forEach((source,i)=>{
   while(source.next<=w.time+EPS){source.backlog.push(request(w,i));source.next+=source.period;}
   if(source.backlog.length&&entrySpace(w,source.link)){const c=source.backlog.shift();c.state='road';w.links[source.link].cars.push(c);}
   source.backlog.forEach(c=>charge(w,c,DT,observe));
  });
  // Nonconflicting approaches can enter together. Identical movements follow
  // at GAP, rather than reserving the entire junction until the leader exits.
  const admissions=w.junctions.map((junction,signal)=>{
   const options=[],selected=[];
   w.topology.links.forEach((link,i)=>{if(link.end!==signal||!canGo(w,signal,link.group))return;const c=w.links[i].cars[0];if(!c||link.length-c.position>SPEED*DT+EPS)return;const m=movement(w,c);if(!m||receivingSlots(w,m.outgoing)<=0||blockedAt(w,i,c.position)<link.length-EPS||leftYields(w,m))return;
    options.push({c,link:i,m,arrival:c.waitAt??w.time+(link.length-c.position)/SPEED,rank:(i-junction.lastIncoming-1+w.links.length)%w.links.length});
   });options.sort((a,b)=>(a.m.turn==='left')-(b.m.turn==='left')||(Math.abs(a.arrival-b.arrival)>EPS?a.arrival-b.arrival:a.rank-b.rank));
   for(const o of options){const peers=junction.cars.concat(selected.map(x=>x.c));
    if(peers.some(c=>{const other=movement(w,c);return conflicts(w.topology,o.m.id,other.id)||(other.incoming===o.link&&c.position<GAP-EPS);}))continue;
    if(receivingSlots(w,o.m.outgoing)-selected.filter(x=>x.m.outgoing===o.m.outgoing).length<=0)continue;
    selected.push(o);
   }
   return selected;
  });
  const newEntries=new Map();
  w.topology.links.forEach((link,i)=>{
   const lane=w.links[i],retained=[];let leader=Infinity;
   if(link.end!==null)for(const current of w.junctions[link.end].cars)if(movement(w,current).incoming===i)leader=Math.min(leader,link.length+current.position);
   for(const c of lane.cars){
    const next=Math.max(c.position,Math.min(c.position+SPEED*DT,leader-GAP,link.length,blockedAt(w,i,c.position))),travel=(next-c.position)/SPEED;
    c.stopped=next-c.position<.01;c.position=next;
    if(link.end===null&&next>=link.length-EPS){finish(w,c,travel);continue;}
    if(link.end!==null&&next>=link.length-EPS){
     c.waitAt??=w.time+travel;
     if(admissions[link.end].some(o=>o.c===c)){c.state='junction';c.position=0;c.stopped=false;w.junctions[link.end].cars.push(c);w.junctions[link.end].lastIncoming=i;newEntries.set(c.id,{remaining:DT-travel,free:travel});leader=link.length;continue;}
    }
    charge(w,c,DT-travel,observe);retained.push(c);leader=next;
   }lane.cars=retained;
  });
  w.junctions.forEach((junction,signal)=>{
   const retained=[],leaders=new Map();
   for(const c of junction.cars){const m=movement(w,c),entry=newEntries.get(c.id),available=entry?.remaining??DT,prior=entry?.free??0,tail=w.links[m.outgoing].cars.at(-1);
   const next=Math.max(c.position,Math.min(c.position+m.speed*available,m.length,(leaders.get(m.id)??Infinity)-GAP,tail?m.length+tail.position-GAP:Infinity)),delta=next-c.position;c.position=next;let free=prior+delta/m.speed;
   if(c.position>=m.length-EPS){
    // Space was reserved at admission. Other cars on this lane only move forward.
    const outgoing=w.links[m.outgoing],road=w.topology.links[m.outgoing],last=outgoing.cars.at(-1);
    if(last&&last.position<GAP-EPS)throw new Error('Lost reserved exit space.');
    const remaining=Math.max(0,DT-free),x=Math.max(0,Math.min(SPEED*remaining,last?last.position-GAP:Infinity,road.length,blockedAt(w,m.outgoing,0)));
    c.position=x;c.leg++;c.state='road';c.waitAt=undefined;c.stopped=x<.01;free+=x/SPEED;c.visitedLinks.push(m.outgoing);c.completedMovements.push(m.id);
    w.turns[m.turn]++;if(m.turn!=='straight')c.turns++;
    w.movementLog.push({id:c.id,movement:m.id,signal,turn:m.turn,at:w.time+prior+delta/m.speed});leaders.set(m.id,m.length+x);
    if(road.end===null&&x>=road.length-EPS){finish(w,c,free);continue;}
    outgoing.cars.push(c);
   }else{c.stopped=delta<.01;retained.push(c);leaders.set(m.id,c.position);}
   charge(w,c,DT-free,observe);
   }junction.cars=retained;
  });
  w.time+=DT;return w;
 }
 function queues(w){const q=w.signals.map(()=>[0,0]);w.topology.links.forEach((l,i)=>{if(l.end!==null)q[l.end][l.group]+=w.links[i].cars.filter(c=>c.stopped).length;});w.sources.forEach(s=>{const l=w.topology.links[s.link];q[l.end][l.group]+=s.backlog.length;});return q;}
 function demand(w,horizon=30){
  const q=queues(w),counts=q.map(a=>a.slice()),flows=new Map();
  function add(c,link,weight){const m=movement(w,c);if(!m)return;const out=w.topology.links[m.outgoing];if(out.end===null)return;const key=[link.end,out.end,link.group,out.group,m.outgoing].join(':');const flow=flows.get(key)??{i:link.end,j:out.end,group:link.group,nextGroup:out.group,outgoing:m.outgoing,count:0,travel:out.length/SPEED};flow.count+=weight;flows.set(key,flow);}
  w.topology.links.forEach((l,i)=>{if(l.end===null)return;for(const c of w.links[i].cars){const eta=(l.length-c.position)/SPEED,weight=c.stopped?1:Math.max(0,1-eta/horizon);if(!c.stopped)counts[l.end][l.group]+=weight;if(weight>0)add(c,l,weight);}});
  w.sources.forEach(s=>{const l=w.topology.links[s.link];s.backlog.forEach(c=>add(c,l,1));});
  return {queues:q,counts,flows:[...flows.values()].map(f=>({...f,freeSlots:Math.max(0,receivingSlots(w,f.outgoing))}))};
 }
 function locate(shape,d){d=Math.max(0,Math.min(shape.length,d));let i=1;while(i<shape.distances.length-1&&shape.distances[i]<d)i++;const f=(d-shape.distances[i-1])/(shape.distances[i]-shape.distances[i-1]);const a=shape.points[i-1],b=shape.points[i];return {point:[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],direction:[b[0]-a[0],b[1]-a[1]]};}
 function positions(w){const ref=w.topology.reference;return active(w,{backlogs:false}).map(c=>{const shape=c.state==='junction'?movement(w,c):w.topology.links[path(w,c).links[c.leg]],p=locate(shape,c.position),n=Math.hypot(...p.direction)||1;return {id:c.id,coordinates:[ref.lon+p.point[0]/ref.metersPerLongitude,ref.lat+p.point[1]/ref.metersPerLatitude],ahead:[ref.lon+(p.point[0]+p.direction[0]/n)/ref.metersPerLongitude,ref.lat+(p.point[1]+p.direction[1]/n)/ref.metersPerLatitude],turning:c.state==='junction'&&shape.turn!=='straight',stopped:c.stopped,path:c.path};});}
 function trip(w,id){const c=active(w).find(c=>c.id===id)??w.completedTrips.find(c=>c.id===id);if(!c)return null;const p=path(w,c);return {id:c.id,path:p.id,source:w.topology.sources[p.source].name,destination:w.topology.exits[p.destination].name,state:c.state??'finished',turns:p.turns.slice(),completedTurns:c.turns,delay:c.delay,links:p.links,movements:p.movements};}
 function tripCoordinates(topology,pathId){const p=topology.paths[pathId],points=[];p.links.forEach((l,i)=>{points.push(...topology.links[l].coordinates);if(i<p.movements.length)points.push(...topology.movements[p.movements[i]].coordinates);});return points;}
 function blockPositions(w){const ref=w.topology.reference;return w.blocks.map(b=>{const p=locate(w.topology.links[b.link],b.at),n=Math.hypot(...p.direction)||1;return {...b,name:w.topology.links[b.link].name,coordinates:[ref.lon+p.point[0]/ref.metersPerLongitude,ref.lat+p.point[1]/ref.metersPerLatitude],ahead:[ref.lon+(p.point[0]+p.direction[0]/n)/ref.metersPerLongitude,ref.lat+(p.point[1]+p.direction[1]/n)/ref.metersPerLatitude]};});}
 // Read-only motion observer. Its state lives outside the traffic world and is
 // never consulted by the controller, vehicle dynamics or random sampler.
 function createStopTracker(initial){
  const topology=initial.topology,windowStart=initial.time,records=new Map(),offsets=topology.paths.map(p=>{let total=0;const starts=p.links.map((id,i)=>{const start=total;total+=topology.links[id].length;if(i<p.movements.length)total+=topology.movements[p.movements[i]].length;return start;});return {starts,total};});
  const definition={version:1,sampleSeconds:DT,maximumStoppedSpeed:.1,minimumEpisodeSeconds:1,longEpisodeSeconds:20,denominator:'All requested trips, including initial cars, source queues and unfinished trips.',newStop:'A qualifying on-road stop after observed movement. Initial queues and waiting before observed movement are excluded from new-stop counts.',censoring:'Initial stopped episodes are left-censored; ongoing episodes are right-censored. Durations cover this experiment window only.',sourceWaiting:'Time waiting to enter the modeled road network, separate from on-road stop episodes.'};
  function progress(c){const p=topology.paths[c.path],o=offsets[c.path];return c.completedAt!==undefined?o.total:c.state==='source'?0:o.starts[c.leg]+(c.state==='junction'?topology.links[p.links[c.leg]].length:0)+c.position;}
  function add(c,isInitial=false){const r={id:c.id,source:c.source,originGroup:topology.links[topology.sources[c.source].link].group,entered:c.state!=='source',finished:c.completedAt!==undefined,initial:isInitial,hasMoved:false,lastTime:isInitial?windowStart:c.requestedAt,lastProgress:isInitial?progress(c):0,sourceSeconds:0,episodes:[],quiet:null};records.set(c.id,r);return r;}
  active(initial).forEach(c=>add(c,true));
  function close(r){if(r.quiet){r.episodes.push({...r.quiet,end:r.lastTime});r.quiet=null;}}
  function observe(w){
   const cars=[...active(w),...w.completedTrips];
   for(const c of cars){const r=records.get(c.id)??add(c),end=c.completedAt??w.time,elapsed=end-r.lastTime;if(elapsed<=EPS)continue;
    if(c.state==='source'){close(r);r.sourceSeconds+=elapsed;}
    else{r.entered=true;const distance=Math.max(0,progress(c)-r.lastProgress),stopped=distance<=definition.maximumStoppedSpeed*elapsed+EPS;
     if(stopped){r.quiet??={start:r.lastTime,duration:0,isNew:r.hasMoved,leftCensored:r.initial&&Math.abs(r.lastTime-windowStart)<EPS};r.quiet.duration+=elapsed;}
     else{close(r);r.hasMoved=true;}
    }
    r.lastTime=end;r.lastProgress=progress(c);r.finished=c.completedAt!==undefined;if(r.finished)close(r);
   }
  }
  function vehicle(r){
   const episodes=[...r.episodes.map(e=>({...e,rightCensored:false})),...(r.quiet?[{...r.quiet,end:r.lastTime,rightCensored:true}]:[])].filter(e=>e.duration>=definition.minimumEpisodeSeconds-EPS);
   const longest=Math.max(0,...episodes.map(e=>e.duration));
   return {id:r.id,source:r.source,originGroup:r.originGroup,entered:r.entered,finished:r.finished,newStops:episodes.filter(e=>e.isNew).length,sourceWaitSeconds:r.sourceSeconds,roadStoppedSeconds:episodes.reduce((sum,e)=>sum+e.duration,0),longestRoadStopSeconds:longest,longestRoadStopCensored:episodes.some(e=>Math.abs(e.duration-longest)<EPS&&(e.leftCensored||e.rightCensored)),episodes};
  }
  function aggregate(trips){
   const episodes=trips.flatMap(t=>t.episodes),longest=Math.max(0,...episodes.map(e=>e.duration)),newStops=trips.reduce((sum,t)=>sum+t.newStops,0),sourceWait=trips.reduce((sum,t)=>sum+t.sourceWaitSeconds,0);
   return {vehicles:trips.length,entered:trips.filter(t=>t.entered).length,finished:trips.filter(t=>t.finished).length,unfinished:trips.filter(t=>!t.finished).length,newStops,newStopsPerCar:trips.length?newStops/trips.length:0,repeatedStopCars:trips.filter(t=>t.newStops>=2).length,roadStopEpisodes:episodes.length,roadStoppedSeconds:episodes.reduce((sum,e)=>sum+e.duration,0),longestRoadStopSeconds:longest,longestRoadStopCensored:episodes.some(e=>Math.abs(e.duration-longest)<EPS&&(e.leftCensored||e.rightCensored)),leftCensoredEpisodes:episodes.filter(e=>e.leftCensored).length,rightCensoredEpisodes:episodes.filter(e=>e.rightCensored).length,stopsAtLeast20Seconds:episodes.filter(e=>e.duration>=20-EPS).length,sourceWaitSeconds:sourceWait,meanSourceWaitSeconds:trips.length?sourceWait/trips.length:0,longestSourceWaitSeconds:Math.max(0,...trips.map(t=>t.sourceWaitSeconds)),durationBins:[episodes.filter(e=>e.duration<5-EPS).length,episodes.filter(e=>e.duration>=5-EPS&&e.duration<15-EPS).length,episodes.filter(e=>e.duration>=15-EPS&&e.duration<30-EPS).length,episodes.filter(e=>e.duration>=30-EPS).length]};
  }
  function trips(){return [...records.values()].map(vehicle);}
  function summary(){const all=trips();return {...aggregate(all),byOrigin:[0,1].map(g=>aggregate(all.filter(t=>t.originGroup===g)))};}
  return {definition,observe,summary,trips,vehicle:id=>records.has(id)?vehicle(records.get(id)):null};
 }
 // Independent approach detector, not a junction-admission counter. Observe
 // after every physics tick; its signal state served that entire tick.
 function createSignalArrivalTracker(initial){
  const topology=initial.topology,windowStart=initial.time,records=new Map(),log=[];
  const definition={version:1,sampleSeconds:DT,detectorMetresBeforeStopLine:16,reference:'First crossing of a virtual detector 16 m before each signal stop line, clipped to the incoming link start on shorter links.',denominator:'Observed first detector crossings, once per trip and route leg. Initial cars already at or beyond a detector are excluded for that approach; source waiting and approaches not yet reached are not arrivals.',classification:'Green serves the incoming road group with no pending change. Pending changes are all-red clearance, counted separately from red. A green arrival does not guarantee passage: queues, left-turn conflicts and blocked exits can still cause stops.',timing:'Signal state after each 0.1 s physics tick applies throughout that tick. Crossing times are interpolated within the tick; no sub-tick signal switching is modeled.'};
  const paths=topology.paths.map(p=>{let start=0;const starts=[],targets=[];p.links.forEach((id,leg)=>{const link=topology.links[id];starts.push(start);if(link.end!==null)targets.push({leg,link:id,signal:link.end,group:link.group,at:start+Math.max(0,link.length-16),detectorPosition:Math.max(0,link.length-16)});start+=link.length+(leg<p.movements.length?topology.movements[p.movements[leg]].length:0);});return {starts,targets,total:start};});
  function progress(c){const p=paths[c.path];return c.completedAt!==undefined?p.total:c.state==='source'?0:p.starts[c.leg]+(c.state==='junction'?topology.links[topology.paths[c.path].links[c.leg]].length:0)+c.position;}
  function add(c,isInitial=false){
   const distance=isInitial?progress(c):0,targets=paths[c.path].targets.filter(t=>!isInitial||c.state==='source'||t.leg>=c.leg).map(t=>({...t,excluded:isInitial&&c.state!=='source'&&t.at<=distance+EPS,seen:false}));
   const r={id:c.id,path:c.path,source:c.source,lastProgress:distance,lastTime:isInitial?initial.time:c.requestedAt,wasSource:!isInitial||c.state==='source',targets};records.set(c.id,r);return r;
  }
  active(initial).forEach(c=>add(c,true));
  function observe(w){
   for(const c of [...active(w),...w.completedTrips]){
    if(c.completedAt!==undefined&&c.completedAt<=windowStart+EPS)continue;
    const r=records.get(c.id)??add(c),end=c.completedAt??w.time,elapsed=end-r.lastTime;if(elapsed<=EPS)continue;
    if(elapsed>DT+EPS)throw new Error('Signal arrivals must be observed every physics tick.');
    const next=progress(c);
    if(c.state!=='source')for(const t of r.targets){
     if(t.excluded||t.seen||t.at>next+EPS||!(t.at>r.lastProgress+EPS||r.wasSource&&t.at>=r.lastProgress-EPS))continue;
     const s=w.signals[t.signal],state=s.pending!==null?'clearance':s.phase===t.group?'green':'red',fraction=next>r.lastProgress?Math.max(0,Math.min(1,(t.at-r.lastProgress)/(next-r.lastProgress))):0;
     log.push({id:r.id,path:r.path,source:r.source,leg:t.leg,link:t.link,signal:t.signal,group:t.group,detectorPosition:t.detectorPosition,at:r.lastTime+fraction*elapsed,state});t.seen=true;
    }
    r.lastProgress=next;r.lastTime=end;r.wasSource=c.state==='source';
   }
  }
  function aggregate(group=null){
   const events=log.filter(e=>group===null||e.group===group),targets=[...records.values()].flatMap(r=>r.targets).filter(t=>group===null||t.group===group),observed=events.length,green=events.filter(e=>e.state==='green').length,initialExcluded=targets.filter(t=>t.excluded).length;
   return {observed,green,red:events.filter(e=>e.state==='red').length,clearance:events.filter(e=>e.state==='clearance').length,greenFraction:observed?green/observed:null,initialExcluded,notYetArrived:targets.length-initialExcluded-observed};
  }
  return {definition,observe,events:()=>log.map(e=>({...e})),summary:()=>({...aggregate(),byApproachGroup:[0,1].map(aggregate)})};
 }
 function metric(w,snapshot,tracker,stops=null,arrivals=null){const count=w.requested-snapshot.completed;return {meanDelay:count?(w.delay-snapshot.delay)/count:0,maxDelay:tracker.summary().maxDelay,finished:w.completed-snapshot.completed,waiting:active(w).filter(c=>c.stopped||c.state==='source').length,vehicles:count,turns:w.turns.left+w.turns.right,leftTurns:w.turns.left,rightTurns:w.turns.right,...(stops?{stops:stops.summary()}:{}),...(arrivals?{arrivals:arrivals.summary()}:{})};}
 scope.RoutedTraffic={create,step,command,conflicts,receivingSlots,queues,demand,active,positions,trip,tripCoordinates,blockPositions,createStopTracker,createSignalArrivalTracker,metric,DT,SPEED,GAP,YELLOW,CLEARANCE};
})(globalThis);
