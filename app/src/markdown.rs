//! Markdown styled in place: spans over the editor's own bytes, and saving the file.

use std::io::{self, Write};
use std::path::Path;

use rune::{Color, Span};

use crate::draft::Tone;

/// The colors the spans use.
#[derive(Clone, Copy, Debug)]
pub struct Theme {
    /// Marks: the `#` of a heading, the stars around bold and italic.
    pub dim: Color,
    /// A `:::` line.
    pub accent: Color,
    /// A `new:` line whose draft failed.
    pub warn: Color,
}

/// The editor's text size, in points; headings are larger.
pub const BODY: f32 = 17.0;
const HEADINGS: [f32; 3] = [28.0, 23.0, 19.0];

/// Styles for the whole text: ATX headings, `**bold**`, `*italic*`, `:::` lines, and fenced
/// code, inside which nothing else is styled. A `::: new:` line is dim until `drafts` (line,
/// tone) says where its draft is. Runs over the whole text; no incremental pass.
pub fn spans(text: &str, theme: &Theme, drafts: &[(u32, Tone)]) -> Vec<Span> {
    let mut out = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    let mut start = 0;
    for (n, line) in text.split('\n').enumerate() {
        let end = start + line.len();
        let lead = line.len() - line.trim_start_matches([' ', '\t']).len();
        let rest = &line[lead..];
        let fence_mark = fence_of(rest);
        if let Some((ch, n)) = fence {
            out.push(Span::new(start, end).mono());
            if let Some((c, m)) = fence_mark && c == ch && m >= n && rest.trim_end().bytes().all(|b| b == ch) {
                fence = None;
            }
        } else if let Some(f) = fence_mark {
            fence = Some(f);
            out.push(Span::new(start, end).mono());
        } else if rest.starts_with(":::") {
            let tone = if crate::draft::is_new_line(rest) {
                drafts.iter().find(|(l, _)| *l as usize == n).map_or(Tone::Dim, |(_, t)| *t)
            } else {
                Tone::Accent
            };
            out.push(Span::new(start, end).color(match tone {
                Tone::Dim => theme.dim,
                Tone::Accent => theme.accent,
                Tone::Warn => theme.warn,
            }));
        } else if let Some(level) = heading_level(rest) {
            let size = HEADINGS.get(level - 1).copied().unwrap_or(BODY);
            let marks = start + lead + level;
            out.push(Span::new(start + lead, marks).size(size).bold().color(theme.dim));
            if marks < end {
                out.push(Span::new(marks, end).size(size).bold());
            }
        } else {
            inline(line, start, theme, &mut out);
        }
        start = end + 1;
    }
    out
}

/// A code fence's character and length, when the line opens or closes one.
fn fence_of(rest: &str) -> Option<(u8, usize)> {
    let ch = *rest.as_bytes().first()?;
    if ch != b'`' && ch != b'~' {
        return None;
    }
    let n = rest.bytes().take_while(|&b| b == ch).count();
    (n >= 3).then_some((ch, n))
}

/// 1 to 6 for an ATX heading (`#` marks then a space or the end of the line).
fn heading_level(rest: &str) -> Option<usize> {
    let n = rest.bytes().take_while(|&b| b == b'#').count();
    ((1..=6).contains(&n) && matches!(rest.as_bytes().get(n), None | Some(b' ' | b'\t'))).then_some(n)
}

/// `**bold**` and `*italic*` on one line, the stars dimmed.
fn inline(line: &str, base: usize, theme: &Theme, out: &mut Vec<Span>) {
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'*' {
            i += 1;
            continue;
        }
        let double = b.get(i + 1) == Some(&b'*');
        let width = if double { 2 } else { 1 };
        let open = i + width;
        // The text must start right after the marks; `* item` is a list, not italic.
        if open >= b.len() || b[open] == b' ' || b[open] == b'*' {
            i = open;
            continue;
        }
        let close = if double { find(b, open + 1, b"**") } else { find_single(b, open + 1) };
        let Some(close) = close.filter(|&c| b[c - 1] != b' ') else {
            i = open;
            continue;
        };
        let (s, e) = (base + i, base + close + width);
        out.push(Span::new(s, s + width).color(theme.dim));
        let inner = Span::new(s + width, base + close);
        out.push(if double { inner.bold() } else { inner.italic() });
        out.push(Span::new(base + close, e).color(theme.dim));
        i = close + width;
    }
}

