// gallery: opens a gallery's pictures in a lightbox. Without this script each
// thumbnail is a link to its picture, so nothing is lost when it does not
// load. One <dialog> serves every gallery on the page; the browser gives it
// focus trapping, Escape to close and focus back to the thumbnail after.
(() => {
  let dialog, img, caption, count, items = [], index = 0;

  const build = () => {
    dialog = document.createElement("dialog");
    dialog.className = "rubric-lightbox";
    dialog.setAttribute("aria-label", "Picture");
    dialog.innerHTML =
      '<figure><img alt=""><figcaption></figcaption></figure>' +
      '<p class="count" aria-live="polite"></p>' +
      '<button class="prev" type="button" aria-label="Previous picture">‹</button>' +
      '<button class="next" type="button" aria-label="Next picture">›</button>' +
      '<button class="close" type="button" aria-label="Close" autofocus>×</button>';
    img = dialog.querySelector("img");
    caption = dialog.querySelector("figcaption");
    count = dialog.querySelector(".count");
    dialog.querySelector(".prev").addEventListener("click", () => show(index - 1));
    dialog.querySelector(".next").addEventListener("click", () => show(index + 1));
    dialog.querySelector(".close").addEventListener("click", () => dialog.close());
    // A click on the dark ground, not the picture or a button, closes it.
    dialog.addEventListener("click", (e) => { if (e.target === dialog || e.target.tagName === "FIGURE") dialog.close(); });
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") show(index - 1);
      else if (e.key === "ArrowRight") show(index + 1);
    });
    // A horizontal swipe moves between pictures.
    let startX = null;
    dialog.addEventListener("pointerdown", (e) => { startX = e.clientX; });
    dialog.addEventListener("pointerup", (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    });
    document.body.append(dialog);
  };

  const show = (i) => {
    index = (i + items.length) % items.length;
    const a = items[index];
    const alt = a.querySelector("img")?.alt ?? "";
    const swap = () => {
      img.src = a.href;
      img.alt = alt;
      caption.textContent = alt;
      count.textContent = `${index + 1} of ${items.length}`;
      dialog.classList.remove("changing");
    };
    if (dialog.open && dialog.classList.contains("motion-subtle")) {
      dialog.classList.add("changing");
      setTimeout(swap, 140);
    } else swap();
    // Fetch the next picture early, so moving on is instant.
    if (items.length > 1) new Image().src = items[(index + 1) % items.length].href;
  };

  document.addEventListener("click", (e) => {
    const a = e.target.closest?.(".part-gallery a");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!dialog) build();
    const gallery = a.closest(".part-gallery");
    items = [...gallery.querySelectorAll("a")];
    dialog.classList.toggle("motion-subtle", gallery.dataset.motion === "subtle");
    dialog.classList.toggle("single", items.length < 2);
    show(items.indexOf(a));
    if (!dialog.open) dialog.showModal();
  });
})();
