# View font configuration

Status: configurable faces, live node-style rules, shared native typography,
paint-only text colors and in-place font replacement are implemented. Milestone 5
is awaiting its final validation and architecture review.

A view accepts a font configuration without exposing graphics or shaping handles:

```ts
import { defaultFonts, mountEditor } from '../src/editor-canvas';

const view = mountEditor(element, {
  editor,
  fonts: {
    ...defaultFonts,
    defaultFamily: 'Product Sans',
    faces: [
      ...defaultFonts.faces,
      {
        family: 'Product Sans',
        weight: 400,
        style: 'normal',
        asset: 'fonts/ProductSans-Regular.ttf',
      },
    ],
  },
  resolveAsset: (asset) => new URL(asset, assetBaseURL),
});
await view.ready;
```

`fonts` is optional; `defaultFonts` preserves the existing Noto Sans faces and
Noto Color Emoji fallback. Each source declares a family, numeric weight from
1–1000, normal/italic style, and an asset key under `fonts/`. The asset resolver
can map that key to the application's actual versioned URL. Registration order
has no semantic meaning. The configuration must include both its default and
emoji families. Duplicate family/weight/style descriptors are rejected. There
can be at most 256 registered faces, matching the packed glyph buffer's byte-sized
face identities.

The font configuration is validated and copied before asynchronous loading.
Caller mutation during loading cannot change it. Readiness includes font loading
and registration in the shaper and painter; failure rejects readiness and releases
native resources. Each view owns its native faces and sized font objects, while
immutable downloaded bytes can be reused across views. Destroying one view cannot
invalidate another view's fonts.

