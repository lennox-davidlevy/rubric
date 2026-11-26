# The app: moving Rune to today's `dev`

Written 2026-11-26. Slice 3 is on `main`. The app pins Rune at `0ca0756` (2026-11-13); `dev` has gone on well over a thousand commits since. This moves the pin in one step, keeps the app doing exactly what it does, and reports what the newer Rune can now do that the app had to work around. It builds nothing new.

## Who builds it

Neon builds from this file in one sitting on a new branch, `rune-move`, off `main`. The session that wrote it, or an Opus session, reviews the diff. The builder reads `CLAUDE.md`, this file, and in `docs/app-slice-findings.md` the sections "Slice 3: the designed menus" (all of it) and "The native run on Omarchy", and nothing from an earlier conversation.

The sitting stops at its end, says what it changed, what it could not check and the commit message, and does not go on to anything under "After the move". Where this plan and the code disagree, the code is right: say so and go on. Where a decision is missing, take the smaller choice and write it under "Decisions the build made" at the end of this file.

## What is known, checked 2026-11-26

- **The revision to pin: `41cfc073ca5845f1d689a41535d796f37a8f7eba`**, `dev`'s head on 2026-11-26. Pin this one, not whatever `dev` is when the sitting starts, so what is written here stays true of the code built.
- **The toolchain is the same**: Rune's `rust-toolchain.toml` and `app/rust-toolchain.toml` both say 1.99.1.
- **The patches.** Rune's README at that revision lists eight under `[patch.crates-io]`: `winit`, `sctk-adwaita`, `parley_engine`, `wgpu-hal`, `naga`, `accesskit_windows`, `accesskit_macos`, `accesskit_atspi_common`. `app/Cargo.toml` has four (`winit`, `parley_engine`, `wgpu-hal`, `accesskit_windows`). `winit` and `sctk-adwaita` must be patched together and from the same revision, or it does not compile (Rune's `crates/rune/README.md`, "Depending on Rune"). Every Rune line, crates and patches, names the same URL and the same `rev`; Rune's `scripts/check_rune_pins.py` checks that.
- **Rune's crates were split** (`rune-core`, `rune-edit`, `rune-text`, `rune-kit` and more) and its files moved (`window/events.rs` is now under `window/host/`). The app uses `rune` and `rune-kit` in about 46 places across 6,700 lines; expect names and paths to have changed.
- **A focus move still resets the input method.** `crates/rune/src/runtime/input/focus.rs` sets `ime_reset` on every `FocusEffect::Moved`, as the pinned revision did. So the lost keyboard under fcitx5 (the findings, "After sitting 4") is likely still there; only David's window can say.
- **The text position under a point now exists**: `Tx::text_offset_at(key, x, y)` (and the same on `Runtime`), a window point to a byte offset in a text field. A secondary press still gives its point (`PointerPress { x, y }`, `El::on_secondary_press`). That is what the right-click menu lacked.
- **Not looked for yet**: a line's rectangle other than the caret's, a font family for a span, lines drawn in a field that are not in its text. Task 4 looks.
- **The page depends on X11.** The web view is an X11 child of Rune's window (`app/src/page.rs`), and `main.rs` (`x11_session`) takes `WAYLAND_DISPLAY` away so the window is made on X11 through XWayland. The new `winit` and `sctk-adwaita` patches draw a client-side frame on Wayland; under X11 they should change nothing, but nobody has seen it.

Rune's source for reading: cargo's checkout once the pin is moved (`~/.cargo/git/checkouts/rune-*/41cfc07/`). Its `CHANGELOG.md` and `changelog/` say what changed between the two revisions; read them before fixing what does not compile.

## Rules for the session

- Keep what the app does. Every change is the smallest one that makes the app compile and its tests pass on the new Rune with the same behavior. No new feature, no use of a new Rune API where the old way still works, no redesign, no cleanup beside the point.
- A test that fails is fixed in the app, not in the test, unless the test names something of Rune's that only changed its name. Say which tests were touched and why. Never delete or weaken a test to get it passing.
- If something the app does cannot be kept on the new Rune (a handler that is gone, the web view that cannot attach, a look that cannot be drawn), stop there and report it. `main` is untouched, so stopping costs nothing.
- No call to Jev, no real drafts, no bench runs that cost money. Never pass `--live` or set `LIVE`. Never read `.env`.
- No window on David's display. The headless `Runtime`, the stub server and the headless `--snap` render are the session's eyes.
- Change nothing outside `app/`, this file, `docs/app-slice-findings.md`, `testing/TESTING.md` and `CLAUDE.md`. Nothing under `sites/` or `testing/` but `testing/TESTING.md`.
- Do not commit. Do not open an issue or post anything to Rune's repository: the wording is written for David, who sends it.
- Stop every process the session starts and check that it is gone.

## Tasks

In order.

### Task 1: what the app does now, written down first

On `rune-move`, before `Cargo.toml` changes, so there is something to compare with:

- `cargo test` and `cargo test -- --ignored` in `app/`: the counts that pass.
- `cargo run --release --features bench --bin typing -- --server`: the numbers in the findings' slice 3 table (a typed character, a key in an open menu, a menu's answer to its frame, a segment's key, Tab to the menu).
- A debug build's headless pictures: `rubric-app sites/app-slice/pages/posts/long.md --scene themes --snap <file> --at 1` (the list of themes), and the same with no scene if the switch allows it (the writing alone). Keep them in a folder outside the repository.
- The size of the release binary and the time of a clean release build.

