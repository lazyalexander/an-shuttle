# an-shuttle

Shuttle connects an application view to a local workflow. The CAD painting example turns one saved revision of a small parametric bench vise into a transparent painting that can be opened independently in Krita.

![CPU rendering of the vise](examples/cad-paint/sample/vise.png)

[OpenRaster sample with four paint layers](examples/cad-paint/sample/vise.ora)

## CAD painting spool

For a managed save, install Node 22+, Python 3.11 or 3.12, and Krita on macOS. Put the pinned [an-loom CLI](https://github.com/lazyalexander/an-loom/tree/9089b0283cc9077f51447e38b32f553049948d98) and [an-agent-host CLI](https://github.com/lazyalexander/an-agent/tree/7c5fa1f2c70d36fbdd8b4054ca9384dfa9174f75) on PATH, or select the binaries with `AN_LOOM_BIN` and `AN_AGENT_HOST_BIN`. Use release builds (`cargo build --release --locked --bin an-loom` and `cargo build --release --locked --bin an-agent-host` in the respective repositories) because the host hashes the selected Python environment. From a clean checkout, select a dedicated runtime once:

```sh
npm ci
npm run build
python3 -m venv --without-pip .venv
python3 -m pip --python .venv install --only-binary=:all: --no-compile -r examples/cad-paint/requirements.txt
.venv/bin/python -B examples/cad-paint/prepare-runtime.py "$(node -p "require.resolve('@an-loom/cad-paint-spool/manifest')")" .venv/paint-runtime.json
export CAD_PAINT_RUNTIME="$PWD/.venv/paint-runtime.json"
npm run studio
```

Visit http://127.0.0.1:4183. Adjust the jaw opening, camera and finishes. Click **保存并绘制**. The submitting CAD window freezes immediately. The server locks the saved revision before awaiting any work, broadcasts the lock to every connected CAD window and rejects concurrent or stale saves. A disconnected window stays disabled until it reconnects. The studio publishes both accepted artifacts on success and releases the CAD lock before waiting for Krita to open. A confirmed terminal failure releases the lock with no download. If the waiting CLI loses its result, the studio keeps the lock and checks the same supervised run for termination.

The spool uses the provided camera and light. Omit the camera for the default three-quarter view, or omit the light for a random azimuth. Assign all four finishes to render offline. To ask a model for missing finishes, start local Ollama with a downloaded model that supports structured JSON. Set `OLLAMA_MODEL` to its name (default `gemma4:e4b`) and optionally `OLLAMA_HOST` to its base URL (default `http://127.0.0.1:11434`). Model failures are reported in the CAD interface.

Mitsuba path traces the saved geometry on the CPU. A separate visibility pass assigns visible pixels to the base, hardware, fixed jaw and moving jaw. Every delivery checks that the four layers composite byte-for-byte to the transparent PNG. The standalone ORA contains the resolved scene recipe. For finer editing, set `CUT_SPOOL_BIN` to a local cutting-spool executable before starting the studio. **送交切割 spool** passes the absolute ORA path as one argument. Exit zero acknowledges delivery. Handoff is optional and CAD stays editable while the cutter runs. Each save gets its own folder under `paintings/`. Shuttle requests that local Krita open the document and also exposes a download. Set `KRITA_BIN` to select the local painting app.

For the standalone renderer on Linux or macOS, install the same Python requirements in a virtual environment, activate it and explicitly run `npm run studio -- --standalone`. This mode executes the Python entry directly and supports `PYTHON_BIN`. An ordinary save always uses the managed profile.

## Swap the source CAD

The second example is a three-spoke handwheel designed in OpenSCAD. It has five part groups and one editable shaft angle. Launch the same studio with the model directory:

```sh
npm run studio -- examples/cad-paint/handwheel
```

Set `PORT=4184` to run it alongside the vise. The browser owns the edit lock in conjunction with the studio server. OpenSCAD supplies the assembly geometry offline. The native OpenSCAD editor is outside this lock.

![OpenSCAD handwheel](examples/cad-paint/sample/handwheel.png)

[Five-layer handwheel ORA](examples/cad-paint/sample/handwheel.ora)

- Edit `model.scad` for the solid geometry and the named part groups.
- Edit `model.json` for part IDs, mask colors, supplied finishes, framing and the revolute joint. The neutral-angle meshes use the same world coordinates and pivot as OpenSCAD.
- Install the authoring-only importer with `python3 -m pip install -r examples/cad-paint/authoring-requirements.txt`. Trimesh owns STL decoding; geometry processing is disabled, and the adapter preserves part names, triangle order and five-decimal coordinates. These dependencies are separate from the painting runtime.
- Rebuild `meshes.json` after geometry or part-ID changes with `python3 examples/cad-paint/export-scad.py examples/cad-paint/handwheel`. OpenSCAD is needed only for this export. Set `OPENSCAD_BIN` if the executable has a different path.

The two demos share capture, locking, material negotiation, scene rendering, ORA delivery and cutting-spool handoff. Additional triangle-mesh assemblies with a single axis-aligned revolute joint can use the directory interface. A different native editor or another joint type needs its own integration.

## Loom package and Shuttle boundary

A CAD save carries an intent, a fixed document revision, its observations and optional operator direction through `packages/cad/shuttle.ts`. The studio holds the CAD lock and hands that message to the domain agent. It gives the model the missing part labels, the existing finishes and the direction. With complete materials it can start the baseline directly.

The [CAD painting reference package in Loom](https://github.com/lazyalexander/an-loom/tree/821176910ceba06fa5fa0b6036d7f4d09291c2d1/examples/cad-paint) owns the domain source. `npm ci` installs v0.1.0 from an immutable commit URL and verifies the distribution against the integrity in `package-lock.json`. Both CAD models use this package. The macOS acceptance exports the exact Loom archive included in it. Its agent proposes a private `kit/appearance.py` for this attempt. Its read-only silk owns the render, PNG/ORA shape and pixel reconstruction. The resulting document records the input and selected kit digests. For each managed save, the studio exports the pinned archive into a fresh native instance. It applies an appearance kit only when materials are missing. The host supervises one run, accepts the outputs and checks out the two fixed revisions in its catalog. The studio records this inventory in `accepted.json` and makes the ORA visible after both checkouts. Each attempt retains its `saved.json`, `request.json` and instance for inspection. For a lost supervisor response, `an-agent-host spool-status <attempt>/instance paint` inspects the same attempt. The macOS acceptance exercises this path through two browser tabs. Further part cutting is a new attempt with its own input.

## Workspaces

| Workspace | Responsibility |
| --- | --- |
| `packages/view` | View binding, revision checks and serialized edits |
| `packages/cad` | CAD snapshot validation, part identifiers and vise geometry |
| `packages/krita` | Opening a local document; domain format generation stays in the pinned Loom spool |
| `examples/cad-paint` | Web CAD, lock owner and pinned painting-spool client |
| `examples/plate` | Minimal plate editor demonstrating a bound view |

## Plate view

After building, run `npm start` and open http://127.0.0.1:4182. Open two plate views, bind one, then choose **Show saved check**. Only the selected view highlights. Refreshing a view requires a fresh binding.

An edit clears the mark and invalidates its target immediately. The first save starts immediately and edits made in flight coalesce. The helper also accepts an explicit trailing delay. A matching save acknowledgement makes the latest generation available. The action rechecks its target immediately before changing the UI.

Run `npm test` with the rendering dependencies installed. With Google Chrome installed, `npm run test:browser` checks view targeting, multi-tab locks and recovery. Both suites use the same incremental TypeScript build.

## Managed CAD and native Krita acceptance

The [portable acceptance](examples/cad-paint/acceptance/macos.json) records actual
two-tab saves, one local Gemma material proposal, host cancellation, fixed output
delivery and Krita import/save of both drawings. The imported KRA files retain
all four/five editable paint layers and reproduce the accepted PNG pixels exactly.
The provider sees only the domain description, operator direction, supplied
finishes and missing part labels. The selected kit cannot replace the protected
renderer. Wrong-origin and stale saves are rejected before submission.

Use `.github/workflows/loom-spool.yml` for the fresh-environment recipe. It runs
`managed.test.js` separately with `CAD_PAINT_FIXTURE` set to `vise`, `handwheel`,
`incomplete` and `cancelled`. Cancellation waits for actual renderer activity,
calls the existing host supervisor and requires terminal evidence; both CAD tabs
unlock with no download. The final Python verifier checks catalog hashes,
protected-source update refusals, process reaping and failed/cancelled acceptance
refusals. CI uses a deterministic model fixture on a fresh local port.

For an explicit real-model run, set `CAD_PAINT_REAL_MODEL=1` for the handwheel
fixture; its local observation proxy forwards one request to the selected
`OLLAMA_HOST`. `CAD_PAINT_REAL_KRITA=1` also requests the native document launch.
Keep generated requests and exchange logs private. Complete native readback with:

```sh
python3 -B .github/scripts/qualify-painted-spool.py verify "$CAD_PAINT_TEST_OUTPUT" \
  --krita /selected/krita
```

This invokes Krita's [documented export command](https://docs.krita.org/en/reference_manual/linux_command_line.html)
with an independent resource directory, then checks KRA layers and merged pixels.
It verifies native file import/save, not GUI brush editing. A launch request alone
is insufficient. The former `packPainting` compatibility entry is retired;
the installed domain spool already produces and validates the ORA, so the Krita
bridge no longer carries Python packaging glue or a domain-package peer dependency.
