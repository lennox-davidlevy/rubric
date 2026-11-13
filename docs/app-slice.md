# The app: a vertical slice on Rune

Written 2026-11-13 for one Opus session (or a few). It builds the thinnest path through every layer of the app (step 9 in [plan.md](plan.md)): a native window, an editor, the real page beside it, and one pick accepted from ghost text. Its purpose is a go or no-go on [Rune](https://github.com/anomalyco/rune) as the shell, with numbers. It is a spike: the code may be thrown away, the findings may not.

## Questions for David, before it starts

1. **Packages.** The Linux build needs development headers that are not installed. Run: `sudo dnf install webkit2gtk4.1-devel gtk3-devel libxkbcommon-devel wayland-devel xdotool`. The session cannot. (`xdotool` lets it click and type in the window to check its own work.)
2. **A Mac.** This slice is built and tried on this machine only (Fedora, X11, i3). The Mac path is not written, because it could not be compiled or tried here. Is there a Mac to repeat task 2 on afterward?
3. **Wayland.** The web view library (wry) attaches a child web view on X11 only. The slice does not solve Wayland. It is recorded as a known gap, to decide after the verdict.

## What the slice is

One window. Left: a post, editable, Markdown styled in place. Right: the Hugo page for that post, live. A divider between them that drags to either edge. Typing changes the page. Moving the cursor scrolls the page. A `:::` line shows the server's pick as dimmed text; Tab makes it the line.

Not in it: the drawer, Sites, menus, drafts, takes, themes, Parts, Appearance, Publish, starters, hover, diagnostics, completion, autosave, starting Hugo from the app, packaging, the Mac, Wayland, moving between picks. Do not build any of them, even partly.

## Decisions, made here

| Decision | Choice | Why |
|---|---|---|
| Where the code lives | `app/`, a Rust crate of its own, outside the Bun project | `bun test` and `bun run typecheck` never see it |
| Rune | git dependency pinned to rev `0ca075619d116f8f6e0e3bc8ff815c72c636cac8`, with `rune-kit` from the same rev, and the `[patch.crates-io]` table Rune's README gives ("Depending on Rune", `crates/rune/README.md:2432-2451`: `winit`, `parley_engine`, `wgpu-hal`, `accesskit_windows` from the same rev) | Rune is pre-release; its README says to pin a rev of `dev`, and without the patches it builds against stock crates |
| Toolchain | Rust 1.99.1, edition 2024; `app/rust-toolchain.toml` names the channel only | What Rune's `rust-toolchain.toml` names; installed. Copying Rune's file whole would download a wasm target |
| Package name | `rubric-app` | The process checks below look for it |
| Web view | `wry`, attached as a child of Rune's window with `build_as_child` | The page is Hugo's HTML, so it needs a browser engine; Rune has no API for hosting a native view |
| The server | The existing one, unchanged: `bun <repo>/src/cli.ts lsp --stub`, stdio, cwd the repo root | The app is a client, not a second copy |
| Jev | Never called. The server always runs with `--stub` unless the app is started with `--live` | Live calls cost money and use the key; only David passes `--live` |
| Hugo and the relay | Started by hand with `bun run play`, on ports of their own | Starting them from the app is step 8, not this slice |
| The site | `sites/app-slice/`, a new copy of `sites/demo/` with a long post | David is live-testing `testing/` in Neovim at the same time; two servers must not write one site |
| Ports | Hugo 1425, relay 1426 | 1415 and 1416 are David's |
| Document sync | The whole text in every `didChange` | Rune's `on_change` gives no delta; a post is a few KB; the server reads the whole text anyway |
| Ghost text | A separate dimmed text element drawn at the caret, shown only while the caret is at the end of the line | Rune's spans style existing bytes only; nothing can be inserted that is not in the buffer |
| Accept key | Tab. With ghost text showing it accepts; with none it is consumed and does nothing | One key, as the plan says. Rune's key routing would otherwise move focus on Tab |
| Picks | Only the first is shown. No next or previous | Moving between picks does not bear on the verdict |
| The closer | The app adds the closing `:::` as Neovim does (`editors/nvim/lua/rubric/init.lua:96-120`) | A `:::` line with no closer is an unclosed block: the server still offers a pick, but the page never draws the part (`src/core/preprocess.ts:122-124`) |
| Save | Ctrl+S writes the file whole (temp file, then rename). Nothing saves by itself | The server works from the editor's text; saving is only for keeping it |

## What exists, verified

Read these before writing code. File and line numbers are from 2026-11-13.

**The server** (`src/server/main.ts`, `src/server/workspace.ts`)

- The client must wait for the `initialize` response before sending `initialized` and `didOpen`. `onInitialize` is async (`main.ts:48-58`) and the server handles messages in parallel; an early `initialized` finds no site, and the `didOpen` is dropped (`main.ts:154-165`).
- The catalog is found from `themesDir` in the site's `hugo.toml`, relative to the site (`src/site.ts:44-49`). A copy of a site somewhere else must rewrite `themesDir` to an absolute path, as `test/workspace.test.ts:21-23` does.
- Started by Neovim as `bun <repo>/src/cli.ts lsp …` with cwd the repo root (`editors/nvim/lua/rubric/init.lua:461-467`). Standard LSP framing over stdio. No `initializationOptions`.
- The site root is the folder holding `rubric.md`, found upward from `rootUri` or the first workspace folder (`main.ts:49-50`).
- Capabilities: `textDocumentSync: 2` (incremental; a change with no `range` is the whole text, which is valid), `inlineCompletionProvider: true`, `hoverProvider`, `completionProvider` (`main.ts:140-151`).
- On each change the server writes `content/<rel>` and `.rubric/sidecar/<rel>.json` 100 ms later (`drawMs`, `workspace.ts:257`), and Hugo's live reload redraws the page in place.
- Ghost text: the client sends `textDocument/inlineCompletion`. The server holds the reply until it has an answer (up to 5 s) and returns one item per pick (`main.ts:313-327`):
  ```ts
  { insertText: string,                       // what to show, e.g. " -> quote"
    range: { start: {line, character}, end: {line, character} },
    command?: { title: "Pin", command: "rubric.pin",
                arguments: [{ line: number, text: string, drop?: …, build?: true, change?: true }] } }
  ```
  `rubric.pin` is carried out by the client. Neovim does two things on accept, as one undo step: it inserts `insertText` at `range` (which can carry a starter body after a newline, `workspace.ts:537-542`), then runs the pin, which replaces the whole line `line` with `text` and handles `drop`. Read `editors/nvim/lua/rubric/init.lua:481-505` and mirror both steps exactly.
- The stub (`src/server/stub.ts:25-35`) gives `::: a quote` one pick with a pin. Words that name no part give one pick that offers a draft (`build: true`), which this slice shows and does not act on.
- The client sends `rubric/cursor {uri, line}` (0-based line; the server forwards it to the relay, `main.ts:183-192`).
- Notifications the server sends that the slice ignores without error: `rubric/picks`, `rubric/starters`, `rubric/drafted`, `rubric/alone`, `textDocument/publishDiagnostics`, and any `window/*` or `client/registerCapability` request (answer requests with `null`).

**The preview** (`scripts/play.ts`, `catalogs/universal/assets/js/rubric-live.js`)

- `RUBRIC_PORT=1425 RUBRIC_RELAY_PORT=1426 bun run play sites/app-slice` builds the site, runs `hugo server` on 1425 and the relay on 1426. It stops Hugo only on SIGINT (`scripts/play.ts:263`): stop it with `kill -INT`, never a plain `kill`, or Hugo is left running.
- The server and the page find the relay at `relay` under `[params.rubric]` in the site's `hugo.toml`, default `http://127.0.0.1:1416`. So `sites/app-slice/hugo.toml` must set `relay = "http://127.0.0.1:1426"`.
- The page listens to the relay. When a cursor event names another page it goes there by itself (`rubric-live.js:184-194`). The relay replays the last cursor to a page that connects later. So the web view loads `http://127.0.0.1:1425/` once, and the first `rubric/cursor` takes it to the post. The app maps no URLs.

**Rune** (source at the pinned rev; clone it to read, do not vendor it)

- An app is an `AppSpec::<State> { …, ..AppSpec::new(title, size, State::default, view) }`, with `fn view(s: &State, cx: &mut Cx<State>) -> El`. Handlers get `&mut State` and optionally `&mut Tx`. Smallest example: `examples/hello/src/main.rs`. It uses `rune::run(spec)`; this app needs `App::new(spec).on_window(…).run()` instead.
- `AppSpec`'s `init`, `view` and `poll` are `fn` pointers, not closures (`crates/rune/src/tooling.rs:17-38`). So the language client and the page live in `State`, and threads reach `State` only through the handle below.
- From another thread: `App::handle()` gives a cloneable `AppHandle<S>`; `handle.update(|s, tx| …)` runs on the UI thread (`crates/rune/src/app.rs:574, 786`; used in `examples/background/src/main.rs:198-209`).
- Text: `TextEdit` (`crates/rune/src/edit.rs`: `text`, `range()`, `set_caret`, `set_selection`, `replace_text`, `insert`). A whole Markdown note in one multi-line field inside a scroll viewport is what `crates/rune/examples/long_note.rs` measures; start from it. `rune_kit`'s `TextArea` (`crates/rune-kit/src/text_input.rs:383-548`) is the other way in, used in `crates/rune-kit/examples/rich_editor.rs`. Use whichever takes spans and scrolls a long note; say which in the findings.
- `Span { start, end, weight, size, color, mono, italic, bg, underline }` (`crates/rune/src/text/span.rs`), byte offsets into `edit.text`.
- Hook names differ by layer. On core `rune`'s field: `on_input_change` and `on_input_key` (`crates/rune/src/el/input.rs:192, 216`). On `rune_kit`'s `TextArea`: `on_change` and `on_key` (`crates/rune-kit/src/text_input.rs:493, 497`). `El::on_key` is a different hook. The change hook is `Fn(&mut S, &mut Tx)`: no range, no delta.
- Key routing (`crates/rune/README.md:246-262`): the field's key handler (step 4) runs before focus navigation (step 5, where Tab moves focus), which runs before the field's own editing (step 6). So the field's key handler must consume Tab every time.
- Return needs `.on_submit(|s, _| s.edit.insert("\n"))`; without it Return goes to the default button (`crates/rune/examples/long_note.rs:56-58`).
- Nothing reports a caret move that is not an edit. Compare `edit.range()` with the last value in `AppSpec::poll`, and treat a difference as a caret move.
- `TextEdit::replace_text` throws away undo history (`crates/rune/src/edit.rs:469`). To change text and keep undo, use an undo group with `set_selection` and `insert`.
- `Cx::caret(key) -> Option<[f32; 4]>`: the caret's line rectangle in window points (`crates/rune/src/runtime/cx.rs:312`). `Cx::layout(key) -> Option<[f32; 4]>`: an element's rectangle in window points (`crates/rune/src/runtime/layout_read.rs:239`). `El::on_layout(|s, rect| …)` calls back with an element's rectangle when it changes (`crates/rune/src/el/layout_watch.rs:36`).
- The native window: `App::on_window(|window| …)` runs on the UI thread when the window is created; `window.with_raw_handle(|h| …)` lends the raw handle and it must not be kept past the callback (`crates/rune/src/window/handle.rs:176-182`). An X11 window id copied out of it is a plain number and may be kept; handle both the Xlib and the Xcb variant. Keep `on_window` cheap: it runs before the first frame.
- Drag: `El::on_drag(|s, drag, tx| …)`, with `drag.dx`, `drag.dy`, `drag.phase` (`crates/rune/src/el/handlers.rs:61, 140-163`). `dx` is the travel since the press, so remember the split at `Phase::Down`. `rune_kit::shell::SplitView` exists but brings a title band and a card; do not use it.
- `AppSpec::poll` runs at the start of every frame, not while the app is idle.
- Headless: in tests, `Runtime::new(state, view, (w, h), Env)`, `rt.frame(dt)`, `rt.find(key)` (`examples/hello/src/main.rs:39-56`). From the binary in a debug build: `--snap out.png`, `--script file.json`, `--tree tree.json` (Rune's README, "Headless"). These never open the real window, and the web view does not exist in them. For the real window's first frame, `RUNE_READY_DIR` writes `ready_ms` from process start (README, "Launching fast").
- On Linux: no spellcheck (`crates/rune/src/spell.rs:27-37`), no native menus, IME through winit only.

**wry** (read its current docs; do not work from memory)

- `WebViewBuilder::build_as_child(&window)`: on Linux, X11 only; `gtk::init` must have been called on that thread, and GTK's loop must be pumped; the web view does not resize by itself, so call `set_bounds`.

## Tasks

In order. Each ends with `cargo test` passing in `app/` and with every line under "The session checks" true. Lines under "David checks" are rows in the table at the end; the session does not claim them.

Processes: record the PID of everything the session starts (the app, `play`, which it stops with `kill -INT`) and stop only those. After each task, `pgrep -fa 'rubric-app|hugo server|scripts/play.ts|cli.ts lsp|WebKitWebProcess|WebKitNetworkProcess'` must show none of the session's own. Never stop a process the session did not start.

Builds: the first Rune build is long; run it in the background with a 30-minute limit. Set `[profile.dev.package."*"] opt-level = 2` in `app/Cargo.toml` so headless tests are fast, and keep documents in headless tests to a few lines. `cargo test` without `--ignored` finishes in under 30 seconds after the first build.

To look at the window: `maim` takes a screenshot; `xdotool` clicks and types in it.

### Task 1: the window and the editor

**Goal.** `cargo run --manifest-path app/Cargo.toml -- sites/app-slice/pages/posts/long.md` opens a window with the post in an editor that types, selects, scrolls, undoes and saves.

**Files.** `app/Cargo.toml`, `app/rust-toolchain.toml`, `app/src/main.rs`, `app/src/state.rs`, `app/src/editor.rs`, `app/src/markdown.rs`; `sites/app-slice/` (a copy of the tracked files of `sites/demo/` only, from `git ls-files sites/demo`, with `relay` set as above, `rubric.md` holding `::: theme paper`, and `pages/posts/long.md`: about 3,000 words of plain Markdown with headings, bold, a list, a blockquote, and no `:::` lines); `app/.gitignore` holding `target/`. The root `.gitignore` already covers the site's generated folders.

**Interfaces.**
```rust
// state.rs
pub struct State {
    pub path: PathBuf,        // the Markdown file
    pub edit: TextEdit,
    pub version: i32,         // LSP document version, starts at 1
    pub saved: String,        // text as last written, to know whether it is dirty
    pub split: f32,           // 0.0 = page only, 1.0 = writing only; starts 0.5
    pub ghost: Option<Ghost>, // task 4
    pub last_range: (usize, usize), // to notice caret moves in `poll`
    pub client: Option<Client>,     // task 3
    pub page: Option<Page>,         // task 2
    pub uri: String,                // file:// of `path`
    pub cursor_line: Option<u32>,   // last line sent as rubric/cursor
}
// markdown.rs
pub fn spans(text: &str, theme: &Theme) -> Vec<Span>;
pub fn save(path: &Path, text: &str) -> io::Result<()>; // temp file beside it, then rename
```
`spans` styles: ATX headings (larger and bold by level 1 to 3, the `#` marks dimmed), `**bold**` (bold, the stars dimmed), `*italic*`, a line starting with `:::` (accent color), fenced code (mono, nothing styled inside). It runs over the whole text on every change; no incremental pass.

The closer, in `editor.rs`: `pub fn closer(edit: &mut TextEdit)`, called after each change, mirrors `editors/nvim/lua/rubric/init.lua:96-120`: the same condition for adding a closing `:::` under a newly typed opener, the same placement, the caret left where it was, in the same undo step as the keystroke. Tab is consumed in the field's key handler and does nothing yet.

**The session checks.** A screenshot shows the post with large headings and bold text, in a centered column at most 720 points wide with no line numbers. Typing with `xdotool` lands in the post, and Return makes a new line. Ctrl+S changes the file on disk (compare with a copy taken before; the site is untracked, so `git diff` shows nothing).

**David checks.** Rows 2, 3 and 12.

**Tests.** `markdown::spans`: a heading line gets a size on its text and a dim color on its `#`; `**a**` gets bold on `a`; nothing inside a code fence is styled; offsets are right after a line holding `é` and an emoji. `save`: the file holds the new text and no temp file is left. `closer`: typing an opener on an empty line adds the closer below and leaves the caret on the opener; the cases where Neovim adds none add none. Headless `Runtime`: a typed character lands in `state.edit.text` and `state.version` goes up by one; Tab leaves the text and the focus unchanged.

**Not to touch.** Anything outside `app/` and `sites/app-slice/`.

### Task 2: the page beside it

**Goal.** The right pane is a web view showing `http://127.0.0.1:1425/`, and a divider between the panes drags.

**Files.** `app/src/page.rs`, `app/src/split.rs`, `app/src/main.rs`, `app/Cargo.toml` (`wry`, `gtk`).

**Interfaces.**
```rust
// page.rs
pub enum PageCmd { Bounds { x: i32, y: i32, w: u32, h: u32 }, Load(String), Close } // physical pixels
pub struct Page { /* sender to the thread that owns the web view */ }
impl Page {
    /// Returns at once. The web view is made on its own thread; `loaded` is called
    /// there with each URL that finishes loading, `failed` once if it cannot attach.
    pub fn attach(parent_x11_window: u32, url: &str,
                  loaded: impl Fn(String) + Send + 'static,
                  failed: impl FnOnce(String) + Send + 'static) -> Page;
    pub fn send(&self, cmd: PageCmd);
}
// split.rs
pub fn snap(fraction: f32) -> f32; // below 0.08 -> 0.0, above 0.92 -> 1.0, else unchanged
```
The view lays out two panes in a row by `state.split`, with a 6-point divider between them carrying `on_drag`. The right pane is an empty element keyed `"page"` with `on_layout`, which sends `Bounds` (points times the window's scale) each time its rectangle changes. At `split == 1.0` send a zero-size rectangle. Each loaded URL is logged to stderr as `page loaded <url>`.

**How to attach, in this order. Stop at the first that works and record which.**

- **A. GTK on a thread of its own.** In `on_window`, copy the X11 window id out of the raw handle. Start a thread that calls `gtk::init`, rebuilds a raw X11 window handle from the id, calls `build_as_child`, and runs `gtk::main()`. `PageCmd`s reach it through an `mpsc` channel drained on that thread's main context (`MainContext::invoke`, or what the `glib` version wry brings offers; its older channel type is deprecated). Rune's loop never pumps GTK, so typing cannot wait on the web view.
- **B. GTK on the UI thread.** `gtk::init` and `build_as_child` inside `on_window`; pump with `while gtk::events_pending() { gtk::main_iteration_do(false) }` from `AppSpec::poll`, and keep frames coming with a thread that calls `handle.wake()` every 16 ms. Record what it costs while idle (CPU percent from `top`).
- **Neither works:** stop. Write what failed, with the exact errors, in the findings. That is a result, not a failure of the task. Do not try a separate top-level window, XEmbed, or another web view library.

**Focus.** A child X11 window tends to keep keyboard focus after a click in it. If typing does not return to the editor after a click there, set X input focus to the parent window id on a pointer press in the writing pane, and try again before recording it as a failure.

**The session checks.** With `play` running on 1425: stderr shows `page loaded http://127.0.0.1:1425/…`; a screenshot shows the page in the right pane; after an `xdotool` drag of the divider, a second screenshot shows both panes at the new sizes and the page filling its pane; after a click in the page and a click in the editor, typed text lands in the editor.

**David checks.** Rows 5, 6 and 7: how the page keeps up while dragging is judged by eye.

**Tests.** `snap` at 0.05, 0.5 and 0.95. Headless: a drag of the divider by a known distance changes `state.split` by that distance over the window's width. The web view has no automated test; its checks are rows in the table below.

**Not to touch.** `scripts/play.ts`, the catalog, anything in `src/`.

### Task 3: the server

**Goal.** The app starts the language server, opens the post in it, and sends every change, so typing changes the page.

**Files.** `app/src/lsp.rs`, `app/src/position.rs`, `app/src/main.rs`, `app/Cargo.toml` (`serde`, `serde_json`).

**Interfaces.**
```rust
// lsp.rs
pub fn encode(msg: &serde_json::Value) -> Vec<u8>;            // Content-Length framing
pub struct Decoder { /* buffer */ }
impl Decoder { pub fn push(&mut self, bytes: &[u8]) -> Vec<serde_json::Value>; }

pub enum Incoming {
    Response { id: i64, result: Result<serde_json::Value, String> }, // Err holds the error's message
    Request { id: serde_json::Value, method: String },   // answered with null by the client
    Notification { method: String, params: serde_json::Value },
}
pub struct Client { /* child process, sender to the writer thread, next id */ }
impl Client {
    /// Spawns `bun <repo>/src/cli.ts lsp [--stub]` with cwd `repo`, sends initialize
    /// (rootUri = site root), blocks until its response arrives, then sends initialized.
    /// Call it from a thread of its own, never the UI thread. `on` is called on a reader thread.
    pub fn start(repo: &Path, site: &Path, stub: bool,
                 on: impl Fn(Incoming) + Send + 'static) -> io::Result<Client>;
    pub fn notify(&self, method: &str, params: serde_json::Value);
    pub fn request(&self, method: &str, params: serde_json::Value) -> i64; // returns the id
    pub fn stop(self); // shutdown, exit, then kill if still alive after 500 ms
}
// position.rs
pub fn line_char(text: &str, byte: usize) -> (u32, u32); // 0-based line, UTF-16 column
pub fn line_range(text: &str, line: u32) -> std::ops::Range<usize>; // bytes, without the newline
```
`repo` is the parent of `env!("CARGO_MANIFEST_DIR")`. The site root is the nearest folder above the file that holds `rubric.md`. `--stub` is passed unless the app's own arguments include `--live`.

On start, from a background thread so the first frame does not wait: `Client::start`, then `textDocument/didOpen` (`languageId: "markdown"`, version 1, the text as it is then), then `rubric/cursor` for the caret's line; the client is put into `State` through the handle. Changes made before it is there need no replay, since `didOpen` carries the text. On every change: `textDocument/didChange` with the new version and `contentChanges: [{ "text": <whole text> }]`. When the caret's line changes (noticed in `poll`): `rubric/cursor { uri, line }`, never twice for the same line. On quit: `didClose`, then `stop`, and the child must be gone.

**The session checks.** With `play` running: after typing a sentence with `xdotool`, `sites/app-slice/content/posts/long.md` holds it within a second; `curl -N http://127.0.0.1:1426/events` shows a cursor event with the new line after the caret moves; `page loaded` shows the post's URL after the first cursor; after quitting, the server process the app started is gone.

**David checks.** Rows 2 and 4.

**Tests.** `Decoder`: one message split across three pushes; two messages in one push; a body with multi-byte characters. `line_char`: a column after `é` and after an emoji (two UTF-16 units). Headless: a typed character queues a `didChange` whose text is the whole document and whose version is one more (the client behind a small trait or channel so the test reads what was sent). One ignored test (`#[ignore]`, run with `cargo test -- --ignored`, because it starts Bun): against a temporary copy of `sites/app-slice/` (tracked files only, `themesDir` rewritten to the absolute path of `catalogs/`), start the real server with `--stub`, open the post, change it, and `content/posts/long.md` under the copy appears holding the typed sentence; afterward the child is gone.

**Not to touch.** `src/`, `editors/`. If the server seems to need a change, write it in the findings and work around it.

### Task 4: ghost text and accept

**Goal.** A `:::` line shows the server's pick dimmed after the caret, and Tab makes it the line.

**Files.** `app/src/ghost.rs`, `app/src/editor.rs`, `app/src/state.rs`, `app/src/main.rs`.

**Interfaces.**
```rust
// ghost.rs
pub struct Pick { pub show: String, pub at: (u32, u32), pub pin: Option<Pin> } // show = insertText, at = range.start
pub struct Pin { pub line: u32, pub text: String, pub acts: bool, /* drop, as Neovim's rubric.pin reads it */ } // acts = false when build or change is set
pub struct Ghost { pub line: u32, pub version: i32, pub pick: Pick }  // the first item only
pub fn wants(text: &str, caret: usize) -> Option<u32>;  // the caret's line, when it starts with ":::" and the caret is at its end
pub fn parse(result: &serde_json::Value, line: u32, version: i32) -> Option<Ghost>;
pub fn accept(edit: &mut TextEdit, ghost: &Ghost);      // insert, then pin, as one undo step; see below
```
`accept` does what Neovim does (`init.lua:481-505`): inserts `show` at `at`, then carries out the pin, inside one undo group built from `set_selection` and `insert` (never `replace_text`), so one undo brings the words back. The caret ends where Neovim leaves it.

After each change, and each caret move, when `wants` gives a line: send `textDocument/inlineCompletion` with `position` from `line_char` and `context: { triggerKind: 2 }`, and remember the request's id with the document version. A reply for an older version, or for a line the caret has left, is dropped. `state.ghost` is cleared by any change and by the caret leaving the line.

Drawing: while `state.ghost` is set and `wants` still gives its line, a text element with `pick.show`, in the muted text color, placed at the right edge of `cx.caret("editor")`, taking no pointer events.

Keys, in the field's key handler: Tab with a ghost showing whose pin acts calls `accept` and sends the change as any edit. Tab is consumed in every case. A pick whose pin carries `build` or `change` is shown, and Tab on it does nothing (it opens a menu in Neovim, which this slice does not have).

**The session checks.** With the stub server and `play` running: on a new empty line, typing `::: a quote` with `xdotool` leaves an opener and a closer in the text; a screenshot shows dimmed text after the caret; after Tab, the line in the editor is the part's plain form, and `content/posts/long.md` holds the part's shortcode in place of an unclosed block.

**David checks.** Rows 8, 9, 10 and 11.

**Tests.** `wants`: true at the end of a `:::` line, false mid-line, false on a plain line. `parse`: an item with a pin, an item without one, an empty result. `accept`: the line becomes the pin's text, other lines are untouched, a starter body in `show` is kept, `drop` behaves as in `init.lua:486-504`, and one undo restores the words. Headless: with a ghost set, Tab changes the line and queues a `didChange`; with none set, or with a pin that does not act, Tab changes nothing. In the ignored test from task 3: `::: a quote` typed into the real stub server returns at least one pick with a pin.

**Not to touch.** The server's ghost format. Show `insertText` exactly as sent.

### Task 5: measure, and write the findings

**Goal.** Numbers for the verdict, in `docs/app-slice-findings.md`.

**Files.** `app/src/bin/typing.rs` (or an example), `docs/app-slice-findings.md`.

**Measure, in a release build (`--release`, with Rune's `tooling` feature if the headless flags need it).**

| What | How | Budget |
|---|---|---|
| Process start to first frame of the real window | `RUNE_READY_DIR` (`ready_ms`, Rune's README, "Launching fast"), 10 runs, median | 150 ms |
| Process start to the page showing | Time from the top of `main` to the first `page loaded`, 10 runs, median, with `play` already running | 1,000 ms |
| One typed character in the 3,000-word post, with spans on | As `crates/rune/examples/long_note.rs` does: headless, 60 keystrokes at the start, middle and end; CPU for the input and the frame that commits it; median and p95 | p95 4 ms |
| `markdown::spans` over the 3,000-word post | 100 runs, median | 1 ms |
| Idle CPU with the window open and nothing happening | `top`, 30 s | under 1% |
| Memory with the post and the page open | resident size of the app, and of the web view's processes separately | recorded, no budget |

A missed budget is reported with its number. Spend at most an hour making one pass; do not redesign to pass it.

**The findings file holds:** each number against its budget; which attach approach worked (A or B) and what the other did; every place Rune lacked something and what was done instead; every place the code reaches around Rune's public API; what broke on X11 (focus, resize, scale); what was not tried (Mac, Wayland, IME, HiDPI if this screen is not); and the Rune rev. No recommendation: the verdict is David's.

**Tests.** None new.

## To try by hand

For David, when the session is done. Start `RUBRIC_PORT=1425 RUBRIC_RELAY_PORT=1426 bun run play sites/app-slice` in one terminal, then `cargo run --release --manifest-path app/Cargo.toml -- sites/app-slice/pages/posts/long.md` in another.

| # | Do | Expect |
|---|---|---|
| 1 | Start the app | Window with the post on the left, ready to type at once; the page on the right within a second |
| 2 | Type a paragraph fast | Letters appear with no lag; the page gains the paragraph in place |
| 3 | Hold a key down for five seconds mid-post | No stutter in the editor; the page catches up when the key is released |
| 4 | Move the caret from top to bottom | The page scrolls to follow |
| 5 | Drag the divider left, right, and to each edge | Both panes resize together; each edge snaps; dragging back restores both |
| 6 | Resize the window | The page stays in its pane |
| 7 | Click a link in the page, then click in the editor and type | The page goes there; typing goes to the editor |
| 8 | On a new empty line type `::: a quote` | A closing `:::` appears below; dimmed pick after the caret |
| 9 | Press Tab | The line becomes the part; the page draws it |
| 10 | After row 9, undo once | The words come back |
| 11 | Press Tab on a plain line | Nothing changes; the caret stays in the editor |
| 12 | Ctrl+S, then `cat` the file | It holds what was typed |
| 13 | Quit, then `pgrep -fa 'cli.ts lsp --stub\|WebKitWebProcess'` | Nothing |
| 14 | Type plain prose in Neovim on a post in `testing/`, and the same in the app | The app feels at least as immediate |

Row 14 is the one that decides. Do not open `sites/app-slice` in Neovim: its server is the live one, so a `:::` line there calls Jev, and two servers would write the same page.

## Rules for the session

- No commits. When a task is done and its tests pass, say so and give a one-sentence commit message.
- No call to Jev, no drafts, no bench runs, no probes. Never pass `--live`. Never read `.env`.
- Change nothing outside `app/`, `sites/app-slice/` and `docs/app-slice-findings.md`. No existing file is edited.
- David is testing in Neovim on `testing/` with `bun run play` on 1415 and 1416. Do not use those ports, that site, or stop those processes.
- American English in code, comments and docs.
- Anything the writer sees is one or two words that state the fact. The slice shows only the pick.
- Stop and report, with the exact error, when a step fails for a reason outside the code (a missing package, a Rune build failure at the pinned rev, a display problem). Do not move the pin to another rev without saying so in the findings.

## Risks

| Risk | What it would show | What then |
|---|---|---|
| The child web view does not attach to Rune's X11 window, or loses input focus | Task 2 fails or row 7 fails | The verdict is no for Rune as the whole shell; the fallback is a system-webview shell with a browser editor, and the design is unchanged |
| GTK and Rune's loop interfere | Stalls while typing with the page open | Approach A is there to avoid it; if only B works, the idle cost decides |
| Rune's editor is slow or lacks scrolling for a long styled post | The typing budget is missed | Reported; one field per block (`long_note --blocks`) is the next thing to try, in a later session |
| Ghost text drawn as a separate element drifts from the caret | Row 8 looks wrong on wrapped lines | Reported; it is a reason to ask Rune for inline virtual text |
| Rune at the pinned rev does not build on Fedora | Task 1 cannot start | Stop and report |
| Wayland | Not tested | Known gap; decide after the verdict |
