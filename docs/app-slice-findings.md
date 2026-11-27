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

### Sitting 5 (2026-11-26): the page's process dies

- **What David found.** Moving onto `audio` in Insert part… killed the page: `WebKitWebProcess` aborted as GStreamer said `autoaudiosink not found`, on a machine with `gstreamer` and no `gst-plugins-base` or `gst-plugins-good`. The core's frames are not symbolized, so the audio sink as the cause is inferred.
- **What the app does now.** The web view's `web-process-terminated` (`page.rs`, on the GTK thread) reaches the state. The first death turns `enable-media` and `enable-webaudio` off in the view's settings and loads its address again, and the status line says `Page restarted`, `audio and video off` for 4 s. A second death within 10 s of that leaves the page stopped: `Page stopped` stays in the failed color with `Reload` (Ctrl+Shift+R), which loads it again with media still off. Media stays off for the rest of the run and nothing is written; a run whose page never dies never turns it off. The headless tests cover the state's part (`a_death_turns_media_off_and_loads_the_page_once_again`, `a_second_death_soon_after_stops_and_offers_reload`, `reload_asks_the_page_to_load`, `a_death_long_after_the_restart_restarts_again`).
- **Not known until David's window says:** whether a page with `::: audio` and one with `::: video` load with media off on a machine without the plugins (C68 to C73 of `testing/TESTING.md`), and whether the signal fires for this abort at all. No one has seen any of it run: the view's part needs a window. C74 kills the web process by hand, which assumes it is the app's child (WebKitGTK 4.1 runs it without its sandbox unless asked).

### Sitting 6 (2026-11-26): names, the theme list, Insert part… and starters

