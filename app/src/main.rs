use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rune::{App, AppSpec};
use rubric_app::lsp::Client;
use rubric_app::page::Page;
use rubric_app::state::{self, State};

static OPENED: OnceLock<(PathBuf, String)> = OnceLock::new();
const SIZE: (f32, f32) = (1400.0, 900.0);

fn init() -> State {
    let (path, text) = OPENED.get().expect("opened before run").clone();
    let mut s = State::open(path, text);
    s.width = SIZE.0;
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
    let Some(file) = args.iter().find(|a| !a.starts_with("--")) else {
        eprintln!("usage: rubric-app <post.md>");
        std::process::exit(2);
    };
    let path = match std::fs::canonicalize(file) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{file}: {e}");
            std::process::exit(1);
        }
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{}: {e}", path.display());
            std::process::exit(1);
        }
    };
    let live = args.iter().any(|a| a == "--live");
    let site = site_of(&path);
    let _ = OPENED.set((path, text));

    let app = App::new(AppSpec::<State> { ..AppSpec::new("Rubric", SIZE, init, rubric_app::view) });

    // The server, from a thread of its own, so the first frame never waits on it.
    match site {
        Some(site) => {
            let handle = app.handle();
            std::thread::spawn(move || {
                let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("app/ is in the repo").to_path_buf();
                let to_ui = handle.clone();
                let started = Client::start(&repo, &site, !live, move |m| to_ui.update(move |s, _| state::incoming(s, m)));
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
        // Tab to the menu on screen, for the measure in the findings.
        if rt.state.menu.is_some()
            && let Some(asked) = rt.state.looked.take()
        {
            eprintln!("menu drawn {:.1} ms", asked.elapsed().as_secs_f64() * 1000.0);
        }
        if rt.state.edit.range() != rt.state.last_range {
            moves.update_if(|s, _| state::moved(s));
        }
    })
    .on_window(move |window| {
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
        let page = Page::attach(id, "about:blank", loaded, |e| eprintln!("page failed: {e}"));
        handle.update(move |s, _| state::page_attached(s, page));
    })
    // Linux runs `on_close` when the window closes but not `on_quit`, so the server and the page go here.
    .on_close(|s, _| state::shut(s))
    .on_quit(|s, _| state::shut(s))
    .run();
}
