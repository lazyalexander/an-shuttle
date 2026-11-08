# Mechanical film reference GUI round-trip

English · [简体中文](mechanical-krita-gui.zh-CN.md)

The steam and inline-four teaching films were handed to Krita 5.3.4 through the existing `openInKrita` bridge. Frame zero was packed into a film-reference ORA using the existing CAD spool ORA writer. A new paint layer was added in the GUI, a brush mark was painted, and the document was saved as native KRA. Both saved documents were closed and reopened through the same bridge.

Each document retains a film-reference paint layer and an independently editable paint layer at 1920 × 1080. The merged images have 389 changed pixels for steam and 8,251 for inline-four. These counts establish actual GUI edits persisted. The [portable acceptance](acceptance/mechanical-krita-gui.json) records both outcomes. Blender scene editability and CAD part-layer delivery have their own acceptance scope.

## Reproduce

Build Shuttle with Node 22+ and `npm run build`. Select the ORA derived from a formally accepted film revision, then call the existing bridge from the repository root.

```sh
node --input-type=module -e 'import {openInKrita} from "./packages/krita/dist/document.js"; await openInKrita(process.argv[1]);' SELECTED_ORA
```

In Krita, choose Layer → New → Add Paint Layer, make a visible brush edit and use Save As. Explicitly select the Krita document format before saving a `.kra` name. Close the document, reopen the KRA through the same bridge, and verify both layers and the mark. A filename suffix alone can leave the ORA filter selected and append `.ora`.

The native KRA files were slightly larger than the host's existing 8 MiB binary-artifact limit. A lossless ZIP-container recompression brought them under that limit. Every archive entry retained identical bytes and order, the mimetype entry remained stored, and both compact KRA files reopened successfully in the GUI. The original KRA files remain preserved locally. The host limit was retained.

Finally, a reviewed host workspace job bound the original film artifact revision, extracted its baseline frame, checked the KRA mimetype, dimensions, two paint layers and changed pixels, then copied the KRA into its declared output. Formal acceptance published fixed revisions for the compact KRA and report after confirmed execution settlement. The GUI application remains user-owned; this check establishes document handoff and return, with separate host verification of returned bytes.

## Dependencies

Use an-agent #216 for the mechanical source workflow, Loom #113 for terminology alignment, and an-spool #6 for the three teaching packages. Merge those in that order before this documentation PR. The application bridge is reused without a new GUI driver. Native grants, raw UI state and working files remain local.

## Native teaching application handoff

The native teaching application in an-spool uses `packages/krita/dist/accepted.js HOST INSTANCE RUN NEW_ORA_PATH`. This finite adapter obtains `painting.ora` through the original host artifact inventory, checks an accepted revision, checks it out through the existing custody API and calls the same `openInKrita`. Unaccepted output refuses before GUI launch. It is an application handoff, not a second spool host, model client or GUI driver. The native application opening request does not itself prove visual content or a completed GUI save; those remain separately observed acceptance.
