# KYOZAI Revise Phase 1 fixture

This fixture is the executable Phase 1 acceptance set. It contains exactly 50
cases: 20 permitted text changes, 20 safe rejections, and 10 version-history
flows. The Vitest suite applies every planned change through the production
executor and version-history functions; it does not emulate candidate creation.
