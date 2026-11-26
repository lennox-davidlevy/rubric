//! The app's fonts, compiled in (`fonts/README.md` says where each file is from): Instrument
//! Sans for the interface, Literata for the writing, JetBrains Mono for code.

use rune::{Family, TextStyle};

pub const FONTS: &[&[u8]] = &[
    include_bytes!("../fonts/instrumentsans/InstrumentSans[wdth,wght].ttf"),
    include_bytes!("../fonts/instrumentsans/InstrumentSans-Italic[wdth,wght].ttf"),
    include_bytes!("../fonts/literata/Literata[opsz,wght].ttf"),
    include_bytes!("../fonts/literata/Literata-Italic[opsz,wght].ttf"),
    include_bytes!("../fonts/jetbrainsmono/JetBrainsMono[wght].ttf"),
    include_bytes!("../fonts/jetbrainsmono/JetBrainsMono-Italic[wght].ttf"),
];

/// The sans and mono slots; Literata is chosen by name.
pub const FAMILIES: (&str, &str) = ("Instrument Sans", "JetBrains Mono");

pub const WRITING: Family = Family::Named("Literata");

/// The writing's text size and line height, in points (the Overview's 17/1.7).
pub const BODY: f32 = 17.0;
pub const LINE: f32 = 29.0;

/// The writing: Literata 17/1.7.
pub fn writing() -> TextStyle {
    TextStyle { family: WRITING, ..TextStyle::new(BODY, 400.0).lh(LINE) }
}

/// The interface: Instrument Sans 13, and captions at 12.
pub fn ui(weight: f32) -> TextStyle {
    TextStyle::new(13.0, weight)
}

pub fn caption(weight: f32) -> TextStyle {
    TextStyle::new(12.0, weight)
}

/// A group's name and a chip: 11.5.
pub fn small(weight: f32) -> TextStyle {
    TextStyle::new(11.5, weight)
}

/// A key cap's text: 10.5.
pub fn key() -> TextStyle {
    TextStyle::new(10.5, 500.0)
}

/// The text system the window draws with, for the headless tests.
pub fn text_system() -> rune::text::TextSystem {
    rune::text::TextSystem::new(FONTS, FAMILIES)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A named family that does not resolve falls back to the sans: Literata measuring
    /// differently from both the sans and a missing name says it is the compiled-in file.
    #[test]
    fn the_writing_is_literata_not_the_sans() {
        let mut t = text_system();
        let line = "Carry less than seems sensible, and the tide decides the rest.";
        let sans = t.measure(line, TextStyle::new(BODY, 400.0), 1.0).0;
        let literata = t.measure(line, writing(), 1.0).0;
        let missing = t.measure(line, TextStyle { family: Family::Named("No Such Face"), ..TextStyle::new(BODY, 400.0) }, 1.0).0;
        assert_eq!(missing, sans, "a missing family falls back to the sans");
        assert_ne!(literata, sans, "the writing is not drawn in the sans");
        let inter = rune::text::TextSystem::new(&[], ("Inter", "Inter")).measure(line, TextStyle::new(BODY, 400.0), 1.0).0;
        assert_ne!(sans, inter, "the sans is Instrument Sans, not Rune's Inter");
    }
}