### Task 2: the pin

- Every Rune line in `app/Cargo.toml` (`rune`, `rune-kit`, the patches) to the revision above, and the patch list made the README's eight.
- Find out how Rune's `scripts/check_rune_pins.py` is run against another workspace's manifest, and run it on `app/Cargo.toml` if it can be.
- `cargo build` warns when a patch is not used (``Patch `naga` was not used in the crate graph``): no such warning may be left, or the reason for it is written in the findings.

### Task 3: compile, then pass

- Fix what does not compile, by the rules above. Keep a list as it goes: each of Rune's names, types or behaviors that changed and what the app does now. That list goes into the findings.
- `cargo test`, then `cargo test -- --ignored`, then `bun run typecheck` and `bun test test/part-request.test.ts test/site-process.test.ts test/live.test.ts` (the server did not change, so these only show nothing else was touched).
- Task 1 again on the new Rune: the same counts, the numbers beside the old ones in one table, the pictures beside the old ones. Look at both pictures of each pair and say what differs, if anything: fonts, spacing, colors, the panel's shadow and corners. A budget that was met and is no longer met is reported, not tuned.

### Task 4: what Rune lacked, looked for again

Read the new source and answer each in the findings, with the file and the call. Build none of it.

1. **The text position under a right-click.** Does `Tx::text_offset_at` answer for the writing field from inside `on_secondary_press`? Does the app's handler still come before the field's own menu (it did: `runtime/input/secondary.rs` at the old revision)? Say in three lines how the right-click menu would be built.
2. **A line's rectangle** other than the caret's: for the `new:` line's edge and label (slice 3, sitting 1), and for a panel's place.
3. **Lines drawn in the field that are not in its text**: for a part's starter between its fences, as Neovim draws it (slice 3, sitting 7).
4. **A font family for a span.**
5. **The input method on a focus move.** Follow `ime_reset` from `focus.rs` to where the window acts on it: does a move from one text input to another still call `set_ime_allowed(false)` and then `set_ime_allowed(true)`? Does the window gaining the focus still do it? Check the changelog for anything about input methods, fcitx or XWayland.
6. **Anything in the changelog that answers a workaround in the app**: hover refreshed on every build (the app's rows follow `on_pointer_move` for it), focus taken by a press on a panel row, colors changing on springs. Name them; change nothing.

### Task 5: write it down, and David's rows

- `docs/app-slice-findings.md` gains "The move to Rune `41cfc07`": what changed in Rune that the app met, the table of numbers before and after, the pictures compared, the six answers of task 4, and what no one saw.
- For the keyboard, whichever way David's row goes, both texts ready in the findings:
  - if it is still lost: the issue for github.com/anomalyco/rune against the new revision, complete and standing alone (the machine, the steps, what happens, the lines of Rune that do it, what would fix it), from the findings' "After sitting 4" and task 4's fifth answer;
  - if it is not: the exact lines of `main.rs` that come out (`XMODIFIERS=@im=none`, `RUBRIC_IME`).
- `testing/TESTING.md` gains section D, one row a test, what to do on the left and what to expect on the right:
  - the app starts natively, with the page beside the writing and no second title bar or frame drawn by the app's window;
  - a short pass over section C's main paths: typing, Ctrl+T and a theme kept, Tab on a part and a setting changed, Insert part… and a part placed, a `new:` draft kept with the stub;
  - started with `RUBRIC_IME=1`: in and out of a quote's Cite field twenty times (Return on the row, a letter, Return), a letter typed in the writing after each;
  - idle CPU with the window open and nothing happening, and `menu drawn N ms` from the terminal for ten Tabs.
- `CLAUDE.md`'s State: the revision the app pins.

## After the move

Not part of the sitting. Each is planned on its own once David has run section D:

- The keyboard: the issue sent, or `XMODIFIERS` taken out.
- The right-click menu, David's first ask, if task 4 finds the way open.
- A part's starter between its fences in the editor, if Rune can draw such lines.
- The `new:` line's edge and label, if a line's rectangle can be had.

## Decisions the build made

One line each: what was chosen, and why the plan did not settle it.

- Ran `cargo update -p naga --precise 30.0.1 --offline` so `app/Cargo.lock` uses Rune's patched `naga 30.0.1` instead of crates.io `30.0.2` (accepted by `wgpu-core 30.0.2` and `wgpu-naga-bridge 30.0.2`): clears the unused-patch warning while keeping Rune's full eight-patch list intact for `check_rune_pins.py`.
- Measured clean release build time with `cargo clean && cargo build --release` before and after (rather than `cargo clean --release`): includes proc-macros and build scripts identically on both sides.
- Kept before/after headless `--snap` PNGs in the session scratch directory outside the repository (`/home/david/.gemini/antigravity-cli/brain/bfea9946-27d5-4ffb-986f-d74731c1dc4c/scratch/snaps/`): the plan asked only for a folder outside the repository.
- Noted where plan and code disagreed: none of the ~46 Rune uses across `app/` broke on `41cfc07` (public re-exports stayed compatible, so zero Rust source or test lines changed), and `tests/server.rs` has three ignored stub-server tests (all passing).
