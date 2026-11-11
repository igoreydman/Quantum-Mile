/* A lesson draw is a proposal. Sampling and editing never command signals or
   advance traffic. Applying consumes the proposal once, without another draw. */
(function(scope){
 const clone=x=>JSON.parse(JSON.stringify(x)),freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
 function create(evaluation,{seed=20261105,initialWorld=null}={}){
  const random=scope.TrafficScenarios.random(seed);let circuit=null,pending=null,draws=0,applied=false;
  function configure(trace){if(applied)throw new Error('This lesson decision has already been applied.');const changed=circuit!==trace;if(changed){circuit=trace;pending=null;}return changed;}
  function sample(trace){configure(trace);const draw=random(),index=scope.LocalSignalPlanner.sample(trace.final.probabilities,draw);pending=freeze({circuit:clone(trace),measurement:scope.CircuitDecision.measured(trace,index),draw,ordinal:++draws});return pending;}
  function apply(routes){
   if(applied||!pending)throw new Error('Sample the current circuit before applying it.');const C=scope.NeighborhoodControl,p=pending,tr=p.circuit,t=C.create(routes,{lesson:true,seconds:30,seed,initialWorld});
   t.initial={...clone(evaluation),expected:tr.final.probabilities.reduce((sum,chance,i)=>sum+chance*evaluation.costs[i],0),quantum:{...clone(evaluation.quantum),gamma:tr.gamma,beta:tr.beta,amplitudes:clone(tr.final.amplitudes),probabilities:tr.final.probabilities.slice(),min:tr.min,range:tr.range}};
   t.plans.quantum={evaluation:t.initial,index:p.measurement.index,at:0,tick:0,draw:p.draw};t.replans=1;t.lessonDrawOrdinal=p.ordinal;C.drive(t.worlds.quantum,p.measurement.index);t.running=false;applied=true;return t;
  }
  return {configure,sample,apply,get pending(){return pending;},get draws(){return draws;}};
 }
 scope.LessonDecision={create};
})(globalThis);
