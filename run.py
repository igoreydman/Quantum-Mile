#!/usr/bin/env python3
"""Reproduce Quantum Mile, sample locally, or prepare one explicit IBM job.
No command submits to hardware except `submit --submit-to-ibm`.
"""
import argparse
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import sys

import numpy as np
from qiskit import qasm3, qpy, transpile
from qiskit.quantum_info import Statevector
from qiskit.transpiler import generate_preset_pass_manager
from qiskit_aer import AerSimulator

from quantum_core import analysis, circuit, dump, require, sha256, verify, versions

HERE = Path(__file__).resolve().parent


def now():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    return json.loads(Path(path).read_text())


def instance_for(args):
    return args.instance or os.environ.get('IBM_QUANTUM_INSTANCE') or os.environ.get('QISKIT_IBM_INSTANCE', '')


def credential_status():
    # SDK saved_accounts() creates an empty store if none exists. Merely checking
    # readiness must not write a credential file or expose any stored values.
    return {'savedAccountFilePresent':(Path.home()/'.qiskit/qiskit-ibm.json').is_file(),
            'tokenEnvironmentPresent':bool(os.environ.get('IBM_QUANTUM_TOKEN') or os.environ.get('QISKIT_IBM_TOKEN')),
            'instanceEnvironmentPresent':bool(os.environ.get('IBM_QUANTUM_INSTANCE') or os.environ.get('QISKIT_IBM_INSTANCE'))}


def require_real_backend(backend):
    require(not backend.name.lower().startswith(('fake','aer','mock','simulator','ibmq_qasm_simulator'))
            and not backend.configuration().simulator, 'Select a real QPU, not a simulator or server dry-run mock')


def validate_saved_plan(directory, fixture_hash, data, require_environment=False):
    plan=read(directory/'plan.json')
    require(plan['fixtureSha256']==fixture_hash and plan['sourceSha256']==data['sourceSha256'], 'Plan is stale')
    if require_environment:
        require(plan['versions']==versions(), 'Plan environment changed')
        require(plan.get('codeSha256')==workflow_hashes(), 'Runner or preflight code changed; prepare a fresh plan')
    require(sha256(directory/'compiled.qpy')==plan['compiledSha256'], 'Compiled circuit changed')
    require(sha256(directory/'preflight.json')==plan['preflightSha256'], 'Preflight record changed')
    preflight=read(directory/'preflight.json')
    require(preflight.get('allPassed') is True and preflight.get('measurementMappingChecked') is True and all(preflight.get(key)==plan[key] for key in
        ['compiledSha256','fixtureSha256','case','backend','physicalQubits']),
        'This exact compiled circuit needs a passing local preflight')
    require(type(plan['shots']) is int and 1<=plan['shots']<=4096 and
            type(plan['maxExecutionSeconds']) is int and 1<=plan['maxExecutionSeconds']<=300, 'Invalid bounded plan')
    getcase(data,plan['case'])
    return plan


def validate_receipt(plan, receipt):
    require(isinstance(receipt.get('jobId'),str) and bool(receipt['jobId']), 'No job ID recorded; inspect IBM Workloads manually')
    require(all(receipt.get(key)==plan[key] for key in ['fixtureSha256','case','backend','shots']), 'Submission receipt does not match the frozen plan')


def workflow_hashes():
    return {name:sha256(HERE/name) for name in ['run.py','quantum_core.py','preflight.py']}


def source_root(fixtures):
    # Shareable bundle has source/; repository execution has parent app sources.
    for candidate in [fixtures.parent/'source', HERE/'source', HERE.parent]:
        if (candidate/'neighborhood-controller.js').is_file(): return candidate
    raise ValueError('Cannot find the app source snapshot')


def dataset(path):
    data = read(path)
    require(data['schema'] == 1, 'Unknown fixture schema')
    root = source_root(path)
    for name, expected in data['sourceSha256'].items():
        require(Path(name).name == name, 'Invalid source path')
        require(sha256(root/name) == expected, 'Stale fixtures: '+name+' changed. Rebuild first.')
    return data


def getcase(data, case_id):
    choices = [c for c in data['cases'] if c['id'] == case_id]
    require(len(choices) == 1, 'Unknown case: '+case_id)
    return choices[0]


def save_circuits(folder, qc, isa=None):
    folder.mkdir(parents=True, exist_ok=True)
    (folder/'logical-circuit.txt').write_text(str(qc.draw(output='text'))+'\n')
    (folder/'logical-circuit.qasm').write_text(qasm3.dumps(qc))
    if isa is not None:
        (folder/'compiled-circuit.txt').write_text(str(isa.draw(output='text', idle_wires=False))+'\n')
        with (folder/'compiled.qpy').open('wb') as f: qpy.dump(isa, f)


