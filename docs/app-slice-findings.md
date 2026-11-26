# The app slice: findings

From the session of 2026-11-16 that built [app-slice.md](app-slice.md) on branch `app-slice`. Rune at rev `0ca075619d116f8f6e0e3bc8ff815c72c636cac8` (not moved), wry 0.57.2, gtk 0.18.2, Rust 1.99.1, Fedora 42, X11 under i3, an NVIDIA RTX 5090 driving the screen.

## How the session ran the window

The first run opened the window on David's display (`:0`). i3 tiled it into the focused workspace, beside the browser there, so the screenshot caught the browser. When that window was killed, **David's X server crashed** (Xorg SIGSEGV in `nvidia_drv.so`, 16:32:39; Brave crashed in `libGLX_nvidia.so` at the same moment). The timing points at the app's Vulkan window on the NVIDIA driver going away. It was not proven: it happened once, and nothing was run on `:0` again to find out. **Xorg crashed again at 17:15:45, as the app's window opened.** David agreed to the window measure on the real display with each window moved to workspace `6:Slack`; the first release launch started at 17:15:45, David saw it open on `6:Slack`, and Xorg died that second (the same SIGSEGV in the NVIDIA driver, Chromium and Sunshine going down with it). The second launch found the restarted X server closed to it and exited, so exactly one launch reached the display. (The session at first said the run never started, going by a rejected tool call; the files the run left showed otherwise.) Both crashes came with the app's window on the NVIDIA display: one as it closed, one as it opened. The first was the task 1 build, which had **no web view**, so Rune's own window (wgpu on Vulkan, NVIDIA's driver) is implicated, not WebKit.

After that, every check ran on a display of the session's own: Xvfb `:77`, Vulkan limited to Mesa's software driver (lavapipe, `VK_ICD_FILENAMES`), WebKit on software GL, and later a private i3 on that display (its own config and socket), so the NVIDIA driver and David's screen were never touched again. Timings that involve drawing (the first frame) are from llvmpipe there, so they are not the real display's; see task 5.

## The Xorg crash

**What it is.** Seven Xorg crashes on this machine come from NVIDIA's X driver (`nvidia_drv.so`). Six end the same way, in Xorg's signal handler (`OsSigHandler`) entered from `nvidia_drv.so + 0x4daa34`. The seventh (18:42:27) was cut short in the dump, with the main thread inside the driver (`nvidia_drv.so + 0x4d9935`, in a DRM call). The one fuller trace (2026-11-07 09:14:06) shows the fault itself: Xorg's `FreePixmap`, called from NVIDIA's X driver. A pixmap is the off-screen buffer a GPU-drawn window presents through, so a window being made, moved or destroyed is where it would show.

| When | Xorg | What was happening |
|---|---|---|
| 2026-11-07 08:34:28 | 21.1.18 | Chrome windows opening and closing (no Rune code in the project yet) |
| 2026-11-07 09:14:06 | 21.1.18 | Chromium windows opening and closing |
| 2026-11-07 09:14:34 | 21.1.18 | the same, 28 s later |
| 2026-11-16 16:32:39 | 21.1.18 | the app's window closing (task 1 build, no web view) |
| 2026-11-16 17:15:45 | 21.1.18 | the app's window opening and moving to `6:Slack` |
| 2026-11-16 18:42:27 | 21.1.22 | the app on `:0` by the session's mistake (below), killed when its close did not land |
| 2026-11-16 19:59:48 | 21.1.22 | David's run of the app: a clean close |

Clients that went down with the server (Brave in `libGLX_nvidia.so`, Sunshine, Chromium) are consequences: a client dying because its server went away (`_XIOError`, then `exit`).

So it is **a fault in this machine's NVIDIA driver**, which Chromium triggered too: a client should not be able to crash the X server. It is not a Rune defect. The app triggers it readily: every time its window appeared on or left this display (4 of 4).

**The 18:42 crash was the session's mistake.** Testing `cycle-window.sh`, the session meant to run it on its private Xvfb. The reboot at 18:33 had emptied its scratchpad, so the file holding the Xvfb and software-rendering settings was gone, the command did not stop when it failed to load, and `DISPLAY` stayed `:0`: the app opened on David's display and Xorg crashed as it was killed. Since then every command the session runs on a display names it inline and first checks that it is a server the session started, and `run-nested.sh` carries its own settings.

**The stack, and what was ruled out.**

- **Xorg: ruled out.** `xorg-x11-server-Xorg` was 21.1.18-1.fc42 (installed 2025-08-23) under `xorg-x11-server-common` and `-Xvfb` at 21.1.22. David upgraded it to 21.1.22-1.fc42 and rebooted at 18:33 on 2026-11-16 (the running server's log reports 1.21.1.22). The crash happened again on 21.1.22 (18:42:27, and 19:59:48 on a clean close).
- **picom: ruled out** (by David, with the 19:59:48 run).
- **The NVIDIA driver 575.64.05 is what is left** (open kernel module, built 2025-07-18). The enabled repo (`rpmfusion-nonfree-nvidia-driver`, Fedora 42) has nothing newer: `dnf upgrade --assumeno 'akmod-nvidia*' 'xorg-x11-drv-nvidia*'` upgrades nothing. **580.159.03 exists for Fedora 42 in RPM Fusion's full nonfree updates repo: untested and not installed.** David is not changing the driver now.
- The `dnf install` of the build packages at 16:23 that day (webkit2gtk and gtk3 devel, 106 packages) changed no Mesa, Vulkan, libglvnd, Xorg or NVIDIA package, so it is an unlikely cause.

**The steps.** A cycle is: open the window, move it to `6:Slack`, keep it there three seconds, close it as i3 does (`app/scripts/cycle-window.sh`). One survival proves little, since Chromium opened and closed many windows on 2026-11-07 and crashed the server three times.

| # | Step | Result |
|---|---|---|
| 1 | The app on Xorg 21.1.22 | crashed (19:59:48, a clean close; and 18:42:27) |
| 2 | Five cycles of `vkcube`, then of Rune's `hello`, to tell any Vulkan window from Rune's | not run: no more app or GPU windows on `:0` for now |
| 3 | The NVIDIA driver 580.159.03 | not tried |

How step 2 would read, if it is run:

| Result | Meaning |
|---|---|
| `vkcube` crashes | Any Vulkan window does it: the driver, not Rune. |
| `vkcube` survives, `hello` crashes | Something Rune's window does triggers the driver bug: a report to Rune with the dumps. |
| Only the app crashes | The trigger is in the app's own window setup. Only the second crash had the web view's X window inside Rune's, so that is the next suspect. |

**Running the app by hand meanwhile: `app/scripts/run-nested.sh`.** It keeps the app's GPU work off the NVIDIA driver: Xephyr as one window on David's display (1600x1000, resizable, without glamor), a private i3 inside it, and the release app inside that, drawing in software (lavapipe through `VK_ICD_FILENAMES`, Mesa's software GL for WebKit). NVIDIA's X driver still handles Xephyr's one window, as it handles every window on the display, but Xephyr draws it with plain X images, no GPU. The app starts the site's process itself, as outside. Closing the Xephyr window, or Ctrl+C, stops all of it, and the site's process too when it was not running before. Checked inside the session's own Xvfb, never on `:0`: the page loads (`page loaded …/posts/long/` at 258 ms), typing reaches the page, the app maps lavapipe and no NVIDIA library, and closing the Xephyr window through an i3 leaves nothing running. Xephyr answers a window manager's close by destroying its window and running on, so the script watches the window, not the process.

**OpenGL instead of Vulkan, not possible as Rune is.** On Linux Rune builds wgpu with the `vulkan` feature only (`crates/rune/Cargo.toml`), so wgpu's OpenGL backend is not in the binary, and `RUNE_GPU_BACKEND` chooses only between wgpu and Rune's Metal backend. Untried, and a code change: the app depending on wgpu 30 with `gles` (Cargo would turn it on for Rune too), and `WGPU_ADAPTER_NAME` naming the GL adapter, which Rune's adapter pick honors across all backends; whether Rune's renderer runs on GL is unknown.

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

## The verdict: go on what the slice measured; on this machine, held until the driver question is settled

The slice asked whether Rune can be the shell, the window and the editor, with the page in a system web view beside it. Everything the slice built works, and the numbers it could take are far inside the budgets. The two desktop crashes on this machine are **not a Rune defect**: they are a fault in this machine's Xorg and NVIDIA stack ("The Xorg crash" above), which Chromium set off three times before Rune was here. But the app sets it off readily (2 of 2), and an app that takes a writer's desktop down is not shippable whoever is at fault, so on Linux with NVIDIA it stays open until the driver question is settled.

What would make it a go without conditions:

1. **The driver question.** The X server is ruled out; the NVIDIA driver 575.64.05 is what is left. A newer driver (580.159.03) not crashing on the app's window, or `vkcube` crashing as readily as the app does, would settle that it is not Rune's to fix.
2. **The real display**, once it holds: A14 (the app at least as immediate as Neovim) and the first frame under 150 ms on the GPU (160 ms in software).
3. **The Mac attach.** The Mac is the other half of the shell, and Wayland is a gap on Linux either way. A Mac where all of this holds would make Rune a go there whatever the Linux crash turns out to be.

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
- A post with no front matter stops Hugo. The first thing in its `content/` file is `{{< rubric-line 0 >}}`, and Hugo reads a file that starts with `{` as JSON front matter (`unmarshal failed: invalid character '{'`). Found in slice 2 with a three-line test post; the session used the sample post, which has front matter.

## Slice 2: a menu and a new part

The plan is [app-slice-2.md](app-slice-2.md), built 2026-11-19 on branch `app-slice-2` and on `main` since 2026-11-20 (PR #9), after David ran section B of `testing/TESTING.md` in the nested window and had no notes. The next slice is [app-slice-3.md](app-slice-3.md). Tab on a `::: new: words` line opens a menu at the caret; the menu drafts, keeps, rerolls (with notes) and cancels; a line under the writing says where the draft is. Every check ran with the stub: no Jev call, no real draft, and "Every theme" was never sent. Windows ran on the session's Xvfb `:77` with lavapipe and its own i3, on a copy of the site in a temporary folder.

### The question: can Rune carry the app's menus?

Yes for a list at the caret; with three things the app does itself.

| What the menu needs | `rune_kit::PopupList` | Done instead |
|---|---|---|
| A list at the caret that takes no focus | Yes: anchored to a keyed element, `active` set from the app's state, so the editor keeps the caret and its key handler moves the row | An invisible 1-point element placed at the caret's rectangle (`Cx::caret`) is the anchor |
| A row chosen by a press, lit under the pointer | Yes (`on_choose`, `on_active`) | |
| To stay inside the writing pane | No: `anchored_fit` flips and clamps against the window, and the page is a native window over the right of it | `menu::place` chooses the side, the left edge and the width from the caret's and the pane's rectangles, and the anchor is put there. A caret's line scrolled out of the pane hangs the menu from the pane's nearest edge |
| A title | No | A first row that cannot be chosen (`disabled`), which Rune draws at half strength. A long one ("Draft failed: the harness could not run (stub)") is cut at the menu's 300 points |
| A line of text (a reroll's notes) | No | `popover::raised` and `popover::anchored` around a real `text_input` that takes the focus; Return gives it back to the editor |
| To close on a press outside | Its scrim (`on_close`) was not used | The menu closes when the caret moves or the text changes. A press on the page or the divider leaves it open |

What fought:

- `Cx::caret("editor")` is none while another field has the focus, so the notes field had no caret to hang from. The anchor reports where it was laid out (`on_layout`), and that is used then.
- Nothing ticks while the app rests, as found before. A parked thread wakes the app once a second while a draft runs or a line about something that just happened shows, and parks again.
- In the headless `Runtime`, state changed outside `update` does not run the view again; the tests deliver the server's messages through `rt.update`.
- `tx.focus("notes")` for a field the same change creates worked.

### The status line

One line under the writing, 28 points, for the line the caret is on: `+ Tab drafts a part`, `◐ drafting 3 s`, `◆ tide-clock drafted · settings pace · Tab keep, reroll, cancel`, `✗ draft failed · Tab retries`; and for 4 s, something that happened elsewhere or just now (`✓ tide-clock kept`, a draft finished on another line, the server's error). The `new:` line itself is gray with nothing drafted, blue while drafting and when ready, orange when failed.

It works and it is far from the eye: the caret is mid-pane and the line is at the bottom. Under the line, as in Neovim, needs a line that is not in the text, which Rune lacks. David's rows B1 and B3 decide whether it is enough.

### The numbers

Release builds. The first three are headless (`app/src/bin/typing.rs`); the rest are the real window on Xvfb, drawn by llvmpipe.

| Budget | Limit | Measured | |
|---|---|---|---|
| One typed character with the menu code in | p95 4 ms | p95 0.24 ms at the start, 0.24 ms in the middle, 0.13 ms at the end; 0.15 ms on a `new:` line with the status line drawn | met; the first slice had 0.13, 0.21 and 0.10 |
| The view's answer to the frame that draws the menu | | median 1.47 ms, p95 1.51 ms | |
| A key in the open menu to its frame | one frame | median 0.08 ms, p95 0.09 ms | met |
| Tab to the menu drawn, stub, 12 times on one line | 50 ms | 5.3 to 7.1 ms after the first; the first 360 ms | met after the first |
| Idle, 10 s each: just opened, caret in the writing, on a `new:` line, menu open, menu closed | under 1% CPU | 0.0 to 0.3% | met |
| While a draft runs | under 1% CPU | not measurable as written: the stub's slowest draft takes 1 s. The second after a choice costs about 3 CPU-seconds on llvmpipe's 16 threads (the menu's exit drawn in software), then 0 to 1% a second while the ticker runs | see below |

- **The first Tab on a line waits for the server**, not the app: `look` asks what the site has near the words and waits up to 700 ms for it (`NEAR_WAIT_MS`), 360 ms with the stub. Later Tabs on the line are answered from its cache. Neovim's menu waits the same.
- **The burst after a choice** is every frame of the menu's exit rasterized on all cores. It says nothing about the GPU path; the native run should watch for it (row B12).

### What differs from the plan

- `menu::place` gives `Place { side, x, y, width }`, not `(Side, f32)`: the left edge and the line it hangs from are the app's to choose too.
- The notes are `State::notes`, a `TextEdit` beside the menu, and `Kind::Notes` holds nothing: Rune's field needs a `&mut TextEdit` that is always there.
- Tab on the offer of a new part (`→ draft a new part` after words nothing fits) makes the line a `new:` line and opens its menu, as Neovim's accept does. The first slice left that Tab doing nothing.
- Esc closes a menu; only the list of similar parts and the notes go back to the menu before, as in Neovim.
- Keys held with Shift or Alt are the editor's too (Shift+Down selects), not only Ctrl and Cmd.
- The server's diagnostics name the post by a URI that escapes fewer characters than the app's (`(`, `)`, `'`, `+`, `@`, `,` stay as they are), so the two are compared unescaped. The review found it; without it a post under a path such as `~/Blog (old)/` got no status at all.

### Not tried

- A real draft (`LIVE=1`, David's row B13).
- Similar parts in the window. The stub does say what is near (`::: new: a quote from the keeper` gives `quote`), and the look, the peek and `use` pass against the real stub server in `app/tests/server.rs`; the list on screen is David's row B14.
- A keep or cancel answered while the notes field has the focus closes the field without handing the focus back to the editor (the review's guess, not reproduced); a click in the writing restores it.
- "Every theme" (row B11): the request is tested headless; nothing sent it to a server.
- A draft longer than a second: the seconds counting up past 1, Stop, and "Keep" on a draft still shown while another is made.
- The menu on the real display, HiDPI, and a menu longer than the pane is tall.

## The native run on Omarchy (2026-11-22)

David moved to Omarchy: Arch, Hyprland 0.56.2 on Wayland, the same RTX 5090 with NVIDIA's open driver 615.78.08, XWayland 24.1.14, WebKitGTK 2.54.1, Rust 1.100. No Xorg server draws the desktop, so the crash above has nothing to happen in.

- **The window opens natively and nothing crashes.** David ran the release app on his desktop, through XWayland. The 75 tests and the two against the stub server pass here.
- **The app runs as an X11 program.** The page attaches to an X11 window only, so under Wayland the app has to take XWayland: `main` drops `WAYLAND_DISPLAY` and sets `GDK_BACKEND=x11` before anything starts (`x11_session`).
- **The page was black** until `WEBKIT_DISABLE_DMABUF_RENDERER=1`: WebKit's DMABUF renderer on NVIDIA's driver. The server and Hugo were serving the post the whole time. `main` sets it unless the environment already has it. It is set on every GPU, not only NVIDIA's; what it costs elsewhere is not measured.
- **Typing is instant in the editor; the page is what lags** (David, row A2, 2026-11-22). Measured from Rune's frame log (`--features bench`, `RUNE_FRAME_LOG`), 394 typed characters on the 100 Hz monitor: a key to the frame handed to the driver is 0.84 ms at the median and 1.0 ms at p95. Without the page (`RUBRIC_NO_PAGE=1`) David feels no delay.
- **Where the page's delay is**, measured with no window (an edit sent to the stub server, 24 times at random intervals): the server writes `content/` 102 ms after the edit (its draw pause, `drawMs` in `workspace.ts`, which starts again with every key), and Hugo says the page is rebuilt 40 to 500 ms after that, 383 ms on average. Hugo's own rebuild is 2 to 3 ms (`.rubric/logs/site.log`); the rest is its file watcher, which gathers changes and acts on a 500 ms tick, with no flag to change it. So the page shows a change 150 to 600 ms after typing pauses, and nothing while it goes on. This is the server's path, the same under Neovim; nothing in it is Rune's or the web view's.

## Slice 3: the designed menus

The plan is [app-slice-3.md](app-slice-3.md), built on branch `slice-3`. Nothing here called Jev or drafted for real.

### Sitting 1 (2026-11-25): the look and the panel

- **A named family resolves to compiled-in bytes.** `AppSpec.fonts` takes Instrument Sans, Literata and JetBrains Mono (`app/fonts/`, about 2.6 MB), and `Family::Named("Literata")` on the writing field finds Literata: it measures differently from the sans, and a name that is not there measures as the sans (`fonts::tests`). A headless render (`--snap`, debug build) shows the writing in Literata and the bars in Instrument Sans.
- **The editor cannot say where a line is.** Rune's field reports the caret's rectangle (`Cx::caret`) and the selection's boxes (`Cx::selection_rects`, for `El::selectable` text), and nothing for any other line. Span decorations (`span_ring`, `TextHighlight`) draw around a line's glyphs, not at its left edge or its right end. So the `new:` line's edge and label are not drawn; the status line carries them, and the line's `:::` keeps the draft's color.
- **What the panel needed that Rune lacks**: a place for a panel that stays inside the writing pane and puts a second one beside the first at its row (`panel::place`, as `menu::place` did for slice 2), and segments that look like the design's (drawn from `row` and `el`; `rune_kit::SegmentedControl` draws its own fill and shadow).
- **Colors change on springs** unless told otherwise: a theme drawn while moving in the list faded over several frames until the panel's changes were made with `Tx::color_motion(Spring::NONE)`.
- **Typing** (release, `src/bin/typing.rs`, with the fonts compiled in): p95 0.15 ms at the start, 0.32 ms in the middle, 0.14 ms at the end, against 4 ms.
- **Not seen by anyone**: the app in a real window with the new look, the list of themes on screen, the pointer over its rows, and a writer's theme file. Those are rows C1 to C6 of `testing/TESTING.md`.
- **A stub server test fails on `main` too**: `a_new_part_is_drafted_rerolled_kept_and_cancelled_with_the_stub` asserts that `sites/app-slice/parts` does not exist, and `sites/app-slice/parts/tide-clock/` is tracked (it came in with 499bfe5). Not changed here.

### Sitting 2 (2026-11-25): the review's fixes, the draft menus, the server's two requests

- **A still pointer took a row.** Rune refreshes hover on every build, so `on_hover_change` fired for the row a panel opened or scrolled under; the list of themes drew Fjord the moment it opened under a resting pointer. Rows now take the focus from `on_pointer_move`, which only a moving pointer sends (`a_still_pointer_under_the_theme_list_chooses_nothing`).
- **A press in a panel took the keys from the writing.** Rune focuses on press; the panel hands the focus back unless the row is a field.
- **The draft menus are panels**, and `menu.rs`, its `PopupList` and the separate notes field are gone. The tests drive every panel by keys and the chip by a press; nothing was seen on a screen.
- **Not seen by anyone**: the panels on screen, the drafter's panel with real tools (the tests answer for the server), a real draft, the seconds counting in the panel's heading, and how `rubric/parts` with words feels against real Jev. Rows C7 to C16 of `testing/TESTING.md`.

### Sitting 3 (2026-11-25): the review's fixes, a placed part, insert

- **The review's two fixes.** A tool that is not installed is drawn dim, passed over by the keys and dead to a press (`Item::off`, `a_tool_that_is_not_installed_cannot_be_chosen`, which fails without it). `rubric/part` with `set` already took a text and a number setting and refused a number that is none; the new test (`a text and a number setting are set…` in `test/part-request.test.ts`) pins it and needed no change to the server.
- **The editor's right-click.** An app's `on_secondary_press` on the field comes before Rune's own field menu (`runtime/input/secondary.rs`: "a field with its own `on_secondary_press` shows that instead"), so the menu could be turned off. But Rune gives the app no way to know where in the text the press landed: the press does not move the caret, and nothing maps a point to a byte (`field_menu` does it with a private `hit`). A right-click could only open the caret's line's menu, wherever it was pressed. So the menus open with Tab only, and the right-click is still Rune's Cut, Copy, Paste. What Rune needs: the text position under a secondary press, or the press placing the caret first, as its own menu does.
- **The server, three additions** (`workspace.ts`): `rubric/part` answers the block's `close`, so Remove takes the closer and keeps the writing; `rubric/parts` marks a part that takes nothing inside (`empty`), so Insert writes no closer for it; and `rubric/peek` also draws a part on an empty line (with its closer) and on a line of words, for Insert part… and the words menu. While such a part is drawn, the notes and starters stay those of the text, so no line moves under the writer.
- **One field at a time.** Rune's `text_input` edits one `&mut TextEdit`, so a panel with several fields (Cite and the words) draws only the focused row as a field; the others show their value as text. A field taking the focus starts from its row's value, and text typed and left without Return is dropped.
- **A setting's change is sent one at a time**: a second while the first is on its way waits for its answer, so it is asked of the line as the first left it.
- **Insert part…'s pause is the window's clock.** The field's change sets a due time and `Tx::wake_after`; `AppSpec::poll` sends `rubric/parts` once it passes. The headless tests drive the same clock.

| Budget | Limit | Measured (release, headless; `cargo run --release --features bench --bin typing -- --server`) | |
|---|---|---|---|
| One typed character | p95 4 ms | p95 0.17 ms at the start, 0.24 ms in the middle, 0.13 ms at the end; 0.17 ms on a `new:` line | met |
| A key in an open menu to its frame | one frame | p95 0.08 ms | met |
| A `new:` line's menu: the answer to its frame | | p95 0.29 ms | |
| A part's menu: both answers to its frame | | p95 0.49 ms | |
| A segment's key, the server's line put in place, and the frame | one frame | p95 0.55 ms in the app; the stub server answers a `set` in 0.05 ms (p95 0.14 ms) | met |
| Tab to the menu: the stub server's two answers | 50 ms | 0.16 ms median, 0.31 ms p95, 4.2 ms the first time | met, without the window's frame |
| Tab to the menu drawn in a window | 50 ms | not measured | |
| Idle | under 1% CPU | not measured | |

The last two need a window. This machine has no Xvfb, and the session opens none on David's display. Started from a terminal, the release app prints `menu drawn N ms` for each Tab, the part's menu included.

- **Not seen by anyone**: every new panel on screen, the page drawing a part on an empty line, a real variant draft, `Add to every site` (never sent; it writes the catalog), Remove from site on anything but a temporary copy, and Cut, Copy and Paste from the menu (they send the key to the writing, untested). While a variant or a part's take drafts, the status line says nothing: it follows `new:` lines only. Rows C17 to C27 of `testing/TESTING.md`.

### Sitting 4 (2026-11-26): the review's fixes and David's live test of section C

- **The keyboard lost after crossing a part's menu (fcitx5 through XWayland).** Each time the highlight crossed a field row, the focus moved between the writing and the panel's field, two text inputs, and Rune resets the window's input method on every focus move (`runtime/input/focus.rs` sets `ime_reset`; `window/platform_sync.rs` then calls `set_ime_allowed(false)` and `set_ime_allowed(true)`). After enough of those fcitx5 stopped handing the app any key; with `XMODIFIERS=@im=none` it never happened. **For Rune:** a focus move from one text input to another need not turn the input method off and on; it could move the input area and keep it enabled. **The fix is in the app:** a field row reached by the keys or the pointer leaves the keys with the writing. The field gets them when it is typed on, given Return or pressed, and gives them back when it is left by Return, Esc, Up, Down or Tab. The first character is kept: a key (`Key::Text`) is typed into the field by the app, and text the input method commits to the writing (`Ime::Commit`, how fcitx5 sends every key) is taken back out by restoring the copy of the writing kept while the row had the focus (`look::typed_on_field`), with its undo history as it was. The headless tests show no focus moving across every row any number of times, and the first character arriving either way (`crossing_every_row_of_a_parts_menu_moves_no_focus`, `typing_on_a_field_row_keeps_the_first_character_as_a_key_or_a_commit`). They could not show the bug before either (4,000 random rounds kept the focus right), so **only David's window can confirm the fix**. `XMODIFIERS` is not set by the app: it would take the input method from writers who need it.
- **Tab in a panel moves, never chooses**, and Shift+Tab moves up.
- **A panel hangs from the left edge of its line's text**, under the line, placed when it opens. The line's offset from the writing field's top is kept (`state::Anchor`), so the caret moving along the line (a setting written) leaves the panel where it is, scrolling carries it with the line (`El::on_layout` reports the field after scrolling), and a resize, which wraps the text again, takes the place from the caret again.
- **The broken theme file that printed nothing.** `load` prints a line for every file it skips, and still does. A file that is not JSON was said, and one with no `theme` object was said (`no theme object`). Three cases said nothing: `{ "theme": {} }`, which resolved with every token falling back and was listed as a theme; a file with nonsense only in roles the app does not read (since sitting 2 only those roles are resolved); and a file not ending in `.json`, passed over unsaid. David's file was gone by this sitting, so which one it was is not known. Now a file with neither `background` nor `text` is skipped and said, and so is a file not ending in `.json`; hidden files (a Mac's `.DS_Store`) are passed over unsaid.
- **The two 52 ms Tabs** are not explained yet. The line now reads `menu drawn 52.5 ms: part, server 50.8 ms`: which menu, and how much of the time was the server's answering, so the next run can say where the time went.
- **The server lets go of a part looked at on a line** when its file's text changes or the file closes, and draws it only while the line is still empty or a line of words (`a part looked at on a line goes when the text changes or the file closes`, which fails without it). A failed take or variant of a placed part now carries its message, as a `new:` line's does.
- **The status line follows a part's take or new variant**: `Drafting` with `Stop`, `Ready` with `Keep`, failed with the reason and `Reroll`, the part and the change asked for as the fact ("Quote, torn edge"), with the same keys as a `new:` line.
- **Kept and Removed are said when the server has answered**: "Add to every site" and "Remove from site" say `Kept` or `Removed` on its answer, and `Failed` with the reason if it refuses.
- **Not seen by anyone**: all of the above on screen, above all the keyboard under fcitx5 (C37 to C39 and C42 of `testing/TESTING.md`), and `app/scripts/clean-test.sh`, which the session was not allowed to run.

### After sitting 4 (2026-11-26): the keyboard, traced

- **The keyboard was still lost after sitting 4.** `RUBRIC_APP_TRACE=<file>` (`app/src/trace.rs`) records every key a handler gets, every change of text and, after each frame, who has the keys and where the input method's area is. David's run: hundreds of arrow keys across a part's menu moved no focus and lost nothing; the focus went into the Cite field six times, and the sixth (Return on the row) was the last line of the trace. So it is the focus move itself, by chance, about one in six that run; sitting 4 made the moves few and did not end them.
- **The X11 input method is off on Linux** (`main.rs`, `x11_session`: `XMODIFIERS=@im=none` unless `RUBRIC_IME=1`). David's run of going in and out of the field with it passed. Composing (Chinese, Japanese, Korean) through fcitx or ibus does not work in the app on Linux until Rune is fixed; the Mac is not touched. Rune resets the same way when the window loses and regains the focus, which this covers too.
- **For Rune** (rev 0ca0756, winit 0.30.13, X11 through XWayland, fcitx5): every `FocusEffect::Moved` sets `ime_reset` (`runtime/input/focus.rs`), and `sync_platform` then calls `set_ime_allowed(false)` and `set_ime_allowed(true)` (`window/platform_sync.rs`); so does `WindowEvent::Focused` (`window/events.rs`). After some of those the window gets no key events, the pointer still working. A move from one text input to another could keep the input method allowed and only cancel the composition and move its area.
- The server's own `RUBRIC_TRACE` (every text it holds) is another switch; the app's is named apart from it because the site's process inherits the app's environment.

