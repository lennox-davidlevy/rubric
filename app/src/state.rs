//! The app's one piece of state, and what happens when the writing changes.

use std::path::PathBuf;

use rune::{Span, TextEdit, Tx};

use serde_json::json;

use std::collections::HashMap;

use crate::{draft, ghost, markdown, position};

/// How long after the last change the post saves by itself, in seconds.
pub const AUTOSAVE_SECS: f64 = 1.0;

/// Curve driving `"page"`'s horizontal glide during a `ViewSlide`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlideCurve {
    /// Rune's default layout spring (view switches: Ctrl+1 / Ctrl+2 / Ctrl+3 / View popover).
    Spring,
    /// Drawer's 140 ms ease-out (opening drawer or View popover over a yielding page).
    DrawerOpen,
    /// Drawer's 140 ms ease-in (closing drawer or View popover over a yielding page).
    DrawerClose,
}

/// An in-flight slide of the native web view (a view switch between `Both`, `Write`, and `Page`,
/// or opening/closing the drawer or View popover when it shifts the page).
///
/// The web view sits on top of everything, so it always slides at the larger of its old and new
/// sizes (`slide_size`): when growing it is resized once before sliding; when shrinking it slides
/// first and is resized once at rest (`final_size`). Meanwhile, what lies under the page stays in
/// its place so no column of ground color ever shows beside or between the panes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewSlide {
    pub target_x: i32,
    pub target_y: i32,
    pub slide_size: (u32, u32),
    pub final_size: (u32, u32),
    pub leaving: bool,
    pub curve: SlideCurve,
    pub last_pos: Option<(i32, i32)>,
    /// While covering the writing pane (e.g. Ctrl+1→Ctrl+3 or Ctrl+2→Ctrl+3), keep writing laid
    /// out at this width underneath the sliding web view until rest.
    pub under_left: Option<f32>,
    /// Lay out writing and divider immediately at their final (or held) place from Frame 0.
    pub instant_under: bool,
    /// While the page slides back over a closing drawer in page-only view, keep the drawer drawn
    /// underneath until rest.
    pub hold_drawer: bool,
    /// While the page slides back over a closing cover column, keep `page-cover` drawn underneath
    /// until rest.
    pub hold_cover: f32,
}

impl ViewSlide {
    /// Whether clearing this slide at rest needs one instant view rebuild to unmount a held
    /// writing pane, drawer, or cover column that sat underneath the closing page.
    pub fn holds_under(&self) -> bool {
        self.under_left.is_some() || self.hold_drawer || self.hold_cover > 0.0
    }
}
/// What the top row shows beside the post's title.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SaveState {
    Saved,
    Edited,
    Failed,
}

/// File metadata recorded when the app last read or wrote the open post, used by `save` to skip
/// reading the file when untouched on disk (one `stat(2)` call).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiskStamp {
    pub len: u64,
    pub modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    pub ino: u64,
    #[cfg(unix)]
    pub ctime: (i64, i64),
}

impl DiskStamp {
    pub fn of(path: &std::path::Path) -> Option<DiskStamp> {
        std::fs::metadata(path).ok().map(|m| Self::from_meta(&m))
    }

    pub fn from_meta(meta: &std::fs::Metadata) -> DiskStamp {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        DiskStamp {
            len: meta.len(),
            modified: meta.modified().ok(),
            #[cfg(unix)]
            ino: meta.ino(),
            #[cfg(unix)]
            ctime: (meta.ctime(), meta.ctime_nsec()),
        }
    }
}

/// One page returned by `rubric/pages`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageEntry {
    pub uri: String,
    pub kind: String,
    pub title: String,
    pub date: Option<String>,
    pub draft: bool,
}

/// The site's name and its pages from `rubric/pages`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SitePages {
    pub site: String,
    pub pages: Vec<PageEntry>,
}

impl SitePages {
    pub fn parse(v: &serde_json::Value) -> Option<SitePages> {
        let site = v.get("site")?.as_str()?.to_string();
        let pages = v.get("pages")?.as_array()?.iter().filter_map(|p| {
            Some(PageEntry {
                uri: p.get("uri")?.as_str()?.to_string(),
                kind: p.get("kind")?.as_str()?.to_string(),
                title: p.get("title")?.as_str()?.to_string(),
                date: p.get("date").and_then(|d| d.as_str()).map(str::to_string),
                draft: p.get("draft").and_then(|d| d.as_bool()).unwrap_or(false),
            })
        }).collect();
        Some(SitePages { site, pages })
    }
}

/// The page opened when the app starts on a site's folder: its newest post (the first post in
/// `rubric/pages`), else its home page, else the first page listed.
pub fn pick_initial(pages: &[PageEntry]) -> Option<&PageEntry> {
    pages.iter().find(|p| p.kind == "post")
        .or_else(|| pages.iter().find(|p| p.kind == "home"))
        .or_else(|| pages.first())
}

