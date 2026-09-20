# Project instructions

- Keep the accepted product scope, including moderated public submissions. Category approval is a deployment prerequisite, not an instruction to remove the feature.
- User-facing interface text is Chinese. Source identifiers, code comments, and documentation are English.
- Do not run tests, build verification, runtime probes, or validation suites on the local Windows machine without explicit user authorization in the current task. Use `ssh test-env` for verification.
- Do not deploy cloud functions, send real WeChat notifications, upload an experience version, or publish without the required real account configuration and authorization.
- Keep demo mode explicit. Never use the demo role selector as production authorization.
- Preserve transaction, ownership, receipt-date, period-snapshot, and idempotency guarantees. Do not weaken assertions merely to make tests pass.
- Run the relevant business tests and the complete build/type check after changes. Actual device and cloud integration checks are distinct from mocked tests.
- Build from source with `scripts/build.mjs`; do not maintain a divergent hand-edited `dist/` implementation.