fn find(b: &[u8], from: usize, pat: &[u8]) -> Option<usize> {
    (from..b.len().saturating_sub(pat.len() - 1)).find(|&j| &b[j..j + pat.len()] == pat)
}

/// A lone `*`, not part of `**`.
fn find_single(b: &[u8], from: usize) -> Option<usize> {
    (from..b.len()).find(|&j| b[j] == b'*' && b.get(j + 1) != Some(&b'*') && b[j - 1] != b'*')
}

/// Writes the file whole: a temporary file beside it, then a rename over it.
pub fn save(path: &Path, text: &str) -> io::Result<()> {
    let name = path.file_name().ok_or_else(|| io::Error::other("no file name"))?.to_string_lossy();
    let tmp = path.with_file_name(format!(".{name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: Theme = Theme { dim: Color { r: 0.5, g: 0.5, b: 0.5, a: 1.0 }, accent: Color { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }, warn: Color { r: 1.0, g: 0.5, b: 0.0, a: 1.0 } };

    fn at<'a>(spans: &'a [Span], start: usize, end: usize) -> &'a Span {
        spans.iter().find(|s| s.start as usize == start && s.end as usize == end)
            .unwrap_or_else(|| panic!("no span {start}..{end} in {spans:?}"))
    }

    #[test]
    fn a_heading_is_larger_with_its_marks_dimmed() {
        let s = spans("## Title\nbody", &T, &[]);
        let marks = at(&s, 0, 2);
        assert_eq!(marks.color, Some(T.dim));
        let words = at(&s, 2, 8);
        assert!(words.size.unwrap() > BODY);
        assert!(words.weight.is_some());
        assert!(!s.iter().any(|x| x.start >= 9), "the plain line after it is not styled");
    }

    #[test]
    fn bold_is_on_the_words_and_the_stars_are_dimmed() {
        let s = spans("x **a** y", &T, &[]);
        assert_eq!(at(&s, 2, 4).color, Some(T.dim));
        assert!(at(&s, 4, 5).weight.is_some());
        assert_eq!(at(&s, 5, 7).color, Some(T.dim));
    }

    #[test]
    fn italic_is_slanted_and_a_list_star_is_not() {
        let s = spans("* item *word*", &T, &[]);
        assert!(at(&s, 8, 12).italic);
        assert!(!s.iter().any(|x| x.start == 0));
    }

    #[test]
    fn nothing_inside_a_code_fence_is_styled() {
        let text = "```\n# not a heading **no**\n```\n# yes";
        let s = spans(text, &T, &[]);
        let inner = text.find("# not").unwrap();
        let inside: Vec<_> = s.iter().filter(|x| (x.start as usize) >= inner && (x.end as usize) <= inner + 22).collect();
        assert!(inside.iter().all(|x| x.mono && x.size.is_none() && x.weight.is_none()), "{inside:?}");
        let after = text.rfind('#').unwrap();
        assert!(at(&s, after + 1, text.len()).size.is_some(), "the fence closed");
    }

    #[test]
    fn a_directive_line_takes_the_accent() {
        let s = spans("text\n::: a quote\n:::", &T, &[]);
        assert_eq!(at(&s, 5, 16).color, Some(T.accent));
    }

    #[test]
    fn a_new_line_is_dim_until_its_draft_says_otherwise() {
        let text = "::: new: a clock\n:::\n::: new: a bell\n:::";
        let s = spans(text, &T, &[(2, Tone::Warn)]);
        assert_eq!(at(&s, 0, 16).color, Some(T.dim));
        assert_eq!(at(&s, 21, 36).color, Some(T.warn));
        assert_eq!(at(&s, 17, 20).color, Some(T.accent), "a closer keeps the accent");
        let s = spans(text, &T, &[(0, Tone::Accent)]);
        assert_eq!(at(&s, 0, 16).color, Some(T.accent));
    }

    #[test]
    fn offsets_are_bytes_after_multibyte_characters() {
        let text = "café 🙂\n**b**";
        let s = spans(text, &T, &[]);
        let b = text.find("b**").unwrap();
        assert_eq!(&text[b..b + 1], "b");
        assert!(at(&s, b, b + 1).weight.is_some());
    }

    #[test]
    fn save_writes_the_text_and_leaves_no_temporary_file() {
        let dir = std::env::temp_dir().join(format!("rubric-app-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("post.md");
        std::fs::write(&path, "old").unwrap();
        save(&path, "new text\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new text\n");
        let names: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("post.md")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
