# Obsidian plugin standards audit

Checked against the 27-rule kernel in `CLAUDE.md` plus the community-plugin submission bot's automated checks. Findings and their resolution as of version 2.0.0.

## Submission bot — would have been auto-rejected

| Check | Before | Now |
|-------|--------|-----|
| Plugin id must not contain "obsidian" | `obsidian-semantic-ai` | `semantic-ai` |
| Description must not name Obsidian or start with "This plugin" | "AI-enhanced semantic plugin with academic-level tagging…" — passed, but named specific categories the plugin no longer hard-codes | Rewritten |
| `LICENSE` file required | Missing, despite `"license": "MIT"` in `package.json` | MIT license added |
| Release must ship `manifest.json` + `main.js` + `styles.css` at a tag matching the manifest version | `version-bump.mjs` was referenced by `npm version` but did not exist | Script added; `versions.json` records 2.0.0 |

The id change is the one breaking item: Obsidian keys installed plugins by id, so 2.0.0 installs as a new plugin and must be enabled again.

## Rule-by-rule

### Memory and lifecycle (R6, R7)

- `registerEvent()` was already used for both context menus. Kept.
- No view references were stored on the plugin class, and `onunload` did not call `detachLeavesOfType`. Both correct already.
- `onunload` now only flushes the concept registry.

### Type safety (R8)

| Was | Now |
|-----|-----|
| `getAbstractFileByPath(path) as TFile` in the batch writer | `instanceof TFile` guard |
| `leaf.view as MermaidView` / `as ConceptTrackerView` / `as ConceptJourneyView` | `instanceof` guards; a wrong view type is now a no-op instead of a crash |
| `vault.read(file as any)` and `vault.modify(file as any)` in the concept registry | Adapter API with real types, no casts |
| Two `@ts-ignore` lines reaching into `app.setting` | Removed with the menu item that used them |
| `getAllLoadedFiles().forEach` + `instanceof` push | `.filter((f): f is TFolder => …)` |

`noImplicitAny` and `strictNullChecks` were already on. `npm run lint` is clean with `@typescript-eslint/no-explicit-any` set to error.

### UI text (R9–R13)

- All settings headings now use `new Setting(el).setHeading()`. `settings.ts` previously built 13 `h1`–`h4` elements directly, including a top-level "Semantic AI Settings" heading that repeated both the plugin name and the word "settings". Headings inside views stay as real `h3`/`h4` content headings, which is correct; modal titles moved from a hand-built `h2` to `titleEl`.
- Every user-facing string is sentence case: "Test connection", "Add a category", "Classify current note".
- Command names no longer contain the word "command", no command id repeats the plugin id, and no default hotkeys are assigned.
- Decorative emoji removed from buttons, tabs, headings, and notices, so screen readers are not read a stream of pictographs.

### API preferences (R14–R19)

| Was | Now | Why |
|-----|-----|-----|
| `vault.modify()` for tag writes, tag removal, tag updates, diagram insertion, and forward links | `vault.process()` | Read-and-write is one atomic step, so a concurrent edit is not silently overwritten |
| `vault.read()` before every classification | `vault.cachedRead()` | No disk hit when only reading |
| `fetch()` in the Postgres connection test | `requestUrl()` | The only remaining `fetch` in the plugin; `requestUrl` avoids CORS and is the documented API |
| `setTimeout` returning `NodeJS.Timeout` | `window.setTimeout` | Correct DOM typing |
| `console.log` on load and unload, `console.error`/`console.warn` in the registry and indexer | Removed; failures surface as a `Notice` or are collected into index warnings | R19 |
| Duplicated provider request code in `main.ts` and `classifier.ts` | Single `AIClassifier.complete()` used by both | The duplicate had already drifted — it never supported the custom provider |
| Registry path hard-coded to `.obsidian/plugins/obsidian-semantic-ai/…` and accessed through the Vault API | `manifest.dir` + `normalizePath()` + the adapter | Files under the config directory are not part of the vault file tree, so `getAbstractFileByPath` always returned null and the registry never persisted |

`Object.assign({}, DEFAULT_SETTINGS, await this.loadData())` is replaced by an explicit `migrateSettings()` function, because a shallow merge left legacy keys in place and could not fold a v1 prompt map into the new taxonomy.

### CSS (R20, R21)

