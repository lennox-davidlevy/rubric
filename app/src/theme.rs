//! The app's own colors ("Appearance"): OpenCode's theme files, resolved for light or dark and
//! turned into the design's tokens, as Pathlight does (`pathlight/src/theme.ts`: `resolveRoles`,
//! `derivePalette`, `loadThemes`). The site's theme (`::: theme` in `rubric.md`) is not this.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rune::Color;
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Light,
    Dark,
}

impl Mode {
    fn key(self) -> &'static str {
        match self {
            Mode::Light => "light",
            Mode::Dark => "dark",
        }
    }

    fn named(name: &str) -> Option<Mode> {
        match name {
            "light" => Some(Mode::Light),
            "dark" => Some(Mode::Dark),
            _ => None,
        }
    }

    /// `RUBRIC_APP_MODE=dark` or `light` for one run, over the mode kept with the theme.
    pub fn from_env() -> Option<Mode> {
        Mode::named(std::env::var("RUBRIC_APP_MODE").ok()?.trim())
    }
}

/// A color as sRGB bytes, which is where blending happens, so the numbers match Pathlight's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgb(pub [u8; 3]);

impl Rgb {
    pub fn parse(hex: &str) -> Option<Rgb> {
        let h = hex.strip_prefix('#')?;
        let byte = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok();
        match h.len() {
            3 => {
                let mut out = [0; 3];
                for (i, c) in h.chars().enumerate() {
                    let d = c.to_digit(16)? as u8;
                    out[i] = d * 16 + d;
                }
                Some(Rgb(out))
            }
            6 => Some(Rgb([byte(0)?, byte(2)?, byte(4)?])),
            _ => None,
        }
    }

    pub fn hex(self) -> String {
        let [r, g, b] = self.0;
        format!("#{r:02x}{g:02x}{b:02x}")
    }

    /// `amount` of `over` laid on `self`.
    pub fn mix(self, over: Rgb, amount: f64) -> Rgb {
        let mut out = [0; 3];
        for i in 0..3 {
            let (a, b) = (self.0[i] as f64, over.0[i] as f64);
            out[i] = (a + (b - a) * amount).round().clamp(0.0, 255.0) as u8;
        }
        Rgb(out)
    }

