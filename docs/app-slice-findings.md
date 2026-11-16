# The app slice: findings

From the session of 2026-11-16 that built [app-slice.md](app-slice.md) on branch `app-slice`. Rune at rev `0ca075619d116f8f6e0e3bc8ff815c72c636cac8` (not moved), wry 0.57.2, gtk 0.18.2, Rust 1.99.1, Fedora 42, X11 under i3, an NVIDIA RTX 5090 driving the screen.

## How the session ran the window

The first run opened the window on David's display (`:0`). i3 tiled it into the focused workspace, beside the browser there, so the screenshot caught the browser. When that window was killed, **David's X server crashed** (Xorg SIGSEGV in `nvidia_drv.so`, 16:32:39; Brave crashed in `libGLX_nvidia.so` at the same moment). The timing points at the app's Vulkan window on the NVIDIA driver going away. It was not proven: it happened once, and nothing was run on `:0` again to find out. **Xorg crashed again at 17:15:45, as the app's window opened.** David agreed to the window measure on the real display with each window moved to workspace `6:Slack`; the first release launch started at 17:15:45, David saw it open on `6:Slack`, and Xorg died that second (the same SIGSEGV in the NVIDIA driver, Chromium and Sunshine going down with it). The second launch found the restarted X server closed to it and exited, so exactly one launch reached the display. (The session at first said the run never started, going by a rejected tool call; the files the run left showed otherwise.) Both crashes came with the app's window on the NVIDIA display: one as it closed, one as it opened. The first was the task 1 build, which had **no web view**, so Rune's own window (wgpu on Vulkan, NVIDIA's driver) is implicated, not WebKit.

After that, every check ran on a display of the session's own: Xvfb `:77`, Vulkan limited to Mesa's software driver (lavapipe, `VK_ICD_FILENAMES`), WebKit on software GL, and later a private i3 on that display (its own config and socket), so the NVIDIA driver and David's screen were never touched again. Timings that involve drawing (the first frame) are from llvmpipe there, so they are not the real display's; see task 5.

## Task 1: the window and the editor

- **Editing component.** Core `rune::text_input` (one multi-line field in a scroll viewport, as `long_note.rs`), not `rune_kit::TextArea`: it takes spans, scrolls a long note and needed nothing more.
- **The field's text is white by default**, whatever the theme; on a light theme the text vanished until `.color(theme.text)`, and the caret is white until `.caret(..)`.
- **Return does not report a change.** `on_submit` (which an editor needs so Return types a newline) does not fire `on_input_change`, so the app records that change itself. An app that keeps a document version off `on_input_change` alone loses every newline.
- **The closer** is done in the field's key handler on a typed space (native X11 delivers space as `Key::Text(" ")`), inside one `undo_group`, so the space and the closer are one undo step, as Neovim's keymap on space is. The plan had it "called after each change"; after the change the keystroke is already its own undo step, so it moved to the key. Neovim also treats parts that take nothing inside (`rubric/alone`) as no block; the slice ignores that notification, so such a line counts as an opener.
- **Spans** are made once per change and kept in the state, not in `view`, which runs more often.
- **A 0-wide field loses focus.** When the divider snaps to the left edge (page only), the writing is 0 wide and the field is blurred; it does not come back when the writing shows again. The divider's drag gives focus back to the editor (`Tx::focus`) when it ends with the writing showing.
- **Debug builds warn** that the field has no accessible name; it is labeled "Writing".

## Task 2: the page beside it

- **Attach approach A worked, first try**: GTK on a thread of its own (`gtk::init`, `build_as_child` on a raw Xlib handle rebuilt from the copied window id, `gtk::main`), commands through an `mpsc` channel drained on that thread. B was not tried.
- Commands are queued with `glib::idle_add_once`, not `MainContext::invoke`: `invoke` runs the function on the calling thread whenever that thread can take the default context (before `gtk::main` starts, for one), where the web view isn't.
- wry's X11 child path takes only an Xlib handle (`RawWindowHandle::Xlib`); the app turns an Xcb one into Xlib by its id.
- A window closed before the page's thread reaches `gtk::main` (WebKit still starting) would have hung the quit: `gtk::main_quit` does nothing before the loop runs. A close seen in the first commands now skips the loop (found in review; not reproduced in a window).
- One `Gdk-CRITICAL: _gdk_frame_clock_freeze: assertion 'GDK_IS_FRAME_CLOCK (clock)' failed` at attach, every run; nothing visible comes of it.
- The page pane is an empty element whose `on_layout` sends its rectangle times `cx.env().scale` (Rune has no scale on `Tx` or in `on_layout`, so the view captures it). At writing-only the web view is hidden rather than given a zero size.
- **Quitting: closing the app's one window runs `on_close`, not `on_quit`.** `on_quit`'s comment lists "the last window closing (in the windows still open)", which reads as running in the *other* windows, so with one window none runs it; the session took it to mean the last window too. Only seen on Linux. The web view is closed and its thread joined in `on_close`, which every close runs. Closed from i3, the process exits in about 50 ms and both WebKit processes go with it.
- Checked on Xvfb under the private i3: the page in the right pane; a drag of the divider resizes both and the page fills its pane; a window resize keeps the page in its pane; a link clicked in the page navigates (`page loaded …/posts/long/`), and a click in the editor then takes typing. X input focus stayed on Rune's window throughout, so the plan's fallback (setting X focus on a press in the writing) was not needed. David's i3 on the NVIDIA display is not the same thing: row 7 is David's.

## Task 3: the server

- The app is a plain LSP client of the server as it is (`bun src/cli.ts lsp --stub`, a bridge to the site's process). Nothing in `src/` changed. The bridge finds the site from `rootUri`, makes it absolute and starts the site's process (stub) when none runs.
- `initialize` is sent from a background thread and waited for there; `initialized`, `didOpen` and the first `rubric/cursor` follow through `AppHandle::update`, so the first frame never waits on Bun.
- Measured on Xvfb: the sentence typed was in `content/posts/long.md` **113 ms after the last key** (the server's 100 ms draw delay plus the rest).
- **A caret move is noticed late in `AppSpec::poll`.** Poll runs at the start of a frame, before that frame's input is applied, so each move was seen one frame late, and the last move before the app rested was not seen at all (Ctrl+Home sent nothing until the next key). The app checks the caret in `App::on_frame_drawn` instead and hands a move to the state through `update_if`. Rune has no hook for "the selection changed"; that would be the clean way.
- Each cursor line went to the relay at once and in order (a click, Ctrl+End, Ctrl+Home, then Down six times: 11, 210, 0, 1 to 6), and the page took the post's address from the first cursor (`page loaded …/posts/long/`), as the plan expects. The app maps no URLs.
- On close: `didClose`, `shutdown`, `exit`, stdin closed; the `rubric lsp` process was gone at once, the site's process stayed (it leaves a minute after its last client), and `rubric stop` ended it and Hugo.
- The headless runtime has no `AppSpec::poll` or window hooks, so a test calls what the hook would.

## Task 4: ghost text and accept

- The pick is a separate text element placed at the right edge of `cx.caret("editor")`, in the editor's own style, dimmed. On a one-line words line it sits on the same baseline as the words (screenshot checked). Rune has no inline virtual text; on a words line long enough to wrap, the pick would hang past the column's edge (not tried; row 8 is David's).
- The view reads the caret only while a pick is showing, so it doesn't re-run on every caret move otherwise.
- `accept` mirrors Neovim: `insertText` at its range, then the pin's whole line, then `drop`, all in one `undo_group` of `set_selection` and `insert`. One Ctrl+Z brings the words back, and the pick shows again.
- An answer counts only for the request asked last, at the document version and line it was asked about; any change or a caret leaving the line clears the pick. A pick whose pin carries `build` or `change` shows, and Tab does nothing on it.
- A question counts as open only until its answer arrives, so a caret that leaves the words line and comes back to its end asks again (found in review: the pick otherwise stayed away until the next edit).
- `connected` asks too, so a post opened with the caret on a words line gets its pick (found by a test: the first answer was otherwise never asked for).
- Checked on Xvfb with the stub: `::: a quote` typed on a new empty line left an opener and a closer, the dimmed `→ quote` after the caret, Tab made the line `::: quote` and `content/posts/long.md` held `{{< quote >}}…{{< /quote >}}`; Tab on a plain line changed nothing and the next key typed in the editor.
- Not tested: whether the pick element can take a click. A plain text element has no handlers and isn't selectable, and Rune's `element_at` reports the drawn element, not the one a press would reach, so a test could not tell. A click past a line's end lands the caret at that end either way.

## Task 5: the numbers

Release builds. The typing and spans numbers are headless (`app/src/bin/typing.rs`, `cargo run --release --manifest-path app/Cargo.toml --features bench --bin typing`), so they are this machine's CPU and nothing else, as Rune's `long_note` measures; they leave out GPU upload and presenting. The window numbers were taken on the session's Xvfb with software Vulkan (llvmpipe), after the crash, and are marked so: the real display's are not taken yet (see the end of this section). The post is `sites/app-slice/pages/posts/long.md`: 3,808 words, 19,344 bytes, 210 lines.

| What | Budget | Measured | |
|---|---|---|---|
| One typed character, spans on: CPU of the input and the frame that commits it, 60 keys, three runs | p95 4 ms | p95 0.10 to 0.13 ms at the start, 0.20 to 0.21 ms in the middle, 0.10 ms at the end (medians 0.09 to 0.19 ms) | met, by about 20 times |
| `markdown::spans` over the whole post, 100 runs | median 1 ms | median 0.007 ms | met |
| Process start to the first frame of the real window (`RUNE_READY_DIR` `ready_ms`), 10 runs | 150 ms | median 160 ms (150 to 160; Rune writes it in steps of 10), **on llvmpipe**; one cold run wrote no file in time | missed by 10 ms in software; real GPU not measured |
| Top of `main` to the first `page loaded`, site's process already running, 10 runs | 1,000 ms | median 187 ms (183 to 193) for the site's root; the post itself, after the first cursor, median 235 ms (231 to 246); on Xvfb | met |
| Idle CPU, window open, nothing happening, `top` over 30 s | under 1% | app 0.0%, WebKitWebProcess 0.0%, WebKitNetworkProcess 0.0%, the `rubric lsp` bridge 0.1%; on Xvfb | met |
| Resident memory with the post and the page open | recorded | app 216 MB (on llvmpipe, which keeps its own buffers in the process), WebKitWebProcess 148 MB, WebKitNetworkProcess 85 MB, the bridge 41 MB; the site's process and Hugo are shared with any editor and not counted | |

The page time includes starting Bun for `rubric lsp`, `initialize`, `rubric/serving` and WebKit's load; the web view itself starts at once with `about:blank`, in parallel with the server. No budget was missed by a design choice, so the hour for one pass was not needed.

**Still to measure, on the real display, with David's go:** `ready_ms` and the page time on the NVIDIA screen, idle CPU and memory there, and whether closing the window crashes Xorg again. `app/scripts/measure-window.sh` is the method: ten launches with `RUNE_READY_DIR`, each closed through i3 and waited for (the site's process running first, as its header says).

## Not tried

- **The real display after the crash.** The numbers above that draw are software-rendered.
- **macOS**: not built or run here; see "On the Mac".
- **Wayland**: wry attaches a child web view on X11 only, and Fedora's default session is Wayland. A known gap, as the plan says.
- **IME** (no input method was set up), **HiDPI** (Xvfb ran at scale 1; this screen's real scale was not tried), a words line long enough to wrap with its pick showing, and the hold-a-key row (A3).
- Approach B (GTK on the UI thread): A worked first, so B was not built.

## On the Mac

The app builds for macOS without the page: the web view is fenced to Linux (`#[cfg(target_os = "linux")]`), and elsewhere the window gives no X11 id, so the page is never attached: the app prints `page: the web view attaches to an X11 window only, for now` and runs with the editor and the server. That build was **not compiled here** (no macOS target); it is the first thing to check.

To build and run it there:

1. Rust 1.99.1 through rustup (the `app/rust-toolchain.toml` picks it), Bun, and the repo on the `app-slice` branch.
2. `cargo test --manifest-path app/Cargo.toml` (the first Rune build is long), then `cargo test --manifest-path app/Cargo.toml -- --ignored` for the one against the real stub server.
3. `cargo run --release --manifest-path app/Cargo.toml -- sites/app-slice/pages/posts/long.md`, and the rows of section A in `testing/TESTING.md`.
4. Then write the Mac `Page::attach`: wry's `build_as_child` with Rune's AppKit handle (`RawWindowHandle::AppKit`), on the main thread (AppKit requires it, and Rune's loop is AppKit's, so there is no second loop to run): build it in `on_window`, and carry out `PageCmd`s in an `AppHandle::update` instead of on a thread. That is the plan's approach B without the pumping, and the Mac's half of the verdict.

What is Linux-only today:

- `app/src/page.rs`'s `linux` module: GTK on its own thread, `gtk::init`, `glib::idle_add_once`, the Xlib handle rebuilt from the window id.
- `x11_id` in `app/src/main.rs`, which gives `None` elsewhere, so the page isn't attached.
- The `gtk` dependency (Linux-only in `Cargo.toml`); wry itself is cross-platform.
- The session's way of looking at the window: Xvfb, a private i3, `xdotool`, `maim`, software Vulkan.
- Not checked: whether Rubric's own site process (its socket under `$XDG_RUNTIME_DIR`) runs as is on macOS.

## The verdict: no-go on Linux with NVIDIA until the crash is explained; everything else says go

The slice asked whether Rune can be the shell, the window and the editor, with the page in a system web view beside it. Everything the slice built works, and the numbers it could take are far inside the budgets. But **on David's machine the app's window crashed the X server twice**, taking the whole desktop down, once as the window closed and once as it opened; the first time with no web view in the app at all. An app that can take the desktop down cannot ship, whatever its speed, so as it stands the answer is **no-go**, on Linux with the NVIDIA driver at least.

What would turn it into a go:

1. **The crash, explained.** The two core dumps are in `coredumpctl` (Xorg, 16:32:39 and 17:15:45). Next steps, cheapest first, none run yet: the same window on `:0` drawing with wgpu's OpenGL backend instead of Vulkan (whether Rune lets an app choose it on Linux is unchecked), and Rune's `hello` example alone, to see whether any Rune window does it or only this app; then a report to Rune with the dumps. Every run on the real display only by David, with work saved.
2. **The real display**, once it doesn't crash: A14 (the app at least as immediate as Neovim) and the first frame under 150 ms on the GPU (160 ms in software).
3. **The Mac attach.** The Mac is the other half of the shell, and Wayland is a gap on Linux either way. A Mac where all of this holds would make Rune a go there even while the Linux crash stands.

What the slice shows apart from the crash:


- **Speed.** A keystroke costs 0.1 to 0.2 ms of CPU in a 3,800-word styled post, against 4 ms allowed; the whole-post Markdown pass is 7 µs; idle is 0%. Nothing in the editor waits on the web view, which has a thread and a GTK loop of its own.
- **The web view fits.** Approach A worked first time; the page follows the pane through drags, snaps and resizes, and focus comes back to the editor after a click in the page (under i3 on Xvfb).
- **Little reaching around Rune.** The app uses Rune's public API throughout. The one raw handle is the documented `with_raw_handle` for the window id.

What it cost, all worked around in a line or two, and worth sending to Rune:

- `on_quit`'s comment is easy to read as running when an app's only window closes; it does not (`on_close` does). A doc question to ask, not a bug to report.
- `AppSpec::poll` runs before a frame's input, so a caret move is noticed a frame late, or not at all when the app then rests; there is no hook for "the selection changed" (the app reads it in `on_frame_drawn`).
- `on_submit` does not report a change, so a Return is missed by code that counts changes in `on_input_change`.
- A `text_input`'s text and caret are white by default, whatever the theme.
- A field laid out 0 wide loses focus for good.
- No inline virtual text: the pick is a separate element at the caret, which will not follow a wrap.

The plan asked the findings for no recommendation; the brief for this session (`reference/next-session-app-slice.md`) asked for a go or no-go with reasons, and that later brief is what this follows.

## Rubric's own code: found, not changed

- `rubric <relative site>` (`src/cli.ts`) keeps the root relative; Hugo, run inside the site, resolves it again and fails (`failed to open dir ".../sites/app-slice/sites/app-slice"`). The socket's name is a hash of the root as given, so a relative and an absolute path also make two processes for one site. The session passed absolute paths.
- The catalog is no longer found from `themesDir` in the site's `hugo.toml` (step 8 writes `.rubric/hugo.toml`, and the universal catalog is the default), so a copy of a site needs no rewriting; the slice plan predates that.
