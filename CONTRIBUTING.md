# Contributing

Use Node.js 22 or later. Run `npm run check`, `npm test`, and `npm run build` before opening a pull request.

Keep CSV parsing in `src/csv.js` and table operations in `src/table.js`. Add a regression test when fixing parsing or export bugs. For UI changes, check the demo with a keyboard and at a narrow screen width. Verify a downloaded file by opening it again.

Bug reports should include the browser, steps to reproduce, and a small CSV that shows the problem. Replace personal or confidential data before sharing a file.
