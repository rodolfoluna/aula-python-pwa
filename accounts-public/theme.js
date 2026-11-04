(() => {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem('aula-theme'); } catch {}
  const apply = value => {
    const theme = value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111827' : '#f3f5f9');
    const button = document.querySelector('#theme-toggle');
    if (button) { button.textContent = theme === 'dark' ? '☀ Tema claro' : '☾ Tema oscuro'; button.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'); }
    window.dispatchEvent(new CustomEvent('aula-theme-change', { detail: theme }));
  };
  apply(preference || (media?.matches ? 'dark' : 'light'));
  media?.addEventListener('change', event => { if (!preference) apply(event.matches ? 'dark' : 'light'); });
  window.addEventListener('storage', event => { if (event.key === 'aula-theme') { preference = event.newValue; apply(preference || (media?.matches ? 'dark' : 'light')); } });
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.querySelector('#theme-toggle')?.addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('aula-theme', preference); } catch {}
      apply(preference);
    });
  });
})();
