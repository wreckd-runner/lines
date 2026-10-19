(function () {
  const bar = document.querySelector(".bar");
  const btn = document.querySelector(".bar__toggle");
  if (btn) btn.addEventListener("click", () => {
    const open = bar.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", open);
    btn.textContent = open ? "Close" : "Menu";
  });
})();
