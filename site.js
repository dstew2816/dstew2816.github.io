(function () {
  var root = document.documentElement;

  // Light and dark toggle. The head script applies a saved choice before first paint.
  var btn = document.querySelector('.toggle');
  function current() {
    return root.dataset.theme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function label() {
    if (btn) btn.textContent = current() === 'dark' ? 'Light mode' : 'Dark mode';
  }
  if (btn) {
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
      label();
      document.dispatchEvent(new Event('themechange'));
    });
    label();
  }
})();
