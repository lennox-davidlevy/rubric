//! The app's one piece of state, and what happens when the writing changes.

use std::path::PathBuf;

use rune::{Span, TextEdit, Tx};

use serde_json::json;

use std::collections::HashMap;

use crate::{draft, ghost, markdown, position};

pub struct State {
    /// The Markdown file.
    pub path: PathBuf,
    pub edit: TextEdit,
    /// LSP document version, starts at 1.
    pub version: i32,
    /// The text as last written, to know whether it is dirty.
    pub saved: String,
    /// 0.0 = page only, 1.0 = writing only; starts 0.5.
    pub split: f32,
    /// To notice caret moves after each drawn frame.
    pub last_range: (usize, usize),
    /// file:// of `path`.
    pub uri: String,
    /// The Markdown styles, made again on each change rather than in every view.
    pub spans: Vec<Span>,
    /// The last save's error, printed once.
    pub problem: Option<String>,
    /// The web view, once the window exists (task 2).
    pub page: Option<crate::page::Page>,
    /// The window's width in points, for the divider.
    pub width: f32,
    /// The page pane's last bounds sent, in physical pixels.
    pub bounds: Option<(i32, i32, u32, u32)>,
    /// The language server, once it answered initialize (task 3).
    pub client: Option<crate::lsp::Client>,
    /// Last line sent as rubric/cursor.
    pub cursor_line: Option<u32>,
    /// The page's address from rubric/serving, loaded once.
    pub page_url: Option<String>,
    /// The pick shown after the caret (task 4).
    pub ghost: Option<crate::ghost::Ghost>,
    /// The inlineCompletion asked last: its id, the document version and the line.
    pub asked: Option<(i64, i32, u32)>,
    /// The window's height in points, for the menu's place.
    pub height: f32,
    /// The menu at the caret, and the view and line it is about.
    pub menu: Option<crate::menu::Menu>,
    pub view: Option<(draft::View, draft::Asked)>,
    /// Where the menu's anchor was last laid out, for when the notes field has the focus and
    /// the editor reports no caret.
    pub menu_at: Option<[f32; 4]>,
    /// A reroll's notes, while `menu` is the notes field.
    pub notes: TextEdit,
    /// Each `new:` line's status, from the server's diagnostics: line, status.
    pub drafts: Vec<(u32, draft::Status)>,
    /// Something that just happened, said at the bottom of the writing until the time in ms.
    pub flash: Option<(char, String, draft::Tone, u64)>,
    /// The time the status line counts from, in ms; set by what changes it and by the ticker.
    pub now_ms: u64,
    /// `rubric/draft` requests not answered yet.
    pub pending: HashMap<i64, draft::Asked>,
    /// When Tab asked for a line's menu, until the frame that draws it: the time is printed.
    pub looked: std::cell::Cell<Option<std::time::Instant>>,
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
    /// The line the panels hang from, for when a field has the focus and the editor reports no
    /// caret.
    pub panel_at: Option<[f32; 4]>,
    /// The theme drawn when the list of themes opened, to go back to.
    pub theme_before: Option<String>,
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
        let look = crate::theme::Look::load(None, None, crate::theme::Mode::Light);
        let spans = markdown::spans(&text, &marks(&look.palette), &[]);
        let title = title_of(&path, &text);
        State {
            path, edit, version: 1, saved: text, split: 0.5, last_range: (0, 0), uri, spans, problem: None, page: None, width: 0.0,
            bounds: None, client: None, cursor_line: None, page_url: None, ghost: None, asked: None, height: 0.0, menu: None,
            view: None, menu_at: None, notes: TextEdit::new(""), drafts: Vec::new(), flash: None, now_ms: draft::now_ms(),
            pending: HashMap::new(), looked: std::cell::Cell::new(None), ticker: None, look, title, pane: [0.0; 4],
            panels: Vec::new(), field: TextEdit::new(""), panel_at: None, theme_before: None,
        }
    }
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

