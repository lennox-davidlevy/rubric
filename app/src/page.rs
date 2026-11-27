//! The page: a wry web view attached as an X11 child of Rune's window, owned by a thread of
//! its own that runs GTK, so typing never waits on the web view. Linux (X11) only: on other
//! systems `attach` reports that it cannot, and the app runs without the page.

/// Physical pixels.
#[derive(Clone, Debug, PartialEq)]
pub enum PageCmd {
    Bounds { x: i32, y: i32, w: u32, h: u32 },
    /// Moves the child window without resizing or calling `size_allocate` (zero WebKit relayout).
    Move { x: i32, y: i32 },
    Load(String),
    /// Audio and video off in the view's settings, for the rest of the run.
    MediaOff,
    /// The address the view had, loaded again.
    Reload,
    /// Whether the page holds keyboard input (true after a press in the page, false after the
    /// next press in the app).
    Keys(bool),
    Close,
}

/// How long after the page is loaded again a second death of its process stops it.
pub const AGAIN_MS: u64 = 10_000;

/// What the app does when the page's process dies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Death {
    /// Media off, then the address loaded again.
    Restart,
    /// Left stopped until the writer reloads it.
    Stop,
}

/// The page's process over the run: whether media was turned off, when the page was last
/// loaded again, and whether it is stopped. Plain data, so the tests need no window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Life {
    pub media_off: bool,
    pub again_ms: Option<u64>,
    pub stopped: bool,
}

impl Life {
    /// The process died at `now_ms`: restarted unless it was loaded again under `AGAIN_MS` ago.
    pub fn died(&mut self, now_ms: u64) -> Death {
        if self.stopped || self.again_ms.is_some_and(|t| now_ms.saturating_sub(t) < AGAIN_MS) {
            self.stopped = true;
            return Death::Stop;
        }
        self.media_off = true;
        self.again_ms = Some(now_ms);
        Death::Restart
    }

    /// The writer reloads a stopped page at `now_ms`; false when it is not stopped.
    pub fn reload(&mut self, now_ms: u64) -> bool {
        if !self.stopped {
            return false;
        }
        self.stopped = false;
        self.again_ms = Some(now_ms);
        true
    }
}

