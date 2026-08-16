# Semantic AI

An Obsidian plugin that reads a note, classifies what is in it against **categories you define**, and writes the results back as hidden, UUID-stamped tags you can browse, index, and graph.

Nothing about the categories is baked in. Ship it at a research vault and it finds axioms and evidence; point it at meeting notes and it finds decisions and action items; point it at a novel draft and it finds scenes and plot points. You pick a preset, then edit it, or start from a blank slate.

## Two axes

Every element gets labelled twice:

| Axis | Question | Example values |
|------|----------|----------------|
| **Category** | What is this? | Idea, Decision, Task · Axiom, Claim, Theorem · Character, Scene, Motif |
| **Topic** | Where does it belong? | Work, Personal, Finance · Physics, Theology · Plot, Voice, Pacing |

The second axis is optional and you choose what it is called — topic, domain, department, thread, whatever fits your vault.

## Presets

Load one from **Settings → Semantic AI → Categories**, then edit anything in it.

| Preset | For |
|--------|-----|
| General notes | Ideas, questions, decisions, tasks, facts, quotes, people, terms, sources, insights |
| Research and academic | Axioms, claims, hypotheses, definitions, theories, observations, laws, theorems, lemmas, evidence |
| Projects and meetings | Requirements, decisions, action items, risks, assumptions, dependencies, metrics, stakeholders |
| Fiction and long-form writing | Characters, settings, scenes, plot points, themes, conflicts, motifs, revision notes |
| Blank | One starter category; build your own |

Each category carries its own prompt — the sentence the model is given when looking for it. Rewrite it in the same tab.

You can export the whole taxonomy as JSON and import it into another vault.

## AI providers

Keys are stored **per provider**, so an OpenAI key and a DeepSeek key can sit side by side and switching between them keeps both.

| Provider | Default model | Key needed |
|----------|---------------|------------|
| OpenAI | `gpt-4o-mini` | Yes — [platform.openai.com](https://platform.openai.com/api-keys) |
| DeepSeek | `deepseek-chat` | Yes — [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| Anthropic | `claude-3-5-haiku-latest` | Yes — [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Ollama | `llama3.1` | No — runs locally |
| Custom endpoint | whatever you set | Optional |

Keys are saved in this vault's plugin data (`data.json`) in plain text, the same as every other Obsidian plugin that talks to an API. Do not commit that file or sync it somewhere public.

Cost estimates shown before a batch run use published list prices and are approximate.

## Tag format

Tags live in a block at the bottom of the note:

```
%%--- SEMANTIC TAGS ---%%
%%tag::Decision::a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d::"Move the launch to Q3"::null::@Work,Product%%
%%tag::Risk::b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e::"Vendor contract is unsigned"::a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d%%
%%--- END SEMANTIC TAGS ---%%
```

The parts are `type`, `uuid`, `label`, `parent uuid`, and an optional `::@topics` segment. The category id is whatever you named it, so a tag written last year still reads correctly after you rename the category's display name — only changing the **id** orphans old tags.

The same concept keeps the same UUID across notes, via a registry stored in the plugin's own folder.

## Commands

| Command | What it does |
|---------|--------------|
| Classify current note | Runs every enabled category |
| Classify current note, choosing categories | Pick categories for this one run |
| Classify as: *category* | One command per category you define |
| Run classifier: *keyword* | One command per custom classifier |
| Toggle tag block visibility | Show or hide the tag block |
| Open semantic map for current note | Diagram and tag list in the side panel |
| Regenerate graph for current note | Rebuild the diagram |
| Classify every note in the current folder | Batch run, with a cost estimate first |
| Index the current folder / whole vault | Build the concept index (no AI calls, no cost) |
| Open concept tracker | Browse concepts, relations, and search |
| Open concept journey | Trace how one concept develops across notes |

Category commands are registered when the plugin loads, so after adding or renaming a category, reload the plugin to see the new command.

No hotkeys are assigned by default — set your own in Obsidian's hotkey settings.

## Installation

### From source

```bash
git clone <this repo> <vault>/.obsidian/plugins/semantic-ai
cd <vault>/.obsidian/plugins/semantic-ai
npm install
npm run build
```

Then enable it in Settings → Community plugins.

On Windows, `install.bat` does the same thing in one click, and `troubleshoot.bat` offers a clean reinstall and rebuild.

### Development

```bash
npm run dev     # rebuild on change
npm run build   # typecheck and build for release
npm run lint    # eslint
```

## Upgrading from 1.x

Existing settings are migrated on first load:

- The old fixed category list becomes the **Research and academic** preset, with any prompt edits preserved.
- The single API key moves to the slot for whichever provider it belonged to.
- Domain mapping becomes the topics axis, keeping your custom domain prompt.

Two things do change and need a look:

- The plugin **id** changed from `obsidian-semantic-ai` to `semantic-ai` (the community-plugin bot rejects ids containing "obsidian"). Obsidian treats that as a different plugin, so install to the new folder name and enable it again.
- The concept registry now lives in the plugin's own folder and is read through the vault adapter. The old path was inside `.obsidian`, which is not part of the vault file tree, so it never actually persisted; the registry rebuilds itself as you classify.

## Project structure

```
src/
  ai/
    classifier.ts       provider transport and response parsing
    prompt-manager.ts   prompt construction, taxonomy import/export
  indexing/
    vault-indexer.ts    cross-note concept index
  tagging/
    tag-writer.ts       read, write, and parse tag blocks
    concept-registry.ts stable UUIDs per concept
    uuid-generator.ts
  ui/
    mermaid-view.ts     semantic map panel
    concept-tracker-view.ts
    concept-journey-view.ts
    result-panel.ts     classification and batch modals
    index-modal.ts      indexing modals
    prompt-tabs.ts      custom classifier settings
  main.ts               plugin entry point
  settings.ts           settings tab
  types.ts              types, presets, settings migration
```

## Database sync

Optional, and off by default. Tags carry UUIDs so they can be mirrored into PostgreSQL through a helper service you run yourself; the plugin never holds database credentials beyond passing the connection string to that local service.

## License

MIT — see [LICENSE](LICENSE).

## Credits

Inspired by [obsidian-note-definitions](https://github.com/dominiclet/obsidian-note-definitions).
