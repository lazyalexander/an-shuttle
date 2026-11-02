# an-shuttle

An application exposes a small set of operations on a particular view. This first example lets a local controller highlight one parameter in a user-selected plate editor.

With Node 22 or newer, run `node server.mjs` and open http://127.0.0.1:4182. Open two plate views, bind one, then choose **Show saved check** in the controller. Only the selected view highlights. Set thickness below 6 mm to change the finding. Refreshing the view requires a new binding. The example keeps one plate in memory until the server exits.

The editor calls `beginEdit()` in its input handler. That clears the mark and invalidates the old target immediately. Each input restarts the 180 ms trailing timer. Only a matching save acknowledgement can make that generation available again. The action rechecks the saved document and local generation after its asynchronous read, immediately before changing the UI.

The granted MessagePort accepts `observe_view` and `highlight_parameter`. Pass the observed target unchanged, a unique operation_id and the allowed parameter name. Applied receipts describe a DOM change. A lost receipt leaves the outcome unknown. Source reads and checks work independently of an attached view.

Run `node --test view.test.mjs` for deterministic timing and source checks.
