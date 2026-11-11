/* Straight-through teaching model, one illustrated lane per direction.
   Hourly volumes can be sourced; trajectories, following and timings are modeled.
   Per-car speed, bounded acceleration, anticipatory braking and yellow decisions.
   No turns, lane changes, pedestrians or field-calibrated driver behavior. */
(function(scope){
  const DT=.1,SPEED=8,GAP=8,YELLOW=3,CLEARANCE=YELLOW,EPS=1e-7;
  const ACCEL=1.5,BRAKE=3.07,REACTION=1,TIME_GAP=1;
  function speed(car){return car.v??(car.stopped?0:SPEED);}
  function stoppingDistance(v){return v*REACTION+v*v/(2*BRAKE);}
  function hash(x){x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return (x^(x>>>16))>>>0;}
  // Same seeded gap sequence for every plan and condition; scale by hourly rate.
  // Normalize each 60-gap block so its mean equals the sourced mean headway.
  const patterns=new Map();
  function arrivalFactor(seed,index){
    const block=Math.floor(index/60),key=seed+':'+block;
    if(!patterns.has(key)){const gaps=Array.from({length:60},(_,i)=>.35-.65*Math.log((hash(seed^Math.imul(block*60+i+1,0x9e3779b1))+.5)/4294967296)),mean=gaps.reduce((s,x)=>s+x,0)/60;patterns.set(key,gaps.map(x=>x/mean));}
    return patterns.get(key)[index%60];
  }
  function create(routes){
    const w={modelVersion:4,time:0,routes,lanes:routes.map(route=>({cars:[],backlog:[],next:route.arrivalOffset??0,arrivalIndex:0})),
      signals:Array.from({length:1+Math.max(...routes.flatMap(r=>r.gates.map(g=>g.signal)))},()=>({phase:1,pending:null,transition:'green',until:0,greenSince:0,phaseChanges:0})),
      requested:0,completed:0,passed:routes.map(()=>0),delay:0,serial:0,waiting:routes.map(()=>0),blocks:[]};
    routes.forEach((route,lane)=>{
      const at=route.gates[0].stopAt,positions=route.group===0?[at-3,at-11,at-19]:[Math.max(0,at-3)];
      positions.filter(x=>x>=0).forEach(x=>{w.lanes[lane].cars.push({id:w.serial++,x,v:0,stopped:true});w.requested++;});
    });return w;
  }
  function occupied(w,signal){return w.routes.some((route,lane)=>route.gates.some(g=>g.signal===signal&&w.lanes[lane].cars.some(c=>c.x>g.stopAt+EPS&&c.x<g.exitAt-EPS)));}
  function changing(w,i){return w.signals[i].pending!==null;}
  function command(w,i,phase){
    const s=w.signals[i];if(s.pending!==null||s.phase===phase||![0,1].includes(phase))return false;
    s.pending=phase;s.transition='yellow';s.until=w.time+YELLOW;s.decisions={};
    w.routes.forEach((route,lane)=>{if(route.group!==s.phase)return;const gate=route.gates.find(g=>g.signal===i);if(!gate)return;
      for(const c of w.lanes[lane].cars){if(c.x>gate.stopAt+EPS||route.gates.find(g=>c.x<=g.stopAt+EPS)!==gate)continue;const v=speed(c),d=gate.stopAt-c.x;
        // A committed go is allowed only while yellow and only if the car can
        // reach the line before red. Followers/storage can still require a stop.
        const go=d<stoppingDistance(v)+.4&&v>0&&d/v<YELLOW-DT;
        s.decisions[c.id]={go,brake:Math.min(BRAKE,Math.max(.8,v*v/(2*Math.max(.1,d-v*REACTION)))),reactUntil:w.time+REACTION,until:s.until};
      }
    });return true;
  }
  function signalStage(w,i){const s=w.signals[i];return s.pending===null?'green':s.transition==='yellow'?'yellow':'clearance';}
  function indication(w,i,direction){const s=w.signals[i];return direction!==s.phase?'red':signalStage(w,i)==='green'?'green':signalStage(w,i)==='yellow'?'yellow':'red';}
  function canGo(w,gate,lane){const s=w.signals[gate.signal];return s.pending===null&&s.phase===w.routes[lane].group;}
  function yellowGo(w,gate,lane,c){return indication(w,gate.signal,w.routes[lane].group)==='yellow'&&w.signals[gate.signal].decisions?.[c.id]?.go===true;}
  // Maximum next-tick speed leaving enough distance for continued braking.
  function stopSpeed(v,d,b=BRAKE){return Math.max(0,-b*DT/2+Math.sqrt(Math.max(0,(b*DT/2)**2+2*b*Math.max(0,d)-b*v*DT)));}
  function step(w,observe=null){
    w.signals.forEach((s,i)=>{if(s.pending===null||w.time+EPS<s.until)return;s.transition='clearance';if(!occupied(w,i)){s.phase=s.pending;s.pending=null;s.transition='green';s.greenSince=w.time;s.phaseChanges=(s.phaseChanges??0)+1;}});
    w.waiting=w.routes.map(()=>0);
    w.routes.forEach((route,laneIndex)=>{
      const lane=w.lanes[laneIndex];
      const room=route.gates.map((gate,k)=>{
        let end=route.gates[k+1]?.stopAt??Infinity;
        for(const b of w.blocks??[])if(b.lane===laneIndex&&b.at>=gate.stopAt-EPS)end=Math.min(end,b.at);
        const receiving=lane.cars.filter(c=>c.x>=gate.exitAt-EPS&&c.x<=end+EPS),reserved=lane.cars.filter(c=>c.x>gate.stopAt+EPS&&c.x<gate.exitAt-EPS).length;
        return Math.max(0,Math.floor((end-gate.exitAt+EPS)/GAP))-receiving.length-reserved;
      });
      while(lane.next<=w.time+EPS){lane.backlog.push({id:w.serial++});w.requested++;const index=lane.arrivalIndex??0;lane.next+=route.period*(route.arrivalPattern==='varied'?arrivalFactor(route.arrivalSeed??laneIndex,index):1);lane.arrivalIndex=index+1;}
      // Spawn with a speed supportable by the space ahead; no entry teleport.
      if(lane.backlog.length&&(!lane.cars.length||lane.cars.at(-1).x>=GAP)){
        const request=lane.backlog.shift(),tail=lane.cars.at(-1),v=tail?Math.min(SPEED,-BRAKE*TIME_GAP+Math.sqrt((BRAKE*TIME_GAP)**2+speed(tail)**2+2*BRAKE*Math.max(0,tail.x-GAP))):SPEED;lane.cars.push({id:request.id,x:0,v,stopped:v<.1});
      }
      let leader=null;w.delay+=lane.backlog.length*DT;w.waiting[laneIndex]+=lane.backlog.length;
      if(observe)lane.backlog.forEach(car=>observe(car.id,DT));
      for(const car of lane.cars){
        const v=speed(car);let target=SPEED,limit=Infinity,reacting=false;
        if(leader){const d=Math.max(0,leader.x-car.x-GAP);target=Math.min(target,-BRAKE*TIME_GAP+Math.sqrt((BRAKE*TIME_GAP)**2+speed(leader)**2+2*BRAKE*d));limit=leader.x-GAP;}
        route.gates.forEach((gate,k)=>{if(car.x>gate.stopAt+EPS)return;
          const allowed=canGo(w,gate,laneIndex)||yellowGo(w,gate,laneIndex,car),decision=w.signals[gate.signal].decisions?.[car.id];
          if(!allowed||room[k]<=0){
            limit=Math.min(limit,gate.stopAt);
            const reaction=room[k]>0&&!allowed&&indication(w,gate.signal,route.group)==='yellow'&&decision&&!decision.go&&w.time+EPS<decision.reactUntil;
            if(reaction){reacting=true;}else target=Math.min(target,stopSpeed(v,gate.stopAt-car.x,decision&&!decision.go&&decision.brake>0?decision.brake:BRAKE));
          }
          // Allocate receiving slots to leaders on the approach too, so a
          // follower sees a full road early enough to brake before the line.
          if(allowed&&room[k]>0)room[k]--;
        });
        for(const block of w.blocks??[])if(block.lane===laneIndex&&car.x<=block.at+EPS){limit=Math.min(limit,block.at);target=Math.min(target,stopSpeed(v,block.at-car.x));}
        if(reacting)target=Math.min(target,v);
        let nextV=Math.max(0,Math.max(v-BRAKE*DT,Math.min(v+ACCEL*DT,target))),distance=(v+nextV)*DT/2;
        // A finite physical boundary is the final guard against numerical drift
        // or a newly blocked receiving road. Ordinary approaches brake upstream.
        distance=Math.max(0,Math.min(distance,limit-car.x));
        if(distance<(v+nextV)*DT/2-EPS)nextV=Math.max(0,2*distance/DT-v);
        const next=car.x+distance;
        const lost=Math.max(0,DT-distance/SPEED);w.delay+=lost;if(observe)observe(car.id,lost);
        car.v=nextV;car.stopped=nextV<.1&&distance<.01;if(car.stopped)w.waiting[laneIndex]++;car.x=next;leader=car;
      }
      const exits=lane.cars.filter(c=>c.x>=route.length).length;w.completed+=exits;w.passed[laneIndex]+=exits;lane.cars=lane.cars.filter(c=>c.x<route.length);
    });w.time+=DT;return w;
  }
  function createDelayTracker(){const losses=new Map();let totalDelay=0,maxDelay=0;return {observe(id,seconds){const loss=(losses.get(id)??0)+seconds;losses.set(id,loss);totalDelay+=seconds;maxDelay=Math.max(maxDelay,loss);},summary(){return {totalDelay,maxDelay};}};}
  function throughBoth(w){return w.routes.reduce((total,route,i)=>route.group===0?total+w.passed[i]+w.lanes[i].cars.filter(c=>c.x>route.gates.at(-1).exitAt).length:total,0);}
  scope.TwoWayTraffic={create,step,command,canGo,changing,throughBoth,createDelayTracker,signalStage,indication,stoppingDistance,arrivalFactor,DT,SPEED,GAP,YELLOW,CLEARANCE,ACCEL,BRAKE,REACTION,TIME_GAP};
})(globalThis);
