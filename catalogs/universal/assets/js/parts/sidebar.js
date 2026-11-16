// sidebar: on a phone it opens over the page from its button. Opened there,
// it would stay over the page once the screen is wide enough for the column
// (a tablet turned on its side), so it closes then. Without this script the
// drawer still opens and closes; only that case is left.
(() => {
  matchMedia("(min-width: 64rem)").addEventListener("change", (e) => {
    if (e.matches) document.querySelectorAll(".part-sidebar:popover-open").forEach((p) => p.hidePopover());
  });
})();