def traffic_comparison(data, case, counts):
    if case['context']['kind'] != 'street':
        return {'scope':'One frozen network decision only. Replacing it changes later traffic inputs; a frozen count histogram is not a whole-run traffic result.'}
    replay = next(r for r in data['replays'] if r['hour'] == case['context']['hour'])
    total = sum(counts.values()); weights = [counts.get(format(i, '02b'), 0)/total for i in range(4)]
    def weighted(probabilities):
        return {key:sum(probabilities[i]*replay['outcomes'][i][key] for i in range(4))
                for key in ['addedVehicleSeconds','addedSecondsPerRequestedCar','finished','unfinished']}
    return {'scope':'Expected 30-second modeled outcome over the four readouts at the same prepared reference. Weighted completed-car counts may be fractional. No live hardware control or field measurement.',
            'idealQuantumWeightedOutcome':weighted(case['probabilities']),
            'sampleWeightedOutcome':weighted(weights),
            'classicalBestHeldPlan':replay['outcomes'][replay['classicalBestIndex']],
            'fixedCycle':replay['fixedCycle']}


def verify_all(args):
    data = dataset(args.fixtures)
    checks = [verify(c) for c in data['cases']]
    # Actual measured Qiskit Aer circuits, rather than NumPy-only draws.
    backend = AerSimulator(method='statevector', max_parallel_threads=1)
    circuits = [circuit(c, measured=True) for c in data['cases']]
    compiled = transpile(circuits, backend, seed_transpiler=20261110, optimization_level=1)
    result = backend.run(compiled, shots=args.shots, seed_simulator=20261110).result()
    for i, (case, check) in enumerate(zip(data['cases'], checks)):
        counts = {k:int(v) for k,v in result.get_counts(i).items()}
        require(sum(counts.values()) == args.shots, 'Wrong shot count')
        check['idealMeasuredSimulation'] = analysis(case, counts)
        require(check['idealMeasuredSimulation']['invalidLockedPlanFrequency'] == 0, 'Ideal lock violation')
        check['compiledOperations'] = dict(compiled[i].count_ops())
    report = {'createdAt':now(), 'allPassed':True, 'fixtureSha256':sha256(args.fixtures),
              'sourceSha256':data['sourceSha256'], 'versions':versions(), 'cases':len(checks),
              'frames':sum(c['frames'] for c in checks), 'shotsPerCase':args.shots,
              'maximumAmplitudeError':max(c['maximumAmplitudeError'] for c in checks),
              'maximumProbabilityError':max(c['maximumProbabilityError'] for c in checks),
              'checks':checks, 'hardwareExecuted':False,
              'limits':data['limits']+['Finite-shot histograms need not equal ideal probabilities. Statevector equality is the arithmetic check.']}
    dump(args.output, report)
    print(json.dumps({k:v for k,v in report.items() if k not in ['checks','sourceSha256','limits']}))


def local_backend(name):
    if name == 'ideal': return AerSimulator(method='statevector', max_parallel_threads=1)
    # 16-qubit archived device snapshot supports both current logical sizes.
    from qiskit_ibm_runtime.fake_provider import FakeGuadalupeV2
    return FakeGuadalupeV2()


def sampler(backend, seed=None, max_seconds=None):
    from qiskit_ibm_runtime.executor_sampler import Sampler
    options = {'default_shots':1024, 'twirling':{'enable_gates':False,'enable_measure':False}}
    if seed is not None: options['simulator'] = {'seed_simulator':seed}
    if max_seconds is not None: options['max_execution_time'] = max_seconds
    return Sampler(mode=backend, options=options)


def sample(args):
    data = dataset(args.fixtures); case = getcase(data,args.case); verify(case)
    require(not args.output.exists(), 'Output exists; choose a fresh directory')
    backend = local_backend(args.backend)
    qc = circuit(case, measured=True)
    isa = generate_preset_pass_manager(backend=backend,optimization_level=1,seed_transpiler=20261110).run(qc)
    save_circuits(args.output,qc,isa)
    result = sampler(backend, seed=20261110).run([isa], shots=args.shots).result()
    counts = {k:int(v) for k,v in result[0].data.meas.get_counts().items()}
    require(sum(counts.values()) == args.shots, 'Wrong shot count')
    report = {'createdAt':now(), 'mode':'local-'+args.backend, 'backend':backend.name,
              'hardwareExecuted':False, 'fixtureSha256':sha256(args.fixtures), 'case':case['id'],
              'versions':versions(), 'compiledDepth':isa.depth(), 'compiledOperations':dict(isa.count_ops()),
              'analysis':analysis(case,counts), 'trafficComparison':traffic_comparison(data,case,counts),
              'limit':'Fake device is an archived noise model, not a prediction or measurement of a current IBM device.'}
    dump(args.output/'result.json',report)
    print(json.dumps(report))


