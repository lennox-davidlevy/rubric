// reading-progress: sets how far down the page the reader is, from 0 at the
// top to 1 at the bottom, on each mark; the CSS draws it as a bar or a ruler.
// Runs again on "rubric:drawn", when the live preview puts new parts in the
// page without reloading it.
(() => {
  let queued = false;
  const update = () => {
    queued = false;
    const end = document.documentElement.scrollHeight - innerHeight;
    const read = end > 0 ? Math.min(1, Math.max(0, scrollY / end)) : 1;
    for (const part of document.querySelectorAll(".part-reading-progress")) {
      part.dataset.ready = "";
      part.style.setProperty("--read", read.toFixed(4));
      const value = part.querySelector(".part-reading-progress-value");
      if (value) value.textContent = read.toFixed(2);
    }
  };
  const soon = () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  };
  addEventListener("scroll", soon, { passive: true });
  addEventListener("resize", soon);
  document.addEventListener("rubric:drawn", soon);
  update();
})();
