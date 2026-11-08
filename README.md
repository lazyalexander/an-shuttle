# an-shuttle

English · [简体中文](README.zh-CN.md)

Application bridges for an-agent: capture a selected document revision, mediate
user interaction, and deliver accepted products back to an application.

- **an-agent** owns task permissions, scheduling, external harness supervision,
  lifecycle, activity records and artifact custody.
- **an-loom** develops, validates and packages spool releases.
- **an-spool** owns reviewed domain instructions, material policy and rendering.
- **Shuttle** owns application snapshots, edit locks, disclosure and delivery.

## Example: CAD → Krita

Save a CAD revision and receive a transparent, layered painting that remains
editable in Krita. This example exercises the bridges; CAD is not the product boundary.

![CAD painting with editable part layers](examples/cad-paint/sample/vise.png)

[Setup, acceptance and limitations](docs/cad-paint.md) ·
[Layered sample](examples/cad-paint/sample/vise.ora) ·
[Domain spool catalog](https://github.com/lazyalexander/an-spool)

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
