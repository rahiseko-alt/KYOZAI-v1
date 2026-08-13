# KYOZAI Revise benchmark fixture

`benchmark.json` is the Phase 0 regression set for turning a natural-language revision request into a typed operation, a bounded scope, and validation assertions. It contains 50 cases across five categories, with no personal information, credentials, or source documents.

## Scoring

Score each case as pass only when the selected `operation` and `scope` match the fixture, every `expected_assertions` item passes, and every `must_preserve` invariant remains unchanged. `strict` requires exact preservation outside the declared change; `bounded` allows only the declared target content to be regenerated while all listed invariants still pass. Any out-of-scope mutation, unresolved source reference, or failed invariant is a failure.