pub struct State {
    /// The Markdown file (or the site folder while `waiting_for_page` is true).
    pub path: PathBuf,
    pub edit: TextEdit,
    /// LSP document version, starts at 1.
    pub version: i32,
    /// The text as last written, to know whether it is dirty.
    pub saved: String,
    /// Metadata of `path` as last read or written, to detect changes by another program before writing.
    pub disk: Option<DiskStamp>,
    /// Another program changed `path` on disk since the app last read or wrote it; nothing is
    /// written until reloaded (or the file on disk matches `saved` again).
    pub disk_conflict: bool,
    /// 0.0 = page only, 1.0 = writing only; starts 0.5.
    pub split: f32,
    /// Right edge of what is open at the left (the View popover, or the drawer in sitting 3),
    /// in window points: the page starts past this edge plus the divider.
    pub left_cover: f32,
    /// To notice caret moves after each drawn frame.
    pub last_range: (usize, usize),
    /// file:// of `path`.
    pub uri: String,
    /// The Markdown styles, made again on each change rather than in every view.
    pub spans: Vec<Span>,
    /// Writer-facing sentence for the last failed save; stays until a save succeeds.
    pub save_error: Option<String>,
    /// A change needs an autosave deadline armed on the window's clock.
    pub save_arm: bool,
    /// Window clock time (seconds) when the pending autosave writes.
    pub save_due: Option<f64>,
    /// Whether `shut` has already run, so `on_close` + `on_quit` never double-save or double-log.
    pub shut_done: bool,
    /// Started on a site folder: waiting for `rubric/pages` to open the newest post or home page.
    pub waiting_for_page: bool,
    /// In-flight `rubric/pages` request id.
    pub pages_req: Option<i64>,
    /// Last `rubric/pages` response from the server.
    pub site_pages: Option<SitePages>,
    /// The drawer's open/selection/hover state.
    pub drawer: crate::drawer::Drawer,
    /// When Return/click started switching to another post, until the frame that draws it.
    pub switched: std::cell::Cell<Option<std::time::Instant>>,
    /// The web view, once the window exists (task 2).
    pub page: Option<crate::page::Page>,
    /// The window's width in points, for the divider.
    pub width: f32,
    /// The page pane's last bounds sent, in physical pixels (`Cell` so `on_frame_drawn` can
    /// advance position-only slides without triggering a view rebuild).
    pub bounds: std::cell::Cell<Option<(i32, i32, u32, u32)>>,
    /// Active view-switch slide (between `Both`, `Write`, and `Page`), cleared once settled.
    pub view_slide: std::cell::Cell<Option<ViewSlide>>,
    /// The language server, once it answered initialize (task 3).
    pub client: Option<crate::lsp::Client>,
    /// Last line sent as rubric/cursor.
    pub cursor_line: Option<u32>,
    /// The page's address from rubric/serving, loaded once.
    pub page_url: Option<String>,
    /// The open post's URL path from rubric/page (e.g. "/posts/long/").
    pub page_path: Option<String>,
    /// The pick shown after the caret (task 4).
    pub ghost: Option<crate::ghost::Ghost>,
    /// The inlineCompletion asked last: its id, the document version and the line.
    pub asked: Option<(i64, i32, u32)>,
    /// The window's height in points, for the menu's place.
    pub height: f32,
    /// The `new:` line whose menu is open, and what the server said of it.
    pub view: Option<draft::Open>,
    /// A drafter chosen for one line (the line's text): it rides on that line's builds.
    pub choice: Option<(String, draft::Choice)>,
    /// Each `new:` line's status, from the server's diagnostics: line, status.
    pub drafts: Vec<(u32, draft::Status)>,
    /// Something that just happened, said at the bottom of the writing until the time in ms.
    pub flash: Option<(draft::Said, u64)>,
    /// The time the status line counts from, in ms; set by what changes it and by the ticker.
    pub now_ms: u64,
    /// `rubric/draft` requests not answered yet.
    pub pending: HashMap<i64, draft::Asked>,
    /// When Tab asked for a line's menu, until the frame that draws it: the time is printed.
    pub looked: std::cell::Cell<Option<std::time::Instant>>,
    /// When the first request of that menu ask was sent.
    pub looked_sent: Option<std::time::Instant>,
    /// Of that time, how long the server took to answer (from sending to the later answer), in ms.
    pub looked_server_ms: f64,
    /// When each request not answered yet was sent, by its id.
    pub sent_at: HashMap<i64, std::time::Instant>,
    /// Wakes the app once a second while a draft runs or a flash shows.
    pub ticker: Option<Ticker>,
    /// The app's theme and its colors.
    pub look: crate::theme::Look,
    /// The title row's words: the post's first heading, or its file's name.
    pub title: String,
    /// The writing pane's rectangle in window points, as last laid out: menus stay inside it.
    pub pane: [f32; 4],
    /// The open panels: one, or a second beside it.
    pub panels: Vec<crate::panel::Panel>,
    /// The text of a panel's field (one at a time).
    pub field: TextEdit,
    /// Whose text `field` holds: the panel's id and the row's.
    pub field_of: Option<(String, String)>,
    /// The in-flight `rubric/part` + `rubric/draft` pair for a `:::` line before its menu opens.
    pub part_wait: Option<crate::part::Pending>,
    /// A setting changed while another change was on its way: sent once that one is answered.
    pub set_next: Option<(String, String)>,
    /// A setting's change is on its way.
    pub setting: bool,
    /// The line Insert part… or a line of words' menu is for, and the parts it lists.
    pub insert: Option<crate::insert::Insert>,
    /// The writer's default drafter, as the server last named it.
    pub drafter: Option<String>,
    /// A panel opened by an answer has a field with the focus: the keys go to it.
    pub focus_field: bool,
    /// The panel's field has the keys (it was typed on, given Return or pressed); a field row
    /// that only has the focus leaves them with the writing.
    pub field_live: bool,
    /// The writing as it was when a field row without the keys took the focus.
    pub held: Option<TextEdit>,
    /// Where the panels hang: the line they opened on, from the writing field's top.
    pub anchor: Option<Anchor>,
    /// Waiting for `Tx::text_line` to place a panel opened by a secondary press before drawing it.
    pub anchor_wait: bool,
    /// The writing field's rectangle in window points, after scrolling.
    pub editor_rect: [f32; 4],
    /// Draft lines in the writing, rebuilt when text or `drafts` changes.
    pub draft_marks: Vec<crate::draft::Mark>,
    /// Each draft line's vertical box relative to `"editor"`'s top, keyed by line number.
    pub draft_boxes: HashMap<u32, DraftBox>,
    /// `(version, editor_w_tenths, editor_h_tenths, marks_sig)` for which `draft_boxes` were asked.
    pub draft_boxes_for: (i32, i32, i32, u64),
    /// What to say once the server has answered a request, by its id: a label and a fact.
    pub said_on: HashMap<i64, (String, String)>,
    /// The theme and mode drawn when the list of themes opened, to go back to.
    pub theme_before: Option<(String, crate::theme::Mode)>,
    /// The page's process over the run: media off, restarted, stopped.
    pub page_life: crate::page::Life,
    /// Whether the page currently holds keyboard input (after a press inside it, until the next
    /// press in the app).
    pub page_has_keys: bool,
    /// The View toolbar button's rectangle in window points, for hanging its popover.
    pub view_btn_rect: [f32; 4],
    /// Which toolbar button the pointer is currently over.
    pub toolbar_hover: Option<crate::toolbar::Hover>,
}

/// The line a panel hangs from, taken when it opens: which line, where it starts in the text,
/// and the writing field's width then (a resize wraps the text again), with the line's offset
/// from the field's top and its height. Scrolling moves the field, and the panel with it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Anchor {
    pub line: u32,
    pub start: usize,
    pub width: f32,
    pub dy: f32,
    pub h: f32,
}

impl Anchor {
    /// Still the caret's line, as it was laid out.
    pub fn holds(&self, line: u32, start: usize, width: f32) -> bool {
        self.line == line && self.start == start && (self.width - width).abs() < 0.5
    }
}

/// A draft line's measured box relative to `"editor"`'s top, so scrolling moves its edge and
/// label with `editor_rect[1]` without re-querying `text_line`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DraftBox {
    pub dy: f32,
    pub h: f32,
    pub wrapped: bool,
    pub text_w: f32,
    /// Byte length of the line when `text_w` was measured.
    pub start: usize,
    pub end: usize,
}

/// The caret's line and the byte it starts at.
pub fn caret_line_start(s: &State) -> (u32, usize) {
    let line = position::line_char(&s.edit.text, s.edit.focus).0;
    (line, position::line_range(&s.edit.text, line).start)
}

/// The thread that ticks: parked until `wake`, at rest again when nothing needs the time.
pub struct Ticker {
    pub on: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub thread: std::thread::Thread,
}

