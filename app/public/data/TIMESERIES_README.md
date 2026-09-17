# Taipei Yearly Time-Series — 睿鏡 PeakLens 時光機

Generated: 2026-09-17T06:15Z (Asia/Taipei query date 2026-09-17)

Source: FUNRAISE MCP (Funraise Data Team) — `search_actual_sales` (內政部實價登錄, 2012–) and
`search_taipei_building_licenses` (臺北市建造執照). Output file: `timeseries.json` (9.8 KB).

## What this is

Per-district (12 Taipei districts), per-year (2012–2026) counts for three series:

- **`sales_all`** — all real-estate sale transactions (實價登錄買賣), any `main_use`.
- **`sales_office`** — sale transactions registered with `main_use = 辦公用` (office use).
- **`licenses`** — Taipei building-license (建照) counts by `license_year` (ROC) and district.

2026 is **year-to-date** (data queried 2026-09-17), not a full year — do not compare it directly
to complete prior years without adjusting for the ~8.5-month partial period.

## Method

1. **Transactions (`sales_all`, `sales_office`)**: `search_actual_sales` was called with
   `{city:'台北市', district, since:'YYYY-01-01', limit:1}` (and `main_use:'辦公用'` for the office
   series) for `since` = 2012-01-01 … 2027-01-01 (16 values per district per series). Each call's
   `total` is the cumulative count of matching transactions from `since` through the query date.
   Annual counts were reconstructed by consecutive differencing:
   `count(district, Y) = total(since=Y-01-01) − total(since=(Y+1)-01-01)`, for Y = 2012…2025.
   **2026 is not differenced** — it is `total(since=2026-01-01)` directly (YTD).
2. **Building licenses (`licenses`)**: `search_taipei_building_licenses` with
   `{license_year: <ROC 101-115>, address: <district>, limit:1}`; `total` is already a direct
   per-year count (no differencing needed). ROC 101–115 ↔ 2012–2026.
3. Every differenced/cumulative value was checked for monotonicity (a later `since` must not
   exceed an earlier one); any violation was re-queried before being accepted. Telescoping sums of
   the reconstructed annual series were checked against the all-time cumulative total district by
   district (both must match exactly) before this file was assembled.

## Important method deviation: the 10,000-cap on `sales_all`

The task's original method assumed `search_actual_sales`'s `total` is always exact. **It is not**:
`total` is capped at exactly **10,000 as a lower bound** (the API marks this with
`total_is_lower_bound: true`) whenever the true matching count exceeds it. Every one of the 12
districts hits this cap at `since=2012-01-01` for the unfiltered `sales_all` series (cumulative
counts back to 2012 range from ~33,000 to ~47,000 in the busiest districts), and the cap persists
for several more years of `since` in each district before the shrinking cumulative window drops
below 10,000 naturally (2012–2018 for the lightest districts, 2012–2022 for the busiest).
`sales_office` and `licenses` never approach this limit (max observed ≈750 and ≈48 respectively),
so they required no correction.

**Workaround**: for every capped `(district, since)` cell, the query was re-run split into 4–8
mutually exclusive, exhaustive price bands using `min_total_price`/`max_total_price` (NTD,
integer bounds), each of which returns a count safely under 10,000 (hence exact), and the bands
were summed to reconstruct the true cumulative total. Band scheme was calibrated once per district
at the worst case (`since=2012-01-01`) and reused for that district's other capped years, since
cumulative counts only shrink as `since` advances:

| Bands | Boundaries (NTD) | Districts |
|---|---|---|
| 4 | ≤15M, 15M+1–30M, 30M+1–60M, >60M | 中正區, 大同區, 松山區, 南港區 |
| 5 | ≤8M, 8M+1–15M, 15M+1–30M, 30M+1–60M, >60M | 萬華區, 信義區, 士林區, 北投區 |
| 6 | ≤8M, 8M+1–15M, 15M+1–22M, 22M+1–30M, 30M+1–60M, >60M | 大安區, 內湖區, 文山區 |
| 8 | ≤4M, 4M+1–8M, 8M+1–11M, 11M+1–15M, 15M+1–22M, 22M+1–30M, 30M+1–60M, >60M | 中山區 |

