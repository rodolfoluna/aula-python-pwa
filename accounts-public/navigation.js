// The first entry is a home boundary for Android/PWA Back. Internal screens
// use real history entries, so browser Back and Forward follow the same path.
export function createNavigation({ window, canLeave, onError = () => {} }) {
  const history = window.history;
  let entries = [], cursor = 1, restoring = false, recovering = false, session = '', active = false;
  const state = index => ({ aula: session, index });
  function reset(key, home) {
    session = key; entries = [home, home]; cursor = 1; active = true;
    history.replaceState(state(0), '', window.location.pathname);
    history.pushState(state(1), '', window.location.pathname);
  }
  function record(key, restore, replace = false) {
    if (!active || restoring) return;
    if (replace || entries[cursor]?.key === key) { entries[cursor] = { key, restore }; return; }
    entries = entries.slice(0, cursor + 1); entries.push({ key, restore }); cursor++;
    history.pushState(state(cursor), '', window.location.pathname);
  }
  const pop = async event => {
    if (!active || event.state?.aula !== session) return;
    if (recovering) { recovering = false; return; }
    const target = event.state.index;
    if (restoring || target === 0 || !canLeave()) {
      recovering = true; history.go(cursor - target); return;
    }
    const previous = cursor; restoring = true;
    try { await entries[target].restore(); cursor = target; }
    catch (error) { recovering = true; history.go(previous - target); onError(error); }
    finally { restoring = false; }
  };
  window.addEventListener('popstate', pop);
  return { reset, record, back() { if (active && cursor > 1) history.back(); }, get restoring() { return restoring; }, destroy() { active = false; window.removeEventListener('popstate', pop); } };
}
