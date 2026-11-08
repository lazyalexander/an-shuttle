# an-shuttle

English · [简体中文](README.zh-CN.md)

Application bridges for an-agent: capture a selected document revision, mediate
user interaction, and deliver accepted products back to an application.

- **an-agent** owns task permissions, scheduling, external harness supervision,
  lifecycle, activity records and artifact custody.
- **an-loom** develops, validates and packages spool releases.
- **an-spool** owns reviewed domain instructions, material policy and rendering.
- **Shuttle** owns application snapshots, edit locks, disclosure and delivery.

## Develop

Use Node 22 or newer. Run `npm ci --ignore-scripts`, `npm run build`, then `npm test`.
Rendering tests require the Python dependencies described in the example guide.
`npm run test:browser` uses Google Chrome; `npm run test:codex` uses the qualified
Codex CLI and host described in the guide. Tests distinguish protocol fixtures
from real model and Krita acceptance.

`packages/view` provides view bindings; `packages/cad` captures CAD state;
`packages/krita` opens accepted documents. `examples/plate` is the minimal view
example (`npm start`); `examples/cad-paint` is the application integration demo.
Domain policy is imported from an-spool, never duplicated in the app bridge.

## Cases · mechanical animation

### Ink and painted steam-engine comparison

| Ink animation | Painted version · 6 s |
| --- | --- |
| ![Ink animation](https://raw.githubusercontent.com/lazyalexander/an-agent/d94f574197d8a7f56d30ca78d9cad8d81039d65d/assets/demos/mechanical-ink.gif) | ![Painted steam engine](https://raw.githubusercontent.com/lazyalexander/an-agent/d94f574197d8a7f56d30ca78d9cad8d81039d65d/assets/demos/painted-steam-engine.gif) |

Shuttle hands accepted editable output to applications. The animation application handoff remains pending; CAD → Krita supplies the existing application acceptance reference.
[Teaching workflow and reproduction evidence](https://github.com/lazyalexander/an-agent/blob/d94f574197d8a7f56d30ca78d9cad8d81039d65d/doc/cases.md).

### Supplementary case · inline-four engine

<img src="https://raw.githubusercontent.com/lazyalexander/an-agent/d94f574197d8a7f56d30ca78d9cad8d81039d65d/assets/demos/painted-inline-four.gif" alt="Inline-four engine" width="420">

Forty CAD parts reuse the painted workflow over an eight-second cycle. Both
painted GIFs loop at 720 × 405 and 12 fps. Media and teaching notes reference a
fixed an-agent revision.

## Example: CAD → Krita

Save a CAD revision and receive a transparent, layered painting that remains
editable in Krita. This example exercises the bridges; CAD is not the product boundary.

![CAD painting with editable part layers](examples/cad-paint/sample/vise.png)

[Setup, acceptance and limitations](docs/cad-paint.md) ·
[Layered sample](examples/cad-paint/sample/vise.ora) ·
[Domain spool catalog](https://github.com/lazyalexander/an-spool)

Kit labels files modified or created by an agent. Unchanged copies retain their silk baseline label. Modification history, current baseline match, trust and retention decisions remain separate records. Paths and legacy slot names do not define this label.

[Mechanical Krita GUI round-trip](docs/mechanical-krita-gui.md)
