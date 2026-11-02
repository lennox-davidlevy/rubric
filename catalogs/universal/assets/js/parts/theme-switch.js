// theme-switch: flips the site between light and dark and remembers the
// choice. Dark is the palette's own dark band, so every theme has one. The
// first choice, before this runs, comes from a line in the page's head.
document.querySelectorAll(".part-theme-switch").forEach((button) => {
  const root = document.documentElement;
  const show = () => button.setAttribute("aria-pressed", String(root.dataset.theme === "dark"));
  show();
  button.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("rubric-theme", root.dataset.theme); } catch {}
    show();
  });
});
