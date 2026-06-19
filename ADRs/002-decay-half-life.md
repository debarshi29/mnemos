# ADR 002: 30-day half-life for retrieval decay

**Status:** Accepted  
**Date:** 2026-06-19

## Context

Facts that haven't been seen recently should be ranked lower at retrieval time, reflecting that stale information is less likely to be currently relevant. The question is how aggressively to penalize age.

## Decision

Use continuous exponential decay with a **30-day half-life**:

```
score = similarity * exp(-lambda * age_days)
lambda = ln(2) / 30  ≈ 0.0231
```

At age 0:  score = similarity (no penalty)  
At age 30: score = 0.5 * similarity  
At age 90: score = 0.125 * similarity  

## Rationale

- 30 days covers a natural learning cycle. A fact from last month is still plausibly relevant; a fact from six months ago should need to fight harder against a fresh observation.
- 7 days (aggressive) would penalize users who take a week off. 90 days (gentle) would barely differentiate age at all within a semester.
- The continuous form is mathematically cleaner than a step function and avoids the "cliff" problem where a fact's score drops suddenly at a threshold.
- Lambda is derived from half-life so changing the config value (`memory.decay_half_life_days`) recalculates lambda automatically — no magic constants.

## Consequences

- Very old facts (>6 months) effectively drop out of retrieval unless they have very high semantic similarity. This is the intended behavior.
- Users who want more aggressive or gentler decay just change one config line.