Custom text presentations can select a face with
`font: { family: 'Product Sans', weight: 600, style: 'italic' }`. The family,
weight and style fields are optional. An absent or unknown family uses the
configured default family. Style is matched before weight. Missing normal/italic
variants use the available style without synthetic bold or skew. Static weight
matching follows the search order in [CSS Fonts, matching font styles](https://www.w3.org/TR/css-fonts-4/#font-style-matching).
This does not implement the full CSS font system: variable axes, oblique angles,
system font discovery and per-character coverage fallback are not supported here.
Emoji keeps the existing explicit emoji-family routing and text-presentation
variation-selector behavior. This does not expand supported scripts.

Author bold/italic marks resolve within the selected family. Bold requests at
least weight 700; it does not reduce a heavier base weight. Italic marks retain
an already italic base style. A missing requested weight chooses an available
face rather than generating a synthetic weight. Supply real variants when their
appearance matters.

Resolved face identities participate in shaping and metrics cache keys. Changing
a paragraph's face cannot reuse shaping from its previous face; changing only
its width, line height or baseline grid retains shaping. Composition separately
keys width, line height and baseline, so retained glyph data cannot reuse stale
line or caret positions. Glyph drawing preserves text order across faces,
including overlapping ink, rather than ordering paint by native registration ID.
The draw runs borrow subarrays of the existing numeric buffers.

Font sources can change without replacing the attachment:

```ts
await view.setFonts({ ...defaultFonts, faces: productFaces });
```

`setFonts` captures and validates the configuration before loading. Its promise
resolves after the replacement fonts are ready and the visible layout has been
refreshed. Distant paragraphs continue through viewport-first background reflow;
the promise does not wait for every offscreen paragraph. The current view remains
usable during loading. Font-loading failure rejects the promise and retains the
working collection, so the caller can retry. A newer valid request cancels the
previous request with an `AbortError`; destroying the view cancels pending work.
Changing an asset's contents requires a versioned URL from the asset resolver.

The swap preserves the graphics surface, native node views, input, session,
selection and reading anchor. It retains estimated paragraph heights while
invalidating glyph data from the old collection, then releases the old resources.
Prepared extension labels refresh before painting; their public `height` reflects
the current fonts. Native text uses the replacement's private browser aliases.

Changing React's `fonts` prop performs the same live replacement. Removing it
restores `defaultFonts`. `onReady` still describes the initial mount; replacement
errors reach `onError` and the existing error display without destroying the
working view. Use `view.setFonts` when an integration needs to await the swap.

## Live node-style rules

Themes belong to a mounted view, independently of the session's content and schema.
A rule binds to an installed node definition, including its configured variants,
and infers that definition's normalized attributes:

```ts
import { defineStyleRule } from '../src/editor-canvas';
import { paragraph, heading, list } from '../src/extensions/starter-definitions';

view.update({
  theme: {
    baselineGrid: 0,
    rules: [
      defineStyleRule(paragraph, {
        size: 20,
        lineHeight: 32,
        after: 20,
        color: '#27352b',
      }),
      defineStyleRule(heading, ({ level }) => ({
        size: [40, 32, 26, 22][level - 1],
        lineHeight: [48, 40, 32, 28][level - 1],
        font: { weight: 400 },
      })),
      defineStyleRule(list, { indent: 36 }),
    ],
  },
});
```

Custom node definitions use the same API. There is no central list of recognized
node names. Rule handles preserve definition identity; a same-named but unrelated
definition cannot impersonate an installed node.

Text rules accept `size`, `lineHeight`, `font`, `color`, `before`, `after` and
`baselineGrid`. Box rules accept spacing and grid settings. Flowing containers
accept `indent`, the amount added to the inherited horizontal inset. Dimensions
are document units, before zoom. Sizes and line heights must be positive; spacing,
indentation and grid steps must be nonnegative. A grid step of zero disables
baseline snapping. Adjacent block margins retain the existing maximum-margin
behavior.

Extension presentations supply defaults. Matching rules apply in array order;
the last defined field wins, with font family, weight and style merged individually.
A node's explicit grid rule overrides the theme-wide grid. Authored bold and italic
marks apply after the resulting base font selection. Starter headings use a base
weight of 700 rather than injecting a synthetic document-wide bold span, allowing
the theme to override heading weight while retaining authored marks.

Fixed rule values are validated and copied when the rule is created. Callback
results are validated and cached per immutable node for each view configuration.
Callbacks should be pure. Replace the theme object when configuration changes;
`view.update({ theme: {} })` restores extension defaults. The React `Editor`
accepts the same `theme` prop; removing it restores defaults without remounting.

A theme change clears resolved style/projection caches while preserving the
extension's presentation factory and default cache. It starts a viewport-first
reflow generation when metrics change and updates input geometry without editing content, selection,
undo history or native element identity. Unchanged native blocks retain their
measured heights; their renderers report actual changes through the existing
measurement contract. Spacing-only changes reuse shaping in both plain text and
text with inline atoms.

These rules reach canvas text, native table previews and editing inputs, list
markers, document spacing and flowing-container indentation.

Colors accept standalone CSS literals, including hex, named colors, RGB and HSL.
The view resolves them once per cached value to 8-bit sRGB, supplying the same
color to canvas and native text. Context-dependent values such as `currentColor`
and `var(...)` are rejected; resolve application CSS variables before passing them
to a rule. A color-only update repaints without new shaping, composition or a new
reflow generation. It preserves caret geometry, native preview elements and active
input dimensions. List markers and underlines inherit text color; an explicit
`underlineView.configure({ color })` overrides that inheritance.

## Native text rendering

Node-view frames and layer frames expose `textStyle(id, marks?)`. It returns an
immutable resolved `TextStyle`, or `null` for an absent/non-text node. The optional
bold/italic flags resolve the same authored emphasis as the canvas font matcher.
Custom text nodes provide their defaults through `defineNodePresentation`; the
style reader does not assume starter-kit node names or text attribute fields.

`applyTextStyle(element, style)` applies the resolved face, size, color, leading and
baseline-grid adjustment. The snapshot includes semantic font metadata and a
`cssFamily` containing private browser aliases. These aliases belong to the
mounted view, must not be persisted as document formatting, and are released with
that view. The helper uses CSS `translate` for the baseline adjustment; put editor
positioning on the enclosing host when writing a native renderer.

Each view registers its own browser `FontFace` objects from the exact buffers used
by its shaper and canvas painter. Each face’s asset is resolved once for both
renderers; a second resolution cannot choose a different source for native text.
Readiness waits for browser font loading and registration. Destroying a view
removes only its registrations, even when another view uses the same semantic
family name with different bytes. Failed ordinary fonts reject readiness without
publishing a partial font collection. Cancellation cannot register fonts late.

The bundled bitmap color-emoji font is accepted by the tested Chromium but rejected
by Firefox and WebKit. For the designated emoji face only, a browser-format
rejection uses platform emoji families in native text. Canvas continues using the
configured emoji face. Native emoji appearance can therefore differ across browser
engines. Ordinary font failures do not silently fall back. This behavior was
verified with real browser font loading, rather than inferred from user-agent names.

Tables read styles for their actual child nodes. Their preview text and textareas
share the same base font, size, leading and grid adjustment. Previews resolve
authored marks within that family. The existing plain textarea does not visually
render mixed inline marks while editing. Header cells add the table extension's bold emphasis. Adjacent
paragraphs use the resolved spacing instead of separate table typography constants.
Theme updates preserve active textarea identity, focus and selection and resize it
when metrics change. List markers inherit their associated text node's appearance;
tests measure their actual browser baselines against canvas line baselines.

## Ownership decision

Font configuration belongs to each mounted view. Putting it in the document
schema would prevent two views of equivalent content from using independent
presentation and would mix persisted formatting with application appearance.
A global mutable registry would make destruction and font replacement dependent
on other editors. The selected design keeps a pure validated catalogue separate
from the view-owned native collection, and keeps numeric native IDs private.

The layout pipeline consumes semantic font requests; the native collection maps
resolved faces to matching shaping and painting resources. Existing inline layout
now passes bold/italic semantics to its glyph resolver, not assumed numeric slots.
