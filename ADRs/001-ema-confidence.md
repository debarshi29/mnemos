# ADR 001: EMA for confidence updates on re-observation

**Status:** Accepted  
**Date:** 2026-06-19

## Context

When the system observes a fact it has already stored, it needs to update the stored confidence score. The naive options are:
- Replace: always use the new observation's confidence (1.0) — forgets history
- Average: arithmetic mean — treats all observations equally regardless of age
- Exponential Moving Average (EMA): weights the new observation more heavily, retains a memory of prior confidence

## Decision

Use EMA with weights **0.7 (new) / 0.3 (prior)**:

```
new_confidence = 0.7 * new_evidence + 0.3 * prior_confidence
```

Where `new_evidence` = 1.0 (a direct re-observation is treated as full confidence).

## Rationale

- EMA is the standard for streaming signal updates — used in finance, sensor fusion, and online learning systems for the same reason: it gives the system a short memory of the past without keeping the full history.
- 0.7/0.3 means a fact confirmed twice will have confidence ≥ 0.79 (0.7 + 0.3*0.7 + …). Three confirmations → ~0.937. This ramp-up feels right: trust increases with repetition but never hits 1.0 from old data.
- The 0.3 prior weight prevents thrashing — a contradictory one-off observation can't immediately nuke a well-established fact.

## Consequences

- Confidence is never permanently pegged at 1.0 by history alone (always slightly decayed by the 0.3 term), which pairs well with the time-decay retrieval score.
- If the weights need tuning they are a single `config.yaml` entry (`memory.ema_new_weight`).
