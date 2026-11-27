// Apply the stored or system theme before first paint (no flash). Served as a
// same-origin file so the Content-Security-Policy needs no inline script.
(function () {
  var theme = null;
  try { theme = localStorage.getItem("talentflow-theme"); } catch (error) { theme = null; }
  if (theme !== "light" && theme !== "dark")
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();
