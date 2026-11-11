/* 64 timing plans on six qubits. All forecasts and tuning are classical.
   q0/q1: first street at Salzedo/Ponce (1 = Miracle Mile).
   q2:q3 / q4:q5: each junction's requested change time, little endian.
   H^6 -> exact diagonal cost phase -> RX(2 beta)^6 -> weighted sample.
   A small local teaching simulation, with no quantum-advantage claim. */
(function(scope){
  const HORIZON=30,CHANGE_TIMES=[11,13,15,19],QUBITS=6,PLAN_COUNT=64,MIN_GREEN=8,model=scope.TwoWayTraffic;
  const LEGACY_PLANS=[40,41,42,43],FIXED_PLAN=43,EPS=1e-7;
  function valid(index){if(!Number.isInteger(index)||index<0||index>=PLAN_COUNT)throw new Error('Invalid timing plan.');}
  function firstPhase(index,signal){return index>>signal&1?0:1;}
  function changeAt(index,signal){return CHANGE_TIMES[index>>(2+2*signal)&3];}
  function decode(index){valid(index);return {index,first:[firstPhase(index,0),firstPhase(index,1)],changeAt:[changeAt(index,0),changeAt(index,1)]};}
  function drive(w,index,start){
    valid(index);const elapsed=w.time-start;if(elapsed>=HORIZON-EPS)return false;
    for(let i=0;i<2;i++){
      const first=firstPhase(index,i),second=elapsed+EPS>=changeAt(index,i),desired=second?1-first:first,s=w.signals[i];
      // Respect actual green across delayed clearance and replanning boundaries.
      // Only the initial startup phase permits an immediate first decision.
      if(desired!==s.phase&&(s.phaseChanges??0)>0&&w.time-(s.greenSince??start)<MIN_GREEN-EPS)continue;
      model.command(w,i,desired);
    }return true;
  }
  function forecast(w,index=null){
    if(index!==null)valid(index);
    const copy=JSON.parse(JSON.stringify(w)),tracker=model.createDelayTracker();copy.routes=w.routes;
    for(let tick=0;tick<Math.round(HORIZON/model.DT);tick++){if(index!==null)drive(copy,index,w.time);model.step(copy,tracker.observe);}
    const vehicles=w.requested-w.completed+copy.requested-w.requested,delay=copy.delay-w.delay;
    return {delay,vehicles,meanDelay:vehicles?delay/vehicles:0,maxDelay:tracker.summary().maxDelay,remaining:copy.requested-copy.completed,
      completed:copy.completed-w.completed,waiting:copy.waiting.reduce((a,b)=>a+b,0)};
  }
  function state(costs,gamma,beta,phase=true,mix=true){
    const n=Math.log2(costs.length);if(!Number.isInteger(n)||n<1||costs.some(c=>!Number.isFinite(c)))throw new Error('Finite power-of-two costs required.');
    const min=Math.min(...costs),range=Math.max(...costs)-min,scale=1/Math.sqrt(costs.length);
    const amplitudes=costs.map(c=>{const angle=phase&&range>1e-10?-gamma*(c-min)/range:0;return [scale*Math.cos(angle),scale*Math.sin(angle)];});
    if(mix){const c=Math.cos(beta),s=Math.sin(beta);
      for(let q=0;q<n;q++)for(let i=0;i<costs.length;i++)if(!(i>>q&1)){
        const j=i|1<<q,[ar,ai]=amplitudes[i],[br,bi]=amplitudes[j];
        amplitudes[i]=[c*ar+s*bi,c*ai-s*br];amplitudes[j]=[c*br+s*ai,c*bi-s*ar];
      }
    }return {amplitudes,probabilities:amplitudes.map(([a,b])=>a*a+b*b)};
  }
  function tune(costs){
    let best={gamma:0,beta:0,expected:costs.reduce((a,b)=>a+b,0)/costs.length,probabilities:costs.map(()=>1/costs.length)};
    for(let g=1;g<=32;g++)for(let b=-32;b<=32;b++){
      const gamma=g*.2,beta=b*Math.PI/64,probabilities=state(costs,gamma,beta).probabilities;
      const expected=probabilities.reduce((sum,p,i)=>sum+p*costs[i],0);
      if(expected<best.expected-1e-9)best={gamma,beta,expected,probabilities};
    }return best;
  }
  function sample(probabilities,u){
    if(!Number.isFinite(u)||u<0||u>=1)throw new Error('Sample value must be in [0,1).');
    let sum=0;for(let i=0;i<probabilities.length;i++){sum+=probabilities[i];if(u<sum)return i;}
    return probabilities.findLastIndex(p=>p>0);
  }
  function evaluate(w){
    const plans=Array.from({length:PLAN_COUNT},(_,i)=>({...decode(i),...forecast(w,i)})),baseline=forecast(w),costs=plans.map(p=>p.delay),quantum=tune(costs);
    return {at:w.time,plans,baseline,costs,quantum,uniformExpected:costs.reduce((a,b)=>a+b,0)/PLAN_COUNT,
      classicalBest:Math.min(...costs),legacyBest:Math.min(...LEGACY_PLANS.map(i=>costs[i])),horizon:HORIZON,qubits:QUBITS,changeTimes:CHANGE_TIMES.slice(),
      objective:'Minimize total added delay in the next 30 seconds. Maximum individual delay and finished trips are reported separately, not optimized.'};
  }
  scope.LocalSignalPlanner={HORIZON,CHANGE_TIMES,QUBITS,PLAN_COUNT,MIN_GREEN,LEGACY_PLANS,FIXED_PLAN,firstPhase,changeAt,decode,drive,forecast,state,tune,sample,evaluate};
})(globalThis);
