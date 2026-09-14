// 智慧都更模擬（first cut）：地號 + 使用分區（FAR/BCR）+ 建照套繪 → 基準容積、獎勵容積、量體 envelope。所有假設外顯，不假裝是估價。
import * as Cesium from 'cesium';
export const ASSUMPTIONS = { floorHeight: 3.6, exemptRatio: 0.15, defaultFar: 2.25, defaultBcr: 0.45, bonusCap: 0.5 };
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);

export function simulateRenewal(unit, pdata, { bonus = 0.3, exempt = ASSUMPTIONS.exemptRatio } = {}) {
  const parcels = (pdata && pdata.parcels) || []; const zoning = (pdata && pdata.zoning && pdata.zoning[0]) || null; const permits = (pdata && pdata.permits) || [];
  const parcelArea = parcels.reduce((s, p) => s + (p.area_sqm || 0), 0); const siteArea = unit.area_sqm || parcelArea || 0; const covered = parcelArea ? Math.min(1, parcelArea / (siteArea || parcelArea)) : 0;
  const farKnown = zoning && zoning.far_decimal != null; const far = farKnown ? zoning.far_decimal : ASSUMPTIONS.defaultFar; const bcr = zoning && zoning.bcr_decimal != null ? zoning.bcr_decimal : ASSUMPTIONS.defaultBcr;
  bonus = Math.max(0, Math.min(ASSUMPTIONS.bonusCap, bonus));
  const baseFloorArea = siteArea * far; const bonusFloorArea = baseFloorArea * bonus; const totalFloorArea = (baseFloorArea + bonusFloorArea) * (1 + exempt);
  const footprint = siteArea * bcr; const floors = footprint > 0 ? Math.ceil(totalFloorArea / footprint) : 0; const height = floors * ASSUMPTIONS.floorHeight;
  const years = permits.map(p => +p.year_minguo).filter(Number.isFinite); const oldest = years.length ? Math.min(...years) + 1911 : null; const age = oldest ? new Date().getFullYear() - oldest : null;
  const density = siteArea ? parcels.length / (siteArea / 1000) : 0; const difficulty = parcels.length === 0 ? '—' : density > 6 ? '高（地號多、整合門檻高）' : density > 2.5 ? '中' : '低（地號少、整合較易）';
  return { siteArea, parcelArea, parcelCount: parcels.length, covered, zoning, farKnown, far, bcr, bonus, exempt, baseFloorArea, bonusFloorArea, totalFloorArea, footprint, floors, height, permits: permits.length, oldestYear: oldest, age, difficulty,
    ping: v => v / 3.3058, notes: [farKnown ? `容積率 ${Math.round(far * 100)}% / 建蔽率 ${Math.round(bcr * 100)}% 取自臺北市使用分區管制對照表（${zoning.zone_short || zoning.zone_code}）` : `本分區為特定區或查無法定容積，暫以住三 225% / 45% 估算 —— 需查細部計畫`, `都更容積獎勵上限以《都市更新條例》§65 基準容積 1.5 倍估（此處 ${Math.round(bonus * 100)}%）`, `免計容積（機電、陽台、梯廳等）暫以 ${Math.round(exempt * 100)}% 計；樓高 ${ASSUMPTIONS.floorHeight} m/層`, '地號、分區、建照套繪皆為 FUNRAISE MCP land-info 查詢結果；產權人數需另拉土地謄本（付費）'] };
}

export class RenewalEnvelope {
  constructor(viewer) { this.viewer = viewer; this.ds = new Cesium.CustomDataSource('renewal-sim'); viewer.dataSources.add(this.ds); this.h = 0; this.target = 0; this.t0 = 0; }
  show(unit, height) { this.ds.entities.removeAll(); const rings = unit.rings || []; if (!rings.length) return; this.h = this.h || 1; this.from = this.h; this.target = Math.max(4, height); this.t0 = performance.now();
    const prog = () => Math.min(1, (performance.now() - this.t0) / 900); const cur = () => this.from + (this.target - this.from) * (1 - Math.pow(1 - prog(), 3));
    for (const ring of rings) { const flat = []; for (const q of ring) flat.push(q[0], q[1]); if (flat.length < 6) continue;
      this.ds.entities.add({ polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)), height: 0, extrudedHeight: new Cesium.CallbackProperty(() => { this.h = cur(); return this.h; }, false), material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C('#16A4C0', 0.22 + 0.08 * Math.sin(performance.now() / 500)), false)), outline: true, outlineColor: C('#93DCE6', .95), outlineWidth: 2 } }); }
    const c = unit._c || (() => { let x = 0, y = 0, n = 0; for (const q of rings[0]) { x += q[0]; y += q[1]; n++; } return [x / n, y / n]; })();
    this.ds.entities.add({ position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(c[0], c[1], this.h + 14), false), label: { text: new Cesium.CallbackProperty(() => `都更量體試算 · ${Math.round(this.h / ASSUMPTIONS.floorHeight)} 層 · ${Math.round(this.h)} m`, false), font: '600 12px "SF Mono", ui-monospace, monospace', fillColor: C('#E3F8FA'), outlineColor: C('#063344', .9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, showBackground: true, backgroundColor: C('#0C83A2', .85), backgroundPadding: new Cesium.Cartesian2(8, 4), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  }
  clear() { this.ds.entities.removeAll(); this.h = 0; }
}
