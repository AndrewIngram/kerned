# View font configuration

Status: first milestone 5 slice. Configurable canvas faces are implemented.
Shared DOM typography, theme rules and live font replacement remain in milestone 5.

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
its width retains shaping. Glyph drawing preserves text order across faces,
including overlapping ink, rather than ordering paint by native registration ID.
The draw runs borrow subarrays of the existing numeric buffers.

This slice treats `fonts` as attachment configuration. Changing the React `fonts`
prop currently replaces the native attachment while retaining the supplied
session. In-place font replacement and coordinated canvas/table/list styling are
still required before milestone 5 is complete.

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
