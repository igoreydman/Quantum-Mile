"""Independent QUBO -> Qiskit construction and common experiment analysis.

x_i=(1-Z_i)/2. For C=c+sum a_i*x_i+sum b_ij*x_i*x_j,
exp(-i gamma C/range) is, up to global phase:
RZ_i[-gamma/range*(a_i+sum_j b_ij/2)] and
RZZ_ij[gamma/range*b_ij/2]. RX_i(2 beta) mixes unlocked bits.
No browser gate list is used to construct the Qiskit circuit.
"""
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def versions():
    return {n: importlib.metadata.version(n) for n in
            ['qiskit', 'qiskit-aer', 'qiskit-ibm-runtime', 'numpy']}


def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def cost(problem, index):
    return (problem['constant'] + sum(a * ((index >> q) & 1)
            for q, a in enumerate(problem['linear'])) + sum(
            e['weight'] * ((index >> e['i']) & 1) * ((index >> e['j']) & 1)
            for e in problem['pairs']))


def allowed(problem, index):
    return all(v is None or ((index >> q) & 1) == v
               for q, v in enumerate(problem['locks']))


def operations(case):
    p = case['problem']; n = p['n']
    require(type(n) is int and 1 <= n <= 6, 'Expected 1–6 logical qubits')
    require(len(p['linear']) == len(p['locks']) == n, 'Invalid coefficients/locks')
    require(all(v is None or type(v) is int and v in (0, 1) for v in p['locks']), 'Invalid bit lock')
    for e in p['pairs']:
        require(type(e['i']) is int and type(e['j']) is int and
                0 <= e['i'] < n and 0 <= e['j'] < n and e['i'] != e['j'], 'Invalid pair')
    numbers = [p['constant'], *p['linear'], *(e['weight'] for e in p['pairs']), case['gamma'], case['beta']]
    require(all(isinstance(v, (int, float)) and math.isfinite(v) for v in numbers), 'Nonfinite coefficient')
    values = [cost(p, i) for i in range(2**n) if allowed(p, i)]
    scale = case['gamma'] / (max(values) - min(values) or 1)
    ops = []
    for q, lock in enumerate(p['locks']):
        if lock is None: ops.append(('h', [q], None))
        elif lock == 1: ops.append(('x', [q], None))
    for q, a in enumerate(p['linear']):
        angle = -scale * (a + sum(e['weight']/2 for e in p['pairs'] if q in (e['i'], e['j'])))
        ops.append(('rz', [q], angle))
    for e in p['pairs']:
        ops.append(('rzz', [e['i'], e['j']], scale * e['weight']/2))
    for q, lock in enumerate(p['locks']):
        if lock is None: ops.append(('rx', [q], 2 * case['beta']))
    return ops


def append(qc, operation):
    gate, targets, angle = operation
    method = getattr(qc, gate)
    method(*targets) if angle is None else method(angle, *targets)


def circuit(case, measured=False):
    qc = QuantumCircuit(case['problem']['n'], name=case['id'])
    for op in operations(case): append(qc, op)
    if measured: qc.measure_all()
    return qc


def verify(case, tolerance=1e-10):
    n = case['problem']['n']; ops = operations(case)
    require(len(case['frames']) == len(ops)+1, 'Frame count mismatch: '+case['id'])
    require(len(case['probabilities']) == len(case['costs']) == 2**n, 'Basis-state count mismatch')
    require(max(abs(cost(case['problem'], i)-case['costs'][i]) for i in range(2**n)) < tolerance, 'Independent QUBO costs differ')
    qc = QuantumCircuit(n); max_amp = max_prob = 0.
    for j, frame in enumerate(case['frames']):
        if j:
            gate, targets, angle = ops[j-1]; browser = frame['op']
            require(browser['gate'].lower() == gate and browser['targets'] == targets, 'Gate identity mismatch')
            if angle is not None: require(abs(browser['angle']-angle) < tolerance, 'Gate angle mismatch')
            append(qc, ops[j-1])
        actual = Statevector.from_instruction(qc)
        expected = np.array([complex(*z) for z in frame['amplitudes']])
        require(len(expected) == 2**n and np.isfinite(expected).all(), 'Invalid browser amplitudes')
        amp = float(np.max(np.abs(actual.data-expected)))
        prob = float(np.max(np.abs(actual.probabilities()-frame['probabilities'])))
        require(amp < tolerance and prob < tolerance, f"State mismatch {case['id']} frame {j}")
        require(abs(sum(frame['probabilities'])-1) < tolerance, 'Unnormalized frame')
        max_amp = max(max_amp, amp); max_prob = max(max_prob, prob)
    probabilities = Statevector.from_instruction(qc).probabilities()
    require(np.max(np.abs(probabilities-case['probabilities'])) < tolerance, 'Controller distribution mismatch')
    require(sum(probabilities[i] for i in range(2**n) if not allowed(case['problem'], i)) < tolerance, 'Locked-state leakage in ideal circuit')
    return {'id':case['id'], 'qubits':n, 'frames':len(case['frames']), 'maximumAmplitudeError':max_amp,
            'maximumProbabilityError':max_prob, 'exactProbabilities':probabilities.tolist(),
            'logicalOperations':dict(qc.count_ops()), 'logicalDepth':qc.depth()}