impl Ticker {
    pub fn rest(&self) {
        self.on.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Something on screen now changes with time.
pub fn wake(s: &State) {
    if let Some(t) = &s.ticker {
        t.on.store(true, std::sync::atomic::Ordering::Relaxed);
        t.thread.unpark();
    }
}

impl State {
    pub fn open(path: PathBuf, text: String) -> State {
        let mut edit = TextEdit::new(text.clone());
        edit.focused = true;
        edit.set_caret(0);
        let uri = file_uri(&path);
        let disk = DiskStamp::of(&path);
        let look = crate::theme::Look::load(None, None, None);
        let spans = markdown::spans(&text, &marks(&look.palette), &[]);
        let title = title_of(&path, &text);
        let mut s = State {
            path, edit, version: 1, saved: text, disk, disk_conflict: false, split: 0.5, left_cover: 0.0, last_range: (0, 0), uri, spans,
            save_error: None, save_arm: false, save_due: None, shut_done: false, waiting_for_page: false, pages_req: None, site_pages: None,
            drawer: crate::drawer::Drawer::default(), switched: std::cell::Cell::new(None),
            page: None, width: 0.0,
            bounds: std::cell::Cell::new(None), view_slide: std::cell::Cell::new(None), client: None, cursor_line: None, page_url: None, page_path: None, ghost: None, asked: None, height: 0.0,
            view: None, choice: None, drafts: Vec::new(), flash: None, now_ms: draft::now_ms(),
            pending: HashMap::new(), looked: std::cell::Cell::new(None), looked_sent: None, looked_server_ms: 0.0, sent_at: HashMap::new(), ticker: None, look, title, pane: [0.0; 4],
            panels: Vec::new(), field: TextEdit::new(""), field_of: None, part_wait: None, set_next: None, setting: false, insert: None, drafter: None, focus_field: false, field_live: false, held: None, anchor: None, anchor_wait: false, editor_rect: [0.0; 4], draft_marks: Vec::new(), draft_boxes: HashMap::new(), draft_boxes_for: (0, 0, 0, 0), said_on: HashMap::new(), theme_before: None, page_life: crate::page::Life::default(), page_has_keys: false,
            view_btn_rect: [0.0; 4], toolbar_hover: None,
        };
        s.draft_marks = draft::marks(&s);
        s
    }

    /// Started on a site's folder: waits for `rubric/pages` after the server connects, then opens
    /// the site's newest post or its home page.
    pub fn open_folder(site: PathBuf) -> State {
        let mut s = State::open(site, String::new());
        s.uri.clear();
        s.waiting_for_page = true;
        s
    }
}

/// Loads `path` and `text` as the open document, resetting every piece of document state as
/// `State::open` makes it (text and undo, version at 1, pick, menus, drafts and marks, pending
/// requests) while keeping window state (server, page, look, split, sizes). Opens it on the
/// server when connected.
pub fn open_document(s: &mut State, path: PathBuf, text: String) {
    crate::look::close_panels(s);
    let mut edit = TextEdit::new(text.clone());
    edit.focused = s.split > 0.0 && !s.drawer.open;
    edit.set_caret(0);
    s.path = path;
    s.uri = file_uri(&s.path);
    s.disk = DiskStamp::of(&s.path);
    s.disk_conflict = false;
    s.edit = edit;
    s.version = 1;
    s.saved = text;
    s.last_range = (0, 0);
    s.cursor_line = None;
    s.page_path = None;
    s.ghost = None;
    s.asked = None;
    s.view = None;
    s.choice = None;
    s.drafts.clear();
    s.flash = None;
    s.pending.clear();
    s.looked.set(None);
    s.looked_sent = None;
    s.looked_server_ms = 0.0;
    s.sent_at.clear();
    s.field = TextEdit::new("");
    s.field_of = None;
    s.field_live = false;
    s.held = None;
    s.anchor = None;
    s.anchor_wait = false;
    s.part_wait = None;
    s.set_next = None;
    s.setting = false;
    s.insert = None;
    s.said_on.clear();
    s.theme_before = None;
    s.save_error = None;
    s.save_arm = false;
    s.save_due = None;
    s.waiting_for_page = false;
    s.spans = spans(s);
    s.draft_marks = draft::marks(s);
    s.draft_boxes.clear();
    s.draft_boxes_for = (0, 0, 0, 0);
    s.title = title_of(&s.path, &s.edit.text);
    if let Some(t) = &s.ticker {
        t.rest();
    }
    if let Some(c) = &s.client {
        c.notify("textDocument/didOpen", json!({
            "textDocument": { "uri": s.uri, "languageId": "markdown", "version": s.version, "text": s.edit.text },
        }));
        c.notify("rubric/cursor", json!({ "uri": s.uri, "line": 0 }));
        s.cursor_line = Some(0);
    }
    ask(s);
}

/// Switches from the open post to `path`: saves any unsaved changes first (stopping on failure so
/// nothing is dropped), reads the new file before closing the old one (flashing `Post not opened`
/// on a read error while leaving the current post open), then sends `didClose` and opens the new
/// document with `open_document`.
pub fn switch_document(s: &mut State, path: PathBuf, tx: &mut Tx) -> bool {
    if !s.waiting_for_page && !s.uri.is_empty() && unescaped(&file_uri(&path)) == unescaped(&s.uri) {
        return true;
    }
    if !s.waiting_for_page && (!clean(s) || s.save_error.is_some() || s.disk_conflict) && !save(s) {
        return false;
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("open {}: {e}", path.display());
            draft::flash(s, "Post not opened", draft::Tone::Warn, open_error_sentence(&e));
            return false;
        }
    };
    if let Some(c) = &s.client && !s.waiting_for_page && !s.uri.is_empty() {
        c.notify("textDocument/didClose", json!({ "textDocument": { "uri": s.uri } }));
    }
    open_document(s, path, text);
    tx.scroll_to_y("writing", 0.0);
    sync_draft_boxes(s, tx);
    true
}

/// Replaces the writing with the file's text on disk after `Post changed on disk`.
pub fn reload_from_disk(s: &mut State) -> bool {
    let text = match std::fs::read_to_string(&s.path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("reload {}: {e}", s.path.display());
            draft::flash(s, "Post not opened", draft::Tone::Warn, open_error_sentence(&e));
            return false;
        }
    };
    crate::look::close_panels(s);
    let mut edit = TextEdit::new(text.clone());
    edit.focused = s.split > 0.0 && !s.drawer.open;
    edit.set_caret(0);
    s.edit = edit;
    s.saved = text;
    s.disk = DiskStamp::of(&s.path);
    s.disk_conflict = false;
    s.save_error = None;
    s.save_arm = false;
    s.save_due = None;
    s.version += 1;
    s.last_range = (0, 0);
    s.ghost = None;
    s.asked = None;
    s.spans = spans(s);
    s.draft_marks = draft::marks(s);
    s.draft_boxes.clear();
    s.draft_boxes_for = (0, 0, 0, 0);
    s.title = title_of(&s.path, &s.edit.text);
    if let Some(c) = &s.client && !s.waiting_for_page {
        c.notify("textDocument/didChange", json!({
            "textDocument": { "uri": s.uri, "version": s.version },
            "contentChanges": [{ "text": s.edit.text }],
        }));
        c.notify("rubric/cursor", json!({ "uri": s.uri, "line": 0 }));
        s.cursor_line = Some(0);
    }
    ask(s);
    true
}

/// Short writer-facing sentence for a file read error.
pub fn open_error_sentence(e: &std::io::Error) -> String {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::NotFound => "The post is no longer on disk.".into(),
        ErrorKind::PermissionDenied => "The file could not be read.".into(),
        _ => "The file could not be read.".into(),
    }
}

/// Once a post switch finishes drawing its first frame: how long Return/click to drawn took.
pub fn switch_drawn(s: &State) -> Option<String> {
    let begun = s.switched.take()?;
    Some(format!("post drawn {:.1} ms: {}", begun.elapsed().as_secs_f64() * 1000.0, s.title))
}

/// The Markdown's colors from the app's theme.
pub fn marks(p: &crate::theme::Palette) -> markdown::Theme {
    markdown::Theme { dim: p.ink3, accent: p.accent, warn: p.fail }
}

/// The Markdown styles for the text as it is, the `new:` lines by their drafts.
pub fn spans(s: &State) -> Vec<Span> {
    let tones: Vec<(u32, draft::Tone)> = s.drafts.iter().map(|(l, st)| (*l, st.tone())).collect();
    markdown::spans(&s.edit.text, &marks(&s.look.palette), &tones)
}

/// The app drawn in another look: the writing's colors follow.
pub fn set_look(s: &mut State, look: crate::theme::Look) {
    s.look = look;
    s.spans = spans(s);
}

/// The theme drawn changed (the list of themes moved): the writing's colors follow.
pub fn show_theme(s: &mut State, name: &str) -> bool {
    let shown = s.look.show(name);
    s.spans = spans(s);
    shown
}

