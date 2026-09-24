# Management UX refinement

This refinement reduces reading and navigation effort in personal management pages while preserving the existing business behavior.

## 1. Reminder preferences

The save action now stays in a bottom dock with a short status message. The page explicitly explains that changes require saving. Detailed WeChat subscription instructions are available through an expandable help section, while the need for separate subscription authorization remains visible.

The help toggle only changes presentation state. Preference payloads, explicit saving, dirty-state tracking, leave warnings, and request lifecycle guards remain unchanged. Bottom padding reserves space for the dock and the device safe area.

## 2. Card issuer presentation

A bank with exactly one issuer shows that issuer as supporting text below the bank selection. Banks with multiple issuers retain the issuer picker. An issuer validation error restores the full field so the error and its anchor remain visible.

The selected issuer, card payload, immutable editing rules, billing setup, recovery intent, and validation rules are unchanged. This removes a redundant input without inferring a different issuer.

## 3. Personal navigation

Participation history, submission status, and reminder settings appear together at the start of the personal page. Held benefits and lounge lookup remain available as two compact tools. Sharing, privacy, moderation, and the explicit demo-role controls retain their existing destinations and authorization conditions.

Submission attention is still qualitative. The existing one-item status queries are not presented as total submission counts.

## 4. Activity lead copy

The introduction states the minimum contribution clearly: a bank, an activity name, and one source. The source section states that any one source is sufficient and that multiple sources can be supplied together.

All source inputs remain visible. Existing source values, local draft timing, validation, submission behavior, and the full-rules entry remain unchanged. No new source-selection step was added.

## Verification

Local tests, builds, and runtime probes were not run. Remote verification is coordinated by the main task through `ssh test-env`, including the relevant business tests, complete build and type check, and visual checks at narrow and standard mobile widths.