    pub fn luminance(self) -> f64 {
        let [r, g, b] = self.0.map(f64::from);
        (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    }

    /// Rune's linear color.
    pub fn color(self) -> Color {
        rune::color::hex(&self.hex()).expect("six hex digits")
    }
}

const ANSI16: [&str; 16] = [
    "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
];

fn ansi(code: u64) -> Rgb {
    if code < 16 {
        return Rgb::parse(ANSI16[code as usize]).expect("table");
    }
    if code < 232 {
        let i = code - 16;
        let level = |v: u64| if v == 0 { 0 } else { (v * 40 + 55) as u8 };
        return Rgb([level(i / 36), level((i / 6) % 6), level(i % 6)]);
    }
    if code < 256 {
        let v = ((code - 232) * 10 + 8) as u8;
        return Rgb([v; 3]);
    }
    Rgb([0; 3])
}

/// A theme file: `defs` names colors, `theme` maps roles to a hex value, a name from `defs` or
/// another role, an ANSI color number, `transparent` or `none`, or `{ "dark": …, "light": … }`.
#[derive(Clone, Debug, PartialEq)]
pub struct File {
    defs: Map<String, Value>,
    theme: Map<String, Value>,
}

impl File {
    pub fn parse(json: &str) -> Result<File, String> {
        let v: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let theme = v.get("theme").and_then(Value::as_object).ok_or("no theme object")?.clone();
        let defs = match v.get("defs") {
            None => Map::new(),
            Some(d) => d.as_object().ok_or("defs is not an object")?.clone(),
        };
        Ok(File { defs, theme })
    }
}

/// The roles `tokens` reads: only these are resolved for the app, so a role it never uses (a
/// number that is no color, a key OpenCode adds later) does not cost the writer the theme.
const USED: &[&str] = &[
    "background", "backgroundPanel", "backgroundElement", "text", "textMuted", "textFaint", "line", "borderSubtle",
    "border", "hover", "primary", "accent", "onAccent", "error",
];

/// Every role of a theme for one mode; `None` is transparent. A color with an alpha channel
/// (`#rrggbbaa`) is laid over the theme's background.
pub fn resolve_roles(file: &File, mode: Mode) -> Result<HashMap<String, Option<Rgb>>, String> {
    resolve_some(file, mode, |_| true)
}

fn resolve_some(file: &File, mode: Mode, wanted: impl Fn(&str) -> bool) -> Result<HashMap<String, Option<Rgb>>, String> {
    let mut canvas = if mode == Mode::Dark { Rgb([0; 3]) } else { Rgb([255; 3]) };
    fn resolve(file: &File, mode: Mode, canvas: Rgb, value: &Value, chain: &mut Vec<String>) -> Result<Option<Rgb>, String> {
        match value {
            Value::Number(n) => Ok(Some(ansi(n.as_u64().ok_or_else(|| format!("unusable color value {n}"))?))),
            Value::String(s) => {
                if s == "transparent" || s == "none" {
                    return Ok(None);
                }
                if s.starts_with('#') {
                    let h = &s[1..];
                    if h.len() == 8 && h.bytes().all(|b| b.is_ascii_hexdigit()) {
                        let base = Rgb::parse(&s[..7]).expect("hex");
                        let alpha = u8::from_str_radix(&h[6..], 16).expect("hex") as f64 / 255.0;
                        return Ok(Some(canvas.mix(base, alpha)));
                    }
                    return Rgb::parse(s).map(Some).ok_or_else(|| format!("unusable color value {s:?}"));
                }
                if chain.contains(s) {
                    chain.push(s.clone());
                    return Err(format!("circular color reference: {}", chain.join(" -> ")));
                }
                let next = file.defs.get(s).or_else(|| file.theme.get(s))
                    .ok_or_else(|| format!("color reference {s:?} is not in defs or theme"))?;
                chain.push(s.clone());
                let out = resolve(file, mode, canvas, next, chain);
                chain.pop();
                out
            }
            Value::Object(o) => match o.get(mode.key()) {
                Some(v) => resolve(file, mode, canvas, v, chain),
                None => Err(format!("no {} color in {value}", mode.key())),
            },
            _ => Err(format!("unusable color value {value}")),
        }
    }
    if let Some(bg) = file.theme.get("background")
        && let Some(c) = resolve(file, mode, canvas, bg, &mut Vec::new())?
    {
        canvas = c;
    }
    let mut roles = HashMap::new();
    for (name, value) in &file.theme {
        // OpenCode's files carry `$schema` and other strings beside the roles only at the top.
        if value.is_null() || !wanted(name) {
            continue;
        }
        roles.insert(name.clone(), resolve(file, mode, canvas, value, &mut Vec::new())?);
    }
    Ok(roles)
}

/// The design's colors (`Rubric Overview.dc.html`, Tokens), and `on`, the text on the accent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tokens {
    /// The window and the bars.
    pub bg: Rgb,
    /// The writing pane.
    pub pane: Rgb,
    /// Popovers and menus.
    pub pop: Rgb,
    pub ink: Rgb,
    pub ink2: Rgb,
    /// Markers and the pick shown after the caret.
    pub ink3: Rgb,
    /// Hairlines.
    pub line: Rgb,
    /// Hover and the active row.
    pub hover: Rgb,
    pub accent: Rgb,
    pub on: Rgb,
    pub fail: Rgb,
}

/// The tokens from a theme's roles. OpenCode's `background` is where the work is, so it is the
/// writing pane, and the bars take the panel. A missing role is blended from the others.
pub fn tokens(roles: &HashMap<String, Option<Rgb>>, mode: Mode) -> Tokens {
    let dark = mode == Mode::Dark;
    let role = |name: &str| roles.get(name).copied().flatten();
    let hex = |h: &str| Rgb::parse(h).expect("hex");
    let pane = role("background").unwrap_or_else(|| hex(if dark { "#141413" } else { "#ffffff" }));
    let ink = role("text").unwrap_or_else(|| hex(if dark { "#eef1f5" } else { "#1a1a1a" }));
    let ink2 = role("textMuted").unwrap_or_else(|| pane.mix(ink, 0.55));
    let accent = role("primary").or_else(|| role("accent")).unwrap_or_else(|| hex("#4257d0"));
    let (white, black) = (hex("#ffffff"), hex("#111111"));
    let far = |c: Rgb| (c.luminance() - accent.luminance()).abs();
    Tokens {
        bg: role("backgroundPanel").unwrap_or_else(|| pane.mix(ink, 0.04)),
        pane,
        pop: role("backgroundElement").unwrap_or_else(|| if dark { pane.mix(ink, 0.08) } else { pane }),
        ink,
        ink2,
        ink3: role("textFaint").unwrap_or_else(|| pane.mix(ink2, 0.60)),
        line: role("line").or_else(|| role("borderSubtle")).or_else(|| role("border")).unwrap_or_else(|| pane.mix(ink, 0.11)),
        hover: role("hover").unwrap_or_else(|| pane.mix(ink, 0.06)),
        accent,
        on: role("onAccent").unwrap_or(if far(white) >= far(black) { white } else { black }),
        fail: role("error").unwrap_or_else(|| hex("#e07a7a")),
    }
}

