# Anti-slop provenance

Source repository: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).

Source commit: [`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`](https://github.com/dmmulroy/anti-slop/commit/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b).

Source directory: `skills/install-anti-slop/assets/anti-slop/`.
Its Git tree is `a7831feb0c097943ac813ddcb1367e26eef52da5`.

Installed on 2026-09-20 using the local `install-anti-slop` skill's
`scripts/install.mjs`. A recursive comparison confirmed that every copied file
matches the source directory at the commit above, including the file inventory.
The skill's recorded folder hash, `89044d21c75a367eac1ddbaf208e650b1a7d5820`,
also matches that commit's `skills/install-anti-slop/` Git tree.

Installed paths:

- `tools/oxlint/anti-slop/index.ts`, the enabled generic plugin.
- `tools/oxlint/anti-slop/rules/` and `shared/`, its rules and helpers.
- `tools/oxlint/anti-slop/effect/`, the bundled opt-in Effect plugin.
- `tools/oxlint/anti-slop/vendor/eslint-stylistic/`, including its unchanged
  [license](vendor/eslint-stylistic/LICENSE) and [provenance](vendor/eslint-stylistic/UPSTREAM.md).

Intentional deviations: this provenance file is the only addition to the copied
assets. No plugin source files were changed.

The repository's `.oxlintrc.json` enables all 18 generic rules and the native
`oxc/no-accumulating-spread` companion rule at error severity. It excludes the
vendored plugin and agent tooling directories. The Effect plugin remains disabled
because this repository has no direct `effect` dependency.

`oxlint` and `@oxlint/plugins` are pinned together at `1.83.0` as development
dependencies. Run `npm run lint` for lint diagnostics and `npm run typecheck` for
the existing application TypeScript check. Installation does not migrate existing
project source to satisfy the new rules.
