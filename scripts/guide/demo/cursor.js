// A drawn mouse pointer for the guide's GIFs, evaluated in the panel page by shoot.mjs:
// __cur.moveTo(x, y) glides to a point, __cur.click() shows a click ring there.
(() => {
  if (window.__cur) return;
  const style = document.createElement('style');
  style.textContent = `
    #__cur { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transition: transform .6s cubic-bezier(.45, 0, .2, 1); }
    #__cur svg { display: block; filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, .4)); }
    .__ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      border: 3px solid rgba(0, 104, 255, .8); animation: __ring .5s ease-out forwards; }
    @keyframes __ring { from { transform: scale(.25); opacity: 1; } to { transform: scale(1.3); opacity: 0; } }`;
  document.head.append(style);
  const el = document.createElement('div');
  el.id = '__cur';
  el.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M1.5 1.5 L1.5 20.5 L6.6 15.8 L10 23.6 L13.6 22 L10.2 14.4 L17.2 14.4 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.append(el);
  let x = innerWidth - 60, y = innerHeight - 90;
  const place = () => { el.style.transform = `translate(${x - 1.5}px, ${y - 1.5}px)`; };
  place();
  window.__cur = {
    moveTo(nx, ny) { x = nx; y = ny; place(); return new Promise(r => setTimeout(r, 650)); },
    click() { const r = document.createElement('div'); r.className = '__ring'; r.style.left = `${x}px`; r.style.top = `${y}px`; document.body.append(r); setTimeout(() => r.remove(), 600); },
    hide() { el.style.visibility = 'hidden'; },
    show() { el.style.visibility = 'visible'; },
  };
})();
