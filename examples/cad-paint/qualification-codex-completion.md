# Codex material completion qualification

Date: 2026-11-06. Dependency: historical material migration at Shuttle
`a709d6739e1cf8748af6c56196979f87a3216a94` (PR #18), with the reviewed
Loom reader `8c87a0ce0a34e1ed5bdb1971d923f64357d17c00`.

Completion and history share one finite Codex CLI 0.166.0 entry. The old Ollama
client and observation proxy are removed from this branch. No new runtime
dependency, model daemon or fallback provider is introduced. The immutable Loom
package continues to supply material instructions, schema and kit validation.
Completion returns material JSON, never executable source. Geometry and local
paths are excluded from the completion brief.

## Verified

- TypeScript build, 12 application/unit checks and four browser checks passed.
- Eight real-Codex protocol checks passed without credentials: history scope,
  adoption and no replay; multi-part completion; extra-part and invalid-value
  refusal; browser cancellation with a delayed valid completion. Cancelled or
  invalid completion creates no kit, render input, native instance or product.
- Both CAD drawings passed signed-in Codex completion, exact material reuse,
  history verification and mixed history-plus-completion. Supplied finishes and
  adopted evidence remained authoritative. The requested model was `gpt-6-sol`.
- Live batch completion also passed for all four vise parts and two missing
  handwheel parts in a single task.
- Exact reuse plus completion requires the same disclosure preflight before
  derived historical data reaches Codex; a local-only grant blocks it.
- Host catalogs, artifact hashes, independent ORA layer reconstruction, exact
  material provenance, immutable-source refusals and native failure/cancellation
  settlement passed. The timing gate retains its 180 ms limit with ten samples.
- Offline direct saves passed for both drawings with `CAD_MATERIAL_CODEX_BIN`
  deliberately pointing to a nonexistent executable.
- The native-render handoff revokes material cancellation; render supervision
  and artifact custody remain with the host.

Private receipts and Codex-native events stay outside the repository. CI uses
one credential-free Responses fixture with the actual pinned Codex binary.
Fixture output does not establish model quality or remote billing settlement.

## Native Krita precision finding

Actual Krita 5.3.4 imports and saves both first-completion and mixed-task ORAs as
editable KRA files: four paint layers for the vise, five for the handwheel.
Alpha is unchanged. Handwheel round trips are byte-exact in RGBA. Each tested
vise round trip changes one partially transparent pixel by at most one RGB code
value out of 255. This also appears in native PNG export. No visual or strict
pixel-equivalence approval is inferred from layer validity.

The optional strict KRA pixel assertion remains unchanged and does not pass for
these vise samples. The known difference is not hidden by a tolerance or by
rewriting accepted artifacts. The operator explicitly accepted complete delivery and editable layers with this
precision finding documented as the completion criterion for this round. The
strict KRA assertion is not reclassified as a pass. Diagnostic encoder experiments
were confined to unaccepted copies; no domain release or accepted bytes changed.
