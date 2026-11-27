use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rune::{App, AppSpec};
use rubric_app::lsp::Client;
use rubric_app::page::Page;
use rubric_app::state::{self, State};

enum Target {
    File(PathBuf, String),
    Folder(PathBuf),
}

static OPENED: OnceLock<Target> = OnceLock::new();
const SIZE: (f32, f32) = (1400.0, 900.0);

/// On Linux the page attaches to an X11 window only, so under Wayland the app runs through
/// XWayland: no `WAYLAND_DISPLAY` for the window, X11 for GTK. WebKit's DMABUF renderer draws
/// a black page on NVIDIA's driver, so it is off unless the environment says otherwise. The
/// X11 input method is off too (below).
/// Called before any thread starts, which is what makes changing the environment sound.
fn x11_session() {
    // RUBRIC_WAYLAND=1 keeps the window on Wayland, with no page: to compare typing there.
    if !cfg!(target_os = "linux") || std::env::var_os("DISPLAY").is_none() || std::env::var_os("RUBRIC_WAYLAND").is_some() {
        return;
    }
    // SAFETY: the process has one thread here.
    unsafe {
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::set_var("GDK_BACKEND", "x11");
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        // No X11 input method: Rune turns the window's input method off and on at every focus
        // move between text inputs, and under fcitx5 through XWayland that now and then leaves
        // the app with no keys at all (the findings, slice 3, sitting 4). Composing (Chinese,
        // Japanese, Korean) is lost with it until Rune is fixed; RUBRIC_IME=1 keeps it.
        if std::env::var_os("RUBRIC_IME").is_none() {
            std::env::set_var("XMODIFIERS", "@im=none");
        }
    }
}

fn init() -> State {
    let mut s = match OPENED.get().expect("opened before run") {
        Target::File(path, text) => State::open(path.clone(), text.clone()),
        Target::Folder(dir) => State::open_folder(dir.clone()),
    };
    s.width = SIZE.0;
    // The app's theme: RUBRIC_APP_THEME for one run, else the one kept, else Paper.
    let wanted = std::env::var("RUBRIC_APP_THEME").ok().filter(|v| !v.is_empty());
    let look = rubric_app::theme::Look::load(rubric_app::theme::config_dir(), wanted, rubric_app::theme::Mode::from_env());
    state::set_look(&mut s, look);
    s
}

/// The window's X11 id, copied out of the raw handle (a plain number, safe to keep).
fn x11_id(window: &rune::WindowHandle) -> Option<u32> {
    use raw_window_handle::RawWindowHandle;
    window.with_raw_handle(|h| match h.as_raw() {
        RawWindowHandle::Xlib(x) => Some(x.window as u32),
        RawWindowHandle::Xcb(x) => Some(x.window.get()),
        _ => None,
    }).ok().flatten()
}

/// The nearest folder above the file that holds `rubric.md`.
fn site_of(file: &Path) -> Option<PathBuf> {
    file.ancestors().skip(1).find(|d| d.join("rubric.md").is_file()).map(Path::to_path_buf)
}

