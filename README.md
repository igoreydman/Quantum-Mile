# Quantum Mile

Quantum Mile is an interactive experiment in traffic signal coordination. In a modeled Coral Gables network, one approach’s green can help its queue while filling a downstream block. The playground compares fixed cycling, exact classical search and a quantum sampler. The code and evidence here reproduce one frozen six-crossing decision independently in Qiskit.

## Reproduce the recorded decision

Use Python 3.14 (verified locally with 3.14.6). From this directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-lock.txt jupyterlab
jupyter lab Quantum-Mile-Submission.ipynb
```

Open **Quantum-Mile-Submission.ipynb** and select **Run All**. The notebook checks the fixture, enumerates the allowed plans, reconstructs the circuit, and compares the ideal result with saved IBM counts. It requires no IBM account and does not submit a job. The submitted notebook already contains outputs.

- `fixtures.json`, `quantum_core.py`, `verification.json`: frozen traffic decision, Qiskit construction and ideal verification.
- `hardware.json`, `hardware/`: IBM `ibm_fez` job `dbpr4klt7fqc7389seeg`, raw counts, compiled QPY and logical QASM.
- `comparisons.json`: eight separate, matched, one-minute traffic simulation scenarios with a declared seed and the three controllers.
- `source/` and `DATA-SOURCES.md`: relevant model code, assumptions and data provenance.

The minimum-score plan `001101` appeared in 886 of 2,048 shots (43.26%); the ideal circuit predicted 51.80%. This measures the distribution for one frozen decision. Across the separate traffic scenarios the ideal quantum sampler had lower mean modeled delay than exact classical search in two of eight cases. The results do not establish field performance, a scaling advantage, or a speedup.