/// The post's first ATX heading, outside front matter and code fences, or its file's name.
pub fn title_of(path: &std::path::Path, text: &str) -> String {
    let mut lines = text.split('\n').peekable();
    if lines.peek().is_some_and(|l| l.trim_end() == "---") {
        lines.next();
        for l in lines.by_ref() {
            if l.trim_end() == "---" {
                break;
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

/// Whether the text is as last written.
pub fn clean(s: &State) -> bool {
    s.edit.text == s.saved
}

/// The text changed: a new version, new styles, and the whole text to the server.
pub fn changed(s: &mut State) {
    s.version += 1;
    s.ghost = None;
    // Typing is not the menu's: it goes (a choice that changed the text closed it already).
    draft::close(s);
    s.spans = spans(s);
    s.title = title_of(&s.path, &s.edit.text);
    if let Some(c) = &s.client {
        c.notify("textDocument/didChange", json!({
            "textDocument": { "uri": s.uri, "version": s.version },
            "contentChanges": [{ "text": s.edit.text }],
        }));
    }
    moved(s);
    ask(s);
}

/// Run after each drawn frame (`App::on_frame_drawn`) and after each change: a caret that
/// moved to another line tells the page, never twice for the same line.
pub fn moved(s: &mut State) -> bool {
    let range = s.edit.range();
    if range == s.last_range {
        return false;
    }
    s.last_range = range;
    // The caret went elsewhere: the menu and the panels were for where it was.
    draft::close(s);
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

/// The server answered initialize: open the document as it is now, and say where the caret is.
pub fn connected(s: &mut State, client: crate::lsp::Client) {
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

/// What the server sent that the slice acts on.
pub fn incoming(s: &mut State, m: crate::lsp::Incoming) {
    use crate::lsp::Incoming;
    match m {
        // Only the answer to the last question, for the version and line it was asked about.
        Incoming::Response { id, result } => {
            if let Some(about) = s.pending.remove(&id) {
                return draft::answered(s, about, result);
            }
            let Some((asked, version, line)) = s.asked else { return };
            if id != asked {
                return;
            }
            // Answered: a caret that leaves the line and comes back asks again.
            s.asked = None;
            if version != s.version || ghost::wants(&s.edit.text, s.edit.focus) != Some(line) {
                return;
            }
            s.ghost = result.ok().and_then(|r| ghost::parse(&r, line, version));
        }
        Incoming::Notification { method, params } if method == "rubric/serving" => {
            if let Some(url) = params.get("url").and_then(|u| u.as_str()) {
                serving(s, url.to_string());
            } else if let Some(p) = params.get("problem").and_then(|p| p.as_str()) {
                eprintln!("page: {p}");
            }
        }
        Incoming::Notification { method, params } if method == "textDocument/publishDiagnostics" => draft::diagnostics(s, &params),
        Incoming::Notification { method, params } if method == "rubric/drafted" => draft::drafted(s, &params),
        _ => {}
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

/// The window is going: the document and the server close, then the web view.
pub fn shut(s: &mut State) {
    if let Some(c) = s.client.take() {
        c.notify("textDocument/didClose", json!({ "textDocument": { "uri": s.uri } }));
        c.stop();
    }
    if let Some(page) = s.page.take() {
        page.close();
    }
}

/// Tab: takes a pick showing whose pin acts, or the offer of a new part, which makes the line
/// a `new:` line; on a `new:` line it asks for the line's menu. Otherwise nothing. Always
/// consumed.
pub fn tab(s: &mut State, _tx: &mut Tx) {
    if let Some(g) = showing(s).filter(|g| g.pick.pin.as_ref().is_some_and(|p| p.acts || p.build)).cloned() {
        ghost::accept(&mut s.edit, &g);
        changed(s);
        if g.pick.pin.is_some_and(|p| p.acts) {
            return;
        }
    }
    draft::tab(s);
}

/// Ctrl+S writes the file whole.
pub fn save(s: &mut State) {
    match markdown::save(&s.path, &s.edit.text) {
        Ok(()) => s.saved = s.edit.text.clone(),
        Err(e) => {
            eprintln!("save failed: {e}");
            s.problem = Some(e.to_string());
        }
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

/// The page pane moved or resized: `rect` in points, `scale` pixels per point.
pub fn page_laid_out(s: &mut State, rect: [f32; 4], scale: f32) {
    let px = |v: f32| (v * scale).round();
    let b = if s.split >= 1.0 || rect[2] < 1.0 || rect[3] < 1.0 {
        (0, 0, 0, 0)
    } else {
        (px(rect[0]) as i32, px(rect[1]) as i32, px(rect[2]) as u32, px(rect[3]) as u32)
    };
    if s.bounds == Some(b) {
        return;
    }
    s.bounds = Some(b);
    if let Some(page) = &s.page {
        page.send(crate::page::PageCmd::Bounds { x: b.0, y: b.1, w: b.2, h: b.3 });
    }
}

/// The web view exists: it takes the last bounds the pane had, and the page's address if the
/// server gave it first.
pub fn page_attached(s: &mut State, page: crate::page::Page) {
    if let Some(b) = s.bounds {
        page.send(crate::page::PageCmd::Bounds { x: b.0, y: b.1, w: b.2, h: b.3 });
    }
    if let Some(url) = &s.page_url {
        page.send(crate::page::PageCmd::Load(url.clone()));
    }
    s.page = Some(page);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn the_title_is_the_first_heading_past_the_front_matter() {
        let p = Path::new("/x/walk.md");
        assert_eq!(title_of(p, "---\ntitle: x\n# not this\n---\n\n```\n# nor this\n```\n## The long walk ##\n# Later"), "The long walk");
        assert_eq!(title_of(p, "no heading\n#tag"), "walk.md");
    }
}
