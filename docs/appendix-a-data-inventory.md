# 附錄 A · FUNRAISE MCP 工具盤點（2026-09-14，連接器「Funraise Data Team」）

依資料域列出工具與（工具說明自述的）規模。★ 表示本輪原型實際呼叫過。

| 資料域 | 工具 | 規模／備註 |
|---|---|---|
| actual-price-sale | search_actual_sales ★、get_actual_sale、aggregate_sales_by_district ★ | 2012 迄今約 477 萬筆；地址子串比對；無座標欄位 |
| actual-price-rental | search_actual_rentals ★、get_actual_rental | 索引無交易日期（`since` 為載入日） |
| actual-price-presale | search_presales、get_presale | 預售屋備查 |
| buildings | search_buildings ★、get_building ★ | 5,488 棟（新北 2,589／台北 2,254／台中 645）；A/B/F/P；照片五尺寸 |
| ai-info | search_knowledge ★、get_knowledge | 22,199 筆（building_qa 19,955／building_summary 2,232） |
| areas | list_areas ★、get_area、search_areas | 105 筆（70 行政區／25 園區／10 商圈），含租售季線與產業結構 |
| cities | list_cities ★、get_city | 22 縣市與公司數 |
| business-registry | search_business_registry、get_business | 約 76 萬筆現況 |
| company-registry | search_registry_changes ★、get_company_history、aggregate_registry_changes | 資本額／地址／負責人／新設／解散異動；2013-01 至 2026-07 |
| key-enterprise | search_key_enterprises ★、get_key_enterprise | 商辦重點承租戶（非屋主） |
| mops-property | search_mops_property ★、get_mops_property | 2024-12～2026-09 共 6,055 筆取得／處分資產 |
| stakeholders | search_stakeholders、get_stakeholder | 94 筆（建商 79） |
| providers | list_providers ★、get_provider | 39 家生態系服務商 |
| urban-renewal | search ★、get ★、aggregate ★、urban_renewal_at_point | 全台約 3,500 筆含圖形 |
| development-zones | search ★、get、aggregate、development_zone_at_point | 市地重劃／區段徵收約 1,011 筆 |
| industrial-parks | search ★、get、aggregate、industrial_park_at_point、companies_in_industrial_park、parcels_in_industrial_park | 212 個園區 |
| land-info | coordinates_by_address ★、coordinates_by_landno、land_boundary、land_boundaries_batch、find_taipei_land_at_point、get_taipei_land_polygon、taipei_zoning_at_point ★、taipei_zoning_at_landno、taipei_zoning_regulation_get、taipei_bldg_overlay_at_point／by_permit、list_cities／areas／sections | 台北分區約 15,500 圖形＋法規；全台地號轉座標 |
| newtaipei-cadastral | search_parcels、search_parcels_near、get_parcel | 新北地籤宗地（含邊界） |
| taipei-licenses | search_taipei_building_licenses ★、search_taipei_use_licenses、get_license、get_license_images | 建照／使照與圖說影像；起造人遮罩 |
| future-dev | search_future_dev ★、get_future_dev | 119 案，逐層用途／面積／高度 |
| public-infras | search_public_infras ★、get_public_infra ★ | 143 筆興建中／規劃中（捷運 130） |
| mrt | list_mrt_stations ★、get_mrt_station ★ | 台北捷運 118 站＋385 出入口 |
| transcripts | moi_address_lookup、moi_address_to_landno、crawl_land／building_transcript、get_*、cadastral／survey maps、pending sections、query logs | 謄本線上調閱（付費動作，原型未呼叫） |
| dd-memo | find_property_lifecycle ★ | 預售→成交→建照／使照 時序 |
| rtube | search_rtube_listings、get_rtube_listing | 掛牌約 8.3 萬筆（住宅 67,633／土地 8,602／店面 6,288／廠房 757） |
| properties | search_properties、get_property | 591 來源約 3.4 萬筆 |
| blog／ecosystem-blog | list／search／get | 市場觀測、佈局策略、建物趨勢 |
| ga4／gsc | list_properties ★、run_report ★、list_sites ★、search_analytics | PickPeak／官網／MCP／BizPeak／睿星／希睿 |

## 對睿鏡最關鍵的六個「獨家層」
1. 資本流：MOPS 取得／處分資產（買賣方類型、金額、坪數）。
2. 企業遷徙：公司登記地址異動（跨市／跨區）＋增資訊號。
3. 供給前瞻：建照（24–48 月）＋未來開發（逐層用途、完工年）。
4. 更新與重劃：都更單元圖形（政府主導標記）＋重劃／區段徵收。
5. 可建強度：使用分區＋容積／建蔽法規即問即答（台北）。
6. 承租結構：重點企業承租戶 × 產業 × 資本額。