#[cfg(target_os = "linux")]
pub use linux::Page;

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use std::sync::mpsc::{self, Receiver, Sender};

    use gtk::{gdk, glib, prelude::*};
    use raw_window_handle::{
        HandleError, HasWindowHandle, RawWindowHandle, WindowHandle, XlibWindowHandle,
    };
    use wry::dpi::{PhysicalPosition, PhysicalSize};
    use webkit2gtk::{SettingsExt, WebViewExt};
    use wry::{PageLoadEvent, Rect, WebView, WebViewBuilder, WebViewExtUnix};

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
        keys_held: Rc<Cell<bool>>,
    }

    thread_local! {
        static OWNED: RefCell<Option<Owned>> = const { RefCell::new(None) };
    }

    impl Page {
        /// Returns at once. The web view is made on its own thread; `loaded` is called there with
        /// each URL that finishes loading, `failed` once if it cannot attach, `died` each time
        /// the web view's process ends (a crash, or the system ending it) with the reason,
        /// `pressed` when a pointer press lands in the page (giving it keys), and `key` for every
        /// key event delivered to the page's X11 window while the page does not hold keys.
        pub fn attach(
            parent_x11_window: u32,
            url: &str,
            loaded: impl Fn(String) + Send + 'static,
            failed: impl FnOnce(String) + Send + 'static,
            died: impl Fn(String) + Send + 'static,
            pressed: impl Fn() + Send + 'static,
            key: impl Fn(rune::KeyEvent) + Send + 'static,
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
                        .with_ipc_handler(|req| {
                            if let Some(rest) = req.body().strip_prefix("live: ") {
                                eprintln!("page: {rest}");
                            }
                        })
                        .with_on_page_load_handler(move |event, url| {
                            if matches!(event, PageLoadEvent::Finished) {
                                loaded(url);
                            }
                        })
                        .build_as_child(&Parent(parent_x11_window));
                    match built {
                        Ok(view) => {
                            let webview = view.webview();
                            webview.connect_web_process_terminated(move |_, reason| died(format!("{reason:?}")));
                            let keys_held = Rc::new(Cell::new(false));
                            let on_key: Rc<dyn Fn(rune::KeyEvent)> = Rc::new(key);
                            if let Some(top) = webview.toplevel() {
                                hook_keys(&top, keys_held.clone(), on_key.clone());
                                if &top != webview.upcast_ref::<gtk::Widget>() {
                                    hook_keys(webview.upcast_ref::<gtk::Widget>(), keys_held.clone(), on_key);
                                }
                            } else {
                                hook_keys(webview.upcast_ref::<gtk::Widget>(), keys_held.clone(), on_key);
                            }
                            let held_press = keys_held.clone();
                            webview.connect_button_press_event(move |_, _| {
                                if !held_press.replace(true) {
                                    pressed();
                                }
                                glib::Propagation::Proceed
                            });
                            OWNED.with(|o| *o.borrow_mut() = Some(Owned { view, rx, keys_held }));
                        }
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

    /// Intercepts key presses (and releases) on a GTK widget while the page does not hold keys,
    /// stopping propagation to WebKit and forwarding every key to the app as a `rune::KeyEvent`.
    /// While the page holds keys, window-wide app chords (`toolbar::window_chord`) still go to the
    /// app, are stopped at the page, and return keys to the app; every other key stays with the
    /// page.
    fn hook_keys(widget: &gtk::Widget, held: Rc<Cell<bool>>, on_key: Rc<dyn Fn(rune::KeyEvent)>) {
        let held_down = held.clone();
        widget.connect_key_press_event(move |_, ev| {
            let kev = gdk_event_key(ev);
            if held_down.get() {
                if let Some(kev) = kev.filter(crate::toolbar::window_chord) {
                    held_down.set(false);
                    on_key(kev);
                    return glib::Propagation::Stop;
                }
                return glib::Propagation::Proceed;
            }
            if let Some(kev) = kev {
                on_key(kev);
            }
            glib::Propagation::Stop
        });
        widget.connect_key_release_event(move |_, _| {
            if held.get() {
                glib::Propagation::Proceed
            } else {
                glib::Propagation::Stop
            }
        });
    }

    fn gdk_event_key(ev: &gdk::EventKey) -> Option<rune::KeyEvent> {
        let st = ev.state();
        gdk_key_to_rune(
            ev.keyval(),
            st.contains(gdk::ModifierType::SHIFT_MASK),
            st.contains(gdk::ModifierType::CONTROL_MASK),
            st.contains(gdk::ModifierType::MOD1_MASK),
            st.contains(gdk::ModifierType::SUPER_MASK),
            ev.is_modifier(),
        )
    }

    /// Translates a GDK keyval and modifier flags into a Rune `KeyEvent` (Linux convention:
    /// `cmd` follows `ctrl`, Space stays `Key::Text(" ")` even with `cmd`, and every other
    /// character with `cmd` becomes a lowercased `Key::Command`).
    pub(crate) fn gdk_key_to_rune(
        keyval: gdk::keys::Key,
        shift: bool,
        ctrl: bool,
        alt: bool,
        logo: bool,
        is_modifier: bool,
    ) -> Option<rune::KeyEvent> {
        use gdk::keys::constants as k;
        use rune::{Key, KeyEvent, Mods};
        if is_modifier {
            return None;
        }
        let mods = Mods { shift, cmd: ctrl, alt, ctrl, logo };
        let v = *keyval;
        let key = match keyval {
            k::Return | k::KP_Enter | k::ISO_Enter => Key::Enter,
            k::BackSpace => Key::Backspace,
            k::Delete | k::KP_Delete => Key::Delete,
            k::Left | k::KP_Left => Key::Left,
            k::Right | k::KP_Right => Key::Right,
            k::Up | k::KP_Up => Key::Up,
            k::Down | k::KP_Down => Key::Down,
            k::Home | k::KP_Home => Key::Home,
            k::End | k::KP_End => Key::End,
            k::Page_Up | k::KP_Page_Up => Key::PageUp,
            k::Page_Down | k::KP_Page_Down => Key::PageDown,
            k::Insert | k::KP_Insert => Key::Insert,
            k::Escape => Key::Escape,
            k::Tab | k::KP_Tab | k::ISO_Left_Tab => Key::Tab,
            k::Print | k::Sys_Req => Key::PrintScreen,
            k::Scroll_Lock => Key::ScrollLock,
            k::Pause | k::Break => Key::Pause,
            k::Menu => Key::ContextMenu,
            k::space | k::KP_Space => Key::Text(" ".into()),
            _ if (*k::F1..=*k::F24).contains(&v) => Key::Function((v - *k::F1 + 1) as u8),
            _ if (*k::KP_F1..=*k::KP_F4).contains(&v) => Key::Function((v - *k::KP_F1 + 1) as u8),
            _ => {
                let ch = match keyval {
                    _ if (*k::KP_0..=*k::KP_9).contains(&v) => Some((b'0' + (v - *k::KP_0) as u8) as char),
                    k::KP_Add => Some('+'),
                    k::KP_Subtract => Some('-'),
                    k::KP_Multiply => Some('*'),
                    k::KP_Divide => Some('/'),
                    k::KP_Decimal => Some('.'),
                    k::KP_Equal => Some('='),
                    k::KP_Separator => Some(','),
                    _ => keyval.to_unicode().filter(|c| !c.is_control()),
                }?;
                if mods.cmd && ch != ' ' {
                    Key::Command(ch.to_ascii_lowercase())
                } else {
                    Key::Text(ch.to_string())
                }
            }
        };
        Some(KeyEvent { key, mods })
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
                            // Never hide with set_visible(false) once attached: XUnmapWindow +
                            // XMapWindow at the same size leaves WebKitGTK blank without repainting.
                            // Instead, state::page_laid_out moves the view outside the window while
                            // keeping its last size, and moves it back when the pane returns.
                            if w > 0 && h > 0 {
                                let _ = owned.view.set_bounds(Rect {
                                    position: PhysicalPosition::new(x, y).into(),
                                    size: PhysicalSize::new(w, h).into(),
                                });
                            }
                        }
                        PageCmd::Move { x, y } => {
                            let webview = owned.view.webview();
                            let scale = webview.scale_factor().max(1) as f64;
                            let lx = (x as f64 / scale).round() as i32;
                            let ly = (y as f64 / scale).round() as i32;
                            if let Some(top) = webview.toplevel().and_then(|w| w.downcast::<gtk::Window>().ok()) {
                                top.move_(lx, ly);
                                if let Some(d) = gdk::Display::default() {
                                    d.flush();
                                }
                            }
                        }
                        PageCmd::Load(url) => {
                            let _ = owned.view.load_url(&url);
                        }
                        PageCmd::MediaOff => {
                            if let Some(settings) = WebViewExt::settings(&owned.view.webview()) {
                                settings.set_enable_media(false);
                                settings.set_enable_webaudio(false);
                            }
                        }
                        PageCmd::Reload => {
                            let _ = owned.view.reload();
                        }
                        PageCmd::Keys(on) => {
                            owned.keys_held.set(on);
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

    #[cfg(test)]
    mod tests {
        use super::gdk_key_to_rune;
        use gtk::gdk::keys::{Key as GKey, constants as k};
        use rune::{Key, KeyEvent, Mods};

        #[test]
        fn translates_typing_chords_navigation_and_function_keys() {
            // Plain and shifted typing, including non-ASCII Unicode and Space.
            assert_eq!(
                gdk_key_to_rune(GKey::from_unicode('a'), false, false, false, false, false),
                Some(KeyEvent { key: Key::Text("a".into()), mods: Mods::default() }),
            );
            assert_eq!(
                gdk_key_to_rune(GKey::from_unicode('W'), true, false, false, false, false),
                Some(KeyEvent { key: Key::Text("W".into()), mods: Mods { shift: true, ..Mods::default() } }),
            );
            assert_eq!(
                gdk_key_to_rune(GKey::from_unicode('é'), false, false, false, false, false),
                Some(KeyEvent { key: Key::Text("é".into()), mods: Mods::default() }),
            );
            assert_eq!(
                gdk_key_to_rune(k::space, false, false, false, false, false),
                Some(KeyEvent { key: Key::Text(" ".into()), mods: Mods::default() }),
            );
            // Ctrl+Space stays Key::Text(" ") with cmd/ctrl set, matching Rune.
            assert_eq!(
                gdk_key_to_rune(k::space, false, true, false, false, false),
                Some(KeyEvent { key: Key::Text(" ".into()), mods: Mods { cmd: true, ctrl: true, ..Mods::default() } }),
            );
            // Command chords: Ctrl+1, Ctrl+Shift+B, Ctrl+W, Ctrl+S, Ctrl+V.
            assert_eq!(
                gdk_key_to_rune(GKey::from_unicode('1'), false, true, false, false, false),
                Some(KeyEvent { key: Key::Command('1'), mods: Mods { cmd: true, ctrl: true, ..Mods::default() } }),
            );
            assert_eq!(
                gdk_key_to_rune(GKey::from_unicode('B'), true, true, false, false, false),
                Some(KeyEvent { key: Key::Command('b'), mods: Mods { shift: true, cmd: true, ctrl: true, ..Mods::default() } }),
            );
            assert_eq!(
                gdk_key_to_rune(GKey::from_unicode('w'), false, true, false, false, false),
                Some(KeyEvent { key: Key::Command('w'), mods: Mods { cmd: true, ctrl: true, ..Mods::default() } }),
            );
            // Named keys, Shift+Tab (ISO_Left_Tab), numpad, function keys.
            assert_eq!(
                gdk_key_to_rune(k::ISO_Left_Tab, true, false, false, false, false),
                Some(KeyEvent { key: Key::Tab, mods: Mods { shift: true, ..Mods::default() } }),
            );
            assert_eq!(
                gdk_key_to_rune(k::Return, false, true, false, false, false),
                Some(KeyEvent { key: Key::Enter, mods: Mods { cmd: true, ctrl: true, ..Mods::default() } }),
            );
            assert_eq!(
                gdk_key_to_rune(k::BackSpace, false, false, false, false, false),
                Some(KeyEvent { key: Key::Backspace, mods: Mods::default() }),
            );
            assert_eq!(
                gdk_key_to_rune(k::Left, true, false, false, false, false),
                Some(KeyEvent { key: Key::Left, mods: Mods { shift: true, ..Mods::default() } }),
            );
            assert_eq!(
                gdk_key_to_rune(k::F10, true, false, false, false, false),
                Some(KeyEvent { key: Key::Function(10), mods: Mods { shift: true, ..Mods::default() } }),
            );
            assert_eq!(
                gdk_key_to_rune(k::KP_3, false, true, false, false, false),
                Some(KeyEvent { key: Key::Command('3'), mods: Mods { cmd: true, ctrl: true, ..Mods::default() } }),
            );
            // Bare modifiers produce nothing.
            assert_eq!(gdk_key_to_rune(k::Control_L, false, true, false, false, true), None);
            assert_eq!(gdk_key_to_rune(k::Shift_L, true, false, false, false, false), None);
        }
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
        _died: impl Fn(String) + Send + 'static,
        _pressed: impl Fn() + Send + 'static,
        _key: impl Fn(rune::KeyEvent) + Send + 'static,
    ) -> Page {
        failed("no web view on this system yet".into());
        Page
    }
    pub fn send(&self, _cmd: PageCmd) {}
    pub fn close(self) {}
}