- **Themes with one mode.** A theme has one mode when its tokens come out the same in light and dark, and that mode is light when its writing pane is more light than dark. Besides the design's four (Paper and Sepia light, Ink and Fjord dark), five of OpenCode's have only a dark half: Aura, Ayu, Catppuccin Frappé, Catppuccin Macchiato and Night Owl. In the list each is dimmed in the mode it lacks, passed over by the keys and dead to a press. The test is the tokens, not the file's shape, so a writer's file with a `{dark, light}` pair that gives the same color twice also counts as one mode.
- **The list of themes wraps**, and only that list (`Panel::wraps`).
- **The names.** A take or variant being drafted, ready or failed is thrown away with `Cancel`, as a `new:` line's draft is; a kept variant's line goes back to the catalog's part with `Revert to original`. `Own` reads `Custom` everywhere the app shows it (one constant, `draft::CUSTOM`): a part's heading, the group in Insert part…, a theme file of the writer's, `added to Custom parts`, and the note in Similar parts. Neovim still says what it said: the plan keeps it out of this slice.
- **Insert part… lists groups.** With no words, the list under the field is each group with its count (`Custom (N)` first when the site has parts of its own), each opening its parts beside it on Return or Right; moving there draws the part on the line, Return puts it there, Left or Esc goes back. With words it is the flat ranked list as before, with no second panel. The list now takes the place of the first menu (Insert part…, New part…, Cut, Copy, Paste) instead of opening beside it, so the group's parts are the second panel; the app's stack holds two.
- **A list is at most twelve rows tall** (the list of themes, Insert part… with or without words, a group's parts, Similar parts, Takes): its field or heading stays put and the rows under it scroll, with Rune's kit scroll bar (`rune_kit::scroll_bar`, drawn while the list overflows unless the system asks for overlay bars). A list with less room than that under its line goes above it before it is cut, as every panel already did.
- **Starters.** `quote`, `callout`, `sidenote` and `section` have one now, so every part in a group has one but the four that take nothing inside (`divider`, `contents`, `post-list`, `contact-form`). A part's `body` is not in anything Jev is sent (`src/core/questions.ts` sends a part's description and settings), so the catalog's version stays 13. The page already drew a looked-at part's starter: `rubric/peek` writes the part and its closer on the line and the live preview fills an empty block with its starter. It does so only where the preview puts a marker, which is a block with a blank line above it, the same rule as for a part placed by hand. On an empty line straight under a paragraph, neither shows a starter.
- **Not seen by anyone**: all of the above on screen, above all the scroll bar (whether it shows on David's system without the pointer over it), the dimmed rows' color in each theme, the list above its line near the window's bottom, and a group's parts beside the groups in a narrow pane. Rows C77 to C96 of `testing/TESTING.md`, and the rewritten C9 to C12, C14, C18, C50, C52, C53, C56, C61 to C63 and C68.

### After sitting 6 (2026-11-26): the page stopped following the writing

- **What David saw.** In his run of section C the page stopped drawing new writing while it still scrolled with the caret. Looked at while it ran (by Gemini Neon in Antigravity, which also made the change): the server's text, `content/`, Hugo's rebuild and the page's address were all current, Hugo's live reload socket was open and delivering, and `location.reload()` was never called. Reload in the web view brought it back.
- **The cause is not proved.** Either a `fetch` of the page that never came back, which left `rubric-live.js` waiting for good (`running` stayed true, so every later change was taken and dropped), or WebKit no longer handing the page the live reload's messages. It has not been made to happen again.
- **What changed.** `rubric-live.js`: a fetch of the page ends after 3 s, and that or any failure reloads the page and says why (`console.warn`, and in the app a `page: …` line on stderr through the web view's `ipc`). The site's process reads Hugo's `Built in` and `Total in` lines and sends each finished build down the relay the caret already uses (`{ built: n }`, the latest again to a page as it connects), and the page draws on that; Hugo's own live reload still draws when the relay is not there, and waits 60 ms for the relay when it is. In David's log every rebuild printed its line (1,805 lines for 1,774 rebuilds).
- **Not measured**: what the second way costs the page in time. The relay's word and the live reload's arrive within a few milliseconds of each other and the first one draws, so it should cost nothing; `scripts/pause.ts` and the plan's "A faster page, to consider" are where to look if the page feels slower.
- **Still open**: on a fresh start, the first Insert part… drew no part in the page; the second did, and so did the first after a restart.

### Sitting 7 (2026-11-26): one-line ghost text and Insert part…'s search

- **One-line ghost text.** `ghost::line` takes `pick.show` up to its first newline (trimming any trailing `\r`), and `lib.rs` draws only that line in the `ghost` element so a part's starter body no longer lies over the closing `:::` or the writing below. `ghost::accept` is unchanged, so Tab still inserts the full starter body (`a_pick_with_a_starter_draws_one_line_and_tab_puts_the_starter_in`).
- **Insert part…'s instant search.** `Insert` keeps the full catalog from the empty `rubric/parts` answer in `Insert.all`. Each keystroke runs `insert::find` in three tiers (name starts with query, name holds query, a description word starts with query, matching both catalog and readable names case-insensitively and keeping the server's order within each tier). When local search finds anything, or when the field is emptied back to groups, the panel updates in the same frame with no pause and no server request, cancelling the timer and dropping the answer of any in-flight `rubric/parts` call. When nothing matches locally, the previous rows clear at once and `rubric/parts` is asked after the 250 ms pause as before (`insert_part_finds_by_name_and_description_at_once_and_asks_server_only_when_empty`, `return_in_insert_part_field_takes_the_first_found_part`).
- **Two earlier headless tests updated.** `typing_in_insert_part_asks_once_after_the_pause_and_drops_older_answers` and `a_long_list_keeps_its_field_in_place_while_its_rows_scroll` typed `"ste"`/`"step"` and `"p"` against `catalog()`, which now match `steps` locally without asking the server; both now type words not in `catalog()` (`"xyz"`/`"xyzw"` and `"z"`) so they continue to exercise debounce, stale-answer dropping, and scrolling on server answers.
- **Not seen by anyone**: both changes in a real window — one-line ghost text on `::: three numbered steps` above a paragraph, instant name and description matching in `Insert part…`, and the server fallback on unfound words (C64 and C97 to C100 of `testing/TESTING.md`).

## The move to Rune `41cfc07`

Built 2026-11-26 on branch `rune-move` off `main`, from [app-rune-move.md](app-rune-move.md). Moved `app/Cargo.toml` from Rune `0ca075619d116f8f6e0e3bc8ff815c72c636cac8` (2026-11-13) to `41cfc073ca5845f1d689a41535d796f37a8f7eba` (2026-11-26) with all eight `[patch.crates-io]` entries from Rune's root `Cargo.toml` (`winit`, `sctk-adwaita`, `parley_engine`, `wgpu-hal`, `naga`, `accesskit_windows`, `accesskit_macos`, `accesskit_atspi_common`). After tracing the ~30× typing regression to Rune commit `09569ff2` and filing the issue on `github.com/anomalyco/rune`, the pin was pointed to fork `https://github.com/lennox-davidlevy/rune` at `ac6b4825f51e13f35628759255f644a8b411e9dc` (branch `rubric-41cfc07-fix`, which is `41cfc07` plus the one-line revert of `09569ff2` at `crates/rune-text/src/paragraphs.rs:912`) so `main` runs at full speed until upstream merges a fix. Nothing in `app/src/` or `app/tests/` changed; no new features were built.

### What changed in Rune that the app met

- **Zero code changes in `app/src/` or `app/tests/`.** Although Rune split internal crates (`rune-core`, `rune-edit`, `rune-text`, `rune-gpu`, `rune-motion`, `rune-image`, `rune-media`, `rune-spell`, `rune-highlights`, `rune-tiny-skia-path`) and reorganized files, every public name and signature `rubric-app` uses from `rune` and `rune-kit` remained compatible. Both `cargo check --tests --features bench` and the full test suite compiled and passed without editing any Rust source file or test.
- **`naga` and `wgpu` versions in `Cargo.lock`.** On the first `cargo fetch`, Cargo warned that `patch naga v30.0.1` was unused because `app/Cargo.lock` still held `wgpu`/`naga` `30.0.2` from crates.io. Updating `naga` and the `wgpu` crates (`wgpu`, `wgpu-core`, `wgpu-core-deps-windows-linux-android`, `wgpu-naga-bridge`, `wgpu-types`, `naga-types`) to `30.0.1` aligns the whole graphics stack with Rune's `Cargo.lock` and clears the unused-patch warning.
- **Pin verification.** Rune's `scripts/check_rune_pins.py --rune-manifest <rune>/Cargo.toml --manifest app/Cargo.toml --lock app/Cargo.lock` exited 0 and reported `Rune pins agree`.
- **Tests.** Before and after: `cargo test` passed 160 tests (89 unit in `src/lib.rs`, 71 headless in `tests/headless.rs`, 3 ignored); `cargo test -- --ignored` passed all 3 stub-server tests in `tests/server.rs`; `bun run typecheck` and `bun test test/part-request.test.ts test/site-process.test.ts test/live.test.ts` (21 tests) passed.

### Numbers before and after

Release builds on a quiet machine (`cargo clean && cargo build --release`, then `./target/release/typing --server`, post `sites/app-slice/pages/posts/long.md`, 19,937 bytes, 3,933 words, 218 lines).

| Metric | Budget | Before (`0ca0756`) | Stock `41cfc07` | Fork `ac6b4825` (1-line revert) | Status |
|---|---|---|---|---|---|
| `cargo test` / `-- --ignored` | all pass | 160 passed / 3 passed | 160 passed / 3 passed | 160 passed / 3 passed | met |
| Clean release build time | recorded | 46.8 s | 48.8 s | 48.8 s | +2.0 s |
| Release binary size (`rubric-app`) | recorded | 44,116,944 B (42.1 MiB) | 49,567,520 B (47.3 MiB) | 49,516,072 B (47.2 MiB) | +5.1 MiB |
| `markdown::spans` (100 runs, wall) | median 1 ms | median 0.0070 ms, p95 0.0072 ms | median 0.0066 ms, p95 0.0069 ms | median 0.0066 ms, p95 0.0069 ms | met |
| One typed char at start (`type_start`, CPU) | p95 4 ms | median 0.14 ms, p95 0.15 ms | median 4.87 ms, p95 5.02 ms | median 0.15 ms, p95 0.16 ms | **met** (was 33× slower) |
| One typed char in middle (`type_mid`, CPU) | p95 4 ms | median 0.24 ms, p95 0.29 ms | median 4.08 ms, p95 4.18 ms | median 0.25 ms, p95 0.26 ms | **met** (was 14× slower) |
| One typed char at end (`type_end`, CPU) | p95 4 ms | median 0.13 ms, p95 0.14 ms | median 5.14 ms, p95 5.37 ms | median 0.13 ms, p95 0.14 ms | **met** (was 39× slower) |
| One typed char on `new:` line (`type_new_line`, CPU) | p95 4 ms | median 0.16 ms, p95 0.21 ms | median 5.18 ms, p95 5.32 ms | median 0.17 ms, p95 0.18 ms | **met** (was 25× slower) |
| `new:` menu: answer to frame (`menu_open`, CPU) | recorded | median 0.29 ms, p95 0.33 ms | median 0.33 ms, p95 0.35 ms | median 0.33 ms, p95 0.35 ms | +0.02 ms |
| Key in open menu to frame (`menu_key`, CPU) | one frame | median 0.08 ms, p95 0.10 ms | median 0.11 ms, p95 0.13 ms | median 0.11 ms, p95 0.14 ms | met |
| Part menu: both answers to frame (`part_menu_open`, CPU) | recorded | median 0.49 ms, p95 0.50 ms | median 0.54 ms, p95 0.56 ms | median 0.54 ms, p95 0.55 ms | +0.05 ms |
| Segment key → server line → frame (`part_segment_to_line`, CPU) | one frame | median 0.43 ms, p95 0.45 ms | median 5.43 ms, p95 5.59 ms | median 0.55 ms, p95 0.59 ms | **met** (was 12× slower) |
| Tab to menu: stub server's two answers (`server_tab_to_answers`, wall) | 50 ms | median 0.15 ms, p95 0.44 ms (max 4.92 ms) | median 0.20 ms, p95 0.38 ms (max 5.84 ms) | median 0.17 ms, p95 0.46 ms (max 5.09 ms) | met |
| Stub server `set` answer (`server_set`, wall) | recorded | median 0.05 ms, p95 0.16 ms | median 0.06 ms, p95 0.20 ms | median 0.06 ms, p95 0.27 ms | unchanged |

**Typing budget regression (root cause proved, not tuned):** every path that mutates the long spanned `text_input` (`type_start`, `type_mid`, `type_end`, `type_new_line`, and `part_segment_to_line`) regressed from 0.14–0.45 ms p95 to 4.18–5.59 ms p95, missing the 4 ms typing budget across all four typing cases. Non-editing frames (`menu_open`, `menu_key`, `part_menu_open`) stayed within ~0.06 ms of baseline, and `markdown::spans` stayed at 7 µs.

- **Cause (proved via Rune's `frame-profile` + isolated `/tmp` build):** Rune commit `09569ff2aea78d15702346b267ac9a981f15d02d` (*"perf(rune-text): keep deferring plain ASCII paragraphs when other paragraphs have layout spans (#1900)"*, 2026-11-24). Running `rubric-app --features bench --script …` with `RUNE_FRAME_LOG` showed every keystroke reshaping **`shaped: 173`** paragraphs (`text_cpu: 4.64 ms`) instead of `1`. In `crates/rune-text/src/paragraphs.rs:912`, `09569ff2` changed `let can_defer = plain && ...` to `let can_defer = no_pills_or_blocks && ...`, while `reuse_keys` (line 902) stayed gated on `plain` (`layout_spans.is_empty()`). On any multi-paragraph (`> 64` lines) `text_input` with layout-affecting spans (headings, bold, italic), `plain` is `false`, so `reuse_keys` returns `None` and `edited` covers the whole document; `can_defer == true` then bundles plain ASCII lines into multi-line waiting-run keys (`"run"`) on every keystroke, which never match the individual shaped paragraphs in `prev.paragraphs`, breaking `before`/`after` prefix/suffix reuse and reshaping all 173 non-empty paragraphs on every key.
- **Resolution (fork pinned at `ac6b4825`, issue filed upstream):** reverting just that line (`can_defer = plain && ...`) on fork `lennox-davidlevy/rune` (`rubric-41cfc07-fix`, `ac6b4825f51e13f35628759255f644a8b411e9dc`) restored every metric to baseline (`type_start` 0.16 ms, `type_mid` 0.26 ms, `type_end` 0.14 ms, `type_new_line` 0.18 ms, `part_segment_to_line` 0.59 ms p95) while keeping `Tx::text_offset_at`, `Tx::text_line`, and `LineFill`. `scripts/check_rune_pins.py` reports `Rune pins agree`. Once `anomalyco/rune` fixes the issue, `app/Cargo.toml` returns to mainline `anomalyco/rune`.

#### Ready-to-file issue for `github.com/anomalyco/rune` (typing regression in `09569ff2`)

> **Title:** `rune-text`: commit `09569ff2` (#1900) breaks paragraph reuse in spanned multi-line `text_input`, reshaping every paragraph on each keystroke (~30× slower)
>
> **Environment**
> - Rune rev: `41cfc073ca5845f1d689a41535d796f37a8f7eba` (regressed in `09569ff2aea78d15702346b267ac9a981f15d02d`, #1900)
> - Reproducer: multi-line `text_input` with `> 64` lines (218 lines, ~20 KB Markdown post) and layout-affecting `Span`s (`size`, `weight`, `italic` on headings/bold/italic).
>
> **What happens**
> Every single keystroke reshapes all 173 non-empty paragraphs (`shaped: 173`, `text_cpu: ~4.6 ms` per keystroke in release headless `Runtime::frame`) instead of only the edited paragraph (`~0.15 ms` before `09569ff2`).
>
> **Why (`crates/rune-text/src/paragraphs.rs:895-937`)**
> 1. Because `layout_spans` is non-empty, `plain` is `false` (line 898), so `reuse_keys` (line 902) is skipped and `edited` spans the entire document (`count_newlines > LAZY_MIN` = 64).
> 2. Commit `09569ff2` changed `can_defer` (line 912) from `plain && ...` to `no_pills_or_blocks && ...`, so `runs` (`Runs { edit: true, ... }`) is `Some(...)` on every keystroke.
> 3. `key_paragraphs` groups plain ASCII lines between line `EAGER_START` (4) and `lines - EAGER_END` (24) into multi-line waiting-run records keyed with `"run"`, while `prev.paragraphs` holds the already-shaped individual paragraphs (one record per line).
> 4. Because the waiting-run keys never match `old`'s per-paragraph keys, `before` stops at the first run and `after` stops at the last run; every paragraph in between gets `kept = None` and reshapes from scratch on every keystroke.
>
> **Verification**
> Changing line 912 back to `let can_defer = plain && ...` on `41cfc07` drops p95 per-keystroke CPU on the same 218-line Markdown post from 4.18–5.37 ms back to 0.13–0.29 ms (and single-line replacement from 5.59 ms to 0.58 ms).
>
> **Suggested fix**
> Do not defer lines into waiting runs when `prev` is already shaped and `reuse_keys` did not run (or extend `reuse_keys` to handle spanned text / match individual lines against `prev` before bundling runs), so editing a spanned multi-line field preserves `before`/`after` paragraph reuse.

### Pictures compared

Debug headless snapshots (`rubric-app sites/app-slice/pages/posts/long.md [--scene themes] --snap <file> --at 1`, 2800×1800 at 2× scale) kept outside the repo in scratch storage:

- **Layout and geometry:** identical. Both `themes` (892 instances, 141 layout nodes, 876 glyphs) and writing-only (778 instances, 15 layout nodes, 770 glyphs) draw the exact same Literata serif writing, Instrument Sans title bar and theme list, line spacing, colors, caret position, and panel placement.
- **Panel corners and shadow:** identical to the eye; pixel comparison over the panel border/shadow band found 156 pixels differing by at most 1/255.
- **Text antialiasing (the only visible/measurable difference):** 0.174% of pixels in `themes` (8,778 of 5,040,000) and 0.175% in writing-only (8,841 of 5,040,000) changed, all on text glyph edges across the title bar, panel labels, and writing (0 changed pixels in the right pane). Changed pixels skew lighter (6,992 lighter vs 1,786 darker in `themes`; 7,432 lighter vs 1,409 darker in writing-only), matching Rune's Linux text rasterizer update (`FontSmoothing::WindfoilChromium` default and Linux text gamma curve). Visually indistinguishable at normal viewing distance.

### What Rune lacked, looked for again (Task 4)

1. **The text position under a right-click.**
   - **Yes.** `Tx::text_offset_at(key, x, y, f)` (`crates/rune/src/el/tx/pick.rs:43`, backed by `Runtime::text_offset_at` in `crates/rune/src/runtime/api.rs`) maps a window point (`PointerPress::x`/`y` from `El::on_secondary_press`, `crates/rune/src/el/handlers.rs:406`) to `Option<usize>` (UTF-8 byte offset) in any mounted, non-exiting, non-secure text or `text_input` (including `"editor"`), running `f(&mut S, Option<usize>, &mut Tx)` after the handler and before the view commit.
   - **Handler precedence is preserved.** In `crates/rune/src/runtime/input/secondary.rs:111-116`, `secondary_target` checks `n.handlers.on_secondary_press.is_some()` before `editable_field_menu(index)`, and `queue_field_menu` (`secondary.rs:464-469`) declines whenever `on_secondary_press` is set, dispatching `Action::SecondaryPress` (`secondary.rs:378-380`) ahead of Rune's built-in Cut/Copy/Paste menu.
   - **How the right-click menu would be built:**
     1. Attach `.on_secondary_press(|_, p, tx| tx.text_offset_at("editor", p.x, p.y, ...))` to the `"editor"` `text_input` in `app/src/lib.rs`.
     2. In the callback, on `Some(byte)`, place the caret at `byte` (unless `byte` lies inside an active selection), update `last_range` / cursor line, and open that line's menu through the same path Tab uses.
     3. Anchor the panel to the clicked line with `Tx::text_line("editor", byte, ...)` (or the moved caret), keeping Cut/Copy/Paste rows available on plain lines or selections.

2. **A line's rectangle other than the caret's.**
   - **Yes, both a line-box query and a built-in left bar/fill now exist.**
   - `Runtime::text_line(key, byte)` (`crates/rune/src/runtime/api.rs:580`, `crates/rune/src/runtime/selection/field_lines.rs:71`) and `Tx::text_line(key, byte, f)` (`crates/rune/src/el/tx/pick.rs:89`) return `Option<TextLine>` (`field_lines.rs:10`) for any byte in a `text_input` (focused or not): `TextLine { rect: [x, y, w, h], start, prev, next }` in window points after scrolling (`x`/`w` span the field's laid-out text, `y`/`h` are that visual line's). That gives both a panel's anchor on any line and the right-edge placement for a `new:` line's status label.
   - For the `new:` line's left edge itself, `LineFill::new(start, end).left_bar(width, color)` (`crates/rune/src/el/text_spec.rs:590`) attached via `El::line_fill` / `El::line_fills` (`crates/rune/src/el/text.rs:288`) draws display-only full-width backgrounds and left vertical bars over the visual lines intersecting `start..end` of a `text_input` without touching `TextEdit` or undo history (mapped across active IME preedits).

3. **Lines drawn in the field that are not in its text.**
   - **No.** Neither `InputSpec` (`crates/rune/src/el/input.rs`) nor `TextEdit` (`crates/rune-edit/src/lib.rs`) supports virtual/phantom lines or inlay text injected between lines of `edit.text`. `El::inline` (`crates/rune/src/el/pills.rs:207-210`) explicitly returns early as a no-op on any `text_input` (static text only); `El::placeholder` draws only when the entire field is empty; `Span`, `TextHighlight`, `LineFill`, `strike`, and `overline` only decorate existing bytes of `edit.text` without inserting vertical room or unbacked lines. Drawing a part's starter between its fences without mutating `TextEdit` is still not supported by `text_input`.

4. **A font family for a span.**
   - **No.** `Span` (`crates/rune-text/src/layout/span.rs:12-25`) still has only `start`, `end`, `weight`, `mono: bool`, `size`, `color`, `bg`, `bg_pad`, `underline`, and `italic` — no `family: Option<Family>` field. A span can switch to the mono slot (`.mono()`), not to another named or sans family inside a Literata field.

5. **The input method on a focus move.**
   - **Still resets the same way on both field-to-field focus moves and window focus gain.**
   - Every `FocusEffect::Moved` sets `self.ime_area = None` and `self.edit.ime_reset = true` (`crates/rune/src/runtime/input/focus.rs:557-561`).
   - `ime_sync_state` / `ime_sync_step` (`crates/rune/src/input/host_events.rs:657-661, 698-701`) passes `reset` to `ImeSync::step` (`host_events.rs:605-628`), which sets `set_allowed = Some(allowed)` whenever `reset || allowed != self.is_enabled()` (line 614).
   - `sync_ime` (`host_events.rs:723-746`) then runs `crate::platform::ime::cancel(window)` (a no-op on Linux/X11: `crates/rune/src/platform/ime.rs:187-188`) and executes:
     ```rust
     if let Some(allowed) = step.set_allowed {
         window.set_ime_allowed(false);
         if allowed { window.set_ime_allowed(true); }
     }
     ```
     So moving focus from one text input to another still calls `set_ime_allowed(false)` immediately followed by `set_ime_allowed(true)`.
   - On window focus loss (`crates/rune/src/window/host/events.rs:600-604`), `WindowEvent::Focused(false)` calls `l.window.set_ime_allowed(false)` and `self.ime.clear()`. On `WindowEvent::Focused(true)` (`events.rs:608-613`), it either sets `rt.edit.ime_reset = true` (when `rt.stale()`) or calls `sync_ime` immediately while `self.ime` is `Disabled`; in both paths `sync_ime` calls `set_ime_allowed(false)` and then `set_ime_allowed(true)` again. Window creation (`crates/rune/src/window/host/create.rs:180-182`) also calls `set_ime_allowed(false)` and sets `ime_reset = true`.
   - **Changelog check:** nothing in `CHANGELOG.md` or `changelog/unreleased/` mentions fcitx or the X11/XWayland lost-keyboard issue. Recent IME changes cover Wayland `zwp_text_input_v3` cursor-area deduplication (`2026-11-23-ime-cursor-area-dedup.md`), `App::on_ime` / `El::ime_cursor` and `Ime::Disabled` (`2026-11-23-app-ime-disabled-ends-composition.md`, `2026-11-23-empty-ime-commit-outside-composition.md`, `2026-11-23-empty-ime-preedit-caret-follow.md`), macOS `OptionAsAlt` and full-width punctuation (`2026-11-13-ime-option-as-alt.md`, `2026-11-23-macos-ime-fullwidth-punctuation.md`, `2026-11-25-option-as-alt-mode.md`), Wayland layer-shell IME (`2026-11-24-wayland-layer-shell-ime.md`), and XWayland overlay/global-shortcut items (`2026-11-23-xwayland-prewarm-hidden-input.md`, `2026-11-24-xwayland-global-shortcuts-portal.md`).

6. **Changelog entries that answer workarounds in the app (named only; nothing changed).**
   - **Focus taken by a press on a panel row** (`look::keys_home` restoring `"editor"` focus after clicks): directly answered by **`El::preserve_focus_on_press(true)`** (`crates/rune/src/el/focus.rs:266`, `changelog/unreleased/2026-11-23-preserve-focus-on-press-focusable.md`), which runs `on_press` while leaving the currently focused text field focused instead of blurring it. Also **`El::keyboard_focus_only()`** (`2026-11-25-focus-ring-radius-keyboard-focus-only.md`) keeps a focusable control out of pointer focus.
   - **Hover refreshed on every build under a still pointer** (`lib.rs` using `on_pointer_move_local` instead of `on_hover_change`): partially answered by **hover hold during layout motion and app glides** (`CHANGELOG.md`, "Hover waits while layout moves content under a still pointer" / "A glide the app asked for holds a still pointer's hover until it stops", plus `2026-11-23-hover-ancestor-resize.md`), **`El::hover_delays(enter, leave)`** (`CHANGELOG.md`), and **`El::focus_highlight`** (`crates/rune/src/el/focus.rs:281`). Note that once motion settles (or on an instant mount), hover still lands under a resting pointer, so `on_pointer_move_local` remains stricter for a panel opening under a stationary pointer.
   - **Colors changing on springs** (`look.rs` passing `tx.color_motion(Spring::NONE)`): colors still spring by default (`El::instant_changes()` leaves colors animating), so `Tx::color_motion(Spring::NONE)` is still needed, and **`Spring::NONE`** is now `Curve::Instant` (no longer stretched into a fade under Reduce Motion, `CHANGELOG.md`) with text colors landing on the same frame instead of hitting the 0.1 s floor (`2026-11-08-text-color-instant.md`).
   - **Other app workarounds now directly answered by Rune `41cfc07`:**
     - **Caret move polled in `App::on_frame_drawn`** (`main.rs:156`): answered by **`El::on_input_selection`** (`2026-11-25-pill-press-and-input-selection.md`), firing in the same turn before view rebuild whenever runtime input changes `(edit.anchor, edit.focus)`.
     - **Keeping panels inside the writing pane** (`panel::place` instead of `anchored_fit`): answered by **`El::anchored_in(boundary_key)`** and `anchor_rect_in(...)` (`2026-11-24-anchor-placement-and-boundary.md`), clamping and flipping overlays inside a named boundary element intersected with the window, plus `Cx::anchor_placement(key)`.
     - **Default white caret/placeholder/selection on `text_input`**: **`2026-11-24-text-input-caret-color.md`** inherits `El::color(c)` for uninked caret, placeholder (`alpha(0.4)`), and selection (`alpha(0.2)`).
     - **Ancestor key interception before a focused field**: **`El::on_key_preview`** (`2026-11-25-on-key-preview.md`).

### Keyboard follow-up: both texts ready for after David's row D3

#### A. If the keyboard is still lost with `RUBRIC_IME=1` — issue for `github.com/anomalyco/rune`

> **Title:** X11/XWayland + fcitx5: toggling `set_ime_allowed(false)` then `set_ime_allowed(true)` on every focus move drops all subsequent keyboard events
>
> **Environment**
> - Rune rev: `41cfc073ca5845f1d689a41535d796f37a8f7eba` (vendored `winit 0.30.13`)
> - OS / desktop: Omarchy (Arch Linux), Hyprland 0.56.2 on Wayland, XWayland 24.1.14, NVIDIA RTX 5090 (open driver 615.78.08)
> - Input method: fcitx5 via XIM (`XMODIFIERS` set for fcitx5)
> - Window runs on X11 through XWayland (`WAYLAND_DISPLAY` unset, `GDK_BACKEND=x11`)
>
> **Steps to reproduce**
> 1. Run a Rune app with two `text_input` elements on X11/XWayland with fcitx5 active (e.g., a main multi-line `text_input` and a second `text_input` in an overlay/panel).
> 2. Repeatedly move focus from the first `text_input` to the second (`Tx::focus`) and back to the first, typing a character in each (in our trace, moving focus into and out of the second field ~6–20 times).
> 3. Continue typing in the focused `text_input`.
>
> **What happens**
> After several focus transitions between text inputs (intermittently, ~1 in 6 in a traced run), the window stops receiving keyboard input completely (neither `KeyboardInput` nor `Ime::Commit` arrives). Pointer events continue to work normally, and Rune's focus state still reports the `text_input` as focused. Running the same app with `XMODIFIERS=@im=none` never reproduces the loss.
>
> **Where Rune does it**
> 1. `crates/rune/src/runtime/input/focus.rs:557-561`: every `FocusEffect::Moved` sets `self.ime_area = None` and `self.edit.ime_reset = true`.
> 2. `crates/rune/src/input/host_events.rs:614-616` (`ImeSync::step`): whenever `reset` is `true`, it sets `set_allowed = Some(allowed)` even when IME was already enabled and remains enabled (moving from one non-secure `text_input` to another).
> 3. `crates/rune/src/input/host_events.rs:727-730` (`sync_ime`): whenever `step.set_allowed` is `Some(allowed)`, it unconditionally calls `window.set_ime_allowed(false)` and then (if `allowed`) `window.set_ime_allowed(true)` back-to-back in the same frame.
> 4. `crates/rune/src/window/host/events.rs:603, 609-611`: `WindowEvent::Focused(false)` calls `set_ime_allowed(false)` and clears `self.ime`, and `WindowEvent::Focused(true)` triggers `sync_ime` again (which also calls `set_ime_allowed(false)` then `set_ime_allowed(true)`).
>
> On X11/XIM (`winit`), each `set_ime_allowed(false)` / `set_ime_allowed(true)` pair appears to trigger an XIM state transition under fcitx5; doing that repeatedly on focus transitions between two text inputs intermittently leaves the window receiving no keyboard events.
>
> **Suggested fix**
> - When focus moves from one enabled text input to another (and especially when no IME preedit composition was active), keep IME enabled instead of toggling `set_ime_allowed(false)` + `set_ime_allowed(true)`: only update the cursor area (`set_ime_cursor_area`) and cancel any active composition if one was in progress.
> - In `sync_ime` (`host_events.rs:727-730`), avoid calling `window.set_ime_allowed(false)` before `window.set_ime_allowed(true)` when IME is already disabled (`!was_enabled && allowed`, e.g., on `WindowEvent::Focused(true)` after `Focused(false)` already disabled it).

#### B. If the keyboard is NOT lost with `RUBRIC_IME=1` — exact lines to remove from `app/src/main.rs`

1. In the doc comment on `x11_session` (`app/src/main.rs:14-15`), remove `The X11 input method is off too (below).`
2. In `x11_session` (`app/src/main.rs:29-35`), remove:
   ```rust
           // No X11 input method: Rune turns the window's input method off and on at every focus
           // move between text inputs, and under fcitx5 through XWayland that now and then leaves
           // the app with no keys at all (the findings, slice 3, sitting 4). Composing (Chinese,
           // Japanese, Korean) is lost with it until Rune is fixed; RUBRIC_IME=1 keeps it.
           if std::env::var_os("RUBRIC_IME").is_none() {
               std::env::set_var("XMODIFIERS", "@im=none");
           }
   ```

### Native run of section D (David, 2026-11-26)

- **Window & page (`D1`):** opens natively on Omarchy/Hyprland through XWayland with the writing on the left, live page on the right (`page loaded … 126 ms`, post `180 ms`), and no second title bar or client-side window frame.
- **Typing & latency (`D2`, `D3`, `D11`):** on stock `41cfc07`, typing latency felt noticeably worse on screen (matching the `09569ff2` 5 ms/keystroke regression; fixed by the `ac6b4825` fork pin above). For `D11` (`Tab` on `::: quote`), 11 of 15 Tabs drew in 1.5–4.3 ms (server 0.9–3.2 ms), while 4 spiked to `34.3 ms` (`server 17.1 ms`) and `50.8–51.0 ms` (`server 33.6–33.7 ms`) — exact ~17 ms (60 Hz frame) multiples across the two sequential `rubric/part` → `rubric/draft` UI-thread round trips plus `on_frame_drawn`.
- **Right-click (`D9`):** right-clicking in the editor showed no menu at all on Linux — **not a regression**. Rune's built-in `field_menu` uses native OS popups (`NSMenu` on macOS, `TrackPopupMenuEx` on Windows); on Linux, `popup_menu_supported()` is `false` on both `0ca0756` and `41cfc07` (`crates/rune/src/popup_menu/mod.rs:47-67`), so `field_menu` shows nothing unless an app hooks the new opt-in `App::on_field_menu` fallback (#2025) or handles right-click itself via `El::on_secondary_press` (which Rubric will do in slice 4).
- **Idle CPU (`D10`):** under 1%.
- **Keyboard with `RUBRIC_IME=1` (`D12`–`D15`):** passed all 20 rounds in and out of `Cite` with zero lost keys. (Note: `ime_reset` still toggles `set_ime_allowed(false)`/`true` in `41cfc07`, so whether the intermittent loss is truly gone or only rarer should be watched if `XMODIFIERS=@im=none` is removed.)
- **Pre-existing slice-3 bug reproduced during D (`⇒ change quote` + Tab):** on `::: quote cite=a : <something>` with ghost pick `⇒ change quote`, Tab opened the panel at the top-left of the pane and sprang it horizontally to the middle-top. Diagnosed (not changed here): `part::answered` (`app/src/part.rs:240-248`) clears `s.anchor = None`, pushes both `part` and `change`, and sets `s.focus_field = true` (the only place in `app/` that sets it), so `state::follow_up` calls `tx.focus("panel-field", false)` in the same turn. Rune's `commit()` (`commit.rs:550-555`) moves focus to `"panel-field"` and discards Pass 1 before `panel-anchor`'s `on_layout` runs; Pass 2 then sees `s.anchor == None` and `cx.caret("editor") == None`, falling back to `[s.pane[0] + PAD, s.pane[1] + TOP]` (`x = 24, y = 96`), which Frame 1 locks into `s.anchor` and Frame 2 then springs rightward to `ed[0]` while keeping `y = 96`.
- **Still unseen:** macOS build and runtime.

## Slice 4: the right-click and a draft's line

Built 2026-11-26 on branch `slice-4` off `main`, from [app-slice-4.md](app-slice-4.md). No Jev calls, no real drafts, no window opened on David's display.

### What the slice found out

- **Panel placement on a right-click (Task 1).** Inside `Tx::text_offset_at`'s callback (`run_pick_reads`, before the frame's commit), moving the caret with `s.edit.set_caret(byte)` does not update `Cx::caret("editor")` until after that frame paints. A synchronous menu opened immediately (empty line or writing line) would therefore read the previous caret's line and lock it into `s.anchor`. Queuing `Tx::text_line("editor", s.edit.focus, ...)` and holding panel rendering behind `s.anchor_wait` for that one frame (which Rune advances automatically because `pending.pick_reads` keeps `needs_commit()` true) anchors the panel to the pressed line on its very first drawn frame.
- **Panel jump on `⇒ change quote` + Tab (Task 2).** Reproduced headless (`frame 0: panel x 26.5625 != line x 78.5`, matching the `x = 24` fallback plus the 0.98 insertion scale). Fixed by calling `Tx::text_line("editor", s.edit.focus, ...)` in `part::tab` (runs in the same frame before commit, while the editor still has focus) and preserving `s.anchor` across `close_panels` when `Anchor::holds` still matches the caret's line and editor width.
- **`rubric/draft` with no action on a line of words (Task 3).** Checked `src/server/main.ts:335` and `src/server/workspace.ts:701-740, 820-847, 983-990`: `workspace.look` returns `undefined` (`null`) immediately on a line of words (`#newLine` requires `d.kind === "new"`; `#draftLine` -> `#ownPart` requires `d.plain`), with zero disk writes, zero disk reads, and zero Jev calls. Sending `rubric/part` and `rubric/draft` together in `part::tab` is therefore free on words lines and cuts a part line's menu to one round trip.
- **Why an answer sometimes waited a frame or two (Task 3).** Checked Rune `ac6b482` (`window/surface.rs:177`, `window/host/events.rs:188,631`, `window/host/draw.rs:512`, `window/host/lifecycle.rs:548`). On Linux X11/XWayland, Rune configures `PresentMode::AutoVsync` (FIFO). Server answers arrive on `lsp-read` and post `WakeEvent::App`, which waits on the UI thread until any in-flight `RedrawRequested` finishes `surface.get_current_texture()` (blocked on vsync, ~16.7 ms at 60 Hz). Previously, `part::tab` made two sequential round trips across the UI thread, and `main.rs` used `AppHandle::update` (requesting a redraw unconditionally on every incoming message, including unhandled notifications such as `rubric/picks` and intermediate answers). Sending both requests together removes the second round trip, and switching `main.rs` to `AppHandle::update_if` with `state::incoming -> bool` skips redundant redraws for unhandled notifications, stale answers, and the first half of a paired `rubric/part` + `rubric/draft` response. (Tab's own handled `KeyboardInput` still calls `request_redraw()` inside Rune, so an answer arriving while that frame is mid-present can still wait for one vsync.)
- **Where Rune draws `LineFill::left_bar` against field padding (Task 4).** Checked `crates/rune/src/runtime/paint/content.rs:325-394` and `crates/rune/src/runtime/paint/helpers.rs:238-249`. `emit_line_fills` receives `(x0, x1)` where `x0 = zr[0] + ins[0]` (inside the element's left padding and border) — the exact same `x` where left-aligned text starts (`origin[0] = text_x(spec, x0, ...)`). `LineFill::left_bar` therefore always paints directly under the first character with no gap, regardless of field padding. The app draws the 2-point bar as its own element at `editor_rect[0] - 18.0` from `TextLine` instead, using the design's dotted (`Not started`, `ink3`), dashed (`Drafting`, `accent`), and solid (`Ready` in `accent`, `Failed` in `fail`) bars.
- **Whether the view can read `text_line` while it builds, and idle CPU (Task 4).** Checked `crates/rune/src/runtime/cx.rs` whole: `Cx` has `caret` only, no `text_line`; only `Tx::text_line` and `Runtime::text_line` exist. The app stores each draft line's box relative to `editor_rect[1]` (`state::DraftBox { dy, h, wrapped, text_w }`), re-querying `Tx::text_line` only when `(version, editor_w, editor_h, marks_sig)` changes (edits, diagnostics, resizes, or wrap-induced height changes). Plain scrolling moves `editor_rect[1]` via `El::on_layout_tx` without re-querying `text_line` or re-measuring text, lines outside the writing viewport draw nothing, long or wrapped lines hide the label, and a settled `Ready` line asks for no frames and schedules no timers (`a_new_line_has_its_edge_and_label_for_every_state_and_no_other_line_does`).

### Numbers

Release build (`cargo run --release --features bench --bin typing -- --server`, post `sites/app-slice/pages/posts/long.md`, 19,937 bytes, 3,933 words, 218 lines):

| Metric | Budget | Move (`ac6b4825`) | Slice 4 | Status |
|---|---|---|---|---|
| `cargo test` / `-- --ignored` | all pass | 160 passed / 3 passed | 174 passed (89 unit + 85 headless) / 3 passed | met |
| `markdown::spans` (100 runs, wall) | median 1 ms | median 0.0066 ms, p95 0.0069 ms | median 0.0069 ms, p95 0.0071 ms | met |
| One typed char at start (`type_start`, CPU) | p95 4 ms | median 0.15 ms, p95 0.16 ms | median 0.16 ms, p95 0.21 ms | met |
| One typed char in middle (`type_mid`, CPU) | p95 4 ms | median 0.25 ms, p95 0.26 ms | median 0.26 ms, p95 0.28 ms | met |
| One typed char at end (`type_end`, CPU) | p95 4 ms | median 0.13 ms, p95 0.14 ms | median 0.13 ms, p95 0.14 ms | met |
| One typed char on `new:` line (`type_new_line`, CPU, edge + label drawn) | p95 4 ms | median 0.17 ms, p95 0.18 ms | median 0.21 ms, p95 0.27 ms | met (~15× under) |
| `new:` menu: answer to frame (`menu_open`, CPU) | recorded | median 0.33 ms, p95 0.35 ms | median 0.34 ms, p95 0.36 ms | unchanged |
| Key in open menu to frame (`menu_key`, CPU) | one frame | median 0.11 ms, p95 0.14 ms | median 0.11 ms, p95 0.13 ms | met |
| Part menu: both answers to frame (`part_menu_open`, CPU) | recorded | median 0.54 ms, p95 0.55 ms | median 0.48 ms, p95 0.50 ms | faster |
| Segment key → server line → frame (`part_segment_to_line`, CPU) | one frame | median 0.55 ms, p95 0.59 ms | median 0.55 ms, p95 0.58 ms | met |
| Tab to menu: stub server's two answers (`server_tab_to_answers`, wall) | 50 ms | median 0.17 ms, p95 0.46 ms (max 5.09 ms) | median 0.13 ms, p95 0.45 ms (max 4.21 ms) | met (parallel) |
| Stub server `set` answer (`server_set`, wall) | recorded | median 0.06 ms, p95 0.27 ms | median 0.06 ms, p95 0.27 ms | unchanged |

### What no one saw

- Everything in a real window: right-click on each line kind (writing, empty, part, words, `new:`), right-click inside a selection followed by Copy, right-click with a pick showing, Tab on `⇒ change quote` opening in place with no jump, ten Tabs on a part's line printing real `menu drawn` timings in a live window, the dotted/dashed/solid draft edges and right-end labels through all four states, smooth scroll tracking and off-screen clipping, long-line label hiding, and idle CPU on screen. Those are section E of `testing/TESTING.md`.
- macOS build and runtime.

## The shell, part 1

### Sitting 1: the window and the toolbar

Built 2026-11-26 on branch `shell` off `slice-4`, from [app-shell.md](app-shell.md). No Jev calls, no real drafts, no window opened on David's display.

#### What the sitting found out

- **Borderless window and the web view (`app/scripts/run-nested.sh`).** Could not be run live here: `Xephyr`, `Xvfb`, `i3`, `xdotool`, and `xdpyinfo` are not installed on this Omarchy (Hyprland/Wayland) machine, `DISPLAY` is unset, and no window may be opened on David's display. Source inspection of Rune `ac6b482` (`crates/rune/src/window/spec.rs:288`, `crates/rune/src/window/host/create.rs:55-98`) confirms `WindowOptions { borderless: true, ..Default::default() }` passes `.with_decorations(false)` to winit, which on X11 only sets `_MOTIF_WM_HINTS` without changing the X11 window ID (`RawWindowHandle::Xlib`/`Xcb`), client coordinate origin `(0, 0)`, or child-window attachment used by `wry::WebViewBuilder::build_as_child`. Borderless is built on Linux and left for David's native check in section F of `testing/TESTING.md`.
- **Whether Rune draws SVG paths for the toolbar icons.** **Yes.** Rune `ac6b482` (`crates/rune-text/src/icon.rs:22-386`, `crates/rune/src/el.rs:443`) renders monochrome SVG icons via `rune::Icon { name, view, body }` and `rune::icon(&Icon, size).color(...)`, supporting `<rect rx="..."/>` and `<path d="..."/>` with `fill="none"`, `stroke="currentColor"`, and `stroke-width`. The toolbar draws the design's exact SVG icons (drawer, view, chevron, open in browser, close).
- **Where the app reads the post's path for Open in browser.** Checked `src/server/main.ts:162-164, 227, 254-262, 412, 449` and `src/server/workspace.ts:374-378, 2111-2121`: `rubric/serving` carries only the site's root URL (`http://127.0.0.1:<port>/`), and `rubric/cursor` pushes `{ source, url, line }` only to the SSE relay (`opts.cursor`), never back to the LSP client. Reading the URL from WebKit's `loaded` callback would not cover writing-only mode, `RUBRIC_NO_PAGE=1`, macOS, or headless tests. The server now sends a small notification `rubric/page` (`{ uri, url }`) to the connection when `rubric/cursor` resolves a page, and the app joins it with `rubric/serving` for Open in browser.
- **Keys while the pointer rests over the page: (a) X11 event masks vs (b) GTK `key-press-event` to `Tx::send_key`.** Checked `wry-0.57.2/src/webkitgtk/mod.rs:144-247`, `wry-0.57.2/src/webkitgtk/synthetic_mouse_events.rs:10-46`, GTK 3.24 (`gdk/x11/gdkwindow-x11.c`, `gtk/gtkwindow.c`, `WebKitWebViewBase`), and Rune `ac6b482` (`crates/rune/src/el/tx.rs:577`, `crates/rune/src/runtime/frame/latch.rs:101`, `crates/rune/src/el/handlers.rs:470`). **Chose (b).** In (a), `wry`'s `build_as_child` wraps its X11 container window (`XCreateSimpleWindow`) in a foreign `GdkWindow` owned by a toplevel `gtk::Window` and exposes only `WebViewExtUnix::webview()`; GTK3 manages both core `XSelectInput` and XInput2 (`XI_KeyPress` / `XI_KeyRelease` via `GdkX11DeviceXI2`) from cached `GdkEventMask`s across the foreign window and child `GdkWindow`s, both `gtk_window_realize` and `WebKitWebViewBase` select key events, and raw Xlib `XSelectInput` conflicts with GDK's cached masks and misses any internal WebKit subwindow or mask refresh. In (b), X11 delivers keys over the page directly to `x11_window` (`webview.toplevel()`), so connecting `key-press-event` (and `key-release-event` to stop stray releases) on `webview.toplevel()` and `webview` catches every key even before `webview` has been clicked or focused. While the page does not hold keys (at start, and after any press in the app via Rune's `El::on_any_press`), the handler returns `glib::Propagation::Stop`, translates any `gdk::EventKey` (named keys, function keys, numpad, `ISO_Left_Tab`, printable Unicode via `gdk_keyval_to_unicode`, and `Ctrl` command chords — every key, typing included) to `rune::KeyEvent`, and forwards it through `AppHandle::update(|_, tx| tx.send_key(ev))` into Rune's normal `Runtime::key` path; `webview`'s `button-press-event` hands keys to the page (`Propagation::Proceed` so WebKit keeps selection and `Ctrl+C`) until the next press in the app sends `PageCmd::Keys(false)`. No new crate or X11 FFI is needed (`gtk::gdk` is re-exported by `gtk 0.18.2`), and the key translation and state transitions are unit- and headless-tested.

#### What no one saw

- **Seen on Xvfb (added in sitting 2's review cleanup; `app/scripts/run-nested.sh` now runs on Xvfb with Arch's `/usr/share/vulkan/icd.d/lvp_icd.json`):** borderless window on Linux with the wry WebKitGTK web view attached and rendering the post (`page loaded …/posts/long/ 148 ms`), the SVG toolbar icons and centered title/saved state, `Ctrl+3` page-only view with the View popover open over the 300-point pane-colored yielded column and its right-edge hairline (matching picture 93), `Esc` and `Ctrl+1` restoring both panes, and `Ctrl+W` closing the window cleanly with no lingering processes.
- **Still unseen:** dragging the top row to move a floating window under Hyprland, resizing from all 8 window edges and corners under Hyprland, toolbar hover tooltips on screen, resizing through 760 points wide live, `xdg-open` launching the system browser on `Ctrl+Shift+B` / Open in browser, clicking the circular close button in a native window, live X11/WebKitGTK key forwarding with the pointer over the page (including clicking in the page to copy with `Ctrl+C` and clicking back in the writing to paste with `Ctrl+V`), native NVIDIA/XWayland rendering, and macOS build/runtime. Those are section F of `testing/TESTING.md`.

### Sitting 2: saving, and the site's pages

Built 2026-11-27 on branch `shell`, from [app-shell.md](app-shell.md), together with sitting 1's five review cleanups. No Jev calls, no real drafts, no window opened on David's display.

#### What the sitting found out

- **What wakes the app for autosave with zero idle CPU.** Rune's `Tx::wake_after` + `AppSpec::poll` (`state::poll`, sharing the poll hook with `insert::poll`) schedules a single deadline via winit's `ControlFlow::WaitUntil` with no extra timer thread. Every edit marks `s.save_arm`, `state::schedule_save` arms `s.save_due = Some(clock + 1.0)` and calls `tx.wake_after(1s)`, a second edit before the second moves `save_due` forward (an earlier wake simply reschedules the remainder without drawing), and once written `save_due` clears so nothing wakes while idle. Measured on Xvfb via `app/scripts/run-nested.sh` (release build, 6 s quiet window after autosave): **0.00% CPU**.
- **Cold-start page race on a fresh site.** During Xvfb verification on a fresh temporary site, `src/server/site-process.ts` announced `rubric/serving` (`http://127.0.0.1:<port>/`) right after spawning `hugo server`, ~100–200 ms before Hugo finished its first build and bound port 1415; WebKit hit `Connection refused` at 107 ms and stayed on its connection error page because `rubric-live.js` never loaded. Pre-starting the site's stub server and waiting for HTTP 200 (as `app/scripts/measure-window.sh` does) lets the post load cleanly in ~148 ms. (`site-process.ts` was not modified, as it is outside sitting 2's file scope.)
- **Bare Xvfb focus.** Without a window manager on Xvfb, X11 does not focus Rune's window automatically; `xdotool windowfocus --sync` hands keyboard input to the window for automated Xvfb checks.

#### What was seen on Xvfb, and what no one saw

- **Seen on Xvfb** (release binary against a temp copy of `sites/app-slice` with the live Hugo post drawn, every screenshot inspected): typing changes the top row to `Edited` and leaves the file unwritten at 0.2 s; after ~1.3 s the file is written, the page updates live, and the top row reads `Saved`; idle CPU over 6 s on a clean post is `0.00%`; making `pages/posts` read-only (`chmod 555`) and typing gives `Not saved` (red, weight 600) in the top row and `Post not saved` / `The site folder could not be written.` / `Retry Ctrl+S` under the writing (picture 99) and as a full-width 34-point foot strip in page-only view (picture 102); making the folder writable (`chmod 755`) and clicking `Retry` writes the file and clears both; typing and closing immediately with `Ctrl+W` saves the unsaved text before exit; starting on the site folder opens the newest post (`Harbour light at dusk`, `2026-11-26`) with its live page drawn.
- **Still unseen:** native Hyprland/XWayland run (section G of `testing/TESTING.md`), and macOS build and runtime.

### Sitting 3: the drawer

Built 2026-11-27 on branch `shell`, from [app-shell.md](app-shell.md). No Jev calls, no real drafts, no window opened on David's display.

#### What the sitting found out

- **Cheapest sound disk-change comparison before every write.** A single `std::fs::metadata` (`stat(2)`) call returns file length (`len`), modified time (`modified`, nanosecond resolution), and on Unix inode (`ino`) and status-change time (`ctime`) in one syscall (`0.28 µs` median, `0.29 µs` p95 on tmpfs, vs `1.32 µs` tmpfs / `8.60 µs` ext4 for `read_to_string` on the 20 KB post — zero file reads on the untouched path). Comparing `DiskStamp { len, modified, ino, ctime }` against what the app recorded on open/reload/save skips reading the file on the common untouched path; whenever any metadata field differs (size change, mtime/ctime change, or atomic-rename replacement with a new inode even in the same coarse timestamp tick), the app reads the file and compares its bytes against `s.saved`, refusing to overwrite only when the text actually differs (so `touch` or a no-op write does not trigger a false conflict). The one theoretical gap is an in-place overwrite of identical byte length within the same ~1–4 ms kernel coarse-clock tick without rename, which cannot occur across real external edits after autosave's 1 s window; adding `ino` and `ctime` closes the atomic-rename same-tick case at zero extra syscall cost.
- **500 posts in the drawer without `virtual_rows`.** Measured in release (`typing` benchmark, 500 posts + home page): opening the drawer takes `3.86 ms` median (`4.06 ms` p95) and pressing Up/Down takes `1.48 ms` median (`1.57 ms` p95) — more than 10× under a 16.7 ms frame — so `virtual_rows` is not needed.
- **How `"page"` reports its place during a slide, and larger-size sliding with zero ground bars.** Checked Rune `ac6b482` (`crates/rune/src/el/layout_watch.rs:73,153` and `crates/rune/src/runtime/elements.rs:558`): both `El::on_layout` and `El::on_drawn_layout` report where a spring comes to rest, never intermediate frames; `Runtime::presented("page")` inside `App::on_frame_drawn` reads the live drawn `[x, y, w, h]` directly from `self.paint.drawn` every frame with zero view rebuilds. Checked `wry-0.57.2/src/webkitgtk/mod.rs:976-990`: `WebView::set_bounds` always calls `gtk_window.move_`, `gdk_window.resize`, and `gtk_window.size_allocate` even when `(w, h)` is unchanged; `PageCmd::Move { x, y }` calls `gtk::Window::move_` + `gdk::Display::flush` with zero WebKit relayout. Positioning `"page"` with `.absolute(page_x, 0.0)` and `frame_motion` (Rune's layout spring for view switches, `Curve::tween(0.14, EASE_OUT / EASE_IN)` for drawer/View popover in page-only view) decouples its slide from the under-layer so writing/drawer/cover stay in place while the web view slides on top at `max(old_size, new_size)` (resized once before sliding when growing, once at rest when shrinking).

#### Numbers

Release build (`cargo run --release --features bench --bin typing -- --server`, post `sites/app-slice/pages/posts/long.md`, 19,937 bytes, 3,933 words, 218 lines):

| Metric | Budget | Slice 4 | Shell Part 1 (Sitting 3) | Status |
|---|---|---|---|---|
| `cargo test` / `-- --ignored` / `bun test` | all pass | 174 / 3 | 202 (98 unit + 104 headless) / 5 / 331 | met |
| `markdown::spans` (100 runs, wall) | median 1 ms | median 0.0069 ms, p95 0.0071 ms | median 0.0068 ms, p95 0.0070 ms | met |
| One typed char at start (`type_start`, CPU) | p95 4 ms | median 0.16 ms, p95 0.21 ms | median 0.18 ms, p95 0.20 ms | met |
| One typed char in middle (`type_mid`, CPU) | p95 4 ms | median 0.26 ms, p95 0.28 ms | median 0.29 ms, p95 0.30 ms | met |
| One typed char at end (`type_end`, CPU) | p95 4 ms | median 0.13 ms, p95 0.14 ms | median 0.16 ms, p95 0.17 ms | met |
| One typed char on `new:` line (`type_new_line`, CPU) | p95 4 ms | median 0.21 ms, p95 0.27 ms | median 0.24 ms, p95 0.31 ms | met |
| Tab to menu: stub server's two answers (`server_tab_to_answers`, wall) | 50 ms | median 0.13 ms, p95 0.45 ms | median 0.12 ms, p95 0.31 ms | met |
| Drawer open with 500 posts (`drawer_500_open`, CPU) | recorded | — | median 3.93 ms, p95 4.40 ms | no `virtual_rows` needed |
| Drawer Up/Down with 500 posts (`drawer_500_key`, CPU) | one frame | — | median 1.51 ms, p95 2.13 ms | met |
| Return on row to new 20 KB post drawn (`drawer_switch`, headless) | 50 ms | — | median 0.30 ms CPU / 0.33 ms wall, p95 0.35 ms | met |
| Return on row to new post drawn (live Xvfb, lavapipe software Vulkan) | 50 ms | — | `1.9–2.8 ms` short post, `11.0 ms` 20 KB post | met |
| View-switch & page-only drawer slide frame on 20 KB post (`view_switch_frame`, CPU) | max 16 ms | — | median 0.021 ms, p95 0.106 ms, max 0.625 ms | met (~25× under) |
| WebKit layouts per switch (Xvfb Ink `resize` + `ResizeObserver` probe, all 8 motions) | ≤1 / switch | — | 0 (`Ctrl+1→2`, `2→1`, `3→2`, `2→3`), 1 (`Ctrl+1→3`, `3→1`, `Ctrl+O` open/close) | met |

#### What was seen on Xvfb, and what no one saw

- **Seen on Xvfb** (release binary in Paper against a temp copy of `sites/app-slice` with four posts — including a draft and a 2025 post — plus Home and About, pre-started stub server serving live Hugo posts on port 1415, every one of 13 drawer screenshots and 12 mid/end view-switch frames inspected):
  - **Drawer & disk protection:** the drawer button renders at full ink and fills while open; `Ctrl+O` opens and closes the 300-point drawer over the writing without moving the writing behind it; rows render in server order (`Low Tide`, `Pages`: `Home`, `About`; `Posts`: newest first with `26 November`, `2 June`, `19 May · Draft`, `4 November 2025`), with the 2-point accent edge and weight 600 on the open post and the 1.5-point accent focus ring tracking `Down`/`Up`; typing while the drawer is open does nothing and `Esc` returns keys to the writing; an unsaved edit (`UNSAVED `) is written to disk before switching on `Return`, the new post draws in `1.9–2.8 ms` (short post) and `11.0 ms` (20 KB post), and WebKit navigates automatically to `/posts/ferry/` and `/posts/long/`; in `Ctrl+3` page-only view the page yields a 300-point column for the drawer in one step (no slide frames) and returns cleanly to the left edge after the drawer slides out with no blanking or misplacement; modifying the open post from another process prevents autosave from overwriting it, shows `Not saved` in red and `Post changed on disk` / `Another program changed this file.` / `Reload` in the status line, and clicking `Reload` replaces the writing and updates the live page; `Ctrl+W` exits cleanly with no lingering processes.
  - **View-switch & page-only drawer motion (20 KB `long.md` in Ink dark theme):** captured 66 fps (~15.15 ms/frame, 43 frames each = 344 frames total) across all 8 motions (`Ctrl+1→Ctrl+3`, `Ctrl+3→Ctrl+1`, `Ctrl+1→Ctrl+2`, `Ctrl+2→Ctrl+1`, `Ctrl+3→Ctrl+2`, `Ctrl+2→Ctrl+3`, and `Ctrl+O` open/close in page-only view) with an in-page `resize`/`ResizeObserver` IPC probe. Every frame was checked programmatically for Ink ground-color (`#141413`) columns, right-edge gaps, and blank pages, plus key mid-motion and settled frames were visually inspected: **0 ground-color bars**, **0 blank pages**, and the page was never drawn at any width other than its old or new width (`0` WebKit layouts on `Ctrl+1→2`, `2→1`, `3→2`, `2→3`; `1` layout on `Ctrl+1→3`, `3→1`, `Ctrl+O` open, and `Ctrl+O` close). On the single frame ~15 ms into `Ctrl+1→Ctrl+3` (`f_004.png`), an 8-px X11/WebKit resize seam appeared briefly near `x = 1333` before WebKit finished painting its newly grown 1394-px surface (gone by `f_005.png`, 15 ms later).
- **Still unseen:** native Hyprland/XWayland run (section H of `testing/TESTING.md`), hovering drawer rows and clicking inside the native page to dismiss on Hyprland, and macOS build and runtime.

## Back to Rune's own repository (2026-11-27)

Rune merged the fix for the typing slowdown into `dev` as `9396dcb` (their pull request #2512). A trial on branch `rune-trial-2`, which is `main` with only the pins in `app/Cargo.toml` changed, found:

- Nothing in `app/src/` or `app/tests/` had to change; `cargo test` (206) and the five tests against the real stub server pass as on the fork.
- Typing, `cargo run --release --features bench --bin typing -- --server`, on the 20 KB post: p95 0.15 to 0.28 ms a letter (the fork: 0.17 to 0.36 ms; `41cfc07` unfixed: 4.1 to 5.4 ms). Switching posts and a frame of a view switch cost what they did.
- On Xvfb with Hugo listening first, the builder ran sections F, G and H and found no row that differs, and captured 360 frames through the eight motions between views in Ink: no column of the ground, no blank page, no page at a width other than its old or new one. One frame of an 8-pixel seam at the right edge going from both panes to page only is there as before.
- David ran it natively on Hyprland and found nothing changed.

Not checked: the Mac, Windows, and composing input (fcitx5) on the new commit.