def service(args):
    from qiskit_ibm_runtime import QiskitRuntimeService
    instance = instance_for(args)
    require(bool(instance), 'Specify --instance or IBM_QUANTUM_INSTANCE to select the allocation deliberately.')
    token = os.environ.get('IBM_QUANTUM_TOKEN') or os.environ.get('QISKIT_IBM_TOKEN')
    # Saved credentials are handled by the official client, never printed/exported.
    kwargs = {'instance':instance, 'channel':'ibm_quantum_platform'}
    if not token:
        require(credential_status()['savedAccountFilePresent'], 'IBM credentials are not configured. Use local account setup before preparing a device.')
        accounts = QiskitRuntimeService.saved_accounts()
        if 'quantum-mile' in accounts: kwargs['name'] = 'quantum-mile'
    if token: kwargs['token'] = token
    return QiskitRuntimeService(**kwargs)


def ready(args, data):
    report = read(args.verification)
    require(report.get('allPassed') is True and report['fixtureSha256'] == sha256(args.fixtures), 'Run verify on these exact fixtures first')
    require(report['sourceSha256'] == data['sourceSha256'], 'Verification source mismatch')
    require(report['versions'] == versions(), 'Environment changed since verification; rerun verify')


def prepare(args):
    data = dataset(args.fixtures); ready(args,data); case=getcase(data,args.case); verify(case)
    require(not args.output.exists(), 'Plan directory exists; choose a fresh directory')
    backend = service(args).backend(args.backend)
    require_real_backend(backend)
    require(backend.status().operational, 'Select an operational real QPU')
    qc = circuit(case, measured=True)
    isa = generate_preset_pass_manager(backend=backend,optimization_level=1,seed_transpiler=20261110).run(qc)
    save_circuits(args.output,qc,isa)
    from preflight import check_compiled
    preflight = check_compiled(case,isa,sampler)
    preflight.update({'case':case['id'],'fixtureSha256':sha256(args.fixtures),
                      'compiledSha256':sha256(args.output/'compiled.qpy'),'backend':backend.name})
    dump(args.output/'preflight.json',preflight)
    plan = {'createdAt':now(), 'hardwareExecuted':False, 'case':case['id'],
            'fixtureSha256':sha256(args.fixtures), 'sourceSha256':data['sourceSha256'], 'versions':versions(),
            'codeSha256':workflow_hashes(),
            'backend':backend.name, 'shots':args.shots, 'maxExecutionSeconds':args.max_seconds,
            'samplerOptions':sampler(backend,max_seconds=args.max_seconds).options.model_dump(mode='json'),
            'compiledSha256':sha256(args.output/'compiled.qpy'), 'compiledDepth':isa.depth(),
            'preflightSha256':sha256(args.output/'preflight.json'),
            'compiledOperations':dict(isa.count_ops()), 'physicalQubits':list(isa.layout.final_index_layout()),
            'instanceSha256':__import__('hashlib').sha256(instance_for(args).encode()).hexdigest(),
            'scope':'One frozen decision, one job, no optimization loop or automatic retry. maxExecutionSeconds is a service limit, not a guaranteed billing estimate. Inspect account usage separately.'}
    dump(args.output/'plan.json',plan)
    print(json.dumps(plan))


