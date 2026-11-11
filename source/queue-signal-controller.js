/* Classical queue-responsive baseline, using current stopped queues only.
   Startup can choose immediately; an inherited actual green is respected.
   Subsequent changes wait for 8 s of actual
   green, then serve the larger queue. At 20 s, a nonempty opposing queue gets
   a turn even when smaller. All changes use the shared model's clearance.
   These are illustrative settings, not calibrated municipal timings. */
(function(scope){
  const M=scope.TwoWayTraffic,MIN_GREEN=8,MAX_GREEN=20,EPS=1e-7;
  function queues(w){
    const counts=w.signals.map(()=>[0,0]);
    w.routes.forEach((route,i)=>{
      counts[route.gates[0].signal][route.group]+=w.lanes[i].backlog.length;
      for(const car of w.lanes[i].cars){
        if(!car.stopped)continue;
        // A car waiting at its first light must not count at its second as well.
        const gate=route.gates.find(g=>car.x<=g.stopAt+EPS);
        if(gate)counts[gate.signal][route.group]++;
      }
    });return counts;
  }
  function create(w){return {signals:w.signals.map(s=>({phase:s.phase,greenSince:s.greenSince??w.time,started:s.pending!==null||(s.phaseChanges??0)>0}))};}
  function drive(w,controller){
    const demand=queues(w),decisions=[];
    w.signals.forEach((signal,i)=>{
      const state=controller.signals[i];
      if(signal.phase!==state.phase){state.phase=signal.phase;state.greenSince=signal.greenSince??w.time;state.started=true;}
      if(M.changing(w,i))return;
      const current=demand[i][signal.phase],other=demand[i][1-signal.phase],age=w.time-state.greenSince;
      const initial=!state.started;state.started=true;
      if(other>0&&(initial?other>current:age+EPS>=MIN_GREEN&&(other>current||age+EPS>=MAX_GREEN))){
        if(M.command(w,i,1-signal.phase))decisions.push({signal:i,phase:1-signal.phase,currentQueue:current,opposingQueue:other,reason:age+EPS>=MAX_GREEN?'waiting turn':'larger queue'});
      }
    });return decisions;
  }
  scope.QueueSignalController={create,drive,queues,MIN_GREEN,MAX_GREEN};
})(globalThis);
