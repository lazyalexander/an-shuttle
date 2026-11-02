# an-shuttle

An application exposes a small set of operations on a particular view. This first example lets a local controller highlight one parameter in a user-selected plate editor.

With Node 22 or newer, build and start the example.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4182. Open two plate views, bind one, then choose **Show saved check** in the controller. Only the selected view highlights. Set thickness below 6 mm to change the finding. Refreshing the view requires a new binding. The example keeps one plate in memory until the server exits.

The editor calls `beginEdit()` in its input handler. That clears the mark and invalidates the old target immediately. Each input restarts the 180 ms trailing timer. Only a matching save acknowledgement can make that generation available again. The action rechecks the saved document and local generation after its asynchronous read, immediately before changing the UI.

The granted MessagePort accepts `observe_view` and `highlight_parameter`. Pass the observed target unchanged, a unique operation_id and the allowed parameter name. Applied receipts describe a DOM change. A lost receipt leaves the outcome unknown. Source reads and checks work independently of an attached view.

After building, run `npm test` for deterministic timing and source checks. With Google Chrome installed, `npm run test:browser` exercises two real tabs against an ephemeral local server. Both suites use the compiled modules in `dist/`.

The TypeScript request and receipt types are in `protocol.ts`. Messages received over a port and JSON received over HTTP are checked at runtime.