/// The post's title: front matter `title:` (plain or quoted), else the first ATX heading outside
/// front matter and code fences, else its file's name.
pub fn title_of(path: &std::path::Path, text: &str) -> String {
    let mut lines = text.split('\n').peekable();
    if lines.peek().is_some_and(|l| l.trim_end() == "---") {
        lines.next();
        let mut fm = Vec::new();
        let mut closed = false;
        for l in lines.by_ref() {
            let trimmed = l.trim_end();
            if trimmed == "---" || trimmed == "..." {
                closed = true;
                break;
            }
            fm.push(trimmed);
        }
        if closed {
            for l in fm {
                if let Some(rest) = l.strip_prefix("title:") {
                    let val = unquote_yaml(rest.trim());
                    if !val.is_empty() {
                        return val;
                    }
                }
            }
        }
    }
    let mut fence = false;
    for l in lines {
        let t = l.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
            continue;
        }
        if fence {
            continue;
        }
        let n = t.bytes().take_while(|&b| b == b'#').count();
        if (1..=6).contains(&n) && t[n..].starts_with([' ', '\t']) {
            let words = t[n..].trim().trim_end_matches('#').trim();
            if !words.is_empty() {
                return words.to_string();
            }
        }
    }
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn unquote_yaml(v: &str) -> String {
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        let inner = &v[1..v.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some('"') => out.push('"'),
                    Some('\\') => out.push('\\'),
                    Some('n') => out.push('\n'),
                    Some('t') => out.push('\t'),
                    Some(other) => {
                        out.push('\\');
                        out.push(other);
                    }
                    None => out.push('\\'),
                }
            } else {
                out.push(c);
            }
        }
        out.trim().to_string()
    } else if v.len() >= 2 && v.starts_with('\'') && v.ends_with('\'') {
        v[1..v.len() - 1].replace("''", "'").trim().to_string()
    } else {
        v.trim().to_string()
    }
}

/// Whether the text is as last written.
pub fn clean(s: &State) -> bool {
    s.edit.text == s.saved
}

/// The saved state shown in the top row.
pub fn save_state(s: &State) -> SaveState {
    if s.save_error.is_some() || s.disk_conflict {
        SaveState::Failed
    } else if clean(s) {
        SaveState::Saved
    } else {
        SaveState::Edited
    }
}

/// Arms the autosave timer on the window's clock whenever a change queued one.
pub fn schedule_save(s: &mut State, tx: &mut Tx) {
    if s.save_arm {
        s.save_arm = false;
        s.save_due = Some(tx.clock() + AUTOSAVE_SECS);
        tx.wake_after(std::time::Duration::from_secs_f64(AUTOSAVE_SECS));
    }
}

/// App-level poll hook (`AppSpec::poll`): drives Insert part…'s search pause and autosave.
/// Does nothing and schedules no wakes while neither is due.
pub fn poll(s: &mut State, clock: f64, tx: &mut Tx) -> bool {
    let mut changed = crate::insert::poll(s, clock, tx);
    if s.save_arm {
        s.save_arm = false;
        s.save_due = Some(clock + AUTOSAVE_SECS);
        tx.wake_after(std::time::Duration::from_secs_f64(AUTOSAVE_SECS));
    } else if let Some(due) = s.save_due {
        if clock < due {
            tx.wake_after(std::time::Duration::from_secs_f64(due - clock));
        } else {
            s.save_due = None;
            if !s.waiting_for_page && (!clean(s) || s.save_error.is_some()) {
                save(s);
                changed = true;
            }
        }
    }
    changed
}

/// The text changed: a new version, new styles, and the whole text to the server.
pub fn changed(s: &mut State) {
    // Typing is not the panels': they go (a choice that changed the text closed them already).
    crate::look::close_panels(s);
    s.part_wait = None;
    sent(s);
    moved(s);
    ask(s);
}

/// A panel rewrote its line (a setting changed): as `changed`, with the panels left open.
pub fn rewritten(s: &mut State) {
    sent(s);
    s.last_range = s.edit.range();
    ask(s);
}

fn sent(s: &mut State) {
    s.version += 1;
    s.ghost = None;
    s.spans = spans(s);
    s.draft_marks = draft::marks(s);
    s.title = title_of(&s.path, &s.edit.text);
    if !s.waiting_for_page {
        if clean(s) && s.save_error.is_none() {
            s.save_arm = false;
            s.save_due = None;
        } else {
            s.save_arm = true;
        }
    }
    if let Some(c) = &s.client && !s.waiting_for_page {
        c.notify("textDocument/didChange", json!({
            "textDocument": { "uri": s.uri, "version": s.version },
            "contentChanges": [{ "text": s.edit.text }],
        }));
    }
}

/// `"editor"` moved, scrolled or resized: records its rect and refreshes draft line boxes only
/// when the text, draft set, or editor dimensions changed (never during plain scrolling).
pub fn editor_laid_out(s: &mut State, rect: [f32; 4], tx: &mut Tx) {
    s.editor_rect = rect;
    sync_draft_boxes(s, tx);
}

/// Refreshes `s.draft_boxes` via `Tx::text_line` when the text, draft lines, or editor size
/// changed since the last query. Does nothing while idle or scrolling.
pub fn sync_draft_boxes(s: &mut State, tx: &mut Tx) {
    let sig = marks_sig(&s.draft_marks);
    let stamp = (s.version, (s.editor_rect[2] * 10.0).round() as i32, (s.editor_rect[3] * 10.0).round() as i32, sig);
    if s.draft_marks.is_empty() {
        s.draft_boxes.clear();
        s.draft_boxes_for = stamp;
        return;
    }
    if s.editor_rect[2] <= 0.0 || s.draft_boxes_for == stamp {
        return;
    }
    s.draft_boxes_for = stamp;
    let keep: Vec<u32> = s.draft_marks.iter().map(|m| m.line).collect();
    s.draft_boxes.retain(|l, _| keep.contains(l));
    for m in s.draft_marks.clone() {
        let text_w = draft::writing_width(&s.edit.text[m.start..m.end]);
        let (line_no, m_start, m_end) = (m.line, m.start, m.end);
        tx.text_line("editor", m_start, move |s: &mut State, box_, _| {
            if s.draft_boxes_for != stamp {
                return;
            }
            if let Some(box_) = box_ {
                let wrapped = box_.next.is_some_and(|next| next <= m_end);
                s.draft_boxes.insert(line_no, DraftBox {
                    dy: box_.rect[1] - s.editor_rect[1],
                    h: box_.rect[3],
                    wrapped,
                    text_w,
                    start: m_start,
                    end: m_end,
                });
            }
        });
    }
}

fn marks_sig(marks: &[draft::Mark]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for m in marks {
        m.line.hash(&mut h);
        m.start.hash(&mut h);
        m.end.hash(&mut h);
    }
    h.finish()
}

/// After a message from the server: a field a panel opened with takes the keys, any queued
/// autosave is armed on the window's clock, and any new or removed draft line updates its box.
pub fn follow_up(s: &mut State, tx: &mut Tx) {
    if std::mem::take(&mut s.focus_field) {
        crate::look::give_field(s, tx);
    }
    schedule_save(s, tx);
    sync_draft_boxes(s, tx);
}

/// Run after each drawn frame (`App::on_frame_drawn`) and after each change: a caret that
/// moved to another line tells the page, never twice for the same line.
pub fn moved(s: &mut State) -> bool {
    let range = s.edit.range();
    if range == s.last_range {
        return false;
    }
    s.last_range = range;
    // The caret went elsewhere: the panels were for where it was.
    crate::look::close_panels(s);
    let line = position::line_char(&s.edit.text, s.edit.focus).0;
    if s.cursor_line != Some(line)
        && let Some(c) = &s.client
    {
        c.notify("rubric/cursor", json!({ "uri": s.uri, "line": line }));
        s.cursor_line = Some(line);
    }
    // The caret left the pick's line, or the end of it.
    if s.ghost.as_ref().is_some_and(|g| ghost::wants(&s.edit.text, s.edit.focus) != Some(g.line)) {
        s.ghost = None;
    }
    ask(s);
    true
}

