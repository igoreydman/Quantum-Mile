/* Inspectable structural QAOA circuit. q0 is the least-significant state bit.
   RZ coefficients combine commuting terms. The constant cost is a global phase.
   Browser computation is local custom code; Qiskit independently verifies it. */
(function(scope){
 const copy=a=>a.map(z=>z.slice()),probabilities=a=>a.map(([r,i])=>r*r+i*i);
 function bits(index,n){return index.toString(2).padStart(n,'0');}
 function trace(problem,gamma,beta){
  const C=scope.NeighborhoodControl,n=problem.n,size=2**n;
  const eligible=Array.from({length:size},(_,i)=>i).filter(i=>C.allowed(problem,i));
  const costs=eligible.map(i=>C.cost(problem,i)),min=Math.min(...costs),range=Math.max(...costs)-min||1,scale=gamma/range;
  let state=Array.from({length:size},(_,i)=>[i===0?1:0,0]);const frames=[],operations=[];
  function frame(op,contributions=null){frames.push({op,amplitudes:copy(state),probabilities:probabilities(state),contributions});}
  function apply(op){
   const before=copy(state),terms=Array.from({length:size},()=>[]),bit=1<<op.targets[0];
   if(op.gate==='H'||op.gate==='X'||op.gate==='RX'){
    for(let i=0;i<size;i++){
     const a=before[i],b=before[i^bit];let own,other;
     if(op.gate==='H'){const sign=i&bit?-1:1;own=a.map(v=>v*sign/Math.sqrt(2));other=b.map(v=>v/Math.sqrt(2));}
     else if(op.gate==='X'){own=[0,0];other=b.slice();}
     else{const c=Math.cos(op.angle/2),s=Math.sin(op.angle/2);own=a.map(v=>v*c);other=[b[1]*s,-b[0]*s];}
     state[i]=own.map((v,k)=>v+other[k]);terms[i]=[{source:i,value:own},{source:i^bit,value:other}];
    }
   }else{
    for(let i=0;i<size;i++){
     const z=op.targets.reduce((v,q)=>v*(i>>q&1?-1:1),1),angle=-op.angle*z/2,c=Math.cos(angle),s=Math.sin(angle),[r,im]=before[i];
     state[i]=[r*c-im*s,r*s+im*c];terms[i]=[{source:i,value:state[i].slice()}];
    }
   }
   operations.push(op);frame(op,terms);
  }
  frame({gate:'start',targets:[],group:'initial',label:'Start at all-zero bits'});
  problem.locks.forEach((lock,q)=>{if(lock===null)apply({gate:'H',targets:[q],group:'preparation',label:`H · prepare q${q}`});else if(lock===1)apply({gate:'X',targets:[q],group:'preparation',label:`X · fix q${q} to 1`});});
  const prepared=frames.length-1;
  for(let q=0;q<n;q++){
   const coefficient=problem.linear[q]+problem.pairs.reduce((s,e)=>s+(e.i===q||e.j===q?e.weight/2:0),0);
   apply({gate:'RZ',targets:[q],angle:-scale*coefficient,group:'cost',label:`RZ · cost phase on q${q}`});
  }
  for(const e of problem.pairs)apply({gate:'RZZ',targets:[e.i,e.j],angle:scale*e.weight/2,group:'cost',label:`RZZ · joint cost on q${e.i}, q${e.j}`});
  const cost=frames.length-1;
  problem.locks.forEach((lock,q)=>{if(lock===null)apply({gate:'RX',targets:[q],angle:2*beta,group:'mixing',label:`RX · mix q${q}`});});
  return {n,problem,gamma,beta,min,range,operations,frames,prepared,cost,mixed:frames.length-1,final:frames.at(-1)};
 }
 function mixContributions(circuit,index){
  const c=Math.cos(circuit.beta),s=Math.sin(circuit.beta);
  return circuit.frames[circuit.cost].amplitudes.map((amplitude,source)=>{
   let value=amplitude.slice();for(let q=0;q<circuit.n;q++){
    if(circuit.problem.locks[q]!==null){if((source>>q&1)!==(index>>q&1))value=[0,0];continue;}
    value=(source>>q&1)===(index>>q&1)?value.map(v=>v*c):[value[1]*s,-value[0]*s];
   }return {source,value};
  });
 }
 function measured(circuit,index){
  if(!Number.isInteger(index)||index<0||index>=2**circuit.n||circuit.final.probabilities[index]<=0)throw new Error('Impossible measured outcome.');
  const amplitudes=Array.from({length:2**circuit.n},(_,i)=>[i===index?1:0,0]);
  return {op:{gate:'M',targets:Array.from({length:circuit.n},(_,i)=>i),group:'measurement',label:`Measured ${bits(index,circuit.n)}`},amplitudes,probabilities:probabilities(amplitudes),contributions:null,index,priorProbability:circuit.final.probabilities[index]};
 }
 scope.CircuitDecision={trace,measured,bits,mixContributions};
})(globalThis);
