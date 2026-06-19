# ADR 003: Keep-both-flagged on true contradiction tie

**Status:** Accepted  
**Date:** 2026-06-19

## Context

When two facts contradict each other and have equal confidence AND equal recency (a true tie), the system must decide what to do. Options:
1. Keep the newer one (arbitrary — both are equally recent)
2. Keep the older one (arbitrary — both have equal confidence)
3. Delete both (destroys potentially valid information)
4. Keep both, flag for user review

## Decision

**Keep both, flag both** (`flagged = True` on both facts). Neither is marked superseded. The Memory Inspector UI surfaces flagged facts with a visual indicator.

## Rationale

- A true tie means the system genuinely doesn't know which is correct. Picking one arbitrarily would be silently wrong — the user deserves to know.
- Deleting both would be information loss with no audit trail.
- "Show the user" is the right call for a system whose thesis is *visible, inspectable memory internals*. The contradiction IS the interesting output, not an error to hide.
- The provenance chain for both facts is preserved, so the user can trace each back to its source episodes and decide.

## Consequences

- The Memory Inspector must visually distinguish flagged facts from normal ones.
- Flagged facts participate in retrieval normally (they're not superseded) — if one is wrong, the user resolves it manually or a future consolidation run resolves it once more evidence arrives.
- The consolidation log records the tie as a `contradiction_resolved` event with both fact_ids for auditability.