/// On a `:::` line with the caret at its end, ask the server for its pick; not again for the
/// same version and line while that question is unanswered.
fn ask(s: &mut State) {
    let Some(line) = ghost::wants(&s.edit.text, s.edit.focus) else { return };
    if s.asked.is_some_and(|(_, v, l)| v == s.version && l == line) {
        return;
    }
    let Some(c) = &s.client else { return };
    let (l, character) = position::line_char(&s.edit.text, s.edit.focus);
    let id = c.request("textDocument/inlineCompletion", json!({
        "textDocument": { "uri": s.uri },
        "position": { "line": l, "character": character },
        "context": { "triggerKind": 2 },
    }));
    s.asked = Some((id, s.version, line));
}

/// The ghost to draw: set, and the caret still at the end of its line.
pub fn showing(s: &State) -> Option<&ghost::Ghost> {
    s.ghost.as_ref().filter(|g| g.version == s.version && ghost::wants(&s.edit.text, s.edit.focus) == Some(g.line))
}

/// The server answered initialize: open the document as it is now (or ask `rubric/pages` when
/// started on a site folder), and say where the caret is.
pub fn connected(s: &mut State, client: crate::lsp::Client) {
    if s.waiting_for_page {
        let id = client.request("rubric/pages", json!({}));
        s.pages_req = Some(id);
        s.client = Some(client);
        return;
    }
    client.notify("textDocument/didOpen", json!({
        "textDocument": { "uri": s.uri, "languageId": "markdown", "version": s.version, "text": s.edit.text },
    }));
    let line = position::line_char(&s.edit.text, s.edit.focus).0;
    client.notify("rubric/cursor", json!({ "uri": s.uri, "line": line }));
    s.cursor_line = Some(line);
    s.last_range = s.edit.range();
    s.client = Some(client);
    ask(s);
}

/// What the server sent that the slice acts on. Returns whether anything the view reads may
/// have changed, so `AppHandle::update_if` skips an idle redraw for dropped messages or the
/// first half of a paired part+draft answer.
pub fn incoming(s: &mut State, m: crate::lsp::Incoming) -> bool {
    use crate::lsp::Incoming;
    match m {
        // Only the answer to the last question, for the version and line it was asked about.
        Incoming::Response { id, result } => {
            if s.pages_req == Some(id) {
                s.pages_req = None;
                match result {
                    Ok(v) => {
                        if let Some(pages) = SitePages::parse(&v) {
                            let initial = pick_initial(&pages.pages).and_then(|e| uri_path(&e.uri));
                            s.site_pages = Some(pages);
                            if s.waiting_for_page {
                                if let Some(path) = initial {
                                    match std::fs::read_to_string(&path) {
                                        Ok(text) => open_document(s, path, text),
                                        Err(e) => {
                                            eprintln!("open {}: {e}", path.display());
                                            s.waiting_for_page = false;
                                        }
                                    }
                                } else {
                                    s.waiting_for_page = false;
                                }
                            }
                            crate::drawer::sync_selection(s);
                            return true;
                        }
                    }
                    Err(e) => {
                        eprintln!("rubric/pages failed: {e}");
                        s.waiting_for_page = false;
                    }
                }
                return false;
            }
            if let Some(sent) = s.sent_at.remove(&id)
                && s.looked.get().is_some()
            {
                let start = s.looked_sent.unwrap_or(sent);
                s.looked_server_ms = start.elapsed().as_secs_f64() * 1000.0;
            }
            if let Some(about) = s.pending.remove(&id) {
                let pair = matches!(about.what, draft::What::Part(_) | draft::What::PartLook(_));
                draft::answered(s, id, about, result);
                return !(pair && s.part_wait.is_some() && s.flash.is_none());
            }
            let Some((asked, version, line)) = s.asked else { return false };
            if id != asked {
                return false;
            }
            // Answered: a caret that leaves the line and comes back asks again.
            s.asked = None;
            if version != s.version || ghost::wants(&s.edit.text, s.edit.focus) != Some(line) {
                return false;
            }
            s.ghost = result.ok().and_then(|r| ghost::parse(&r, line, version));
            true
        }
        Incoming::Notification { method, params } if method == "rubric/serving" => {
            if let Some(url) = params.get("url").and_then(|u| u.as_str()) {
                serving(s, url.to_string());
            } else if let Some(p) = params.get("problem").and_then(|p| p.as_str()) {
                eprintln!("page: {p}");
            }
            true
        }
        Incoming::Notification { method, params } if method == "rubric/page" => {
            let for_me = params.get("uri").and_then(|u| u.as_str()).is_none_or(|u| unescaped(u) == unescaped(&s.uri));
            if for_me && let Some(url) = params.get("url").and_then(|u| u.as_str()) {
                let next = Some(url.to_string());
                if s.page_path != next {
                    s.page_path = next;
                    return true;
                }
            }
            false
        }
        Incoming::Notification { method, params } if method == "textDocument/publishDiagnostics" => {
            draft::diagnostics(s, &params);
            true
        }
        Incoming::Notification { method, params } if method == "rubric/drafted" => {
            draft::drafted(s, &params);
            true
        }
        _ => false,
    }
}

/// The page's address: loaded once, whenever both it and the web view are there.
pub fn serving(s: &mut State, url: String) {
    if s.page_url.as_deref() == Some(url.as_str()) {
        return;
    }
    if let Some(page) = &s.page {
        page.send(crate::page::PageCmd::Load(url.clone()));
    }
    s.page_url = Some(url);
}

/// Tab asked for a line's menu: the time to its drawing starts now.
pub fn start_look(s: &mut State) {
    s.looked.set(Some(std::time::Instant::now()));
    s.looked_sent = None;
    s.looked_server_ms = 0.0;
}

/// Once the menu Tab asked for is drawn: how long it took, which menu it is and how long the
/// server took of it ("menu drawn 52.5 ms: part, server 50.8 ms"), said once.
pub fn menu_drawn(s: &State) -> Option<String> {
    let id = s.panels.first()?.id.clone();
    let asked = s.looked.take()?;
    Some(format!("menu drawn {:.1} ms: {id}, server {:.1} ms", asked.elapsed().as_secs_f64() * 1000.0, s.looked_server_ms))
}

/// The window is going: unsaved writing saves first (a failure is printed and closing still
/// completes), then the document and server close, then the web view.
pub fn shut(s: &mut State) {
    if s.shut_done {
        return;
    }
    s.shut_done = true;
    if !s.waiting_for_page && (!clean(s) || s.save_error.is_some()) {
        save(s);
    }
    if let Some(c) = s.client.take() {
        if !s.waiting_for_page && !s.uri.is_empty() {
            c.notify("textDocument/didClose", json!({ "textDocument": { "uri": s.uri } }));
        }
        c.stop();
    }
    if let Some(page) = s.page.take() {
        page.close();
    }
}

/// Tab: takes a pick showing whose pin acts, or the offer of a new part, which makes the line
/// a `new:` line; on a `new:` line it asks for the line's menu, on a part's line for the
/// part's, on a line of words for theirs, and on an empty line it offers to put a part there.
/// Always consumed.
pub fn tab(s: &mut State, tx: &mut Tx) {
    if let Some(g) = showing(s).filter(|g| g.pick.pin.is_some()).cloned() {
        let pin = g.pick.pin.clone().unwrap();
        // Words after a part's ":" that set nothing: its Change….
        if pin.change {
            crate::part::tab(s, true, tx);
            return;
        }
        if pin.acts || pin.build {
            ghost::accept(&mut s.edit, &g);
            changed(s);
            if pin.acts {
                return;
            }
        }
    }
    open_line_menu(s, false, tx);
}

/// Opens the caret's line's menu, past any pick: a `new:` line's draft menu, a part's or words'
/// menu, an empty line's insert menu, or (when `writing` is true, from a right-click) Cut, Copy,
/// Paste on a line of writing.
pub fn open_line_menu(s: &mut State, writing: bool, tx: &mut Tx) -> bool {
    draft::tab(s) || crate::part::tab(s, false, tx) || crate::insert::tab(s) || (writing && crate::insert::writing_menu(s))
}

