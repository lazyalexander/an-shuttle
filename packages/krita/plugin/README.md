# an-shuttle live update for Krita

A Krita Python plugin that lets the CAD studio update one open working document
in place. Start the studio with `npm run studio -- --live`; each confirmed CAD
revision is rendered while CAD stays editable, and only the newest accepted
painting reaches Krita.

The working document (`paintings/<drawing>/working.kra`) has two groups:

| Group | Owner | Behaviour |
| --- | --- | --- |
| `手绘` | user | Never written by the shuttle |
| `agent 渲染` | agent | Locked; its layers are replaced by each accepted painting |

While a revision renders, Krita only shows "正在更新到第 N 版" and the hand group
stays editable. The window is disabled just for the replacement and save. If a
render layer was unlocked and painted on, a copy moves into `手绘` before it is
replaced. Older or repeated revisions are refused. The shuttle records the
revision and render-layer digests in `working.kra.an-shuttle.json` beside it.

## Install

1. `python3 -B packages/krita/plugin/pack.py an_shuttle_live.zip`
2. In Krita choose Tools → Scripts → Import Python Plugin from File, select the
   zip and enable the plugin when asked (or later under Settings → Configure
   Krita → Python Plugin Manager), then restart Krita.
3. The plugin listens on `~/.an-shuttle/krita.sock`. Set
   `AN_SHUTTLE_KRITA_SOCKET` for both Krita and the studio to change it.

The socket accepts only the current user. As elsewhere in an-shuttle, same-user
processes are trusted; host-issued delivery grants are not implemented yet.
Updates written through the API are not in Krita's undo history.

A preserved layer is a copy of the whole render layer, so it also carries the
agent pixels that were there when the user painted on it.

`test_core.py` checks the update rules without Krita. On 2026-11-06 the plugin
ran in Krita on macOS through the same rules and over the local socket: create,
replace in place, preserve a painted render layer, refuse a stale revision and a
bad request. The saved document's merged image matched the expected composite
pixel for pixel. That run called the plugin directly, not from a live studio.