/// The tokens in Rune's colors, made once when the theme changes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palette {
    pub bg: Color,
    pub pane: Color,
    pub pop: Color,
    pub ink: Color,
    pub ink2: Color,
    pub ink3: Color,
    pub line: Color,
    pub hover: Color,
    pub accent: Color,
    pub on: Color,
    pub fail: Color,
}

impl From<Tokens> for Palette {
    fn from(t: Tokens) -> Palette {
        Palette {
            bg: t.bg.color(), pane: t.pane.color(), pop: t.pop.color(), ink: t.ink.color(), ink2: t.ink2.color(),
            ink3: t.ink3.color(), line: t.line.color(), hover: t.hover.color(), accent: t.accent.color(), on: t.on.color(),
            fail: t.fail.color(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    /// The file's name without `.json`.
    pub name: String,
    pub file: File,
    /// From the writer's own folder.
    pub own: bool,
}

impl Entry {
    /// "catppuccin-frappe" reads "Catppuccin frappe".
    pub fn label(&self) -> String {
        let words = self.name.replace(['-', '_'], " ");
        let mut c = words.chars();
        c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
    }

    pub fn tokens(&self, mode: Mode) -> Result<Tokens, String> {
        Ok(tokens(&resolve_some(&self.file, mode, |r| USED.contains(&r))?, mode))
    }
}

macro_rules! bundled {
    ($($name:literal),* $(,)?) => { &[$(($name, include_str!(concat!("../themes/", $name, ".json")))),*] };
}

/// The design's four first, then OpenCode's, as Pathlight copied them.
const BUNDLED: &[(&str, &str)] = bundled![
    "paper", "ink", "sepia", "fjord",
    "aura", "ayu", "carbonfox", "catppuccin", "catppuccin-frappe", "catppuccin-macchiato", "cobalt2", "cursor",
    "dracula", "everforest", "flexoki", "github", "gruvbox", "kanagawa", "lucent-orng", "material", "matrix",
    "mercury", "monokai", "nightowl", "nord", "one-dark", "orng", "osaka-jade", "palenight", "rosepine",
    "solarized", "synthwave84", "tokyonight", "vercel", "vesper", "zenburn",
];

/// The theme the app starts in until one is kept.
pub const DEFAULT: &str = "paper";

/// The bundled themes, then the writer's own from `<config>/themes/*.json` in name order, a
/// writer's file replacing a bundled one of its name in place. A file that does not parse, or
/// does not resolve in both modes, is skipped, and why is said once on stderr.
pub fn load(config: Option<&Path>) -> Vec<Entry> {
    let (out, skipped) = load_all(config);
    for why in skipped {
        eprintln!("{why}");
    }
    out
}

/// `load`, and why each skipped file was skipped (`theme mine.json: …`).
pub fn load_all(config: Option<&Path>) -> (Vec<Entry>, Vec<String>) {
    let mut out: Vec<Entry> = BUNDLED.iter()
        .map(|(name, json)| Entry { name: name.to_string(), file: File::parse(json).expect("a bundled theme parses"), own: false })
        .collect();
    let mut skipped = Vec::new();
    let Some(dir) = config.map(|c| c.join("themes")) else { return (out, skipped) };
    let Ok(read) = std::fs::read_dir(&dir) else { return (out, skipped) };
    let mut files: Vec<PathBuf> = read.filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json") && p.is_file()).collect();
    files.sort();
    for path in files {
        let Some(name) = path.file_stem().map(|s| s.to_string_lossy().into_owned()) else { continue };
        let shown = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let parsed = std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|t| File::parse(&t));
        let entry = parsed.and_then(|file| {
            let entry = Entry { name, file, own: true };
            entry.tokens(Mode::Light)?;
            entry.tokens(Mode::Dark)?;
            Ok(entry)
        });
        let entry = match entry {
            Ok(e) => e,
            Err(why) => {
                skipped.push(format!("theme {shown}: {why}"));
                continue;
            }
        };
        match out.iter_mut().find(|e| e.name == entry.name) {
            Some(e) => *e = entry,
            None => out.push(entry),
        }
    }
    (out, skipped)
}

/// `$XDG_CONFIG_HOME/rubric`, or `~/.config/rubric`.
pub fn config_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()).map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("rubric"))
}

