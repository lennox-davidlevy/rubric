//! The divider between the writing and the page.

/// Near an edge, the split snaps to it: below 0.08 the page fills the window, above 0.92 the
/// writing does.
pub fn snap(fraction: f32) -> f32 {
    if fraction < 0.08 {
        0.0
    } else if fraction > 0.92 {
        1.0
    } else {
        fraction
    }
}

/// The split after dragging `dx` points from `from`, in a window `width` points wide.
pub fn dragged(from: f32, dx: f32, width: f32) -> f32 {
    if width <= 0.0 {
        return from;
    }
    snap((from + dx / width).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn near_an_edge_it_snaps_and_between_it_stays() {
        assert_eq!(snap(0.05), 0.0);
        assert_eq!(snap(0.5), 0.5);
        assert_eq!(snap(0.95), 1.0);
    }
}