fn main() {
    let begun = std::time::Instant::now();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(arg) = args.iter().find(|a| !a.starts_with("--")) else {
        eprintln!("usage: rubric-app <post.md | site-folder>");
        std::process::exit(2);
    };
    let path = match std::fs::canonicalize(arg) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{arg}: {e}");
            std::process::exit(1);
        }
    };
    let live = args.iter().any(|a| a == "--live");
    x11_session();
    let (target, site) = if path.is_dir() {
        if !path.join("rubric.md").is_file() {
            eprintln!("{}: not a Rubric site (no rubric.md)", path.display());
            std::process::exit(1);
        }
        (Target::Folder(path.clone()), Some(path))
    } else {
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("{}: {e}", path.display());
                std::process::exit(1);
            }
        };
        let site = site_of(&path);
        (Target::File(path, text), site)
    };
    let _ = OPENED.set(target);

    let app = App::new(AppSpec::<State> {
        fonts: rubric_app::fonts::FONTS,
        families: rubric_app::fonts::FAMILIES,
        // For `--snap out.png --scene themes` in a debug build: the list of themes, drawn headless.
        scenes: &[("themes", rubric_app::look::show_themes)],
        // Insert part…'s list pause and autosave deadline.
        poll: Some(rubric_app::state::poll),
        // Window-wide shortcuts and panel keys when the writing pane is hidden (page-only view).
        on_key: Some(rubric_app::editor::window_key),
        ..AppSpec::new("Rubric", SIZE, init, rubric_app::view)
    });
    // On Linux, no system frame: the toolbar row moves the window and the edges resize it.
    #[cfg(target_os = "linux")]
    let app = app.window_options(rune::WindowOptions { borderless: true, ..Default::default() });

    // The server, from a thread of its own, so the first frame never waits on it.
    match site {
        Some(site) => {
            let handle = app.handle();
            std::thread::spawn(move || {
                let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("app/ is in the repo").to_path_buf();
                let to_ui = handle.clone();
                let started = Client::start(&repo, &site, !live, move |m| to_ui.update_if(move |s, tx| {
                    let changed = state::incoming(s, m);
                    state::follow_up(s, tx);
                    changed
                }));
                match started {
                    Ok(client) => handle.update(move |s, _| state::connected(s, client)),
                    Err(e) => eprintln!("server: {e}"),
                }
            });
        }
        None => eprintln!("server: no rubric.md above the file"),
    }

    // The seconds of "drafting 12 s" and the end of a flash: a thread that wakes the app once
    // a second while either shows, and is parked the rest of the time.
    let ticks = app.handle();
    let on = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let running = on.clone();
    let ticker = std::thread::spawn(move || loop {
        if !running.load(std::sync::atomic::Ordering::Relaxed) {
            std::thread::park();
            continue;
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
        ticks.update_if(|s, _| rubric_app::draft::tick(s));
    });
    let thread = ticker.thread().clone();
    app.handle().update(move |s, _| s.ticker = Some(state::Ticker { on, thread }));

    // A caret moved by keys or the pointer is no edit, and nothing reports it. `AppSpec::poll`
    // runs at the start of a frame, before its input, so a move was seen a frame late, and never
    // when the app then rested. After each drawn frame instead: a move goes to the state.
    let moves = app.handle();
    let handle = app.handle();
    app.on_frame_drawn(move |rt| {
        // During a view switch or page-only drawer/popover slide, follow Rune's presented `"page"`
        // rect with position-only moves, resizing once at rest when shrinking.
        if let Some(slide) = rt.state.view_slide.get()
            && let Some((rect, _)) = rt.presented("page")
        {
            let held = slide.holds_under();
            state::page_presented(&rt.state, rect, rt.window_scale());
            if held && rt.state.view_slide.get().is_none() {
                moves.update(|_, tx| tx.instant());
            }
        }
        // Tab to the menu on screen, and Return on a drawer row to post drawn, for the findings.
        if let Some(said) = state::menu_drawn(&rt.state) {
            eprintln!("{said}");
        }
        if let Some(said) = state::switch_drawn(&rt.state) {
            eprintln!("{said}");
        }
        if rubric_app::trace::on() {
            rubric_app::trace::frame(|| {
                let s = &rt.state;
                let focused: Vec<String> = rt.elements().into_iter().filter(|e| e.focused).map(|e| e.key.clone().unwrap_or_else(|| "?".into())).collect();
                let panels: Vec<String> = s.panels.iter().map(|p| format!("{}@{}", p.id, p.active_id().unwrap_or("-"))).collect();
                format!("focused {focused:?} ime_area {:?} panels {panels:?} field_live {} held {} edit.focused {} field.focused {}",
                    rt.ime_area.map(|a| a.map(|v| v.round())), s.field_live, s.held.is_some(), s.edit.focused, s.field.focused)
            });
        }
        if rt.state.edit.range() != rt.state.last_range {
            moves.update_if(|s, _| state::moved(s));
        }
    })
    .on_window(move |window| {
        // RUBRIC_NO_PAGE=1 leaves the page pane empty: to compare typing without the web view.
        if std::env::var_os("RUBRIC_NO_PAGE").is_some() {
            return;
        }
        let Some(id) = x11_id(window) else {
            eprintln!("page: the web view attaches to an X11 window only, for now");
            return;
        };
        // The web view starts at once, empty; the page's address comes from the server.
        // With the time since the top of `main`, for task 5's measure.
        let loaded = move |url: String| {
            if url != "about:blank" {
                eprintln!("page loaded {url} {} ms", begun.elapsed().as_millis());
            }
        };
        let deaths = handle.clone();
        let died = move |reason: String| {
            deaths.update(move |s, _| {
                state::page_died(s, &reason);
            });
        };
        let press_handle = handle.clone();
        let pressed = move || {
            press_handle.update_if(|s, tx| {
                let had_overlay = s.drawer.open || rubric_app::toolbar::view_open(s);
                state::page_pressed_tx(s, tx);
                had_overlay
            });
        };
        let key_handle = handle.clone();
        let on_key = move |ev| {
            key_handle.update(move |s, tx| {
                s.page_has_keys = false;
                tx.send_key(ev);
            });
        };
        let page = Page::attach(id, "about:blank", loaded, |e| eprintln!("page failed: {e}"), died, pressed, on_key);
        handle.update(move |s, _| state::page_attached(s, page));
    })
    // Linux runs `on_close` when the window closes but not `on_quit`, so the server and the page go here.
    .on_close(|s, _| state::shut(s))
    .on_quit(|s, _| state::shut(s))
    .run();
}
