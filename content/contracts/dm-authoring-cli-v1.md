# Synthetic DM authoring CLI v1 — local-only

The existing `validateDmAuthoringPreflight` is an importable author-side validator. This wrapper lets an author check **one synthetic, spoiler-free JSON sheet** from stdin without writing a custom JavaScript runner:

```sh
node scripts/check-dm-authoring-json.mjs < synthetic-authoring-sheet.json
```

The JSON object must contain the existing nine fields: `flow`, `guards`, `bridge`, `chapter`, `alignment`, `actions`, `worldGraph`, `links`, `proof`. The wrapper additionally requires `synthetic:true` on `flow`, `guards`, `bridge`, `alignment`, `proof`, and both `links`, and `actions.scope` equal to `synthetic-mechanics-only`. It accepts no command-line arguments and limits stdin to 1 MiB. Malformed JSON, invalid UTF-8, missing synthetic markers and oversized input fail closed.

The CLI prints **one JSON line only**: success is `{ "ok": true, "validatedRoutes": 2, "validatedLinks": 2 }`; failure is `{ "ok": false, "code": "<fixed-code>" }` and a nonzero exit status. It never prints input, file paths, trace IDs, exception messages, stack traces, or unrecognized validator diagnostics. The accepted underlying codes are `input_invalid`, `event_guard_invalid`, `learning_payoff_invalid`, `route_crosswalk_invalid`, `invalid_input`; wrapper-only codes are `arguments_invalid`, `input_too_large`, `input_unreadable`, `json_invalid`, `synthetic_required`, `preflight_failed`.

Run the CLI protocol tests with `node --test test/dm-authoring-cli.test.mjs`. They cover negative input and output hygiene; they are **not** a substitute for the existing real-validator integration tests (`test/dm-authoring-preflight.integration.test.mjs`) or full repository CI.

This command is a local synthetic authoring convenience, **not** a private-story storage mechanism, content approval, runtime gate, production integration, deployment or import authorization. Never pipe official world secrets into it or commit such JSON. The first official world remains **DO-NOT-IMPORT** until private review, real Worker/D1/model verification and Catherine's explicit authorization.

The real-validator integration suite (`node --test test/dm-authoring-preflight.integration.test.mjs`) now also contains five **process-level CLI smoke tests** using the existing synthetic two-route fixture: valid input, reversed route order, guard mismatch, second-route learning mismatch and missing synthetic marker. Unlike protocol tests with a stub, these invoke the actual CLI and dependency chain. They still do not exercise Worker/D1, model output, private content or production import. Passing the author preflight is never an approval to import.
