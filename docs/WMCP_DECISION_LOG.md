# WMCP Decision Log

## 2026-05-09 — Review/audit redaction boundary secret-pattern coverage

Decision: treat the review queue summary/detail, project activity feed, and audit detail endpoints as redaction boundaries. These boundaries must redact realistic synthetic secret payloads by value pattern, not only key names or generic `Bearer` substrings.

Pattern mapping covered by automated tests:

| Pattern class                | Synthetic coverage                  | Boundary evidence                                                                                   |
| ---------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| Loreum raw API key           | `lrm_...` raw key shape             | Unit redaction test; review queue list/detail; audit detail metadata                                |
| OpenAI-style project API key | `sk-proj-...` shape                 | Unit redaction test; review queue list/detail; activity target/summary; audit detail target/summary |
| GitHub fine-grained PAT      | `github_pat_...` shape              | Unit redaction test; review queue list/detail; audit detail `newData.authorization`                 |
| JWT access token             | `eyJ...<payload>.<signature>` shape | Unit redaction test; review queue hidden body assertion; audit detail capability context            |
| US SSN-style PII             | `NNN-NN-NNNN` shape                 | Unit redaction test; review queue list/detail; audit detail metadata                                |

Cross-project API-key negative coverage: `apps/api/src/entities/entities.spec.ts` verifies an API key scoped to a different project is rejected before reading project activity, audit detail, review queue list, or review detail.

Evidence captured during WMCP-REPAIRUI-07:

- RED: `pnpm --filter api exec vitest run src/audit/audit-redaction.spec.ts --reporter=verbose` failed for OpenAI-style API key, GitHub PAT, JWT, and SSN value-pattern cases before the regex expansion.
- GREEN targeted: `pnpm --filter api exec vitest run src/audit/audit-redaction.spec.ts --reporter=verbose` passed 7 tests.
- Boundary regression: `pnpm --filter api exec vitest run src/entities/entities.spec.ts --reporter=verbose -t "redacts realistic|returns redacted audit details|rejects API keys scoped"` passed 3 targeted integration tests.
- Full focused regression: `pnpm --filter api exec vitest run src/audit/audit-redaction.spec.ts src/entities/entities.spec.ts --reporter=verbose` passed 37 tests across 2 files.
- Type contract: `pnpm --filter api check-types` passed.

Response-shape stability note: existing response keys remain unchanged for frontend consumers. The added assertions only verify redacted values inside the existing `displaySummary`, `proposed.summary`, activity `targetDisplay`/`summary`, and audit detail `newData`, `metadata`, and `capabilityContext` fields.
