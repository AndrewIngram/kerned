# Milestone 8 architecture review

The independent `improve-codebase-architecture` judge reviewed the complete
package migration from `b75c193` through implementation commit `15bee1a`.
It assessed package/editor/extension interfaces, module depth, information hiding,
dependency direction and built consumer experience. Its explorer also checked
extension authoring against the assembled standard kit.

The judge accepted the package decomposition, dependency-ordered build, sealed
exports, shared runtime identities, composition-only starter-kit, independent
table consumer and external comment state. Three P2 findings required changes.

## Built React server imports

Ordinary Node could not import `@gprose/react`: its eager view import reached a
CSS file and raised `ERR_UNKNOWN_FILE_EXTENSION`. Vitest transformed CSS, so its
SSR tests did not reveal the failure. Standard browser extensions had the same
problem when used to assemble a schema during server rendering.

**Resolved.** Styles are inert JavaScript strings contributed through `viewStyles`.
The complete mount owns its base and contributed style element and releases it
with the view. It installs styles synchronously, including inside a shadow root.
Two-view and failed-initialization browser regressions prove cleanup cannot remove
another view's styles. This controls stylesheet lifetime, not selector isolation;
normal document/shadow-root cascade rules still apply.

`tests/consumers/react-server.mjs` imports emitted React, view, starter browser,
comment and search packages in ordinary Node without a CSS loader or DOM globals.
It renders both an owned-session hook and a borrowed-session content host.
The fixture is part of the required `pnpm check` gate.

## Custom inline layout in standard text nodes

Standard paragraph and heading presentations sent every inline value through
`mentionLayout`, which parsed attributes as a mention. Valid custom inline values
could therefore fail before their registered renderer was reached. Earlier tests
used a custom text-node presentation and missed standard-kit composition.

**Resolved.** `defineInlinePresentation` binds allocation to an installed inline
definition. `inlinePresentations` composes these factories per view, and text-node
presentations call `context.layoutInline()` to allocate canonical values. The
view supplies identity and offset and rejects missing/duplicate allocators. The
mention browser extension now supplies mention metrics through the same contract.

A public consumer combines a badge with mention values in standard paragraphs
and headings. Its browser regression verifies configured widths, renderer frames
and caret positions. Its emitted-package version is also exercised in all three
browsers by the built-consumer gate.

## Public manual view assembly

The view barrel still exposed the earlier event mount, interaction controllers
and navigation helpers. Standard input and table extensions derived callback
shapes from the entire manual mount options, keeping that obsolete interface alive.

**Resolved.** Extensions share `InputHandlers`. The complete mount owns input
capture, composition and focus. Manual mount, pointer, hit-test and navigation
helpers remain private implementation modules. Their low-level regressions live
beside their owner. The node-only E2E fixture now uses `mountEditor` and public
node definitions/presentations/views to exercise drag, shift reversal and
keyboard document-edge selection.

## Follow-up judgement

The independent judge reviewed all three remedies and found no further blocking
findings. It confirmed the smaller input seam, schema-bound allocation and
mount-owned stylesheet lifetime. Documentation explicitly preserves normal CSS
cascade semantics. The completion audit maps the full plan to executable evidence.

## Reflow audit follow-up

Production verification exposed one additional coupling: the private layout
engine spread incoming inline allocation objects into rectangle records, and the
reflow audit compared those records as JSON. Schema-bound allocation supplied the
same values in a different property order. A real-engine regression proved equal
geometry but unequal serialized records in all three browsers.

The engine now constructs each rectangle's fields explicitly. This preserves
identity, label, metrics and coordinates while making output independent of
caller property order and excluding undeclared input fields. The existing reflow
assertion remains unchanged. The independent judge reviewed and approved this
follow-up without further findings.

## Final validation

`pnpm check` passes all built headless/React SSR consumers, five built browser
consumers in three browsers, lint, formatting, types, declarations, ownership
checks, 968 Vitest cases and 42 E2E scenarios. The one pre-existing concurrent
split/insert TODO remains documented. Collection preserves all 886 previous
cases and adds nine browser cases, for 895 declared cases.

The production build passes. All nine large-document reflow cases and three
serial foundation trials pass unchanged budgets. Worst measured values are
233 ms first usable paint, 1,273.7 ms streaming, 49.3 ms paste handling, 115 ms
paste-to-paint, 32.2 ms typing, 32.2 ms paging and 28,115,740 loaded heap bytes.
Reports are under `artifacts/public-interface-m8/judge-*`; they identify
pre-commit HEAD `15bee1a` and measure the reviewed fix tree. The post-review
commit closes milestone 8 and the complete public-interface implementation plan.