This reconstruction covers 113 district×since cells across the 12 districts (all fully resolved —
no cell was left capped/approximate in the final output).

## Other caveats

- **`main_use='辦公用'` is a registered-use filter, not a building-type filter.** Offices are
  frequently registered inside residential towers (住宅大樓) or 華廈, not just in buildings typed
  as commercial/office — filtering on `building_type` instead would silently undercount.
- **`sales_office` is near-zero for 2012–2016 in every one of the 12 districts**, then ramps up
  from ~2017 onward (spot-checked and confirmed against live queries, not a collection artifact).
  This looks like a genuine characteristic of `main_use` tagging coverage in the earliest years of
  the 實價登錄 dataset rather than an actual absence of office transactions; treat 2012–2016
  `sales_office` figures as materially less reliable than later years.
- **`licenses` counts include multiple license/construction types** — sampled records show
  新建, 增建, 修建, and 變更 all present under the same `license_year`+district query; this series
  is a mix of new-build and modification/change permits, not new-construction starts alone, and is
  not equivalent to actual construction starts or completions.
- **`alltime`** (in the output JSON) is each district's full cumulative count from 2012-01-01
  through the query date (2026-09-17), for `sales_all` and `sales_office` only (`licenses` has no
  cumulative `total` to reconstruct from, so no `alltime.licenses`).

## City totals per year

| Year | sales_all | sales_office | licenses |
|---|---|---|---|
| 2012 | 14,534 | 1 | 307 |
| 2013 | 34,705 | 1 | 311 |
| 2014 | 27,175 | 6 | 284 |
| 2015 | 22,071 | 7 | 275 |
| 2016 | 18,325 | 13 | 207 |
| 2017 | 21,133 | 150 | 213 |
| 2018 | 22,576 | 710 | 229 |
| 2019 | 26,170 | 703 | 234 |
| 2020 | 29,807 | 807 | 271 |
| 2021 | 28,373 | 674 | 340 |
| 2022 | 22,966 | 550 | 333 |
| 2023 | 23,696 | 549 | 270 |
| 2024 | 24,456 | 578 | 244 |
| 2025 | 18,522 | 395 | 202 |
| 2026 (YTD) | 8,693 | 175 | 98 |

`sales_all` city-wide total 2012–2026 (YTD): 343,202. `sales_office`: 5,319. `licenses`: 3,818.

## Output schema (`timeseries.json`)

```
{
  meta: { generated_at, source, method, years[15], roc_years[15], ytd_year: 2026, notes[] },
  districts: [12 district names],
  sales_all:    { district: [15 annual counts, 2012..2026] },
  sales_office: { district: [15 annual counts, 2012..2026] },
  licenses:     { district: [15 annual counts, 2012..2026] },
  city: { sales_all[15], sales_office[15], licenses[15] },
  alltime: { district: { sales_all, sales_office } },
  peaks: { sales_all: {district: peakYear}, sales_office: {...}, licenses: {...} },
  yoy:   { sales_all: {district: [null, pct...]}, sales_office: {...}, licenses: {...} }
}
```

`yoy` is percent change vs. the prior year, rounded to 1 decimal; `null` for 2012 (no prior year)
and for any year immediately following a zero-count year (percent change undefined).

## Data collection stats

- ~1,190 MCP tool calls total: 564 baseline `total` look-ups (12 districts × (16 `sales_all` +
  16 `sales_office` + 15 `license_year` since/year values)), 599 price-band sub-queries to
  reconstruct the 113 capped `sales_all` cells, and roughly 30 additional re-verification calls
  triggered by monotonicity checks during collection (per the task's required sanity-check
  protocol) and a final spot-check against live data before this file was written.
- No nulls in the final output — every district/year/series resolved to a concrete integer.