def submit(args):
    require(args.submit_to_ibm, 'Hardware requires --submit-to-ibm after reviewing plan.json and allocation')
    data=dataset(args.fixtures); ready(args,data)
    plan=validate_saved_plan(args.plan,sha256(args.fixtures),data,require_environment=True)
    instance=instance_for(args)
    require(__import__('hashlib').sha256(instance.encode()).hexdigest() == plan['instanceSha256'], 'Use the same instance as preparation')
    marker=args.plan/'submission.json'
    require(not marker.exists(), 'Submission already attempted; inspect the saved job before any retry')
    backend=service(args).backend(plan['backend'])
    require_real_backend(backend)
    require(backend.name==plan['backend'], 'Resolved QPU differs from the frozen target')
    require(backend.status().operational, 'Selected QPU is not operational; no job submitted')
    with (args.plan/'compiled.qpy').open('rb') as f: qc=qpy.load(f)[0]
    executor=sampler(backend,max_seconds=plan['maxExecutionSeconds'])
    require(executor.options.model_dump(mode='json')==plan['samplerOptions'], 'Sampler options changed since preparation')
    # Exclusive creation occurs BEFORE contacting IBM. A network error after a
    # request can mean an accepted job; never retry blindly or duplicate a job.
    with marker.open('x') as f:
        json.dump({'createdAt':now(),'status':'submission-attempt-started','backend':plan['backend'],
                   'case':plan['case'],'warning':'If no job ID is saved, inspect IBM Workloads before any further submission.'},f,indent=2)
    job=executor.run([qc],shots=plan['shots'],dry_run=False)
    receipt={'createdAt':now(),'status':'submitted','jobId':job.job_id(),'backend':plan['backend'],
             'case':plan['case'],'fixtureSha256':plan['fixtureSha256'],'shots':plan['shots']}
    dump(marker,receipt)
    print(json.dumps(receipt))


def fetch(args):
    data=dataset(args.fixtures); plan=validate_saved_plan(args.plan,sha256(args.fixtures),data)
    receipt=read(args.plan/'submission.json');validate_receipt(plan,receipt)
    instance=instance_for(args)
    require(__import__('hashlib').sha256(instance.encode()).hexdigest() == plan['instanceSha256'], 'Instance mismatch')
    job=service(args).job(receipt['jobId']); status=str(job.status())
    require(job.job_id()==receipt['jobId'], 'Retrieved job ID mismatch')
    if status not in ['DONE','JobStatus.DONE']:
        print(json.dumps({'jobId':receipt['jobId'],'status':status,'resultSaved':False}));return
    backend=job.backend();require(backend is not None, 'Completed job has no verifiable backend')
    require_real_backend(backend)
    require(backend.name==plan['backend'], 'Retrieved job backend differs from prepared target')
    result=job.result();case=getcase(data,plan['case'])
    require(len(result)==1, 'Expected exactly one circuit result')
    counts={k:int(v) for k,v in result[0].data.meas.get_counts().items()}
    computed=analysis(case,counts)
    require(computed['shots']==plan['shots'], 'Returned shot count differs from the frozen plan')
    report={'createdAt':now(),'hardwareExecuted':True,'mode':'ibm-hardware',**receipt,
            'status':'DONE','versions':plan['versions'],'retrievalVersions':versions(),
            'jobIdentityVerified':True,'verifiedBackend':backend.name,'dryRun':False,
            'compiledSha256':plan['compiledSha256'],'preflightSha256':plan['preflightSha256'],
            'analysis':computed,
            'trafficComparison':traffic_comparison(data,case,counts),
            'metadata':json.loads(json.dumps(result[0].metadata,default=str)),
            'jobMetrics':json.loads(json.dumps(job.metrics(),default=str))}
    dump(args.plan/'result.json',report)
    print(json.dumps({k:report[k] for k in ['jobId','status','backend','case','shots','hardwareExecuted','jobIdentityVerified']}))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    for command in ['verify','sample','prepare','submit','fetch']:
        p=sub.add_parser(command);p.add_argument('--fixtures',type=Path,default=HERE/'fixtures.json')
        if command in ['verify','sample','prepare']:
            p.add_argument('--shots',type=int,default=1024)
        if command in ['sample','prepare']:
            p.add_argument('--case',default='street-h10-full');p.add_argument('--output',type=Path,required=True)
        if command=='verify':p.add_argument('--output',type=Path,default=HERE/'verification.json')
        if command=='sample':p.add_argument('--backend',choices=['ideal','fake'],default='ideal')
        if command in ['prepare','submit']:
            p.add_argument('--verification',type=Path,default=HERE/'verification.json')
        if command in ['prepare','submit','fetch']:p.add_argument('--instance')
        if command=='prepare':
            p.add_argument('--backend',required=True);p.add_argument('--max-seconds',type=int,default=60)
        if command in ['submit','fetch']:p.add_argument('--plan',type=Path,required=True)
        if command=='submit':p.add_argument('--submit-to-ibm',action='store_true')
    args=parser.parse_args()
    if hasattr(args,'shots'):require(1 <= args.shots <= 4096, 'Use 1–4096 shots for this bounded experiment')
    if hasattr(args,'max_seconds'):require(1 <= args.max_seconds <= 300, 'Use a 1–300 second execution cap')
    {'verify':verify_all,'sample':sample,'prepare':prepare,'submit':submit,'fetch':fetch}[args.command](args)


if __name__=='__main__':
    main()
