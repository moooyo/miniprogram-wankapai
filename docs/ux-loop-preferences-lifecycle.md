# Preferences lifecycle correction

## Finding

A pending Preferences save could finish after the user confirmed leaving that page and started editing another Preferences instance. The old success callback unconditionally disabled the active page's leave warning. Old load and failure callbacks could also write obsolete state after unload, and overlapping loads had no request ordering.

The correction adds page disposal, visibility and load-generation guards. A save may finish updating a still-mounted hidden page, but only the current visible page may alter its native leave warning. Returning to that page restores the warning from its own dirty state. Unloaded pages receive no state or global warning effects from pending callbacks. Only the latest load can publish data, errors or loading completion.

The browser workbench's separate unsaved-refresh confirmation is documented in the complete round 11 record. This native controller correction does not replace that navigation decision.

## Verification

`tests/preferences-lifecycle.test.ts` executes the actual TypeScript controller with mocked transport and native page effects. Six regression scenarios cover departed save success and failure, overlapping successful and failed reads, hidden-page completion and return, and a read completing after unload.

Before changing the controller, all six scenarios failed on `test-env`; the log is `/tmp/wankapai-preferences-before.log`. After the correction, all six passed and the complete TypeScript check passed:

```text
cd /tmp/wankapai-ux-loop-20260922
node --import tsx --test tests/preferences-lifecycle.test.ts
npm run typecheck
```

The browser's independent frozen-before reproduction also confirmed that an old save removed the new dirty page's warning and allowed immediate departure. Its JSON and screenshots are under `.qa-native/prototype/candidate-r9/r11-preferences-*`. Final corrected browser evidence belongs to the consolidated candidate report. No local test, build or runtime probe was executed.

No real account settings, subscription messages, cloud deployment or publication are used by these checks.