/// Right-click in the writing at UTF-8 byte `byte`: closes any open panels, places the caret
/// unless `byte` lies inside the selection, and opens that line's menu past any pick, anchored
/// from the pressed line's box.
pub fn secondary_press(s: &mut State, byte: usize, tx: &mut Tx) {
    let was_field = s.field_live;
    crate::look::close_panels(s);
    if was_field {
        tx.focus("editor", false);
    }
    let (a, b) = s.edit.range();
    if !(a < b && byte >= a && byte <= b) {
        s.edit.set_caret(byte);
    }
    moved(s);
    if open_line_menu(s, true, tx) {
        s.anchor_wait = true;
        tx.text_line("editor", s.edit.focus, |s: &mut State, line, _| anchor_from_line(s, line));
    }
}

/// Locks a panel's anchor from a `TextLine` box so it hangs from that line on its first frame.
pub fn anchor_from_line(s: &mut State, line: Option<rune::TextLine>) {
    s.anchor_wait = false;
    let Some(line) = line else { return };
    let width = s.editor_rect[2];
    if width <= 0.0 || (s.panels.is_empty() && s.pending.is_empty()) {
        return;
    }
    let (at, start) = caret_line_start(s);
    s.anchor = Some(Anchor { line: at, start, width, dy: line.rect[1] - s.editor_rect[1], h: line.rect[3] });
}

/// The kept anchor if it still holds for the caret's line and the field's width.
pub fn keep_anchor(s: &State) -> Option<Anchor> {
    let (at, start) = caret_line_start(s);
    s.anchor.filter(|a| a.holds(at, start, s.editor_rect[2]))
}

/// Compares the file on disk against what the app last read or wrote: one `stat(2)` first, and
/// reads the file only when size, mtime, ctime, or inode differs.
fn changed_on_disk(path: &std::path::Path, expected: &Option<DiskStamp>, saved: &str) -> bool {
    let Some(expected) = expected else { return false };
    let Ok(meta) = std::fs::metadata(path) else { return false };
    let current = DiskStamp::from_meta(&meta);
    if current == *expected {
        return false;
    }
    match std::fs::read_to_string(path) {
        Ok(text) => text != saved,
        Err(_) => false,
    }
}

/// Writes the file whole; checks first whether another program changed it on disk (leaving the
/// file untouched and flagging `disk_conflict` if so), clears any failed-save state on success,
/// or records a short writer-facing sentence and prints the error on failure. Returns whether the
/// file is saved.
pub fn save(s: &mut State) -> bool {
    if s.waiting_for_page {
        return true;
    }
    s.save_arm = false;
    s.save_due = None;
    if changed_on_disk(&s.path, &s.disk, &s.saved) {
        s.disk_conflict = true;
        s.save_error = None;
        return false;
    }
    match markdown::save(&s.path, &s.edit.text) {
        Ok(()) => {
            s.saved = s.edit.text.clone();
            s.disk = DiskStamp::of(&s.path);
            s.disk_conflict = false;
            s.save_error = None;
            true
        }
        Err(e) => {
            eprintln!("save failed: {e}");
            s.save_error = Some(save_error_sentence(&e));
            false
        }
    }
}

/// Short writer-facing sentence for an I/O save error.
pub fn save_error_sentence(e: &std::io::Error) -> String {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem => "The site folder could not be written.".into(),
        ErrorKind::NotFound => "The post's folder is gone.".into(),
        ErrorKind::StorageFull => "The disk is full.".into(),
        _ => {
            let raw = e.to_string();
            let clean = raw.split(" (os error ").next().unwrap_or(&raw).trim();
            if clean.is_empty() {
                "The file could not be written.".into()
            } else {
                let mut c = clean.chars();
                let mut out: String = c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default();
                if !out.ends_with('.') {
                    out.push('.');
                }
                out
            }
        }
    }
}

/// Converts a `file://` URI back to a filesystem path.
pub fn uri_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let bytes = unescaped(rest);
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        Some(PathBuf::from(std::ffi::OsString::from_vec(bytes)))
    }
    #[cfg(not(unix))]
    {
        String::from_utf8(bytes).ok().map(PathBuf::from)
    }
}

/// `file://` and the path, with the bytes a URI cannot hold escaped.
pub fn file_uri(path: &std::path::Path) -> String {
    let mut out = String::from("file://");
    for b in path.to_string_lossy().bytes() {
        if b.is_ascii_alphanumeric() || b"/-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// A URI with its `%XX` escapes turned back into bytes, to compare two spellings of one path.
pub fn unescaped(uri: &str) -> Vec<u8> {
    let b = uri.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = (b[i] == b'%').then(|| uri.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok())).flatten();
        match hex {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(b[i]);
                i += 1;
            }
        }
    }
    out
}

/// Computes the layout target rect `[x, y, w, h]` of `"page"` in window points (matching `lib.rs`).
pub fn page_target_rect(s: &State) -> [f32; 4] {
    let room = (s.width - crate::DIVIDER).max(0.0);
    let left = (room * s.split).round();
    let cover_page_only = left == 0.0 && s.left_cover > 0.0;
    let cover_w = if cover_page_only {
        s.left_cover.min(s.width)
    } else {
        (s.left_cover - left - crate::DIVIDER).max(0.0)
    };
    let (x, w) = if cover_page_only {
        (cover_w, (s.width - cover_w).max(0.0))
    } else {
        (left + crate::DIVIDER + cover_w, (room - left - cover_w).max(0.0))
    };
    let wide_status = s.split <= 0.0 && crate::draft::wide_status(s);
    let h = (s.height - crate::TITLE - if wide_status { crate::STATUS } else { 0.0 }).max(0.0);
    [x, crate::TITLE, w, h]
}

/// Starts a view-switch slide synchronously when `s.split` changes from `old_split` to `s.split`:
/// the web view slides at the larger of its old and new sizes (resized once at the start when
/// growing or entering from off-window, or resized once at rest when shrinking; zero resizes when
/// leaving or unchanged). Returns any initial command sent to the page.
pub fn begin_view_slide(s: &mut State, old_split: f32, scale: f32) -> Option<crate::page::PageCmd> {
    use crate::page::PageCmd;
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let room = (s.width - crate::DIVIDER).max(0.0);
    let old_left = (room * old_split).round();
    let new_left = (room * s.split).round();
    let rect = page_target_rect(s);
    let px = |v: f32| (v * scale).round();
    let target_y = px(rect[1]) as i32;
    let prev = s.bounds.get();
    if s.split >= 1.0 || rect[2] < 1.0 || rect[3] < 1.0 {
        let (w, h) = prev.map_or((1, 1), |(_, _, w, h)| (w.max(1), h.max(1)));
        let target_x = px(s.width.max(rect[0])) as i32;
        s.view_slide.set(Some(ViewSlide {
            target_x,
            target_y,
            slide_size: (w, h),
            final_size: (w, h),
            leaving: true,
            curve: SlideCurve::Spring,
            last_pos: prev.map(|(x, y, _, _)| (x, y)),
            under_left: None,
            instant_under: old_left <= 0.0,
            hold_drawer: false,
            hold_cover: 0.0,
        }));
        return None;
    }
    let new_w = px(rect[2]) as u32;
    let new_h = px(rect[3]) as u32;
    let target_x = px(rect[0]) as i32;
    let win_w = px(s.width) as i32;
    let was_hidden = prev.is_none_or(|(old_x, _, _, _)| old_x >= win_w);
    let start_x = if was_hidden { win_w } else { prev.unwrap().0 };
    let (slide_w, slide_h) = if was_hidden {
        (new_w, new_h)
    } else {
        let (_, _, old_w, old_h) = prev.unwrap();
        (old_w.max(new_w), old_h.max(new_h))
    };
    let cmd = match prev {
        Some((old_x, old_y, old_w, old_h)) if old_w == slide_w && old_h == slide_h => {
            if old_x == start_x && old_y == target_y {
                None
            } else {
                Some(PageCmd::Move { x: start_x, y: target_y })
            }
        }
        _ => Some(PageCmd::Bounds { x: start_x, y: target_y, w: slide_w, h: slide_h }),
    };
    let under_left = (new_left <= 0.0 && old_left > 0.0).then_some(old_left);
    let instant_under = old_left <= 0.0 || new_left <= 0.0;
    s.bounds.set(Some((start_x, target_y, slide_w, slide_h)));
    s.view_slide.set(Some(ViewSlide {
        target_x,
        target_y,
        slide_size: (slide_w, slide_h),
        final_size: (new_w, new_h),
        leaving: false,
        curve: SlideCurve::Spring,
        last_pos: Some((start_x, target_y)),
        under_left,
        instant_under,
        hold_drawer: false,
        hold_cover: 0.0,
    }));
    if let Some(cmd) = &cmd && let Some(page) = &s.page {
        page.send(cmd.clone());
    }
    cmd
}

