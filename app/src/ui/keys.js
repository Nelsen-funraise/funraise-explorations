// Phase 11C 🔑 金鑰對話框（docs/11-v2-cesium-app.md §20.3）— 線上版（GitHub Pages／Vercel 靜態前端）「需要 API 的話給我一個地方
// 填寫」的那個地方：訪客或分享者在這裡貼 client 端金鑰與 agent server 位址，只存在自己這台瀏覽器的 localStorage（src/keys.js），
// 不會上傳、也不進 build。server 端金鑰（OpenAI／Fish／MCP token）永遠不在這裡——那些放在 server 的環境變數（docs/12-hosting.md）。
import { getKey, setKey, KEY_NAMES } from '../keys.js';
const FIELDS = [
  { k: 'ion', label: 'Cesium ion token', secret: true, hint: '實景 3D（Google 相片級 3D Tiles，經 ion 資產 2275207）＋世界地形。到 ion.cesium.com → Access Tokens 複製；建議在 ion 後台限制允許的網域。' },
  { k: 'gkey', label: 'Google Maps API key（選填）', secret: true, hint: '直接走 Google Map Tiles API 的相片級 3D Tiles（計量收費）；沒有就用上面的 ion token。' },
  { k: 'api', label: 'Agent server 網址', secret: false, placeholder: 'https://peaklens-xxx.vercel.app', hint: 'AI 模式、語音、FUNRAISE MCP 即時資料都在這台 server 上；留空＝跟網頁同一個網域（本機 npm start、或前後端同在 Vercel 時）。' },
  { k: 'code', label: '存取碼', secret: true, hint: 'server 有設 PEAKLENS_ACCESS_CODE 時要填；向分享給你的人索取。' },
];
export function createKeysDialog({ ui, viewerApi }) {
  const btn = document.getElementById('keys');
  const box = document.createElement('div'); box.id = 'keysmenu'; box.className = 'panel hidden'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '金鑰');
  box.innerHTML = '<div class="eyebrow">金鑰 · KEYS</div><p class="hint" style="margin:0">只存在你這台瀏覽器（localStorage），不會上傳；改了會重新載入頁面。網址也可以直接帶參數分享：?ion=…&amp;api=…&amp;code=…（載入後自動存起來並從網址列移除）。</p>'
    + FIELDS.map(f => `<label class="kf"><span>${f.label}</span><input data-k="${f.k}" type="${f.secret ? 'password' : 'url'}" autocomplete="off" spellcheck="false" placeholder="${f.placeholder || (f.secret ? '貼上…' : '')}"><small>${f.hint}</small></label>`).join('')
    + '<div class="kbtns"><button data-act="save">儲存並重新載入</button><button data-act="clear">清除全部</button><button data-act="close">關閉</button></div><div class="kstat mono"></div>';
  document.body.appendChild(box);
  const status = () => {
    const parts = [`實景 3D：${viewerApi && viewerApi.hasGoogleKey ? '可用' : '沒有金鑰（白模）'}`, `agent server：${getKey('api') || import.meta.env.VITE_API_BASE || '同網域'}`, `存取碼：${getKey('code') ? '已填' : '—'}`, `build 內建 ion token：${import.meta.env.VITE_CESIUM_ION_TOKEN ? '有' : '無'}`];
    box.querySelector('.kstat').textContent = parts.join(' · ');
  };
  const fill = () => { for (const f of FIELDS) box.querySelector(`[data-k="${f.k}"]`).value = getKey(f.k); status(); };
  const open = () => { fill(); box.classList.remove('hidden'); if (btn) btn.setAttribute('aria-expanded', 'true'); ui.closeSunMenu && ui.closeSunMenu(); const first = box.querySelector('input'); first && first.focus(); };
  const close = () => { box.classList.add('hidden'); if (btn) btn.setAttribute('aria-expanded', 'false'); };
  const reload = (msg) => { ui.toast && ui.toast(msg); setTimeout(() => location.reload(), 500); };
  box.addEventListener('click', e => {
    const act = e.target && e.target.dataset ? e.target.dataset.act : null; if (!act) return;
    if (act === 'close') close();
    else if (act === 'clear') { for (const k of KEY_NAMES) setKey(k, ''); reload('已清除金鑰，重新載入…'); }
    else if (act === 'save') { let changed = false; for (const f of FIELDS) { const v = box.querySelector(`[data-k="${f.k}"]`).value.trim().replace(/\/+$/, ''); if (v !== getKey(f.k)) { setKey(f.k, v); changed = true; } } if (changed) reload('已儲存，重新載入以套用…'); else close(); }
  });
  if (btn) btn.onclick = () => { if (box.classList.contains('hidden')) open(); else close(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.classList.contains('hidden')) close(); });
  ui.openKeys = open; ui.closeKeys = close;
  return { open, close, get isOpen() { return !box.classList.contains('hidden'); } };
}
