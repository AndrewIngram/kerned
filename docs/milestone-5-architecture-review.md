# Milestone 5 architecture review

Implementation: `c25f91e..8e5cd7b`. The independent judge used the requested
`improve-codebase-architecture` skill and shared codebase-design vocabulary.
Scope: configurable presentation, semantic fonts, native/canvas typography,
paint-only colors, live replacement and the corresponding React adapter.

## Accepted finding

**P2: validate fixed colors before installing a theme.** The theme module accepted
any nonempty string; the mounted view then installed it before paint normalization
rejected invalid CSS. Error handling destroyed the working attachment. This made
a configuration mistake inconsistent with early numeric theme validation.

The fix keeps browser parsing behind the existing color adapter and supplies it
to theme compilation. Fixed colors are validated before compilation returns,
so neither the presentation compiler nor view configuration is replaced on
failure. Parsing and normalization share one implementation; tables, canvas
painting and React do not need separate guards.

A public-mount regression failed in all three browsers before the fix, then passed
with the fix. It checks invalid and context-dependent colors while also attempting
to change zoom, spacing and leading. The previous geometry, selection, focus,
canvas/input identities, generation and shaping counts survive. Subsequent typing
uses the previous theme. A second regression rejects invalid initial colors before
DOM or asset ownership is acquired and verifies that a valid mount can follow.

The judge reviewed the remedy and confirmed resolution without further findings.
Arbitrary presentation callback failures remain outside this fixed-configuration
finding; the remedy does not attempt transactional rollback of extension code.

## Architecture assessment

The judge found the following seams coherent:

- Semantic font selection hides numeric face identities and native ownership.
- `setFonts` provides depth through cancellation, loading, installation, glyph
  invalidation, retained geometry and disposal behind one operation.
- Definition-bound style rules support custom schemas without privileged starter
  node names.
- Shared text styles remove duplicated native typography policy. Paint-only
  updates remain separate from shaping and composition.
- React delegates replacement to the mounted-view interface.

No further M5 requirement gaps were identified. Rendering/decorations, the rest of
React integration, codecs and workspace delivery remain assigned to M6–8.

## Validation

The judge independently ran 153 focused browser tests across 21 browser files.
After the remedy, the required full gate passes: 638 Vitest tests, one existing
collaboration TODO and 42 end-to-end cases. Production build and formatting
stability pass.

Before the validation-only remedy, the committed implementation passed all nine
production reflow cases and three serial performance trials against unchanged
budgets. Their evidence is in
`artifacts/public-interface-m5/font-replacement/`. The remedy changes fixed
configuration validation, not the shaping, reflow or paint algorithms.