/// Starts a 140 ms drawer-curve slide when opening or closing the drawer or View popover shifts
/// the page (e.g. in page-only view or when the writing pane is narrower than 300 points).
/// Does nothing when the page's target rect did not change.
pub fn begin_cover_slide(s: &mut State, scale: f32, had_drawer: bool, prev_cover: f32) -> Option<crate::page::PageCmd> {
    use crate::page::PageCmd;
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let rect = page_target_rect(s);
    if s.split >= 1.0 || rect[2] < 1.0 || rect[3] < 1.0 {
        return None;
    }
    let Some((old_x, old_y, old_w, old_h)) = s.bounds.get() else {
        return None;
    };
    let px = |v: f32| (v * scale).round();
    let target_x = px(rect[0]) as i32;
    let target_y = px(rect[1]) as i32;
    let new_w = px(rect[2]) as u32;
    let new_h = px(rect[3]) as u32;
    if old_x == target_x && old_y == target_y && old_w == new_w && old_h == new_h {
        return None;
    }
    let opening = s.left_cover > prev_cover;
    let slide_w = old_w.max(new_w);
    let slide_h = old_h.max(new_h);
    let cmd = if slide_w != old_w || slide_h != old_h {
        Some(PageCmd::Bounds { x: old_x, y: target_y, w: slide_w, h: slide_h })
    } else if old_y != target_y {
        Some(PageCmd::Move { x: old_x, y: target_y })
    } else {
        None
    };
    s.bounds.set(Some((old_x, target_y, slide_w, slide_h)));
    s.view_slide.set(Some(ViewSlide {
        target_x,
        target_y,
        slide_size: (slide_w, slide_h),
        final_size: (new_w, new_h),
        leaving: false,
        curve: if opening { SlideCurve::DrawerOpen } else { SlideCurve::DrawerClose },
        last_pos: Some((old_x, target_y)),
        under_left: None,
        instant_under: true,
        hold_drawer: !opening && had_drawer && s.split <= 0.0,
        hold_cover: if !opening && prev_cover > 0.0 { prev_cover } else { 0.0 },
    }));
    if let Some(cmd) = &cmd && let Some(page) = &s.page {
        page.send(cmd.clone());
    }
    cmd
}

/// The page pane moved or resized: `rect` in points, `scale` pixels per point.
///
/// While a slide is active (`s.view_slide` is `Some`), `begin_view_slide` / `begin_cover_slide`
/// and `page_presented` own the web view's bounds so `on_layout` does nothing. Outside a slide
/// (divider drag, window resize, first layout), it updates bounds in one step. Returns any
/// command sent to the page (for tests).
pub fn page_laid_out(s: &mut State, rect: [f32; 4], scale: f32) -> Option<crate::page::PageCmd> {
    use crate::page::PageCmd;
    if s.view_slide.get().is_some() {
        return None;
    }
    let px = |v: f32| (v * scale).round();

    let b = if s.split >= 1.0 || rect[2] < 1.0 || rect[3] < 1.0 {
        let (w, h) = s.bounds.get().map_or((1, 1), |(_, _, w, h)| (w.max(1), h.max(1)));
        let off_x = px(s.width.max(rect[0])) as i32 + 64;
        let off_y = px(s.height.max(rect[1] + rect[3])) as i32 + 64;
        (off_x, off_y, w, h)
    } else {
        (px(rect[0]) as i32, px(rect[1]) as i32, px(rect[2]) as u32, px(rect[3]) as u32)
    };
    let prev = s.bounds.get();
    if prev == Some(b) {
        return None;
    }
    s.bounds.set(Some(b));
    let cmd = match prev {
        Some((_, _, old_w, old_h)) if old_w == b.2 && old_h == b.3 => PageCmd::Move { x: b.0, y: b.1 },
        _ => PageCmd::Bounds { x: b.0, y: b.1, w: b.2, h: b.3 },
    };
    if let Some(page) = &s.page {
        page.send(cmd.clone());
    }
    Some(cmd)
}

/// Called from `App::on_frame_drawn` with `rt.presented("page")` on every frame while a slide is
/// active: sends position-only `PageCmd::Move` updates at `slide_size` until `cur_x` reaches rest,
/// then sends the one-time `PageCmd::Bounds` if the page shrank (`final_size != slide_size`) and
/// clears `view_slide`.
pub fn page_presented(s: &State, rect: [f32; 4], scale: f32) -> Option<crate::page::PageCmd> {
    use crate::page::PageCmd;
    let mut slide = s.view_slide.get()?;
    let px = |v: f32| (v * scale).round();
    let cur_x = px(rect[0]) as i32;
    let cur_y = px(rect[1]) as i32;
    let settled = if slide.leaving {
        cur_x >= slide.target_x && cur_y == slide.target_y
    } else {
        cur_x == slide.target_x && cur_y == slide.target_y
    };
    if settled {
        let (final_x, final_y) = if slide.leaving {
            let off_x = px(s.width.max(rect[0])) as i32 + 64;
            let off_y = px(s.height.max(rect[1] + rect[3])) as i32 + 64;
            (off_x, off_y)
        } else {
            (slide.target_x, slide.target_y)
        };
        let (fw, fh) = slide.final_size;
        let resized = !slide.leaving && slide.slide_size != slide.final_size;
        s.view_slide.set(None);
        s.bounds.set(Some((final_x, final_y, fw, fh)));
        let cmd = if resized {
            Some(PageCmd::Bounds { x: final_x, y: final_y, w: fw, h: fh })
        } else if slide.last_pos != Some((final_x, final_y)) {
            Some(PageCmd::Move { x: final_x, y: final_y })
        } else {
            None
        };
        if let Some(cmd) = &cmd && let Some(page) = &s.page {
            page.send(cmd.clone());
        }
        return cmd;
    }
    if slide.last_pos == Some((cur_x, cur_y)) {
        return None;
    }
    slide.last_pos = Some((cur_x, cur_y));
    s.view_slide.set(Some(slide));
    s.bounds.set(Some((cur_x, cur_y, slide.slide_size.0, slide.slide_size.1)));
    let cmd = PageCmd::Move { x: cur_x, y: cur_y };
    if let Some(page) = &s.page {
        page.send(cmd.clone());
    }
    Some(cmd)
}