/// The theme kept in `<config>/app.json`, if any, and the mode kept with it.
pub fn saved(config: &Path) -> (Option<String>, Option<Mode>) {
    let Some(v) = std::fs::read_to_string(config.join("app.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return (None, None);
    };
    let text = |k: &str| v.get(k).and_then(Value::as_str);
    (text("theme").map(str::to_string), text("mode").and_then(Mode::named))
}

/// Keeps `name` and `mode` in `<config>/app.json`, every other key as it was; written whole.
pub fn save(config: &Path, name: &str, mode: Mode) -> std::io::Result<()> {
    let path = config.join("app.json");
    let mut settings = std::fs::read_to_string(&path).ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    settings.insert("theme".into(), Value::String(name.into()));
    settings.insert("mode".into(), Value::String(mode.key().into()));
    std::fs::create_dir_all(config)?;
    let text = serde_json::to_string_pretty(&Value::Object(settings)).expect("json") + "\n";
    crate::markdown::save(&path, &text)
}

/// The themes, the one drawn, and where the choice is kept.
#[derive(Clone, Debug)]
pub struct Look {
    pub themes: Vec<Entry>,
    /// The name drawn now.
    pub name: String,
    pub mode: Mode,
    pub palette: Palette,
    /// `None`: nothing is read or written (the tests).
    pub config: Option<PathBuf>,
}

impl Look {
    /// The theme from `wanted` (`RUBRIC_APP_THEME`), else the one kept in `config`, else Paper;
    /// a name that is not there is Paper too. The mode is `mode` (`RUBRIC_APP_MODE`), else the
    /// one kept with the theme, else light.
    pub fn load(config: Option<PathBuf>, wanted: Option<String>, mode: Option<Mode>) -> Look {
        let themes = load(config.as_deref());
        let (kept, kept_mode) = config.as_deref().map(saved).unwrap_or_default();
        let mode = mode.or(kept_mode).unwrap_or(Mode::Light);
        let mut look = Look { themes, name: String::new(), mode, palette: Palette::from(paper(mode)), config };
        for name in [wanted, kept, Some(DEFAULT.to_string())].into_iter().flatten() {
            if look.show(&name) {
                break;
            }
        }
        look
    }

    /// Draws the app in `name`; false when there is no such theme.
    pub fn show(&mut self, name: &str) -> bool {
        let Some(t) = self.themes.iter().find(|e| e.name == name).and_then(|e| e.tokens(self.mode).ok()) else { return false };
        self.palette = Palette::from(t);
        self.name = name.to_string();
        true
    }

    /// Draws the theme shown now in `mode`.
    pub fn set_mode(&mut self, mode: Mode) {
        let old = self.mode;
        self.mode = mode;
        let name = self.name.clone();
        if !self.show(&name) {
            self.mode = old;
        }
    }

    /// Keeps the theme drawn now, and its mode.
    pub fn keep(&self) -> std::io::Result<()> {
        match &self.config {
            Some(c) => save(c, &self.name, self.mode),
            None => Ok(()),
        }
    }
}

fn paper(mode: Mode) -> Tokens {
    let json = BUNDLED.iter().find(|(n, _)| *n == DEFAULT).expect("paper is bundled").1;
    tokens(&resolve_roles(&File::parse(json).expect("parses"), mode).expect("resolves"), mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(json: &str) -> File {
        File::parse(json).unwrap()
    }

    fn hexes(t: Tokens) -> [String; 10] {
        [t.bg, t.pane, t.pop, t.ink, t.ink2, t.ink3, t.line, t.hover, t.accent, t.fail].map(Rgb::hex)
    }

    fn bundled(name: &str, mode: Mode) -> Tokens {
        load(None).into_iter().find(|e| e.name == name).unwrap().tokens(mode).unwrap()
    }

    /// The Overview's ten (bg, pane, pop, ink, ink2, ink3, line, hover, accent, fail), its
    /// `rgba` hairlines laid over the pane.
    #[test]
    fn the_designs_four_resolve_to_the_overviews_values() {
        assert_eq!(hexes(bundled("paper", Mode::Light)),
            ["#f6f6f4", "#ffffff", "#ffffff", "#1c1c1a", "#66665f", "#96968e", "#e5e5e5", "#f2f2f2", "#4257d0", "#b3432c"]);
        assert_eq!(hexes(bundled("ink", Mode::Dark)),
            ["#141413", "#1a1a19", "#222221", "#ecece8", "#9c9c95", "#6c6c66", "#333332", "#2a2a29", "#9aa8f7", "#e2806a"]);
        assert_eq!(hexes(bundled("sepia", Mode::Light)),
            ["#f1eadc", "#f8f3e9", "#fcf8f0", "#3b3228", "#75675a", "#a39582", "#dcd5c9", "#ebe5da", "#9a4a22", "#a8321f"]);
        assert_eq!(hexes(bundled("fjord", Mode::Dark)),
            ["#1e232b", "#252b35", "#2c333f", "#e3e7ee", "#98a2b3", "#687386", "#3b424e", "#323843", "#86c5cd", "#e58f7c"]);
        assert_eq!(bundled("paper", Mode::Light).on.hex(), "#ffffff");
        assert_eq!(bundled("fjord", Mode::Dark).on.hex(), "#10151c");
    }

    #[test]
    fn every_bundled_theme_resolves_in_both_modes() {
        let all = load(None);
        assert!(all.len() >= 36, "{}", all.len());
        for e in &all {
            for mode in [Mode::Light, Mode::Dark] {
                e.tokens(mode).unwrap_or_else(|err| panic!("{} {mode:?}: {err}", e.name));
            }
        }
    }

    #[test]
    fn references_ansi_numbers_modes_alpha_and_transparency_resolve() {
        let f = file(r##"{ "defs": { "base": "#102030" }, "theme": {
            "background": "base", "text": { "dark": "#ffffff", "light": "#000000" }, "textMuted": "text",
            "primary": 1, "border": "#fff", "warning": "#ff000080", "info": "transparent" } }"##);
        let r = resolve_roles(&f, Mode::Dark).unwrap();
        let hex = |k: &str| r[k].map(Rgb::hex);
        assert_eq!(hex("background").as_deref(), Some("#102030"));
        assert_eq!(hex("text").as_deref(), Some("#ffffff"));
        assert_eq!(hex("textMuted").as_deref(), Some("#ffffff"));
        assert_eq!(hex("primary").as_deref(), Some("#800000"));
        assert_eq!(hex("border").as_deref(), Some("#ffffff"));
        assert_eq!(hex("warning").as_deref(), Some("#881018"), "laid over the background");
        assert_eq!(r["info"], None);
        assert_eq!(resolve_roles(&f, Mode::Light).unwrap()["text"].map(Rgb::hex).as_deref(), Some("#000000"));
    }

    #[test]
    fn a_role_given_for_both_modes_follows_the_mode() {
        let f = file(r##"{ "theme": { "background": { "dark": "#000000", "light": "#ffffff" }, "primary": { "dark": "#aabbcc", "light": "#112233" } } }"##);
        let e = Entry { name: "x".into(), file: f, own: false };
        assert_eq!(e.tokens(Mode::Dark).unwrap().accent.hex(), "#aabbcc");
        assert_eq!(e.tokens(Mode::Light).unwrap().accent.hex(), "#112233");
        assert_eq!(e.tokens(Mode::Dark).unwrap().pane.hex(), "#000000");
    }

    #[test]
    fn a_bad_reference_or_a_cycle_is_refused() {
        assert!(resolve_roles(&file(r#"{ "theme": { "text": "nowhere" } }"#), Mode::Dark).unwrap_err().contains("nowhere"));
        let err = resolve_roles(&file(r#"{ "theme": { "text": "muted", "muted": "text" } }"#), Mode::Dark).unwrap_err();
        assert!(err.contains("circular"), "{err}");
    }

    #[test]
    fn missing_roles_are_blended_from_the_background_and_the_text() {
        let f = file(r##"{ "theme": { "background": "#ffffff", "text": "#000000", "primary": "#ffee00" } }"##);
        let t = Entry { name: "x".into(), file: f, own: false }.tokens(Mode::Light).unwrap();
        assert_eq!(t.bg.hex(), "#f5f5f5");
        assert_eq!(t.ink2.hex(), "#737373");
        assert_eq!(t.line.hex(), "#e3e3e3");
        assert_eq!(t.pop, t.pane, "in light the popover is the pane");
        assert_eq!(t.on.hex(), "#111111", "a light accent takes dark text");
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("rubric-theme-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("themes")).unwrap();
        d
    }

    #[test]
    fn a_writers_file_replaces_a_bundled_one_and_a_broken_one_is_skipped() {
        let d = temp("own");
        std::fs::write(d.join("themes/nord.json"), r##"{ "theme": { "background": "#010203", "text": "#eeeeee" } }"##).unwrap();
        std::fs::write(d.join("themes/mine.json"), r##"{ "theme": { "background": "#111111", "text": "#eeeeee" } }"##).unwrap();
        std::fs::write(d.join("themes/broken.json"), "{ nope").unwrap();
        std::fs::write(d.join("themes/loop.json"), r#"{ "theme": { "text": "a", "a": "text" } }"#).unwrap();
        std::fs::write(d.join("themes/later.json"), r##"{ "theme": { "background": "#222222", "text": "#eeeeee", "diffAdded": "nowhere", "opacity": 0.5 } }"##).unwrap();
        std::fs::write(d.join("themes/missing.json"), r##"{ "theme": { "background": "x", "text": "#eeeeee" } }"##).unwrap();
        let (all, skipped) = load_all(Some(&d));
        assert!(all.iter().any(|e| e.name == "later"), "roles the app never reads cost nothing");
        assert_eq!(skipped.len(), 3, "{skipped:?}");
        assert!(skipped.iter().any(|w| w.contains("missing.json") && w.contains("\"x\"")), "{skipped:?}");
        assert!(skipped.iter().any(|w| w.contains("broken.json")) && skipped.iter().any(|w| w.contains("loop.json")), "{skipped:?}");
        let nord = all.iter().find(|e| e.name == "nord").unwrap();
        assert!(nord.own);
        assert_eq!(nord.tokens(Mode::Dark).unwrap().pane.hex(), "#010203");
        assert_eq!(all.iter().filter(|e| e.name == "nord").count(), 1);
        assert!(all.iter().any(|e| e.name == "mine" && e.own));
        assert!(!all.iter().any(|e| e.name == "broken" || e.name == "loop"));
        assert!(all.iter().any(|e| e.name == "dracula" && !e.own));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn the_kept_theme_is_read_back_and_other_settings_stay() {
        let d = temp("kept");
        std::fs::write(d.join("app.json"), r#"{ "other": 1 }"#).unwrap();
        let mut look = Look::load(Some(d.clone()), None, None);
        assert_eq!(look.name, DEFAULT);
        assert!(look.show("sepia"));
        look.keep().unwrap();
        assert_eq!(Look::load(Some(d.clone()), None, None).name, "sepia");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.join("app.json")).unwrap()).unwrap();
        assert_eq!(v["other"], 1);
        assert_eq!(Look::load(Some(d.clone()), Some("fjord".into()), None).name, "fjord", "the environment's for one run");
        assert_eq!(Look::load(Some(d.clone()), Some("nothing".into()), None).name, "sepia");
        assert_eq!(Look::load(Some(d.clone()), None, None).mode, Mode::Light, "light until a mode is kept");
        look.set_mode(Mode::Dark);
        look.keep().unwrap();
        let back = Look::load(Some(d.clone()), None, None);
        assert_eq!((back.name.as_str(), back.mode), ("sepia", Mode::Dark), "the mode is kept with the theme");
        assert_eq!(back.palette, Palette::from(bundled("sepia", Mode::Dark)));
        assert_eq!(Look::load(Some(d.clone()), None, Some(Mode::Light)).mode, Mode::Light, "the environment's for one run");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_name_reads_as_words() {
        let e = Entry { name: "catppuccin-frappe".into(), file: file(r#"{ "theme": {} }"#), own: false };
        assert_eq!(e.label(), "Catppuccin frappe");
    }
}
