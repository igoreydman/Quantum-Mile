"""Validate the exact device-compiled circuit locally before any QPU request."""
import math
import numpy as np
from qiskit_aer import AerSimulator

from quantum_core import analysis, require


def check_compiled(case, isa, make_sampler, shots=1024):
    # Device layouts can use many physical wires. Aer truncates unused wires;
    # request the marginal in original logical-qubit order explicitly.
    mapping = isa.layout.final_index_layout()
    require(len(mapping) == case['problem']['n'], 'Unexpected logical layout')
    require(isa.num_clbits==len(mapping) and len(isa.cregs)==1 and isa.cregs[0].name=='meas',
            'Expected the original meas readout register')
    measurements=[(isa.find_bit(op.qubits[0]).index,isa.find_bit(op.clbits[0]).index)
                  for op in isa.data if op.operation.name=='measure']
    require(sorted(measurements)==sorted((physical,q) for q,physical in enumerate(mapping)),
            'Compiled measurements changed the logical-to-classical bit order')
    unitary = isa.remove_final_measurements(inplace=False)
    unitary.save_probabilities(mapping, label='logical_probabilities')
    backend = AerSimulator(method='statevector', max_parallel_threads=1)
    # The ISA already consists of native gates supported by Aer. Avoid a second
    # target transpilation: Aer advertises a memory-based wire limit before its
    # unused-wire truncation, which otherwise rejects e.g. a 6-qubit circuit
    # laid out on a 133-wire target even though only a few wires are active.
    exact = np.asarray(backend.run(unitary).result().data(0)['logical_probabilities'])
    error = float(np.max(np.abs(exact-case['probabilities'])))
    require(error < 1e-10, 'Device compilation/layout changed the ideal logical probabilities')
    # Exercise the same Sampler interface and measured ISA that submission uses.
    result = make_sampler(backend, seed=20261110).run([isa], shots=shots).result()
    counts = {k:int(v) for k,v in result[0].data.meas.get_counts().items()}
    require(sum(counts.values()) == shots, 'Sampler readout count mismatch')
    measured = analysis(case, counts)
    # Simultaneous Hoeffding bound across every basis-state frequency. This is
    # only a noiseless software preflight, not a hardware-accuracy guarantee.
    bound = math.sqrt(math.log(2*len(exact)/1e-6)/(2*shots))
    deviation = float(np.max(np.abs(np.asarray(measured['frequencies'])-exact)))
    require(deviation <= bound, 'Noiseless compiled readout failed its declared sampling check')
    require(measured['invalidLockedPlanFrequency'] == 0, 'Compiled ideal readout violates bit locks')
    return {'allPassed':True, 'hardwareExecuted':False, 'physicalQubits':mapping,
            'maximumExactLogicalProbabilityError':error,
            'measurementMappingChecked':True,'classicalReadoutOrder':'q[n-1]...q0',
            'measuredSamplerPathChecked':True, 'shots':shots,
            'simultaneousFrequencyBound':bound, 'observedMaximumFrequencyDeviation':deviation,
            'counts':counts, 'scope':'Exact real-target compiled circuit, simulated noiselessly locally. Does not verify service acceptance, account entitlement or actual hardware fidelity.'}
