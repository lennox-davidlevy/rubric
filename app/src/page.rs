//! The page: a wry web view attached as an X11 child of Rune's window, owned by a thread of
//! its own that runs GTK, so typing never waits on the web view. Linux (X11) only: on other
//! systems `attach` reports that it cannot, and the app runs without the page.

/// Physical pixels.
#[derive(Clone, Debug, PartialEq)]
pub enum PageCmd {
    Bounds { x: i32, y: i32, w: u32, h: u32 },
    Load(String),
    Close,
}

#[cfg(target_os = "linux")]
pub use linux::Page;

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::RefCell;
    use std::sync::mpsc::{self, Receiver, Sender};

    use gtk::glib;
    use raw_window_handle::{
        HandleError, HasWindowHandle, RawWindowHandle, WindowHandle, XlibWindowHandle,
    };
    use wry::dpi::{PhysicalPosition, PhysicalSize};
    use wry::{PageLoadEvent, Rect, WebView, WebViewBuilder};

    use super::PageCmd;

    pub struct Page {
        tx: Sender<PageCmd>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    /// The parent window, rebuilt from its X11 id on the page's thread.
    struct Parent(u32);

    impl HasWindowHandle for Parent {
        fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
            let raw = RawWindowHandle::Xlib(XlibWindowHandle::new(self.0 as _));
            // SAFETY: the id names Rune's window, which outlives the web view: `Close` is sent and
            // the thread joined before the app's window goes.
            Ok(unsafe { WindowHandle::borrow_raw(raw) })
        }
    }

    struct Owned {
        view: WebView,
        rx: Receiver<PageCmd>,
    }

    thread_local! {
        static OWNED: RefCell<Option<Owned>> = const { RefCell::new(None) };
    }

    impl Page {
        /// Returns at once. The web view is made on its own thread; `loaded` is called there with
        /// each URL that finishes loading, `failed` once if it cannot attach.
        pub fn attach(
            parent_x11_window: u32,
            url: &str,
            loaded: impl Fn(String) + Send + 'static,
            failed: impl FnOnce(String) + Send + 'static,
        ) -> Page {
            let (tx, rx) = mpsc::channel();
            let url = url.to_string();
            let thread = std::thread::Builder::new()
                .name("page".into())
                .spawn(move || {
                    if let Err(e) = gtk::init() {
                        failed(format!("gtk::init: {e}"));
                        return;
                    }
                    let built = WebViewBuilder::new()
                        .with_url(&url)
                        .with_bounds(Rect {
                            position: PhysicalPosition::new(0, 0).into(),
                            size: PhysicalSize::new(1u32, 1u32).into(),
                        })
                        .with_on_page_load_handler(move |event, url| {
                            if matches!(event, PageLoadEvent::Finished) {
                                loaded(url);
                            }
                        })
                        .build_as_child(&Parent(parent_x11_window));
                    match built {
                        Ok(view) => OWNED.with(|o| *o.borrow_mut() = Some(Owned { view, rx })),
                        Err(e) => {
                            failed(format!("build_as_child: {e}"));
                            return;
                        }
                    }
                    // Commands sent before the loop ran. A close among them ends it here:
                    // `main_quit` does nothing before `gtk::main` runs, which would then
                    // never return.
                    if !run_commands() {
                        gtk::main();
                    }
                    OWNED.with(|o| o.borrow_mut().take());
                });
            let thread = match thread {
                Ok(t) => Some(t),
                Err(e) => {
                    eprintln!("page thread: {e}");
                    None
                }
            };
            Page { tx, thread }
        }

        pub fn send(&self, cmd: PageCmd) {
            // Always queued on the default context, which only the page's thread runs: `invoke`
            // would run `drain` here instead when this thread could take the context.
            if self.tx.send(cmd).is_ok() {
                glib::idle_add_once(drain);
            }
        }

        /// Closes the web view and waits for its thread.
        pub fn close(mut self) {
            self.send(PageCmd::Close);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }

    /// Runs on the page's thread: carries out every command waiting.
    fn drain() {
        run_commands();
    }

    /// `drain`, saying whether a close was among the commands.
    fn run_commands() -> bool {
        OWNED.with(|o| {
            let mut close = false;
            if let Some(owned) = o.borrow().as_ref() {
                while let Ok(cmd) = owned.rx.try_recv() {
                    match cmd {
                        PageCmd::Bounds { x, y, w, h } => {
                            let shown = w > 0 && h > 0;
                            if shown {
                                let _ = owned.view.set_bounds(Rect {
                                    position: PhysicalPosition::new(x, y).into(),
                                    size: PhysicalSize::new(w, h).into(),
                                });
                            }
                            let _ = owned.view.set_visible(shown);
                        }
                        PageCmd::Load(url) => {
                            let _ = owned.view.load_url(&url);
                        }
                        PageCmd::Close => close = true,
                    }
                }
            }
            if close {
                o.borrow_mut().take();
                gtk::main_quit();
            }
            close
        })
    }
}

/// Not on Linux: the page is not attached yet (the Mac path is the next session's).
#[cfg(not(target_os = "linux"))]
pub struct Page;

#[cfg(not(target_os = "linux"))]
impl Page {
    pub fn attach(
        _parent_x11_window: u32,
        _url: &str,
        _loaded: impl Fn(String) + Send + 'static,
        failed: impl FnOnce(String) + Send + 'static,
    ) -> Page {
        failed("no web view on this system yet".into());
        Page
    }
    pub fn send(&self, _cmd: PageCmd) {}
    pub fn close(self) {}
}