/// The web view exists: it takes the last bounds the pane had, and the page's address if the
/// server gave it first.
pub fn page_attached(s: &mut State, page: crate::page::Page) {
    if let Some(b) = s.bounds.get() {
        page.send(crate::page::PageCmd::Bounds { x: b.0, y: b.1, w: b.2, h: b.3 });
    }
    if let Some(url) = &s.page_url {
        page.send(crate::page::PageCmd::Load(url.clone()));
    }
    s.page = Some(page);
}

/// A press landed inside the page: it holds keys until the next press in the app, and closes
/// an open drawer or View popover.
pub fn page_pressed(s: &mut State) {
    s.page_has_keys = true;
    if s.drawer.open {
        s.drawer.open = false;
        s.drawer.hovered = None;
    }
    if crate::toolbar::view_open(s) {
        crate::look::close_panels(s);
    }
    crate::toolbar::sync_cover(s);
}

/// Like `page_pressed`, with `tx` so closing an open drawer or View popover over a yielding page
/// slides the page back smoothly over 140 ms.
pub fn page_pressed_tx(s: &mut State, tx: &mut Tx) {
    let prev_cover = s.left_cover;
    let had_drawer = s.drawer.open;
    page_pressed(s);
    if prev_cover > 0.0 && s.left_cover < prev_cover {
        begin_cover_slide(s, tx.scale(), had_drawer, prev_cover);
        if s.view_slide.get().is_some() {
            tx.animated();
        }
    }
}

/// A press landed anywhere in the app: if the page held keys, take them back. Answers what was
/// sent to the page.
pub fn app_pressed(s: &mut State) -> Vec<crate::page::PageCmd> {
    if !s.page_has_keys {
        return Vec::new();
    }
    s.page_has_keys = false;
    send_page(s, vec![crate::page::PageCmd::Keys(false)])
}

/// The page's process ended. The first time, media goes off and the page loads again; a death
/// within `AGAIN_MS` of that leaves it stopped, and the status line offers Reload. Answers what
/// was sent to the page.
pub fn page_died(s: &mut State, reason: &str) -> Vec<crate::page::PageCmd> {
    use crate::page::{Death, PageCmd};
    eprintln!("page: the web view's process ended ({reason})");
    match s.page_life.died(draft::now_ms()) {
        Death::Restart => {
            draft::flash(s, "Page restarted", draft::Tone::Ink, "audio and video off");
            send_page(s, vec![PageCmd::MediaOff, PageCmd::Reload])
        }
        Death::Stop => {
            s.flash = None;
            Vec::new()
        }
    }
}

/// Reload on a stopped page: it loads again, media still off. Answers what was sent.
pub fn reload_page(s: &mut State) -> Vec<crate::page::PageCmd> {
    if !s.page_life.reload(draft::now_ms()) {
        return Vec::new();
    }
    send_page(s, vec![crate::page::PageCmd::Reload])
}

fn send_page(s: &State, cmds: Vec<crate::page::PageCmd>) -> Vec<crate::page::PageCmd> {
    if let Some(page) = &s.page {
        for c in &cmds {
            page.send(c.clone());
        }
    }
    cmds
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn the_title_is_the_front_matter_then_the_first_heading_then_the_file_name() {
        let p = Path::new("/x/walk.md");
        assert_eq!(title_of(p, "---\ntitle: Three days on the coast path\n---\n# Heading"), "Three days on the coast path");
        assert_eq!(title_of(p, "---\ntitle: \"The long walk: part \\\"1\\\"\"\n---\n# Heading"), "The long walk: part \"1\"");
        assert_eq!(title_of(p, "---\ntitle: 'Keeper''s log'\n---\n# Heading"), "Keeper's log");
        assert_eq!(title_of(p, "---\ndate: 2026-06-12\n# not this\n---\n\n```\n# nor this\n```\n## The long walk ##\n# Later"), "The long walk");
        assert_eq!(title_of(p, "---\ntitle: \"\"\n---\n# Fallback heading"), "Fallback heading");
        assert_eq!(title_of(p, "no heading\n#tag"), "walk.md");
    }

    fn reload_key() -> rune::KeyEvent {
        rune::KeyEvent { key: rune::Key::Command('r'), mods: rune::Mods { cmd: true, shift: true, ..rune::Mods::default() } }
    }

    #[test]
    fn a_death_turns_media_off_and_loads_the_page_once_again() {
        use crate::page::PageCmd;
        let mut s = State::open(PathBuf::from("/x/walk.md"), "# Walk\n".into());
        assert_eq!(page_died(&mut s, "Crashed"), [PageCmd::MediaOff, PageCmd::Reload]);
        assert!(s.page_life.media_off && !s.page_life.stopped);
        let said = draft::line(&s).expect("the status line says it");
        assert_eq!((said.tone, said.action), (draft::Tone::Ink, None), "a flash, with nothing to do");
        assert!(!crate::draft::status_key(&mut s, &reload_key()), "nothing to reload while it runs");
    }

    #[test]
    fn a_second_death_soon_after_stops_and_offers_reload() {
        let mut s = State::open(PathBuf::from("/x/walk.md"), "# Walk\n".into());
        page_died(&mut s, "Crashed");
        assert_eq!(page_died(&mut s, "Crashed"), [], "no loop");
        assert!(s.page_life.stopped && s.page_life.media_off);
        let said = draft::line(&s).expect("the status line keeps it");
        assert_eq!(said.tone, draft::Tone::Warn);
        assert!(said.action.as_ref().and_then(|(_, k)| k.as_ref()).is_some_and(|k| k.matches(&reload_key())), "its one action has the key");
        let mut plain_r = reload_key();
        plain_r.mods.shift = false;
        assert!(!crate::draft::status_key(&mut s, &plain_r), "Ctrl+R is not Reload");
        assert!(crate::draft::status_key(&mut s, &reload_key()));
        assert!(!s.page_life.stopped && s.page_life.media_off, "media stays off");
        assert!(draft::line(&s).is_none());
        assert_eq!(reload_page(&mut s), [], "a page that runs is not reloaded");
        assert_eq!(page_died(&mut s, "Crashed"), [], "a death soon after Reload stops again");
    }

    #[test]
    fn reload_asks_the_page_to_load() {
        use crate::page::PageCmd;
        let mut s = State::open(PathBuf::from("/x/walk.md"), "# Walk\n".into());
        page_died(&mut s, "Crashed");
        page_died(&mut s, "Crashed");
        assert_eq!(reload_page(&mut s), [PageCmd::Reload]);
    }

    #[test]
    fn a_death_long_after_the_restart_restarts_again() {
        let mut life = crate::page::Life::default();
        assert_eq!(life.died(1_000), crate::page::Death::Restart);
        assert_eq!(life.died(1_000 + crate::page::AGAIN_MS), crate::page::Death::Restart);
        assert_eq!(life.died(1_000 + crate::page::AGAIN_MS + 9_999), crate::page::Death::Stop);
        assert!(life.media_off);
    }

    #[test]
    fn page_press_gives_page_keys_and_next_app_press_takes_them_back_once() {
        use crate::page::PageCmd;
        let mut s = State::open(PathBuf::from("/x/walk.md"), "# Walk\n".into());
        assert!(!s.page_has_keys);
        assert_eq!(app_pressed(&mut s), []);
        page_pressed(&mut s);
        assert!(s.page_has_keys);
        assert_eq!(app_pressed(&mut s), [PageCmd::Keys(false)]);
        assert!(!s.page_has_keys);
        assert_eq!(app_pressed(&mut s), [], "second app press sends nothing");
    }

    #[test]
    fn uri_path_round_trips_spaces_and_symbols_and_save_error_sentence_is_concise() {
        let p = PathBuf::from("/tmp/Blog (old)/café walk.md");
        assert_eq!(uri_path(&file_uri(&p)), Some(p));
        let perm = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "permission denied");
        assert_eq!(save_error_sentence(&perm), "The site folder could not be written.");
    }
}