- 34 hard-coded hex and `rgba()` colours removed from `styles.css`. Category colours are now eight palette slots mapped to Obsidian's own `--color-blue`, `--color-orange`, … variables, addressed by `data-color` rather than by category name — which is what makes user-defined categories possible in the first place.
- The Mermaid `classDef` block that emitted light-theme-only fills is gone; node shape now carries the distinction, which reads correctly in any theme.
- The five inline `element.style.width` / `.fontFamily` assignments are replaced by CSS classes. The one genuinely dynamic value, the progress bar width, is passed as a CSS custom property via `setCssProps()`.
- Selectors stay scoped to `semantic-ai-*` containers.

### Accessibility (R22–R24)

This was the largest gap: the plugin had **zero** `aria-label`, `setTooltip`, `tabindex`, or `:focus-visible` usage.

- `:focus-visible` outlines added for every interactive element the plugin renders, using `--interactive-accent` with a 2px offset.
- Settings tabs and the concept tracker tabs are proper `role="tablist"` / `role="tab"` widgets with `aria-selected`, roving `tabindex`, and Left/Right/Home/End key handling.
- File links were `<a>` elements with a click handler and no `href`, so they could not be focused or activated by keyboard. They are now buttons styled as links, each with an `aria-label` naming the file.
- Icon-only buttons (delete, reset) carry both `setTooltip()` and an `aria-label`.
- The batch progress list is `role="log"` with `aria-live="polite"`; the indexing progress bar is a real `role="progressbar"` with `aria-valuenow`; the search results region is `aria-live`.
- Modals focus their primary action on open, so Enter works immediately.
- Touch targets are at least 44px on coarse pointers, relaxed to 32px on `pointer: fine`.

### Security and compatibility (R25–R27)

- No `innerHTML` or `outerHTML` anywhere — this was already clean, and the new code keeps to `createEl`/`setText`.
- No regex lookbehind, so iOS below 16.4 is fine. The tag regex was rewritten but uses only capture groups.
- No sample or template code remained from the plugin template.
- `src/indexing/vault-indexer-ORIGINAL.ts` and `-PATCHED.ts` were dead copies of the live indexer, 993 lines never imported by anything. Deleted.

## Bugs found while auditing

1. **`batchClassifyFolder` referenced an undeclared variable.** `processFiles(fileContents, defaultTypes)` — `defaultTypes` did not exist. This was a compile error, so `npm run build` failed and the committed `main.js` was stale. Batch classification could not have worked in any build produced from this source.
2. **Custom classifier tags could never be read back.** `formatTag` writes the type as `Custom:keyword`, but the parser's type group was `[^:]+`, which cannot match a value containing a colon. Every custom-classifier tag written to a note was invisible to the parser, the indexer, and the graph. The type group now allows an embedded colon.
3. **The concept registry never persisted.** As above: it lived under `.obsidian`, which the Vault API cannot see. Each session started from an empty registry, so "the same concept keeps the same UUID" did not hold across restarts.
4. **Domain assignments were computed and then discarded.** The classifier validated the model's `domains` array onto the tag, but `formatTag` had no field for it, so the second axis was paid for on every request and thrown away. Topics now round-trip through the `::@topic,topic` segment.
5. **Batch cost was double counted.** `estimateBatchCost` returned input + output tokens as `totalTokens`, and the caller then treated that sum as the input count and added another 20% on top.
6. **`batchClassifyFolder` matched sibling folders.** `path.startsWith(folder.path)` meant indexing `Notes` also swept `Notes-archive`. Now compares against `folder.path + '/'`, with a special case for the vault root.
7. **A tag could become its own parent** when the model returned a `parentLabel` equal to its own label, producing a self-loop in the graph. Guarded.
8. **`vault.create` on an existing export path threw** an unhandled error. Now checked first, with a notice.

## Not addressed

- **Category commands need a plugin reload to appear.** Obsidian has no public API to remove a command once registered, so commands are built from saved settings at load time. Adding a category and wanting its command immediately means reloading the plugin. Called out in the README and in a code comment.
- **API keys are stored in plain text** in `data.json`. This is what every Obsidian plugin that talks to an API does — there is no vault-level secret store — but the settings tab now says so plainly rather than leaving it implicit.
- **No automated tests.** There is no test runner in the project. The settings migration was verified by hand against a fresh install, a v1 settings object, a re-run for idempotency, and an empty-category edge case.
- **Mobile has not been tested on a device.** The code paths avoid Node APIs and `isDesktopOnly` is false, but the manifest claim is untested on real hardware.
