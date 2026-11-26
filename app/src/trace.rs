//! A record of what reaches the app, for a fault only a real window shows (the keyboard lost
//! under an input method). `RUBRIC_APP_TRACE=<file>` turns it on: every key a handler gets, every
//! change of text, and, after each frame, who has the keys and where the input method's area
//! is, when any of that changed. Off, each call is one check of a flag.

use std::io::Write;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

struct Trace {
    file: std::fs::File,
    begun: Instant,
    last: String,
}

static TRACE: OnceLock<Option<Mutex<Trace>>> = OnceLock::new();

fn trace() -> Option<&'static Mutex<Trace>> {
    TRACE.get_or_init(|| {
        let path = std::env::var_os("RUBRIC_APP_TRACE").filter(|p| !p.is_empty())?;
        let file = std::fs::File::create(&path).map_err(|e| eprintln!("trace: {e}")).ok()?;
        eprintln!("trace: writing {}", std::path::Path::new(&path).display());
        Some(Mutex::new(Trace { file, begun: Instant::now(), last: String::new() }))
    }).as_ref()
}

pub fn on() -> bool {
    trace().is_some()
}

/// One line, with the ms since the start.
pub fn say(what: impl FnOnce() -> String) {
    let Some(t) = trace() else { return };
    let Ok(mut t) = t.lock() else { return };
    let ms = t.begun.elapsed().as_secs_f64() * 1000.0;
    let line = what();
    let _ = writeln!(t.file, "{ms:10.1} {line}");
    let _ = t.file.flush();
}

/// After a frame: `what` is said only when it differs from the frame before.
pub fn frame(what: impl FnOnce() -> String) {
    let Some(t) = trace() else { return };
    let line = what();
    {
        let Ok(mut t) = t.lock() else { return };
        if t.last == line {
            return;
        }
        t.last = line.clone();
    }
    say(|| format!("frame  {line}"));
}
