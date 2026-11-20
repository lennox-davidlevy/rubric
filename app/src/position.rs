//! Byte offsets in the editor's text and LSP positions (0-based line, UTF-16 column).

/// The line and UTF-16 column of `byte` (clamped to the text and to a character boundary).
pub fn line_char(text: &str, byte: usize) -> (u32, u32) {
    let byte = text.floor_char_boundary(byte.min(text.len()));
    let before = &text[..byte];
    let line = before.bytes().filter(|&b| b == b'\n').count() as u32;
    let start = before.rfind('\n').map_or(0, |i| i + 1);
    let col = before[start..].encode_utf16().count() as u32;
    (line, col)
}

/// The bytes of 0-based `line`, without its newline; past the end, an empty range at the end.
pub fn line_range(text: &str, line: u32) -> std::ops::Range<usize> {
    let mut start = 0;
    for _ in 0..line {
        match text[start..].find('\n') {
            Some(i) => start += i + 1,
            None => return text.len()..text.len(),
        }
    }
    let end = text[start..].find('\n').map_or(text.len(), |i| start + i);
    start..end
}

/// The byte offset of an LSP position (clamped to its line).
pub fn byte_at(text: &str, line: u32, character: u32) -> usize {
    let r = line_range(text, line);
    let mut units = 0;
    for (i, c) in text[r.clone()].char_indices() {
        if units >= character {
            return r.start + i;
        }
        units += c.len_utf16() as u32;
    }
    r.end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns_count_utf16_units_after_accents_and_emoji() {
        let text = "a\né!🙂x";
        let x = text.find('x').unwrap();
        assert_eq!(line_char(text, x), (1, 4), "é is one unit, the emoji two");
        let bang = text.find('!').unwrap();
        assert_eq!(line_char(text, bang), (1, 1));
        assert_eq!(byte_at(text, 1, 4), x);
    }

    #[test]
    fn line_ranges_leave_out_the_newline() {
        let text = "one\ntwo\n";
        assert_eq!(&text[line_range(text, 1)], "two");
        assert_eq!(line_range(text, 2), 8..8);
        assert_eq!(line_range(text, 5), 8..8);
    }
}
