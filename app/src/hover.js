// Hover mini-card: a non-interactive card that follows the cursor over picked FUNRAISE entities / clusters (one glance = what is this, how big, how much).
import { LAYERS, fmtInt, fmtMoney } from './layers/funraise.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yearOf = s => { const m = String(s || '').match(/(\d{4})/); return m ? m[1] : null; };
const LINES = {
  stock: it => [it.grade && `${it.grade} 級商辦`, it.floor_above && `${it.floor_above}F${it.floor_below ? '／B' + it.floor_below : ''}`, it.actual_rent_avg && `租 ${fmtInt(it.actual_rent_avg)} 元/坪`, it.mrt && it.mrt[0] && `${it.mrt[0].station_name} ${it.mrt[0].distance} m`],
  mops: it => [it.buyer_name && `買方 ${it.buyer_name}`, it.total_price && fmtMoney(it.total_price), it.announcement_date],
  licenses: it => [it.construction_type, it.issue_date && `核發 ${it.issue_date}`, it.developer_masked],
  renewal: it => [it.category, it.area_sqm && `${fmtInt(it.area_sqm)} m²`, it.designation_method],
  future: it => [it.floors_above && `${it.floors_above}F`, yearOf(it.completion_date) && `${yearOf(it.completion_date)} 完工`, it.developer],
  moves: it => [it.from_district && it.district && `${it.from_district} → ${it.district}`, it.date, it.move_scope],
  infra: it => [it.subcategory, it.status, it.completion_year && `${it.completion_year} 年`],
  parks: it => [it.park_type, it.area_ha && `${it.area_ha} ha`, it.status],
  heat: it => { const mp = it.market_price || {}; return [mp.actual_rent_avg && `租 ${fmtInt(mp.actual_rent_avg)} 元/坪`, mp.actual_sale_avg && `售 ${fmtInt(mp.actual_sale_avg / 1e4)} 萬/坪`, it.company_total && `${fmtInt(it.company_total)} 家公司`]; },
  zones: it => [it.category, it.status],
  mrt: it => [Array.isArray(it.lines) && it.lines.join('・')],
  parcels: it => [(it.landcode || it.land_no) && `地號 ${it.landcode || it.land_no}`, (it.area_sqm || it.area) && `${fmtInt(it.area_sqm || it.area)} m²`, it.zoning || it.zone],
};
const titleOf = it => it.name || it.company_name || it.property_name || it.license_number || it.landcode || it.land_no || '—';

export function createHover(stage) {
  const card = document.createElement('div'); card.id = 'hovercard'; card.className = 'panel hidden'; card.setAttribute('aria-hidden', 'true'); stage.appendChild(card);
  let cur = null;
  const render = (pl, cluster) => {
    if (cluster) { card.innerHTML = `<div class="eyebrow" style="color:${LAYERS.stock.color}">商辦存量</div><h5>${cluster.length} 棟商辦</h5><div class="l">點一下放大 · 雙擊飛進去</div>`; return; }
    const L = LAYERS[pl.layer] || { name: pl.layer, color: '#93DCE6' }; const parts = ((LINES[pl.layer] || (() => []))(pl.item) || []).filter(Boolean).map(esc);
    card.innerHTML = `<div class="eyebrow" style="color:${L.color}">${esc(L.name)}</div><h5>${esc(titleOf(pl.item))}</h5>${parts.length ? `<div class="l">${parts.join(' · ')}</div>` : ''}<div class="hint">點選看資料卡 · 雙擊飛過去</div>`;
  };
  return {
    update(picked, pos) {
      const id = picked && picked.id; const cluster = id && id.cluster; let pl = null; try { pl = id && id.properties && id.properties.pl ? id.properties.pl.getValue() : null; } catch { pl = null; }
      if (!cluster && !pl) { this.hide(); return false; }
      const key = cluster ? 'cluster:' + cluster.length : pl.key; if (key !== cur) { cur = key; render(pl, cluster); }
      card.classList.remove('hidden'); const W = stage.clientWidth, H = stage.clientHeight; const w = card.offsetWidth, h = card.offsetHeight; let x = pos.x + 16, y = pos.y + 18; if (x + w > W - 12) x = pos.x - w - 12; if (y + h > H - 12) y = pos.y - h - 12;
      card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; return true;
    },
    hide() { if (cur == null) return; cur = null; card.classList.add('hidden'); },
    get visible() { return cur != null; },
  };
}