def analysis(case, counts):
    n = case['problem']['n']; total = sum(counts.values())
    require(total > 0 and all(type(v) is int and v >= 0 for v in counts.values()), 'Invalid counts')
    require(all(len(k) == n and set(k) <= {'0','1'} for k in counts), 'Invalid logical bitstrings')
    observed = np.array([counts.get(format(i, f'0{n}b'), 0)/total for i in range(2**n)])
    ideal = np.array(case['probabilities']); costs = np.array(case['costs'])
    indices = [i for i in range(2**n) if allowed(case['problem'], i)]
    minimum = min(costs[i] for i in indices)
    best = [i for i in indices if abs(costs[i]-minimum) < 1e-9]
    expected_sd = math.sqrt(max(0., float(np.dot(ideal, costs**2)-np.dot(ideal,costs)**2))/total)
    best_frequency = float(sum(observed[i] for i in best))
    z=1.959963984540054;denominator=1+z*z/total
    center=(best_frequency+z*z/(2*total))/denominator
    half=z*math.sqrt(best_frequency*(1-best_frequency)/total+z*z/(4*total*total))/denominator
    null_probabilities=np.maximum(ideal,0);null_probabilities=null_probabilities/null_probabilities.sum()
    null_counts=np.random.default_rng(20261110).multinomial(total,null_probabilities,size=4096)
    null_distances=np.abs(null_counts/total-null_probabilities).sum(axis=1)/2
    def wilson(frequency):
        middle=(frequency+z*z/(2*total))/denominator
        radius=z*math.sqrt(frequency*(1-frequency)/total+z*z/(4*total*total))/denominator
        return [max(0.,middle-radius),min(1.,middle+radius)]
    observed_mean=float(np.dot(observed,costs))
    # Bound covers all raw readouts, including locked-bit violations. It is
    # sampling uncertainty, not an estimate of systematic device error.
    cost_half=(float(np.max(costs))-float(np.min(costs)))*math.sqrt(math.log(40)/(2*total))
    return {'shots':total, 'counts':counts, 'frequencies':observed.tolist(),
            'frequency95WilsonIntervals':[wilson(float(p)) for p in observed],
            'totalVariationDistanceFromIdeal':float(np.abs(observed-ideal).sum()/2),
            'idealExpectedCost':float(np.dot(ideal,costs)), 'observedMeanCost':observed_mean,
            'observedMeanCost95HoeffdingInterval':[max(float(np.min(costs)),observed_mean-cost_half),min(float(np.max(costs)),observed_mean+cost_half)],
            'bestAllowedPlans':[format(i,f'0{n}b') for i in best],
            'exactBestAllowedCost':float(minimum),
            'uniformAllowedExpectedCost':float(np.mean(costs[indices])),
            'observedCostGapFromExact':observed_mean-float(minimum),
            'idealCostMeanStandardErrorAtTheseShots':expected_sd,
            'idealBestAllowedPlanProbability':float(sum(ideal[i] for i in best)),
            'observedBestAllowedPlanFrequency':float(sum(observed[i] for i in best)),
            'bestAllowedFrequency95WilsonInterval':[max(0.,center-half),min(1.,center+half)],
            'idealSamplingOnlyTVD95Reference':float(np.quantile(null_distances,.95)),
            'uncertaintyMethod':'Marginal Wilson 95% intervals for each readout and best-plan frequency (not simultaneous); bounded-cost Hoeffding 95% interval for the mean; fixed-seed 4096 multinomial simulations give a descriptive sampling-only 95th-percentile TVD reference. Intervals assume independent shots with a stable distribution, exclude device drift/systematic uncertainty, and are not hardware-success thresholds or evidence of traffic advantage.',
            'invalidLockedPlanFrequency':float(sum(observed[i] for i in range(2**n) if i not in indices)),
            'interpretation':'Frequency differences include finite sampling; hardware additionally includes device error. Surrogate cost is not measured traffic delay. Invalid hardware readouts are reported, never silently discarded.'}
