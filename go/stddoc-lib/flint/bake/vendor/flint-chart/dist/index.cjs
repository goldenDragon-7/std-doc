'use strict';

// src/core/types.ts
var channels = [
  "x",
  "y",
  "x2",
  "y2",
  "id",
  "color",
  "opacity",
  "size",
  "shape",
  "strokeDash",
  "column",
  "row",
  "latitude",
  "longitude",
  "radius",
  "detail",
  "group",
  "open",
  "high",
  "low",
  "close",
  "angle",
  // Connected Scatter Plot: the sequence field that defines the line's
  // connection order (the trajectory), independent of the x value.
  "order",
  // KPI Card: one row per tile, no chart axes.
  "metric",
  "value",
  "goal"
];
var channelGroups = {
  "": ["x", "x2", "y", "y2", "latitude", "longitude", "id", "radius", "detail", "order"],
  "legends": ["color", "group", "size", "shape", "text", "opacity", "strokeDash"],
  "price": ["open", "high", "low", "close"],
  "facets": ["column", "row"],
  "kpi": ["metric", "value", "goal"]
};

// src/core/encoding-overrides.ts
function applyEncodingOverrides(template, encodings, chartProperties) {
  const actions = template.encodingActions;
  if (!actions || actions.length === 0 || !chartProperties) return encodings;
  let result = encodings;
  for (const action of actions) {
    const override = chartProperties[action.key];
    if (override !== void 0) {
      result = action.set(result, override);
    }
  }
  return result;
}

// src/core/pivot.ts
var DISCRETE_TYPES = /* @__PURE__ */ new Set(["nominal", "ordinal"]);
function isDiscrete(enc) {
  return !!enc?.field && !!enc.type && DISCRETE_TYPES.has(enc.type);
}
function isMeasure(enc) {
  return !!enc?.field && (enc.type === "quantitative" || !!enc.aggregate);
}
function isTemporal(enc) {
  return enc?.type === "temporal";
}
function temporalActsDiscrete(template) {
  return template.markCognitiveChannel !== "position";
}
function clone(encodings) {
  const out = {};
  for (const [ch, enc] of Object.entries(encodings)) {
    out[ch] = { ...enc };
  }
  return out;
}
function distinctCount(data, field) {
  if (!field || !Array.isArray(data)) return 0;
  const seen = /* @__PURE__ */ new Set();
  for (const row of data) {
    if (row && row[field] != null) seen.add(row[field]);
  }
  return seen.size;
}
function makeCartesianPivot(opts = {}) {
  return {
    key: opts.key ?? "pivot",
    label: opts.label ?? "View",
    transpose: opts.transpose ?? [],
    permute: opts.permute ?? [],
    shift: opts.shift ?? [],
    facetBudget: opts.facetBudget ?? 12,
    transitions: opts.transitions
  };
}
var CHANNEL_ORDER = ["x", "y", "color", "size", "group", "column", "row"];
function orderPair(a, b) {
  const ia = CHANNEL_ORDER.indexOf(a);
  const ib = CHANNEL_ORDER.indexOf(b);
  return ia <= ib ? [a, b] : [b, a];
}
function transposeState(base, template, pair) {
  const [a, b] = orderPair(pair[0], pair[1]);
  const ea = base[a];
  const eb = base[b];
  if (!ea?.field || !eb?.field) return null;
  if (!temporalActsDiscrete(template) && (isTemporal(ea) || isTemporal(eb))) return null;
  const next = clone(base);
  next[a] = { ...eb };
  next[b] = { ...ea };
  return { id: `flip:${a}-${b}`, label: `\u03C4_${a}\u2194${b}`, enc: next };
}
function channelProfile(enc, template) {
  if (!enc?.field) return null;
  if (isMeasure(enc)) return "measure";
  if (isDiscrete(enc) || isTemporal(enc) && temporalActsDiscrete(template)) return "category";
  return "time";
}
function permuteSwapState(base, template, pair) {
  const [a, b] = orderPair(pair[0], pair[1]);
  const posCh = a === "x" || a === "y" ? a : null;
  const auxCh = b;
  if (!posCh || auxCh !== "color" && auxCh !== "size") return null;
  const posEnc = base[posCh];
  const auxEnc = base[auxCh];
  if (!posEnc?.field || !auxEnc?.field) return null;
  if (posEnc.field === auxEnc.field) return null;
  const profile = channelProfile(posEnc, template);
  if (!profile || profile !== channelProfile(auxEnc, template)) return null;
  const id = `swap:${a}-${b}`;
  const label = `\u03C3_${a}\u2194${b}`;
  if (profile === "measure") {
    if (template.markCognitiveChannel !== "position") return null;
    const next = clone(base);
    next[posCh] = measureCore(auxEnc);
    next[auxCh] = measureCore(posEnc);
    return { id, label, enc: next };
  }
  if (profile === "category") {
    if (auxCh !== "color") return null;
    const next = clone(base);
    next[posCh] = { ...auxEnc };
    next.color = { ...posEnc };
    return { id, label, enc: next };
  }
  return null;
}
function measureCore(enc) {
  const core = { field: enc.field, type: enc.type };
  if (enc.aggregate) core.aggregate = enc.aggregate;
  return core;
}
var GROUPING_CHANNELS = ["color", "group", "column", "row"];
function routeBudget(target, facetBudget) {
  if (target === "column" || target === "row") return facetBudget;
  if (target === "group") return 12;
  return 20;
}
function routeLabel(target) {
  return `\u03B3_\u2192${target}`;
}
function findSeries(base, candidates, channels2) {
  for (const ch of candidates) {
    if (channels2.includes(ch) && isDiscrete(base[ch])) {
      return { channel: ch, enc: base[ch] };
    }
  }
  return null;
}
function seriesRoutingStates(base, template, data, shiftChannels, facetBudget) {
  const channels2 = template.channels ?? [];
  const src = findSeries(base, shiftChannels, channels2);
  if (!src) return [];
  const card = distinctCount(data, src.enc.field);
  const out = [];
  for (const target of shiftChannels) {
    if (target === src.channel) continue;
    if (!channels2.includes(target)) continue;
    if (base[target]?.field) continue;
    if (card > routeBudget(target, facetBudget)) continue;
    const next = clone(base);
    delete next[src.channel];
    next[target] = { ...src.enc };
    out.push({ id: `series:${target}`, enc: next, label: routeLabel(target) });
  }
  return out;
}
function transitionState(base, data, template, t) {
  const enc = clone(base);
  const route = t.route;
  if (route) {
    const fromCh = route.from === "series" ? findSeries(base, GROUPING_CHANNELS, template.channels ?? [])?.channel : route.from;
    if (!fromCh) return null;
    const srcEnc = base[fromCh];
    if (!srcEnc?.field) return null;
    if (t.requireDiscreteSource && !isDiscrete(srcEnc)) return null;
    if (t.maxSourceCardinality != null && distinctCount(data, srcEnc.field) > t.maxSourceCardinality) return null;
    const mode = route.mode ?? "move";
    const dstEnc = base[route.to];
    if (mode === "swap") {
      const spillCh = route.spill ?? fromCh;
      if (spillCh !== fromCh && base[spillCh]?.field) return null;
      enc[route.to] = { ...srcEnc };
      delete enc[fromCh];
      if (dstEnc?.field) enc[spillCh] = { ...dstEnc };
      else delete enc[spillCh];
    } else {
      if (dstEnc?.field) return null;
      delete enc[fromCh];
      enc[route.to] = { ...srcEnc };
    }
  }
  return { enc, chartType: t.to, label: t.label };
}
function pivotSteps(template, enc, data) {
  const def = template.pivot;
  if (!def) return [];
  const steps = [];
  for (const pair of def.transpose ?? []) {
    if (pair.length !== 2) continue;
    const s = transposeState(enc, template, [pair[0], pair[1]]);
    if (s) steps.push({ id: s.id, label: s.label, enc: s.enc });
  }
  for (const block of def.permute ?? []) {
    for (let i = 0; i < block.length; i++) {
      for (let j = i + 1; j < block.length; j++) {
        const s = permuteSwapState(enc, template, [block[i], block[j]]);
        if (s) steps.push({ id: s.id, label: s.label, enc: s.enc });
      }
    }
  }
  if (def.shift && def.shift.length) {
    for (const s of seriesRoutingStates(enc, template, data, def.shift, def.facetBudget ?? 12)) {
      steps.push({ id: s.id, label: s.label, enc: s.enc });
    }
  }
  if (def.transitions) {
    for (const t of def.transitions) {
      const st = transitionState(enc, data, template, t);
      if (st) steps.push({ id: `type:${t.to}`, label: `\u03B8_\u2192${t.label.toLowerCase()}`, enc: st.enc, chartType: st.chartType });
    }
  }
  return steps;
}
function encodingKey(enc, chartType) {
  const cells = Object.keys(enc).filter((ch) => enc[ch]?.field).sort().map((ch) => {
    const e = enc[ch];
    return `${ch}=${e.field}/${e.type ?? ""}/${e.aggregate ?? ""}`;
  });
  return `${chartType ?? ""}::${cells.join(",")}`;
}
function isRenderableState(template, enc) {
  const channels2 = template.channels ?? [];
  if (channels2.includes("x") && channels2.includes("y")) {
    if (!enc.x?.field || !enc.y?.field) return false;
  }
  return true;
}
var MAX_PIVOT_STATES = 12;
function computePivot(template, base, data, resolveTemplate) {
  const def = template.pivot;
  if (!def) return null;
  const key = def.key ?? "pivot";
  const label = def.label ?? "View";
  const ids = ["default"];
  const labels = ["Default"];
  const statesById = {
    default: clone(base)
  };
  const chartTypeById = {
    default: void 0
  };
  const seen = /* @__PURE__ */ new Set([encodingKey(base, void 0)]);
  const queue = [{ id: "default", label: "Default", enc: clone(base), chartType: void 0, template }];
  const authoredChart = template.chart;
  while (queue.length > 0 && ids.length < MAX_PIVOT_STATES) {
    const cur = queue.shift();
    for (const step of pivotSteps(cur.template, cur.enc, data)) {
      let nextChartType = step.chartType ?? cur.chartType;
      if (nextChartType === authoredChart) nextChartType = void 0;
      const resolved = step.chartType ? resolveTemplate?.(step.chartType) : void 0;
      const nextTemplate = step.chartType ? resolved ?? { ...cur.template, pivot: void 0 } : cur.template;
      if (!isRenderableState(nextTemplate, step.enc)) continue;
      const fp = encodingKey(step.enc, nextChartType);
      if (seen.has(fp)) continue;
      seen.add(fp);
      const id = cur.id === "default" ? step.id : `${cur.id}|${step.id}`;
      const stepLabel = cur.id === "default" ? step.label : `${cur.label} \xB7 ${step.label}`;
      ids.push(id);
      labels.push(stepLabel);
      statesById[id] = step.enc;
      chartTypeById[id] = nextChartType;
      queue.push({ id, label: stepLabel, enc: step.enc, chartType: nextChartType, template: nextTemplate });
      if (ids.length >= MAX_PIVOT_STATES) break;
    }
  }
  return { key, label, ids, labels, statesById, chartTypeById };
}
function applyPivot(template, base, data, chartProperties, resolveTemplate) {
  const comp = computePivot(template, base, data, resolveTemplate);
  if (!comp || comp.ids.length <= 1) {
    return { encodings: base, chartType: void 0, surface: void 0 };
  }
  const stored = chartProperties?.[comp.key];
  const id = typeof stored === "string" && comp.ids.includes(stored) ? stored : comp.ids[0];
  const index = comp.ids.indexOf(id);
  return {
    encodings: comp.statesById[id],
    chartType: comp.chartTypeById[id],
    surface: {
      key: comp.key,
      label: comp.label,
      length: comp.ids.length,
      index,
      ids: comp.ids,
      labels: comp.labels
    }
  };
}

// src/core/encoding-actions.ts
var isMeasureEnc = (e) => !!e?.field && (!!e.aggregate || e.type === "quantitative");
var isDiscreteCategoryEnc = (e) => !!e?.field && !e.aggregate && e.type !== "quantitative" && e.type !== "temporal";
function resolveSortChannels(encodings, candidates) {
  const category = candidates.find((c) => isDiscreteCategoryEnc(encodings[c]));
  const measure = candidates.find((c) => isMeasureEnc(encodings[c]));
  if (!category || !measure || category === measure) return null;
  return { category, measure };
}
function makeSortAction(options) {
  const candidates = options?.channels ?? ["x", "y"];
  return {
    key: options?.key ?? "sort",
    label: options?.label ?? "Sort",
    dependencies: candidates,
    isApplicable: (ctx) => resolveSortChannels(ctx.encodings, candidates) !== null,
    control: {
      type: "discrete",
      options: [
        { value: void 0, label: "Default" },
        { value: "value-desc", label: "Value \u2193" },
        { value: "value-asc", label: "Value \u2191" }
      ]
    },
    get: (encodings) => {
      const resolved = resolveSortChannels(encodings, candidates);
      if (!resolved) return void 0;
      const { category, measure } = resolved;
      const enc = encodings[category];
      if (enc.sortBy === measure) {
        return enc.sortOrder === "descending" ? "value-desc" : "value-asc";
      }
      return void 0;
    },
    set: (encodings, value) => {
      const resolved = resolveSortChannels(encodings, candidates);
      if (!resolved) return encodings;
      const { category, measure } = resolved;
      const base = encodings[category];
      let next;
      switch (value) {
        case "value-asc":
          next = { ...base, sortBy: measure, sortOrder: "ascending" };
          break;
        case "value-desc":
          next = { ...base, sortBy: measure, sortOrder: "descending" };
          break;
        default:
          next = { ...base, sortBy: void 0, sortOrder: void 0 };
      }
      return { ...encodings, [category]: next };
    }
  };
}

// src/core/axis-detection.ts
var isDiscrete2 = (type) => type === "nominal" || type === "ordinal";
var getFieldCardinality = (field, table) => new Set(table.map((row) => row[field]).filter((value) => value != null)).size;
function resolveDiscreteType(currentType, field, table) {
  if (currentType === "nominal") return "nominal";
  if (currentType === "ordinal") return "ordinal";
  if (currentType === "temporal") return "ordinal";
  if (currentType === "quantitative" && field && table.length > 0) {
    return getFieldCardinality(field, table) <= 20 ? "ordinal" : "nominal";
  }
  return "nominal";
}
function detectBandedAxisFromSemantics(channelSemantics, table, options = {}) {
  const xType = channelSemantics.x?.type;
  const yType = channelSemantics.y?.type;
  if (xType && isDiscrete2(xType)) return { axis: "x" };
  if (yType && isDiscrete2(yType)) return { axis: "y" };
  if (xType && yType) {
    if (xType === "quantitative" && yType !== "quantitative") {
      return { axis: "y" };
    }
    if (yType === "quantitative" && xType !== "quantitative") {
      return { axis: "x" };
    }
    return { axis: options.preferAxis || "x" };
  }
  if (xType) {
    const newType = resolveDiscreteType(xType, channelSemantics.x?.field, table);
    return { axis: "x", resolvedTypes: { x: newType } };
  }
  if (yType) {
    const newType = resolveDiscreteType(yType, channelSemantics.y?.field, table);
    return { axis: "y", resolvedTypes: { y: newType } };
  }
  return null;
}
function detectBandedAxisForceDiscrete(channelSemantics, table, options = {}) {
  const result = detectBandedAxisFromSemantics(channelSemantics, table, options);
  if (!result) return null;
  const axis = result.axis;
  const semantics = channelSemantics[axis];
  if (!semantics) return result;
  if (!isDiscrete2(semantics.type)) {
    const newType = resolveDiscreteType(semantics.type, semantics.field, table);
    return {
      axis,
      resolvedTypes: { ...result.resolvedTypes, [axis]: newType }
    };
  }
  return result;
}

// src/core/band-dodge.ts
var DEFAULT_NESTED_SNAP_THRESHOLD = 0.9;
function recommendMode(maxPerBand, globalCount, nestedFraction, threshold) {
  if (maxPerBand <= 1) return "none";
  if (nestedFraction >= threshold) return "none";
  if (maxPerBand >= globalCount) return "global";
  return "local";
}
function planBandDodge(table, axisField, subField, options) {
  const perBand = /* @__PURE__ */ new Map();
  const global = /* @__PURE__ */ new Set();
  for (const row of table) {
    global.add(row[subField]);
    const key = row[axisField];
    let bandSet = perBand.get(key);
    if (!bandSet) perBand.set(key, bandSet = /* @__PURE__ */ new Set());
    bandSet.add(row[subField]);
  }
  const globalCount = Math.max(1, global.size);
  const bandCount = perBand.size;
  let maxPerBand = 0;
  let singleValuedBands = 0;
  for (const bandSet of perBand.values()) {
    if (bandSet.size > maxPerBand) maxPerBand = bandSet.size;
    if (bandSet.size <= 1) singleValuedBands++;
  }
  const threshold = options?.nestedSnapThreshold ?? DEFAULT_NESTED_SNAP_THRESHOLD;
  const nestedFraction = bandCount > 0 ? singleValuedBands / bandCount : 1;
  const mode = recommendMode(maxPerBand, globalCount, nestedFraction, threshold);
  return {
    mode,
    dodge: mode !== "none",
    laneCount: globalCount,
    ambiguous: maxPerBand > 1,
    maxPerBand,
    global: globalCount,
    bandCount
  };
}
function laneCountForMode(plan, mode) {
  if (mode === "global") return plan.global;
  if (mode === "local") return Math.max(1, plan.maxPerBand);
  return 1;
}
function resolveDodge(plan, override) {
  let mode = override === "none" || override === "local" || override === "global" ? override : plan.mode;
  if (mode !== "none" && plan.maxPerBand <= 1) mode = "none";
  return { mode, laneCount: laneCountForMode(plan, mode) };
}
function resolveBandDodge(plan, override) {
  const normalized = override === "dodge" ? "global" : override === "nested" ? "none" : override;
  const { mode } = resolveDodge(plan, normalized);
  return { dodge: mode !== "none", laneCount: plan.laneCount };
}

// src/core/type-registry.ts
var TYPE_REGISTRY = {
  // --- Temporal: DateTime ---
  DateTime: { t0: "Temporal", t1: "DateTime", visEncodings: ["temporal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Date: { t0: "Temporal", t1: "DateTime", visEncodings: ["temporal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Time: { t0: "Temporal", t1: "DateTime", visEncodings: ["temporal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Timestamp: { t0: "Temporal", t1: "DateTime", visEncodings: ["temporal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  // --- Temporal: DateGranule ---
  Year: { t0: "Temporal", t1: "DateGranule", visEncodings: ["temporal", "ordinal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "integer", zeroBaseline: "arbitrary", zeroPad: 0.03 },
  Quarter: { t0: "Temporal", t1: "DateGranule", visEncodings: ["ordinal"], aggRole: "dimension", domainShape: "cyclic", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Month: { t0: "Temporal", t1: "DateGranule", visEncodings: ["ordinal"], aggRole: "dimension", domainShape: "cyclic", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Week: { t0: "Temporal", t1: "DateGranule", visEncodings: ["ordinal"], aggRole: "dimension", domainShape: "cyclic", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Day: { t0: "Temporal", t1: "DateGranule", visEncodings: ["ordinal"], aggRole: "dimension", domainShape: "cyclic", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Hour: { t0: "Temporal", t1: "DateGranule", visEncodings: ["ordinal"], aggRole: "dimension", domainShape: "cyclic", diverging: "none", formatClass: "integer", zeroBaseline: "arbitrary", zeroPad: 0 },
  YearMonth: { t0: "Temporal", t1: "DateGranule", visEncodings: ["temporal", "ordinal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  YearQuarter: { t0: "Temporal", t1: "DateGranule", visEncodings: ["temporal", "ordinal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  YearWeek: { t0: "Temporal", t1: "DateGranule", visEncodings: ["temporal", "ordinal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Decade: { t0: "Temporal", t1: "DateGranule", visEncodings: ["temporal", "ordinal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "integer", zeroBaseline: "arbitrary", zeroPad: 0.03 },
  // --- Temporal: Duration ---
  Duration: { t0: "Temporal", t1: "Duration", visEncodings: ["quantitative"], aggRole: "additive", domainShape: "open", diverging: "none", formatClass: "unit-suffix", zeroBaseline: "meaningful", zeroPad: 0 },
  // --- Measure: Amount ---
  Amount: { t0: "Measure", t1: "Amount", visEncodings: ["quantitative"], aggRole: "additive", domainShape: "open", diverging: "none", formatClass: "currency", zeroBaseline: "meaningful", zeroPad: 0 },
  Price: { t0: "Measure", t1: "Amount", visEncodings: ["quantitative"], aggRole: "intensive", domainShape: "open", diverging: "none", formatClass: "currency", zeroBaseline: "meaningful", zeroPad: 0 },
  // --- Measure: Physical ---
  Quantity: { t0: "Measure", t1: "Physical", visEncodings: ["quantitative"], aggRole: "additive", domainShape: "open", diverging: "none", formatClass: "unit-suffix", zeroBaseline: "meaningful", zeroPad: 0 },
  Temperature: { t0: "Measure", t1: "Physical", visEncodings: ["quantitative"], aggRole: "intensive", domainShape: "open", diverging: "conditional", formatClass: "unit-suffix", zeroBaseline: "arbitrary", zeroPad: 0.05 },
  // --- Measure: Proportion ---
  Percentage: { t0: "Measure", t1: "Proportion", visEncodings: ["quantitative"], aggRole: "intensive", domainShape: "bounded", diverging: "none", formatClass: "percent", zeroBaseline: "contextual", zeroPad: 0 },
  // --- Measure: SignedMeasure ---
  Profit: { t0: "Measure", t1: "SignedMeasure", visEncodings: ["quantitative"], aggRole: "signed-additive", domainShape: "open", diverging: "conditional", formatClass: "decimal", zeroBaseline: "meaningful", zeroPad: 0 },
  PercentageChange: { t0: "Measure", t1: "SignedMeasure", visEncodings: ["quantitative"], aggRole: "intensive", domainShape: "open", diverging: "conditional", formatClass: "percent", zeroBaseline: "contextual", zeroPad: 0.05 },
  Sentiment: { t0: "Measure", t1: "SignedMeasure", visEncodings: ["quantitative"], aggRole: "intensive", domainShape: "open", diverging: "inherent", formatClass: "decimal", zeroBaseline: "meaningful", zeroPad: 0 },
  Correlation: { t0: "Measure", t1: "SignedMeasure", visEncodings: ["quantitative"], aggRole: "intensive", domainShape: "bounded", diverging: "inherent", formatClass: "decimal", zeroBaseline: "meaningful", zeroPad: 0 },
  // --- Measure: GenericMeasure ---
  Count: { t0: "Measure", t1: "GenericMeasure", visEncodings: ["quantitative"], aggRole: "additive", domainShape: "open", diverging: "none", formatClass: "integer", zeroBaseline: "meaningful", zeroPad: 0 },
  Number: { t0: "Measure", t1: "GenericMeasure", visEncodings: ["quantitative"], aggRole: "additive", domainShape: "open", diverging: "none", formatClass: "decimal", zeroBaseline: "meaningful", zeroPad: 0 },
  // --- Discrete ---
  Rank: { t0: "Discrete", t1: "Rank", visEncodings: ["ordinal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "integer", zeroBaseline: "arbitrary", zeroPad: 0.08 },
  Score: { t0: "Discrete", t1: "Score", visEncodings: ["quantitative", "ordinal"], aggRole: "intensive", domainShape: "bounded", diverging: "conditional", formatClass: "decimal", zeroBaseline: "contextual", zeroPad: 0.05 },
  ID: { t0: "Identifier", t1: "ID", visEncodings: ["nominal"], aggRole: "identifier", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "arbitrary", zeroPad: 0 },
  // --- Geographic ---
  Latitude: { t0: "Geographic", t1: "GeoCoordinate", visEncodings: ["quantitative", "geographic"], aggRole: "dimension", domainShape: "fixed", diverging: "none", formatClass: "decimal", zeroBaseline: "arbitrary", zeroPad: 0.02 },
  Longitude: { t0: "Geographic", t1: "GeoCoordinate", visEncodings: ["quantitative", "geographic"], aggRole: "dimension", domainShape: "fixed", diverging: "none", formatClass: "decimal", zeroBaseline: "arbitrary", zeroPad: 0.02 },
  Country: { t0: "Geographic", t1: "GeoPlace", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  State: { t0: "Geographic", t1: "GeoPlace", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  City: { t0: "Geographic", t1: "GeoPlace", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Region: { t0: "Geographic", t1: "GeoPlace", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Address: { t0: "Geographic", t1: "GeoPlace", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  ZipCode: { t0: "Geographic", t1: "GeoPlace", visEncodings: ["nominal"], aggRole: "identifier", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  // --- Categorical: Entity ---
  Category: { t0: "Categorical", t1: "Entity", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Name: { t0: "Categorical", t1: "Entity", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  // --- Categorical: Coded ---
  Status: { t0: "Categorical", t1: "Coded", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Boolean: { t0: "Categorical", t1: "Coded", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "fixed", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  Direction: { t0: "Categorical", t1: "Coded", visEncodings: ["ordinal", "nominal"], aggRole: "dimension", domainShape: "cyclic", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  // --- Categorical: Binned ---
  Range: { t0: "Categorical", t1: "Binned", visEncodings: ["ordinal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 },
  // --- Fallbacks ---
  Unknown: { t0: "Categorical", t1: "Entity", visEncodings: ["nominal"], aggRole: "dimension", domainShape: "open", diverging: "none", formatClass: "plain", zeroBaseline: "none", zeroPad: 0 }
};
var UNKNOWN_ENTRY = {
  t0: "Categorical",
  t1: "Entity",
  visEncodings: ["nominal"],
  aggRole: "dimension",
  domainShape: "open",
  diverging: "none",
  formatClass: "plain",
  zeroBaseline: "none",
  zeroPad: 0
};
function getRegistryEntry(semanticType) {
  return TYPE_REGISTRY[semanticType] ?? UNKNOWN_ENTRY;
}
function isRegistered(semanticType) {
  return semanticType in TYPE_REGISTRY;
}
function getRegisteredTypes() {
  return Object.keys(TYPE_REGISTRY);
}

// src/core/semantic-types.ts
var SemanticTypes = {
  // =========================================================================
  // TEMPORAL TYPES - Time-related concepts
  // =========================================================================
  // Point-in-time (full timestamp precision)
  DateTime: "DateTime",
  // Full date and time: "2024-01-15T14:30:00"
  Date: "Date",
  // Date only: "2024-01-15"
  Time: "Time",
  // Time only: "14:30:00"
  Timestamp: "Timestamp",
  // Unix timestamp (seconds or milliseconds since epoch)
  // Temporal granules (discrete time units, inherently ordered)
  Year: "Year",
  // "2024" (as a time unit, not a measure)
  Quarter: "Quarter",
  // "Q1", "Q2", "2024-Q1"
  Month: "Month",
  // "January", "Jan", 1-12
  Week: "Week",
  // "Week 1", 1-52
  Day: "Day",
  // "Monday", "Mon", 1-31
  Hour: "Hour",
  // 0-23
  // Combined temporal
  YearMonth: "YearMonth",
  // "2024-01", "Jan 2024"
  YearQuarter: "YearQuarter",
  // "2024-Q1"
  YearWeek: "YearWeek",
  // "2024-W01"
  Decade: "Decade",
  // "1990s", "2000s"
  // Temporal duration/span
  Duration: "Duration",
  // Time span: "2 hours", "3 days", milliseconds
  // =========================================================================
  // NUMERIC MEASURE TYPES - Continuous values for aggregation
  // =========================================================================
  Quantity: "Quantity",
  // Generic continuous measure
  Count: "Count",
  // Discrete count of items
  Amount: "Amount",
  // Monetary or general amounts
  Price: "Price",
  // Unit price
  Percentage: "Percentage",
  // 0-100% or 0-1 ratio
  Temperature: "Temperature",
  // Degrees
  // Signed measures (can be positive or negative, zero has meaning)
  Profit: "Profit",
  // Gain/loss, profit/deficit
  PercentageChange: "PercentageChange",
  // Growth rate, change %
  Sentiment: "Sentiment",
  // Positive/negative sentiment score
  Correlation: "Correlation",
  // Positive/negative correlation coefficient
  // =========================================================================
  // NUMERIC DISCRETE TYPES - Numbers with ordinal/identifier meaning
  // =========================================================================
  Rank: "Rank",
  // Position in ordered list: 1st, 2nd, 3rd
  ID: "ID",
  // Unique identifier (not for aggregation!)
  Score: "Score",
  // Rating score: 1-5, 1-10, 0-100
  // =========================================================================
  // GEOGRAPHIC TYPES - Location-based data
  // =========================================================================
  Latitude: "Latitude",
  // -90 to 90
  Longitude: "Longitude",
  // -180 to 180
  Country: "Country",
  // Country name or code
  State: "State",
  // State/Province
  City: "City",
  // City name
  Region: "Region",
  // Geographic region
  Address: "Address",
  // Street address (geo lookup)
  ZipCode: "ZipCode",
  // Postal code (geo lookup)
  // =========================================================================
  // CATEGORICAL ENTITY TYPES - Named entities
  // =========================================================================
  Category: "Category",
  // Discrete category / product / entity class
  Name: "Name",
  // Generic named entity (person, company, product, etc.)
  // =========================================================================
  // CATEGORICAL CODED TYPES - Discrete categories/statuses
  // =========================================================================
  Status: "Status",
  // State: "Active", "Pending", "Closed"
  Boolean: "Boolean",
  // True/False, Yes/No
  Direction: "Direction",
  // Compass direction: "N", "NE", "East", etc.
  // =========================================================================
  // BINNED/RANGE TYPES - Discretized continuous values
  // =========================================================================
  Range: "Range",
  // Numeric range, age group, binned values
  // =========================================================================
  // FALLBACK TYPES
  // =========================================================================
  Number: "Number",
  // Generic number (measure fallback)
  Unknown: "Unknown"
  // Cannot determine type
};
var measureTypes = new Set(
  getRegisteredTypes().filter((t) => {
    const e = getRegistryEntry(t);
    return ["additive", "intensive", "signed-additive"].includes(e.aggRole) && e.t1 !== "Score";
  })
);
var nonMeasureNumericTypes = /* @__PURE__ */ new Set([
  "Rank",
  "ID",
  "Score",
  "Year",
  "Month",
  "Day",
  "Hour",
  "Latitude",
  "Longitude"
]);
var categoricalTypes = new Set(
  getRegisteredTypes().filter((t) => {
    const e = getRegistryEntry(t);
    return e.visEncodings.includes("nominal") && e.aggRole !== "identifier" || e.t1 === "Binned";
  })
);
var ordinalTypes = new Set(
  getRegisteredTypes().filter((t) => {
    const e = getRegistryEntry(t);
    return e.visEncodings.includes("ordinal");
  })
);
function getVisCategory(semanticType) {
  if (!semanticType || !isRegistered(semanticType)) return null;
  return getRegistryEntry(semanticType).visEncodings[0] ?? null;
}
function inferVisCategory(values) {
  if (values.length === 0) return "nominal";
  const isBoolean = (v) => v === true || v === false || Object.prototype.toString.call(v) === "[object Boolean]";
  const isNumber = (v) => !isNaN(+v) && !(Object.prototype.toString.call(v) === "[object Date]");
  const looksLikeDate = (s) => /^\d|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s.trim());
  const isDate = (v) => {
    if (v instanceof Date) return !isNaN(v.getTime());
    if (typeof v === "string") return looksLikeDate(v) && !isNaN(Date.parse(v));
    return !isNaN(Date.parse(v));
  };
  const nonNull = values.filter((v) => v != null);
  if (nonNull.length === 0) return "nominal";
  if (nonNull.every(isBoolean)) return "nominal";
  if (nonNull.every(isNumber)) return "quantitative";
  if (nonNull.every(isDate)) return "temporal";
  return "nominal";
}
function isMeasureType(semanticType) {
  return measureTypes.has(semanticType);
}
function isTimeSeriesType(semanticType) {
  const entry = getRegistryEntry(semanticType);
  return entry.t0 === "Temporal" && entry.t1 !== "Duration";
}
function isCategoricalType(semanticType) {
  return categoricalTypes.has(semanticType);
}
function isOrdinalType(semanticType) {
  return ordinalTypes.has(semanticType);
}
function isGeoType(semanticType) {
  return getRegistryEntry(semanticType).t0 === "Geographic";
}
function isGeoCoordinateType(semanticType) {
  return getRegistryEntry(semanticType).t1 === "GeoCoordinate";
}
function isNonMeasureNumeric(semanticType) {
  return nonMeasureNumericTypes.has(semanticType);
}
function getZeroClass(semanticType) {
  const baseline = getRegistryEntry(semanticType).zeroBaseline;
  if (baseline === "none") return "unknown";
  return baseline;
}
var ZERO_BASELINE_GAP_THRESHOLD = 0.5;
function dataFarFromZero(values) {
  if (!values || values.length === 0) return false;
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  if (dataMin <= 0 || dataMax <= 0) return false;
  return dataMin / dataMax >= ZERO_BASELINE_GAP_THRESHOLD;
}
function computeZeroDecision(semanticType, channel, markType, values) {
  const isBarLike = ["bar", "area", "rect"].includes(markType);
  const isScatterMark = markType === "circle" || markType === "point";
  const isPositional = ["x", "y"].includes(channel);
  const entry = getRegistryEntry(semanticType);
  const zeroClass = getZeroClass(semanticType);
  if (zeroClass === "meaningful") {
    if (isBarLike) {
      return { zero: true, domainPadFraction: 0, zeroClass, forced: true, uncertain: false };
    }
    if (isPositional && isScatterMark) {
      if (values && values.length > 0 && Math.min(...values) <= 0) {
        return { zero: true, domainPadFraction: 0, zeroClass, forced: true, uncertain: false };
      }
      return {
        zero: false,
        domainPadFraction: entry.zeroPad || 0.05,
        zeroClass,
        forced: false,
        uncertain: true
      };
    }
    return {
      zero: true,
      domainPadFraction: 0,
      zeroClass,
      forced: false,
      uncertain: dataFarFromZero(values)
    };
  }
  if (zeroClass === "arbitrary") {
    if (isBarLike && values && values.length > 0) {
      const dataMin = Math.min(...values);
      if (dataMin <= 0) {
        return { zero: true, domainPadFraction: 0, zeroClass, forced: true, uncertain: false };
      }
    }
    return {
      zero: false,
      domainPadFraction: entry.zeroPad || 0.05,
      zeroClass,
      forced: false,
      uncertain: false
    };
  }
  if (zeroClass === "contextual" && values && values.length > 0) {
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    if (dataMin <= 0) {
      return { zero: true, domainPadFraction: 0, zeroClass, forced: true, uncertain: false };
    }
    const proximity = dataMax > 0 ? dataMin / dataMax : 0;
    if (proximity < 0.3) {
      return { zero: true, domainPadFraction: 0, zeroClass, forced: false, uncertain: false };
    }
    if (isBarLike) {
      return { zero: true, domainPadFraction: 0, zeroClass, forced: true, uncertain: false };
    }
    return { zero: false, domainPadFraction: 0.05, zeroClass, forced: false, uncertain: false };
  }
  if (isBarLike && isPositional) {
    return { zero: true, domainPadFraction: 0, zeroClass: "unknown", forced: true, uncertain: false };
  }
  return { zero: false, domainPadFraction: 0.05, zeroClass: "unknown", forced: true, uncertain: false };
}
function computePaddedDomain(values, padFraction) {
  if (padFraction <= 0 || values.length < 2) return null;
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin;
  if (span <= 0) return null;
  const padding = span * padFraction;
  return [dataMin - padding, dataMax + padding];
}
function getRecommendedColorScheme(semanticType, encodingType, uniqueValueCount = 10, fieldName = "", values = [], colorHint) {
  const pickScheme = (schemes, name) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash = hash & hash;
    }
    return schemes[Math.abs(hash) % schemes.length];
  };
  if (!semanticType) {
    if (encodingType === "quantitative") {
      return { scheme: "viridis", type: "sequential", reason: "default for quantitative" };
    }
    if (encodingType === "ordinal") {
      return { scheme: "blues", type: "sequential", reason: "default for ordinal" };
    }
    return {
      scheme: uniqueValueCount > 10 ? "tableau20" : "tableau10",
      type: "categorical",
      reason: "default for categorical"
    };
  }
  if (semanticType === "Temperature") {
    if (colorHint?.type === "diverging") {
      return { scheme: "redblue", type: "diverging", reason: "temperature diverging around freezing point" };
    }
    return { scheme: "reds", type: "sequential", reason: "temperature single-direction uses sequential" };
  }
  if (semanticType === "Percentage") {
    if (colorHint?.type === "diverging") {
      return { scheme: "redblue", type: "diverging", reason: "percentage spans positive and negative" };
    }
    return { scheme: "oranges", type: "sequential", reason: "percentage all same sign uses sequential" };
  }
  if (["Price", "Amount"].includes(semanticType)) {
    if (colorHint?.type === "diverging") {
      return { scheme: "redblue", type: "diverging", reason: "financial data spans positive and negative" };
    }
    return { scheme: "goldgreen", type: "sequential", reason: "financial data uses gold-green" };
  }
  if (semanticType === "Score") {
    if (colorHint?.type === "diverging") {
      return { scheme: "redblue", type: "diverging", reason: "score/rating diverging around midpoint" };
    }
    return { scheme: "yelloworangebrown", type: "sequential", reason: "scores use warm sequential" };
  }
  if (semanticType === "Rank") {
    return { scheme: "purples", type: "sequential", reason: "ranks use single-hue sequential" };
  }
  if (semanticType === "Range") {
    return { scheme: "blues", type: "sequential", reason: "range groups use sequential" };
  }
  if (ordinalTypes.has(semanticType) && ["Year", "Quarter", "Month", "Week", "Day", "Hour", "Decade"].includes(semanticType)) {
    return { scheme: "viridis", type: "sequential", reason: "temporal granules use perceptually uniform" };
  }
  if (getRegistryEntry(semanticType ?? "").t1 === "GeoPlace") {
    if (uniqueValueCount <= 10) {
      return { scheme: "set2", type: "categorical", reason: "geographic regions use distinct pastels" };
    }
    return { scheme: "tableau20", type: "categorical", reason: "many regions use large categorical" };
  }
  if (["Status", "Boolean"].includes(semanticType)) {
    return { scheme: "set1", type: "categorical", reason: "status uses high-contrast categorical" };
  }
  if (semanticType === "Category") {
    return {
      scheme: uniqueValueCount > 10 ? "tableau20" : "tableau10",
      type: "categorical",
      reason: "categories use standard categorical"
    };
  }
  if (semanticType === "Name") {
    return {
      scheme: uniqueValueCount > 8 ? "tableau20" : "set2",
      type: "categorical",
      reason: "names use readable categorical"
    };
  }
  if (semanticType === "Duration") {
    return { scheme: "oranges", type: "sequential", reason: "duration uses intensity-based sequential" };
  }
  if (measureTypes.has(semanticType)) {
    if (colorHint?.type === "diverging") {
      return { scheme: "redblue", type: "diverging", reason: "measure with diverging nature" };
    }
    const sequentialSchemes = ["viridis", "blues", "greens", "reds", "yelloworangebrown", "goldgreen"];
    return {
      scheme: pickScheme(sequentialSchemes, fieldName),
      type: "sequential",
      reason: "measures use perceptually uniform sequential"
    };
  }
  if (ordinalTypes.has(semanticType) || encodingType === "ordinal") {
    const ordinalSchemes = ["blues", "greens", "purples", "oranges"];
    return {
      scheme: pickScheme(ordinalSchemes, fieldName),
      type: "sequential",
      reason: "ordinal data uses sequential scheme"
    };
  }
  if (encodingType === "nominal" || encodingType === "temporal") {
    return {
      scheme: uniqueValueCount > 10 ? "tableau20" : "tableau10",
      type: "categorical",
      reason: "default categorical palette"
    };
  }
  return { scheme: "viridis", type: "sequential", reason: "universal fallback" };
}
var MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var MONTH_ABBR3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var MONTH_NUM = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
var DOW_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
var DOW_ABBR3 = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
var DOW_ABBR2 = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
var DOW_FULL_SUN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var DOW_ABBR3_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"];
var COMPASS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
var COMPASS_8_FULL = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"];
var COMPASS_4 = ["N", "E", "S", "W"];
var COMPASS_4_FULL = ["North", "East", "South", "West"];
var ORDINAL_SEQUENCES = {
  Month: [
    { labels: MONTH_FULL, caseInsensitive: true },
    { labels: MONTH_ABBR3, caseInsensitive: true },
    { labels: MONTH_NUM, caseInsensitive: false }
  ],
  Day: [
    { labels: DOW_FULL, caseInsensitive: true },
    { labels: DOW_ABBR3, caseInsensitive: true },
    { labels: DOW_ABBR2, caseInsensitive: true },
    { labels: DOW_FULL_SUN, caseInsensitive: true },
    { labels: DOW_ABBR3_SUN, caseInsensitive: true }
  ],
  Quarter: [
    { labels: QUARTER_LABELS, caseInsensitive: true }
  ],
  Direction: [
    { labels: COMPASS_8, caseInsensitive: true },
    { labels: COMPASS_8_FULL, caseInsensitive: true },
    { labels: COMPASS_4, caseInsensitive: true },
    { labels: COMPASS_4_FULL, caseInsensitive: true }
  ]
};
function buildLookup(seq) {
  const m = /* @__PURE__ */ new Map();
  for (let i = 0; i < seq.labels.length; i++) {
    const key = seq.caseInsensitive ? seq.labels[i].toLowerCase() : seq.labels[i];
    m.set(key, i);
  }
  return m;
}
function matchSequence(values, sequences) {
  const uniqueValues = [...new Set(values.map((v) => v != null ? String(v) : ""))].filter((v) => v !== "");
  if (uniqueValues.length === 0) return void 0;
  for (const seq of sequences) {
    const lookup = buildLookup(seq);
    const matched = [];
    const unmatched = [];
    for (const val of uniqueValues) {
      const key = seq.caseInsensitive ? val.toLowerCase() : val;
      const idx = lookup.get(key);
      if (idx !== void 0) {
        matched.push({ value: val, index: idx });
      } else {
        unmatched.push(val);
      }
    }
    if (matched.length >= uniqueValues.length * 0.6 && matched.length >= 2) {
      matched.sort((a, b) => a.index - b.index);
      const result = matched.map((m) => m.value);
      result.push(...unmatched);
      return result;
    }
  }
  return void 0;
}
function inferOrdinalSortOrder(semanticType, values) {
  const sequences = ORDINAL_SEQUENCES[semanticType];
  if (sequences) {
    return matchSequence(values, sequences);
  }
  if (!semanticType || semanticType === "Category" || semanticType === "Unknown") {
    for (const seqs of Object.values(ORDINAL_SEQUENCES)) {
      const result = matchSequence(values, seqs);
      if (result) return result;
    }
  }
  return void 0;
}

// src/core/decisions.ts
function visCategoryToVLType(vc) {
  switch (vc) {
    case "quantitative":
      return "quantitative";
    case "ordinal":
      return "ordinal";
    case "temporal":
      return "temporal";
    case "geographic":
      return "quantitative";
    case "nominal":
    default:
      return "nominal";
  }
}
function validateTemporalParsing(data, fieldName, fromRegistry) {
  const sampleValues = data.map((r) => r[fieldName]).slice(0, 15).filter((v) => v != null);
  if (sampleValues.length === 0) return false;
  const uniqueValues = new Set(sampleValues.map(String));
  if (uniqueValues.size <= 1) return false;
  const looksTemporalValue = (val) => {
    if (val instanceof Date) return true;
    if (typeof val === "number") {
      if (val >= 1500 && val <= 2200 && val % 1 === 0) return true;
      if (val > 864e5 && val < 42e11) return true;
      return false;
    }
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (!trimmed) return false;
      if (/^\d{4}$/.test(trimmed)) return true;
      return !Number.isNaN(Date.parse(trimmed));
    }
    return false;
  };
  const passingCount = sampleValues.filter(looksTemporalValue).length;
  const minFraction = fromRegistry ? 0.3 : 0.5;
  return passingCount / sampleValues.length >= minFraction;
}
function resolveTemporalEncoding(visCategory, channel, data, fieldName, fromRegistry) {
  if (["size", "column", "row"].includes(channel)) {
    return { vlType: "ordinal", visCategory, channelOverride: true, cardinalityGuard: false };
  }
  if (channel === "color") {
    const uniqueCount = new Set(data.map((r) => r[fieldName])).size;
    if (uniqueCount <= 12) {
      return { vlType: "ordinal", visCategory, channelOverride: true, cardinalityGuard: false };
    }
  }
  if (!validateTemporalParsing(data, fieldName, fromRegistry)) {
    return { vlType: "ordinal", visCategory, channelOverride: false, cardinalityGuard: false };
  }
  return { vlType: "temporal", visCategory, channelOverride: false, cardinalityGuard: false };
}
function applyOrdinalGuards(visCategory, channel, data, fieldName, fieldValues, fromRegistry) {
  const numericVals = fieldValues.filter((v) => v != null && !isNaN(+v)).map(Number);
  if (numericVals.length > 0) {
    const uniqueCount = new Set(numericVals).size;
    const hasFractions = numericVals.some((v) => v % 1 !== 0);
    if (!fromRegistry && hasFractions && uniqueCount > 20) {
      return { vlType: "quantitative", visCategory, channelOverride: false, cardinalityGuard: true };
    }
    if (!hasFractions && uniqueCount > 12 && ["color", "group"].includes(channel)) {
      return { vlType: "quantitative", visCategory, channelOverride: true, cardinalityGuard: true };
    }
    if (!hasFractions && uniqueCount > 12 && ["x", "y"].includes(channel)) {
      return { vlType: "quantitative", visCategory, channelOverride: true, cardinalityGuard: true };
    }
  }
  return { vlType: "ordinal", visCategory, channelOverride: false, cardinalityGuard: false };
}
function disambiguateMultiEncoding(candidates, channel, data, fieldName, fieldValues) {
  const has = (vc) => candidates.includes(vc);
  if (has("temporal") && has("ordinal")) {
    return resolveTemporalEncoding("temporal", channel, data, fieldName, true);
  }
  if (has("quantitative") && has("ordinal")) {
    if (["color", "group"].includes(channel)) {
      const uniqueCount = new Set(data.map((r) => r[fieldName])).size;
      if (uniqueCount <= 12) {
        return { vlType: "ordinal", visCategory: "ordinal", channelOverride: false, cardinalityGuard: false };
      }
      return { vlType: "quantitative", visCategory: "quantitative", channelOverride: false, cardinalityGuard: true };
    }
    if (["column", "row"].includes(channel)) {
      return { vlType: "ordinal", visCategory: "ordinal", channelOverride: false, cardinalityGuard: false };
    }
    return { vlType: "quantitative", visCategory: "quantitative", channelOverride: false, cardinalityGuard: false };
  }
  if (has("quantitative") && has("geographic")) {
    return { vlType: "quantitative", visCategory: "quantitative", channelOverride: false, cardinalityGuard: false };
  }
  if (has("ordinal") && has("nominal")) {
    if (["color", "group"].includes(channel)) {
      return { vlType: "nominal", visCategory: "nominal", channelOverride: false, cardinalityGuard: false };
    }
    return { vlType: "ordinal", visCategory: "ordinal", channelOverride: false, cardinalityGuard: false };
  }
  const fallback = candidates[0];
  return { vlType: visCategoryToVLType(fallback), visCategory: fallback, channelOverride: false, cardinalityGuard: false };
}
function resolveEncodingType(semanticType, fieldValues, channel, data, fieldName) {
  if (semanticType && isRegistered(semanticType)) {
    const entry = getRegistryEntry(semanticType);
    const candidates = entry.visEncodings;
    if (candidates.length > 1) {
      return disambiguateMultiEncoding(candidates, channel, data, fieldName);
    }
    const baseType = candidates[0];
    if (baseType === "quantitative") {
      const nonNull = fieldValues.filter((v) => v != null);
      const allNumeric = nonNull.length > 0 && nonNull.every((v) => typeof v === "number" || typeof v === "string" && !isNaN(+v) && v.trim() !== "");
      if (!allNumeric) {
        const inferred = inferVisCategory(fieldValues);
        return {
          vlType: visCategoryToVLType(inferred),
          visCategory: inferred,
          channelOverride: false,
          cardinalityGuard: false
        };
      }
    }
    if (baseType === "temporal") {
      return resolveTemporalEncoding(baseType, channel, data, fieldName, true);
    }
    if (baseType === "ordinal") {
      return applyOrdinalGuards(baseType, channel, data, fieldName, fieldValues, true);
    }
    return {
      vlType: visCategoryToVLType(baseType),
      visCategory: baseType,
      channelOverride: false,
      cardinalityGuard: false
    };
  }
  const visCategory = inferVisCategory(fieldValues);
  const channelOverride = false;
  const cardinalityGuard = false;
  switch (visCategory) {
    case "temporal":
      return resolveTemporalEncoding(visCategory, channel, data, fieldName, false);
    case "ordinal":
      return applyOrdinalGuards(visCategory, channel, data, fieldName, fieldValues, false);
    case "quantitative":
      return { vlType: "quantitative", visCategory, channelOverride, cardinalityGuard };
    case "geographic":
      return { vlType: "quantitative", visCategory, channelOverride, cardinalityGuard };
    case "nominal":
    default:
      return { vlType: "nominal", visCategory, channelOverride, cardinalityGuard };
  }
}
var DEFAULT_GAS_PRESSURE_PARAMS = {
  markCrossSection: 30,
  elasticity: 0.3,
  maxStretch: 1.5
};
function computeGasPressure(xValues, yValues, xDomain, yDomain, canvasWidth, canvasHeight, params = DEFAULT_GAS_PRESSURE_PARAMS) {
  const N = xValues.length;
  if (N <= 1 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { stretchX: 1, stretchY: 1, rawStretchX: 1, rawStretchY: 1 };
  }
  const sigma1dDefault = Math.sqrt(params.markCrossSection);
  const computeAxisStretch = (values, domain, baseDim, sigma1d) => {
    if (baseDim <= 0 || values.length <= 1) return [1, 1];
    const range = domain[1] - domain[0];
    if (range <= 0) return [1, 1];
    const pxPerUnit = baseDim / range;
    const seen = /* @__PURE__ */ new Set();
    for (const v of values) {
      seen.add(Math.round((v - domain[0]) * pxPerUnit));
    }
    const uniquePositions = seen.size;
    const pressure = uniquePositions * sigma1d / baseDim;
    if (pressure <= 1) return [1, 1];
    const raw = Math.pow(pressure, params.elasticity);
    return [Math.min(params.maxStretch, raw), raw];
  };
  const sigma1dX = params.markCrossSectionX != null ? Math.sqrt(params.markCrossSectionX) : sigma1dDefault;
  const sigma1dY = params.markCrossSectionY != null ? Math.sqrt(params.markCrossSectionY) : sigma1dDefault;
  const computeStretchForAxis = (values, domain, baseDim, sigma1d, sigmaRaw, itemCountOverride) => {
    if (itemCountOverride != null && sigmaRaw > 0) {
      const pressure = itemCountOverride * sigmaRaw / baseDim;
      if (pressure <= 1) return [1, 1];
      const raw = Math.pow(pressure, params.elasticity);
      return [Math.min(params.maxStretch, raw), raw];
    }
    return sigma1d > 0 ? computeAxisStretch(values, domain, baseDim, sigma1d) : [1, 1];
  };
  const sigmaRawX = params.markCrossSectionX ?? params.markCrossSection;
  const sigmaRawY = params.markCrossSectionY ?? params.markCrossSection;
  const [stretchX, rawStretchX] = computeStretchForAxis(xValues, xDomain, canvasWidth, sigma1dX, sigmaRawX, params.xItemCountOverride);
  const [stretchY, rawStretchY] = computeStretchForAxis(yValues, yDomain, canvasHeight, sigma1dY, sigmaRawY, params.yItemCountOverride);
  return { stretchX, stretchY, rawStretchX, rawStretchY };
}
function computeElasticBudget(itemCount, baseDimension, params) {
  if (itemCount <= 0) {
    return { budget: baseDimension, stretchFactor: 1 };
  }
  const pressure = itemCount * params.defaultStepSize / baseDimension;
  if (pressure <= 1) {
    return { budget: baseDimension, stretchFactor: 1 };
  }
  const stretchFactor = Math.min(params.maxStretch, Math.pow(pressure, params.elasticity));
  return {
    budget: baseDimension * stretchFactor,
    stretchFactor
  };
}
function computeAxisStep(nominalCount, continuousCount, baseDimension, params) {
  if (nominalCount > 0) {
    const { budget } = computeElasticBudget(nominalCount, baseDimension, params);
    return { step: Math.floor(budget / nominalCount), budget, itemCount: nominalCount };
  }
  if (continuousCount > 0) {
    const { budget } = computeElasticBudget(continuousCount, baseDimension, params);
    return { step: Math.floor(budget / continuousCount), budget, itemCount: continuousCount };
  }
  return { step: params.defaultStepSize, budget: baseDimension, itemCount: 0 };
}
function computeFacetLayout(facetCols, facetRows, baseWidth, baseHeight, params) {
  const minContinuousSize = params.minSubplotSize;
  let subplotWidth;
  if (facetCols > 1) {
    const stretch = Math.min(params.maxStretch, Math.pow(facetCols, params.facetElasticity));
    subplotWidth = Math.round(Math.max(minContinuousSize, baseWidth * stretch / facetCols));
  } else {
    subplotWidth = baseWidth;
  }
  let subplotHeight;
  if (facetRows > 1) {
    const stretch = Math.min(params.maxStretch, Math.pow(facetRows, params.facetElasticity));
    subplotHeight = Math.round(Math.max(minContinuousSize, baseHeight * stretch / facetRows));
  } else {
    subplotHeight = baseHeight;
  }
  return { columns: facetCols, rows: facetRows, subplotWidth, subplotHeight };
}
function computeLabelSizing(effectiveStep, hasDiscreteItems) {
  const defaultFontSize = 10;
  const defaultLimit = 100;
  if (!hasDiscreteItems) {
    return { fontSize: defaultFontSize, labelLimit: defaultLimit };
  }
  let fontSize = Math.max(6, Math.min(10, effectiveStep - 1));
  let labelLimit = Math.max(30, Math.min(100, effectiveStep * 8));
  let labelAngle;
  let labelAlign;
  let labelBaseline;
  if (effectiveStep < 10) {
    labelAngle = -90;
    fontSize = Math.max(6, Math.min(8, effectiveStep));
    labelLimit = 40;
    labelAlign = "right";
    labelBaseline = "middle";
  } else if (effectiveStep < 16) {
    labelAngle = -45;
    fontSize = Math.max(7, Math.min(9, effectiveStep));
    labelLimit = 60;
    labelAlign = "right";
    labelBaseline = "top";
  }
  return { fontSize, labelLimit, labelAngle, labelAlign, labelBaseline };
}
function computeOverflow(uniqueCount, maxDimension, minStepSize) {
  const maxToKeep = Math.floor(maxDimension / minStepSize);
  const overflowed = uniqueCount > maxToKeep;
  return {
    overflowed,
    maxToKeep,
    omittedCount: overflowed ? uniqueCount - maxToKeep : 0
  };
}
function computeCircumferencePressure(effectiveItemCount, canvasSize, params = {}) {
  const {
    minArcPx = 45,
    minRadius = 60,
    maxRadius = 400,
    elasticity = 0.5,
    maxStretch = 2,
    margin = 20
  } = params;
  const maxStretchX = Math.max(1, params.maxStretchX ?? maxStretch);
  const maxStretchY = Math.max(1, params.maxStretchY ?? maxStretch);
  const baseW = canvasSize.width;
  const baseH = canvasSize.height;
  const baseRadius = Math.max(
    minRadius,
    Math.min(baseW, baseH) / 2 - margin
  );
  const maxCanvasW = baseW * maxStretchX;
  const maxCanvasH = baseH * maxStretchY;
  const maxDiameter = Math.min(maxCanvasW, maxCanvasH);
  const effectiveMaxRadius = Math.min(
    maxRadius,
    (maxDiameter - 2 * margin) / 2
  );
  const effectiveMaxStretch = Math.max(1, effectiveMaxRadius / baseRadius);
  const baseCircumference = 2 * Math.PI * baseRadius;
  const pressure = effectiveItemCount * minArcPx / baseCircumference;
  let radius;
  if (pressure <= 1) {
    radius = baseRadius;
  } else {
    const stretch = Math.min(effectiveMaxStretch, Math.pow(pressure, elasticity));
    radius = Math.round(baseRadius * stretch);
  }
  radius = Math.min(maxRadius, Math.max(minRadius, radius));
  const diameter = 2 * radius + 2 * margin;
  const canvasW = Math.max(baseW, diameter);
  const canvasH = Math.max(baseH, diameter);
  return { radius, canvasW, canvasH };
}
function computeEffectiveBarCount(values) {
  if (values.length === 0) return 0;
  const positiveValues = values.filter((v) => v > 0);
  if (positiveValues.length === 0) return values.length;
  const total = positiveValues.reduce((s, v) => s + v, 0);
  const minVal = Math.min(...positiveValues);
  const effective = total / minVal;
  return Math.min(100, effective);
}

// src/core/field-semantics.ts
function toTypeString(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  return input.semanticType || "";
}
function normalizeAnnotation(input) {
  if (!input) return { semanticType: "Unknown" };
  if (typeof input === "string") return { semanticType: input || "Unknown" };
  return { ...input, semanticType: input.semanticType || "Unknown" };
}
var CURRENCY_MAP = {
  USD: "$",
  EUR: "\u20AC",
  GBP: "\xA3",
  JPY: "\xA5",
  CNY: "\xA5",
  KRW: "\u20A9",
  INR: "\u20B9",
  BRL: "R$",
  CAD: "CA$",
  AUD: "A$",
  CHF: "CHF",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr"
};
var UNIT_SUFFIX_MAP = {
  // Temperature
  "\xB0C": "\xB0C",
  "\xB0F": "\xB0F",
  C: "\xB0C",
  F: "\xB0F",
  // Mass
  kg: " kg",
  lb: " lb",
  // Distance
  km: " km",
  mi: " mi",
  m: " m",
  ft: " ft",
  // Speed
  "km/h": " km/h",
  mph: " mph",
  // Time
  sec: " s",
  min: " min",
  hr: " hr",
  seconds: " s",
  minutes: " min",
  hours: " hr",
  // Percentage (handled by formatClass, but allow explicit suffix)
  "%": "%"
};
function detectPercentageRepresentation(values) {
  if (values.length === 0) return "0-100";
  const abs = values.map(Math.abs);
  const countBelow1 = abs.filter((v) => v <= 1).length;
  if (countBelow1 / abs.length >= 0.8) return "0-1";
  return "0-100";
}
function detectPrecision(values) {
  let maxDecimals = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const s = v.toFixed(10);
    const dot = s.indexOf(".");
    if (dot === -1) continue;
    let end = s.length - 1;
    while (end > dot && s[end] === "0") end--;
    const decimals = end > dot ? end - dot : 0;
    if (decimals > maxDecimals) maxDecimals = decimals;
  }
  return Math.min(maxDecimals, 4);
}
function precisionFormat(values, useGrouping = true, signMode = "") {
  const p = detectPrecision(values);
  const group = useGrouping ? "," : "";
  if (p === 0) return `${signMode}${group}d`;
  return `${signMode}${group}.${p}f`;
}
function resolveFormat(semanticType, annotation, values) {
  const entry = getRegistryEntry(semanticType);
  const unit = annotation.unit;
  const currencyPrefix = unit ? CURRENCY_MAP[unit.toUpperCase()] ?? CURRENCY_MAP[unit] : void 0;
  const unitSuffix = unit ? UNIT_SUFFIX_MAP[unit] : void 0;
  const nums = values.filter((v) => typeof v === "number" && !isNaN(v));
  switch (entry.formatClass) {
    case "currency": {
      const pfx = currencyPrefix;
      if (pfx) {
        const axisPattern = semanticType === "Price" ? ",.2f" : precisionFormat(nums);
        return {
          format: { pattern: axisPattern, prefix: pfx },
          tooltipFormat: { pattern: ",.2f", prefix: pfx }
        };
      }
      return { tooltipFormat: { pattern: ",.2f" } };
    }
    case "percent": {
      if (!annotation.intrinsicDomain) {
        return { tooltipFormat: { pattern: precisionFormat(nums) } };
      }
      const rep = detectPercentageRepresentation(nums);
      if (rep === "0-1") {
        const p = detectPrecision(nums);
        const axisP = Math.max(0, p - 2);
        const tipP = Math.min(axisP + 1, 4);
        return {
          format: { pattern: `.${axisP}~%` },
          tooltipFormat: { pattern: `.${tipP}%` }
        };
      }
      return {
        tooltipFormat: { pattern: precisionFormat(nums, false), suffix: "%" }
      };
    }
    case "unit-suffix":
      return {
        tooltipFormat: unitSuffix ? { pattern: precisionFormat(nums), suffix: unitSuffix } : { pattern: precisionFormat(nums) }
      };
    case "integer":
      if (semanticType === "Year" || semanticType === "Decade") {
        return {};
      }
      return { tooltipFormat: { pattern: ",d" } };
    case "decimal":
      return { tooltipFormat: { pattern: precisionFormat(nums) } };
    case "plain":
    default:
      return {};
  }
}
function resolveDefaultVisType(semanticType, values) {
  if (!isRegistered(semanticType)) {
    return inferVisCategory(values);
  }
  const entry = getRegistryEntry(semanticType);
  const candidates = entry.visEncodings;
  if (candidates.length === 1) {
    if (candidates[0] === "quantitative") {
      const nonNull = values.filter((v) => v != null);
      const allNumeric = nonNull.length > 0 && nonNull.every((v) => typeof v === "number" || typeof v === "string" && !isNaN(+v) && v.trim() !== "");
      if (!allNumeric) {
        return inferVisCategory(values);
      }
    }
    return candidates[0];
  }
  if (candidates.includes("quantitative") && candidates.includes("ordinal")) {
    const distinct = new Set(values.filter((v) => v != null)).size;
    return distinct <= 12 ? "ordinal" : "quantitative";
  }
  if (candidates.includes("temporal") && candidates.includes("ordinal")) {
    const distinct = new Set(values.filter((v) => v != null)).size;
    return distinct <= 6 ? "ordinal" : "temporal";
  }
  if (candidates.includes("geographic") && candidates.includes("quantitative")) {
    return "quantitative";
  }
  return candidates[0];
}
function resolveAggregationDefault(semanticType) {
  const entry = getRegistryEntry(semanticType);
  switch (entry.aggRole) {
    case "additive":
      return "sum";
    case "signed-additive":
      return "sum";
    case "intensive":
      return "average";
    case "dimension":
      return void 0;
    case "identifier":
      return void 0;
    default:
      return void 0;
  }
}
function resolveZeroClassFromAnnotation(semanticType, domain) {
  if (domain && domain[0] > 0) return "arbitrary";
  return getZeroClass(semanticType);
}
function resolveScaleType(semanticType, values) {
  const entry = getRegistryEntry(semanticType);
  const eligible = entry.aggRole === "additive" && entry.domainShape === "open" && entry.t1 !== "GenericMeasure";
  if (!eligible) return void 0;
  if (values.length < 10) return void 0;
  const filtered = values.filter((v) => typeof v === "number" && !isNaN(v) && isFinite(v));
  if (filtered.length < 10) return void 0;
  const min = Math.min(...filtered);
  const max = Math.max(...filtered);
  if (max <= 0 || min === max) return void 0;
  if (min < 0) return void 0;
  const positiveMin = Math.min(...filtered.filter((v) => v > 0));
  if (positiveMin > 0 && max / positiveMin >= 1e6) {
    const hasZeros = filtered.some((v) => v === 0);
    return hasZeros ? "symlog" : "log";
  }
  return void 0;
}
function mergeIntrinsicWithData(intrinsic, values, hard) {
  if (hard) {
    return { min: intrinsic[0], max: intrinsic[1], clamp: true };
  }
  const nums = values.filter((v) => typeof v === "number" && !isNaN(v));
  if (nums.length === 0) {
    return { min: intrinsic[0], max: intrinsic[1], clamp: false };
  }
  const dataMin = Math.min(...nums);
  const dataMax = Math.max(...nums);
  return {
    min: Math.min(intrinsic[0], dataMin),
    max: Math.max(intrinsic[1], dataMax),
    clamp: false
  };
}
function snapToBoundHeuristic(intrinsic, values) {
  const nums = values.filter((v) => typeof v === "number" && !isNaN(v));
  if (nums.length === 0) return void 0;
  const [lo, hi] = intrinsic;
  const range = hi - lo;
  if (range <= 0) return void 0;
  const dataMin = Math.min(...nums);
  const dataMax = Math.max(...nums);
  const zeroInside = lo < 0 && hi > 0;
  const thresholdLo = 0.25 * (zeroInside ? 0 - lo : range);
  const thresholdHi = 0.25 * (zeroInside ? hi : range);
  let snapMin;
  let snapMax;
  if (dataMin >= lo && dataMin <= lo + thresholdLo) {
    snapMin = lo;
  }
  if (dataMax <= hi && dataMax >= hi - thresholdHi) {
    snapMax = hi;
  }
  if (snapMin === void 0 && snapMax === void 0) return void 0;
  return { min: snapMin, max: snapMax, clamp: false };
}
function resolveDomainConstraint(semanticType, annotation, values) {
  const entry = getRegistryEntry(semanticType);
  if (annotation.intrinsicDomain) {
    if (entry.t1 === "Proportion" || entry.t1 === "SignedMeasure") {
      return snapToBoundHeuristic(annotation.intrinsicDomain, values);
    }
    return mergeIntrinsicWithData(annotation.intrinsicDomain, values, false);
  }
  if (semanticType === "Latitude") return mergeIntrinsicWithData([-90, 90], values, true);
  if (semanticType === "Longitude") return mergeIntrinsicWithData([-180, 180], values, true);
  if (semanticType === "Correlation") return mergeIntrinsicWithData([-1, 1], values, true);
  if (semanticType === "Percentage") {
    const nums = values.filter((v) => typeof v === "number" && !isNaN(v));
    if (nums.length > 0) {
      const rep = detectPercentageRepresentation(nums);
      const M = rep === "0-1" ? 1 : 100;
      return snapToBoundHeuristic([0, M], values);
    }
  }
  return void 0;
}
function resolveTickConstraint(semanticType, domain) {
  const entry = getRegistryEntry(semanticType);
  if (entry.formatClass === "integer") {
    const tc = { integersOnly: true, minStep: 1 };
    if (domain) {
      const span = domain[1] - domain[0];
      if (span <= 20 && span > 0) {
        tc.exactTicks = [];
        for (let i = domain[0]; i <= domain[1]; i++) {
          tc.exactTicks.push(i);
        }
      }
    }
    return tc;
  }
  if (semanticType === "Score" && domain) {
    const span = domain[1] - domain[0];
    if (span >= 2) {
      const tc = { integersOnly: true, minStep: 1 };
      if (span <= 20) {
        tc.exactTicks = [];
        for (let i = domain[0]; i <= domain[1]; i++) {
          tc.exactTicks.push(i);
        }
      }
      return tc;
    }
  }
  return void 0;
}
function resolveCanonicalOrder(semanticType, annotation, values) {
  if (annotation.sortOrder && annotation.sortOrder.length > 0) {
    return annotation.sortOrder;
  }
  return inferOrdinalSortOrder(semanticType, values);
}
function resolveCyclic(semanticType) {
  const entry = getRegistryEntry(semanticType);
  return entry.domainShape === "cyclic";
}
function resolveReversed(semanticType, channel) {
  if (semanticType === "Rank") {
    return channel !== "x";
  }
  return false;
}
function resolveNice(semanticType, domainConstraint) {
  if (domainConstraint?.clamp) return false;
  if (domainConstraint && domainConstraint.min !== void 0 && domainConstraint.max !== void 0) {
    return false;
  }
  const entry = getRegistryEntry(semanticType);
  if (entry.domainShape === "fixed") return false;
  return true;
}
function resolveDivergingInfo(semanticType, annotation, values) {
  const entry = getRegistryEntry(semanticType);
  if (semanticType === "Temperature" && annotation.unit) {
    const unitMidpoints = {
      "\xB0C": 0,
      "\xB0F": 32,
      "K": 273.15,
      C: 0,
      F: 32
    };
    const mid = unitMidpoints[annotation.unit];
    if (mid !== void 0) {
      return { midpoint: mid, inherent: false, source: "unit" };
    }
  }
  if (entry.diverging === "inherent") {
    return { midpoint: 0, inherent: true, source: "type-intrinsic" };
  }
  if (entry.diverging === "conditional") {
    return { midpoint: 0, inherent: false, source: "type-intrinsic" };
  }
  if (annotation.intrinsicDomain) {
    return {
      midpoint: (annotation.intrinsicDomain[0] + annotation.intrinsicDomain[1]) / 2,
      inherent: false,
      source: "domain"
    };
  }
  if (values.length > 0) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min < 0 && max > 0) {
      return { midpoint: 0, inherent: false, source: "data" };
    }
  }
  return void 0;
}
function resolveColorSchemeHint(semanticType, annotation, values) {
  const entry = getRegistryEntry(semanticType);
  const nums = values.filter((v) => typeof v === "number" && !isNaN(v));
  const divInfo = resolveDivergingInfo(semanticType, annotation, nums);
  if (divInfo) {
    const min = nums.length > 0 ? Math.min(...nums) : 0;
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    const spansBothSides = min < divInfo.midpoint && max > divInfo.midpoint;
    if (divInfo.inherent || spansBothSides) {
      return {
        type: "diverging",
        divergingMidpoint: divInfo.midpoint,
        inherentlyDiverging: divInfo.inherent
      };
    }
  }
  if (entry.visEncodings.includes("quantitative")) {
    return { type: "sequential" };
  }
  return { type: "categorical" };
}
function resolveBinningSuggested(semanticType, domain) {
  const entry = getRegistryEntry(semanticType);
  if (!entry.visEncodings.includes("quantitative")) return false;
  if (entry.aggRole === "identifier" || entry.aggRole === "dimension") return false;
  if (semanticType === "Year" || semanticType === "Decade") return false;
  if (domain && domain[1] - domain[0] <= 20) return false;
  if (semanticType === "Score" && !domain) return false;
  return true;
}
function resolveStackable(semanticType) {
  const entry = getRegistryEntry(semanticType);
  switch (entry.aggRole) {
    case "additive":
      return "sum";
    case "signed-additive":
      return "sum";
    case "intensive":
      if (semanticType === "Percentage") return "normalize";
      return false;
    case "dimension":
      return false;
    case "identifier":
      return false;
    default:
      return false;
  }
}
function resolveSortDirection(semanticType) {
  if (semanticType === "Rank") return "descending";
  return "ascending";
}
function resolveFieldSemantics(input, fieldName, values) {
  const annotation = normalizeAnnotation(input);
  const semanticType = annotation.semanticType;
  const numericValues = values.filter((v) => typeof v === "number" && !isNaN(v) && isFinite(v));
  const defaultVisType = resolveDefaultVisType(semanticType, values);
  const { format, tooltipFormat } = resolveFormat(semanticType, annotation, values);
  let aggregationDefault = resolveAggregationDefault(semanticType);
  let zeroClass = resolveZeroClassFromAnnotation(semanticType, annotation.intrinsicDomain);
  const scaleType = resolveScaleType(semanticType, numericValues);
  const domainConstraint = resolveDomainConstraint(semanticType, annotation, values);
  const canonicalOrder = resolveCanonicalOrder(semanticType, annotation, values);
  const cyclic = resolveCyclic(semanticType);
  let binningSuggested = resolveBinningSuggested(semanticType, annotation.intrinsicDomain);
  const sortDirection = resolveSortDirection(semanticType);
  if (!isRegistered(semanticType) && defaultVisType === "quantitative") {
    if (!aggregationDefault) aggregationDefault = "sum";
    if (zeroClass === "unknown") zeroClass = "meaningful";
    binningSuggested = true;
  }
  return {
    semanticAnnotation: annotation,
    defaultVisType,
    format,
    tooltipFormat,
    aggregationDefault,
    zeroClass,
    scaleType: scaleType ?? void 0,
    domainConstraint,
    canonicalOrder,
    cyclic,
    sortDirection,
    binningSuggested
  };
}

// src/core/resolve-semantics.ts
var MAX_TIMESTAMP_SEC = 4102444800;
var MAX_TIMESTAMP_MS = 41024448e5;
function isLikelyTimestamp(val) {
  if (val >= 1e9 && val <= MAX_TIMESTAMP_SEC) return true;
  if (val > MAX_TIMESTAMP_SEC && val <= MAX_TIMESTAMP_MS) return true;
  return false;
}
function timestampToMs(val) {
  return val <= MAX_TIMESTAMP_SEC ? val * 1e3 : val;
}
function looksLikeDateString(s) {
  const t = s.trim();
  return /^\d|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t);
}
function analyzeTemporalField(fieldValues) {
  const dates = [];
  let nonNull = 0;
  for (const v of fieldValues.slice(0, 100)) {
    if (v == null) continue;
    nonNull++;
    const d = v instanceof Date ? v : new Date(v);
    if (!isNaN(d.getTime())) dates.push(d);
  }
  if (dates.length < 2 || dates.length < nonNull * 0.5) return null;
  const monthSet = new Set(dates.map((d) => d.getUTCMonth()));
  const daySet = new Set(dates.map((d) => d.getUTCDate()));
  const hourSet = new Set(dates.map((d) => d.getUTCHours()));
  const minuteSet = new Set(dates.map((d) => d.getUTCMinutes()));
  const secondSet = new Set(dates.map((d) => d.getUTCSeconds()));
  const yearSet = new Set(dates.map((d) => d.getUTCFullYear()));
  const isSmallSpread = (s, maxSpread = 1) => {
    if (s.size <= 1) return true;
    const arr = [...s];
    return Math.max(...arr) - Math.min(...arr) <= maxSpread;
  };
  const same = {
    month: monthSet.size === 1,
    day: daySet.size === 1,
    hour: isSmallSpread(hourSet, 1),
    minute: minuteSet.size === 1,
    second: secondSet.size === 1
  };
  const sameYear = yearSet.size === 1;
  const sameMonth = sameYear && same.month;
  const sameDay = sameMonth && same.day;
  return { dates, same, sameYear, sameMonth, sameDay };
}
function computeDataVotes(same) {
  const votes = [0, 0, 0, 0, 0, 0];
  if (same.second) votes[5] += 1;
  if (same.minute && same.second) votes[5] += 1;
  if (same.hour && same.minute && same.second) votes[5] += 1;
  if (same.day && same.hour && same.minute && same.second) votes[5] += 2;
  if (same.month && same.day && same.hour && same.minute && same.second) votes[5] += 3;
  if (same.second) votes[4] += 1;
  if (same.minute && same.second) votes[4] += 1;
  if (same.hour && same.minute && same.second) votes[4] += 1;
  if (same.day && same.hour && same.minute && same.second) votes[4] += 2;
  if (!same.month && same.day && same.hour && same.minute && same.second) votes[4] += 3;
  if (same.second) votes[3] += 1;
  if (same.minute && same.second) votes[3] += 1;
  if (same.hour && same.minute && same.second) votes[3] += 1;
  if (!same.day && same.hour && same.minute && same.second) votes[3] += 3;
  if (same.second) votes[2] += 1;
  if (same.minute && same.second) votes[2] += 1;
  if (!same.hour && same.minute && same.second) votes[2] += 3;
  if (same.second) votes[1] += 1;
  if (!same.minute && same.second) votes[1] += 3;
  if (!same.second) votes[0] += 4;
  return votes;
}
var SEMANTIC_LEVEL = {
  Year: 5,
  Decade: 5,
  YearMonth: 4,
  Month: 4,
  YearQuarter: 4,
  Quarter: 4,
  Date: 3,
  Day: 3,
  Hour: 2,
  DateTime: 1,
  Timestamp: 0
};
function pickBestLevel(votes) {
  let bestLevel = 0;
  let bestScore = votes[0];
  for (let i = 1; i <= 5; i++) {
    if (votes[i] >= bestScore) {
      bestScore = votes[i];
      bestLevel = i;
    }
  }
  return { level: bestLevel, score: bestScore };
}
function levelToFormat(level, analysis) {
  switch (level) {
    case 5:
      return "%Y";
    case 4:
      return analysis.sameYear ? "%b" : "%b %Y";
    case 3:
      return analysis.sameYear ? "%b %d" : "%b %d, %Y";
    case 2:
      return analysis.sameDay ? "%H:00" : "%b %d %H:00";
    case 1:
      return analysis.sameDay ? "%H:%M" : "%b %d %H:%M";
    case 0:
      return analysis.sameDay ? "%H:%M:%S" : "%b %d %H:%M:%S";
    default:
      return null;
  }
}
function resolveTemporalFormat(fieldValues, semanticType) {
  const analysis = analyzeTemporalField(fieldValues);
  if (!analysis) return null;
  const votes = computeDataVotes(analysis.same);
  const semLevel = SEMANTIC_LEVEL[semanticType];
  if (semLevel !== void 0) votes[semLevel] += 3;
  const { level } = pickBestLevel(votes);
  return levelToFormat(level, analysis);
}
function expandToFullYear(val) {
  const trimmed = val.trim();
  if (/^\d{2}$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return String(n <= 49 ? 2e3 + n : 1900 + n);
  }
  return val;
}
function convertTemporalData(data, semanticTypes) {
  if (data.length === 0) return data;
  const keys = Object.keys(data[0]);
  const temporalKeys = keys.filter((k) => {
    const st = toTypeString(semanticTypes[k]);
    const vc = inferVisCategory(data.map((r) => r[k]));
    const stCategory = st ? getVisCategory(st) : null;
    return vc === "temporal" || stCategory === "temporal" || st === "Decade";
  });
  if (temporalKeys.length === 0) return data;
  const values = structuredClone(data);
  return values.map((r) => {
    for (const temporalKey of temporalKeys) {
      const val = r[temporalKey];
      const st = toTypeString(semanticTypes[temporalKey]);
      if (typeof val === "number") {
        if (st === "Year" || st === "Decade") {
          r[temporalKey] = `${Math.floor(val)}`;
        } else if (isLikelyTimestamp(val)) {
          r[temporalKey] = new Date(timestampToMs(val)).toISOString();
        } else {
          r[temporalKey] = String(val);
        }
      } else if (val instanceof Date) {
        r[temporalKey] = val.toISOString();
      } else {
        if ((st === "Year" || st === "Decade") && typeof val === "string") {
          r[temporalKey] = expandToFullYear(val);
        } else {
          r[temporalKey] = String(val);
        }
      }
    }
    return r;
  });
}
function resolveChannelSemantics(encodings, data, semanticTypes, convertedData) {
  const result = {};
  const temporalData = convertedData ?? data;
  for (const [channel, encoding] of Object.entries(encodings)) {
    const fieldName = encoding.field;
    if (!fieldName && encoding.aggregate !== "count") continue;
    if (!fieldName && encoding.aggregate === "count") {
      result[channel] = {
        field: "_count",
        semanticAnnotation: { semanticType: "Count" },
        type: "quantitative",
        aggregationDefault: "sum"
      };
      continue;
    }
    if (!fieldName) continue;
    const rawAnnotation = semanticTypes[fieldName];
    const semanticType = typeof rawAnnotation === "string" ? rawAnnotation || "" : rawAnnotation?.semanticType ?? "";
    const fieldValues = data.map((r) => r[fieldName]);
    const typeDecision = resolveEncodingType(
      semanticType,
      fieldValues,
      channel,
      data,
      fieldName
    );
    let resolvedType = typeDecision.vlType;
    if (encoding.type) {
      resolvedType = encoding.type;
    } else if (channel === "column" || channel === "row") {
      if (resolvedType !== "nominal" && resolvedType !== "ordinal") {
        resolvedType = "nominal";
      }
    }
    if (resolvedType === "quantitative") {
      const sampleValues = data.slice(0, 15).filter((r) => r[fieldName] != void 0).map((r) => r[fieldName]);
      const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
      if (sampleValues.length > 0 && sampleValues.every((val) => isoDateRegex.test(`${val}`.trim()))) {
        resolvedType = "temporal";
      }
    }
    const fc = resolveFieldSemantics(rawAnnotation, fieldName, fieldValues);
    const annotation = fc.semanticAnnotation;
    const tickConstraint = resolveTickConstraint(annotation.semanticType, annotation.intrinsicDomain);
    const reversed = resolveReversed(annotation.semanticType, channel);
    const nice = resolveNice(annotation.semanticType, fc.domainConstraint);
    const stackable = resolveStackable(annotation.semanticType);
    const cs = {
      field: fieldName,
      semanticAnnotation: annotation,
      type: resolvedType,
      // From FieldSemantics (data identity)
      format: fc.format,
      tooltipFormat: fc.tooltipFormat,
      aggregationDefault: fc.aggregationDefault,
      scaleType: fc.scaleType,
      domainConstraint: fc.domainConstraint,
      cyclic: fc.cyclic || void 0,
      sortDirection: fc.sortDirection,
      binningSuggested: fc.binningSuggested || void 0,
      // Channel-specific visualization decisions
      nice,
      tickConstraint,
      reversed: reversed || void 0,
      stackable
    };
    if (encoding.aggregate) {
      if (encoding.aggregate === "count") {
        cs.field = "_count";
        cs.type = "quantitative";
      } else {
        cs.field = `${fieldName}_${encoding.aggregate}`;
        cs.type = "quantitative";
      }
    }
    if ((channel === "color" || channel === "group") && fieldName) {
      if (encoding.scheme && encoding.scheme !== "default") {
        cs.colorScheme = {
          scheme: encoding.scheme,
          type: "categorical",
          reason: "explicit user scheme"
        };
      } else {
        const encodingVLType = cs.type;
        const colorHint = resolveColorSchemeHint(semanticType, annotation, fieldValues);
        const uniqueValues = [...new Set(fieldValues)];
        cs.colorScheme = getRecommendedColorScheme(
          semanticType,
          encodingVLType,
          uniqueValues.length,
          fieldName,
          fieldValues,
          { type: colorHint.type }
        );
        if (cs.colorScheme.type === "diverging" && encodingVLType === "quantitative") {
          const nums = fieldValues.filter((v) => typeof v === "number" && !isNaN(v));
          const divInfo = resolveDivergingInfo(semanticType, annotation, nums);
          if (divInfo) {
            cs.colorScheme.domainMid = divInfo.midpoint;
          }
        }
      }
    }
    if (cs.type === "temporal" || semanticType && getVisCategory(semanticType) === "temporal") {
      const convertedFieldValues = temporalData.map((r) => r[fieldName]);
      const fmt = resolveTemporalFormat(convertedFieldValues, semanticType);
      if (fmt) cs.temporalFormat = fmt;
    }
    if (cs.type === "ordinal" || cs.type === "nominal") {
      if (!encoding.sortOrder && !encoding.sortBy) {
        const ordinalSort = inferOrdinalSortOrder(semanticType, fieldValues);
        if (ordinalSort) {
          cs.ordinalSortOrder = ordinalSort;
        }
      }
    }
    result[channel] = cs;
  }
  return result;
}

// src/core/filter-overflow.ts
function filterOverflow(channelSemantics, declaration, encodings, data, budgets, allMarkTypes) {
  const effectiveType = (ch) => declaration.resolvedTypes?.[ch] ?? channelSemantics[ch]?.type;
  const effectiveField = (ch) => {
    if (channelSemantics[ch]?.field) return channelSemantics[ch].field;
    return void 0;
  };
  const isDiscreteType2 = (t) => t === "nominal" || t === "ordinal";
  const nominalCounts = {
    x: 0,
    y: 0,
    column: 0,
    row: 0,
    group: 0
  };
  const truncations = [];
  const warnings = [];
  let filteredData = data;
  const groupField = channelSemantics.group?.field;
  if (groupField) {
    nominalCounts.group = new Set(data.map((r) => r[groupField])).size;
  }
  const strategyContext = {
    data,
    channelSemantics,
    encodings,
    allMarkTypes
  };
  const strategy = declaration.overflowStrategy ?? defaultOverflowStrategy;
  for (const channel of ["x", "y", "column", "row", "color"]) {
    const fieldName = effectiveField(channel);
    const type = effectiveType(channel);
    if (!fieldName) continue;
    const maxToKeep = budgets.maxValues[channel] ?? Infinity;
    if (!isDiscreteType2(type)) {
      if (channel === "column" || channel === "row") {
        const uniqueValues2 = [...new Set(filteredData.map((r) => r[fieldName]))];
        nominalCounts[channel] = Math.min(uniqueValues2.length, maxToKeep);
        if (uniqueValues2.length > maxToKeep) {
          const sorted = [...uniqueValues2].sort();
          const valuesToKeep = sorted.slice(0, maxToKeep);
          const omittedCount = uniqueValues2.length - valuesToKeep.length;
          warnings.push({
            severity: "warning",
            code: "overflow",
            message: `${omittedCount} of ${uniqueValues2.length} values in '${fieldName}' were omitted (showing first ${valuesToKeep.length}).`,
            channel,
            field: fieldName
          });
          const keepSet = new Set(valuesToKeep);
          filteredData = filteredData.filter((row) => keepSet.has(row[fieldName]));
        }
      }
      continue;
    }
    const uniqueValues = [...new Set(filteredData.map((r) => r[fieldName]))];
    nominalCounts[channel] = Math.min(uniqueValues.length, maxToKeep);
    if (uniqueValues.length > maxToKeep) {
      const valuesToKeep = strategy(channel, fieldName, uniqueValues, maxToKeep, strategyContext);
      const omittedCount = uniqueValues.length - valuesToKeep.length;
      const placeholder = `...${omittedCount} items omitted`;
      warnings.push({
        severity: "warning",
        code: "overflow",
        message: `${omittedCount} of ${uniqueValues.length} values in '${fieldName}' were omitted (showing top ${valuesToKeep.length}).`,
        channel,
        field: fieldName
      });
      truncations.push({
        severity: "warning",
        code: "overflow",
        message: `${omittedCount} of ${uniqueValues.length} values in '${fieldName}' were omitted (showing top ${valuesToKeep.length}).`,
        channel,
        field: fieldName,
        keptValues: valuesToKeep,
        omittedCount,
        placeholder
      });
      if (channel !== "color") {
        filteredData = filteredData.filter((row) => valuesToKeep.includes(row[fieldName]));
      }
    }
  }
  return { filteredData, nominalCounts, truncations, warnings };
}
var defaultOverflowStrategy = (channel, fieldName, uniqueValues, maxToKeep, context) => {
  const { data, channelSemantics, encodings, allMarkTypes } = context;
  const hasConnectedMark = allMarkTypes.has("line") || allMarkTypes.has("area") || allMarkTypes.has("trail");
  const encoding = encodings[channel];
  const sortBy = encoding?.sortBy;
  const sortOrder = encoding?.sortOrder;
  let sortField;
  let sortFieldType;
  let isDescending = true;
  if (sortBy) {
    if (sortBy === "x" || sortBy === "y" || sortBy === "color") {
      const sortCS = channelSemantics[sortBy];
      sortField = sortCS?.field;
      sortFieldType = sortCS?.type;
      isDescending = sortOrder === "descending" || sortOrder !== "ascending" && sortBy !== channel;
    } else {
      try {
        const sortedList = JSON.parse(sortBy);
        if (Array.isArray(sortedList)) {
          const orderedValues = sortOrder === "descending" ? sortedList.reverse() : sortedList;
          return orderedValues.filter((v) => uniqueValues.includes(v)).slice(0, maxToKeep);
        }
      } catch {
      }
      isDescending = sortOrder === "descending";
    }
  } else {
    const oppositeChannel = channel === "x" ? "y" : channel === "y" ? "x" : void 0;
    const colorCS = channelSemantics.color;
    const oppositeCS = oppositeChannel ? channelSemantics[oppositeChannel] : void 0;
    const markType = allMarkTypes.has("rect") ? "rect" : void 0;
    if (markType !== "rect" && colorCS?.type === "quantitative") {
      sortField = colorCS.field;
      sortFieldType = colorCS.type;
    } else if (oppositeCS?.type === "quantitative") {
      sortField = oppositeCS.field;
      sortFieldType = oppositeCS.type;
    } else {
      isDescending = false;
    }
  }
  const fieldOriginalType = inferVisCategory(data.map((r) => r[fieldName]));
  if (fieldOriginalType === "quantitative" || channel === "color") {
    return uniqueValues.sort((a, b) => a - b).slice(0, maxToKeep);
  }
  if (channel === "column" || channel === "row") {
    return uniqueValues.slice(0, maxToKeep);
  }
  if (hasConnectedMark) {
    return uniqueValues.slice(0, maxToKeep);
  }
  if (sortField && sortFieldType === "quantitative") {
    let aggregateOp = Math.max;
    let initialValue = -Infinity;
    if (allMarkTypes.has("bar") && sortField !== channelSemantics.color?.field) {
      aggregateOp = (x, y) => x + y;
      initialValue = 0;
    }
    const valueAggregates = /* @__PURE__ */ new Map();
    for (const row of data) {
      const fieldValue = row[fieldName];
      const sortValue = row[sortField] || 0;
      if (valueAggregates.has(fieldValue)) {
        valueAggregates.set(fieldValue, aggregateOp(valueAggregates.get(fieldValue), sortValue));
      } else {
        valueAggregates.set(fieldValue, aggregateOp(initialValue, sortValue));
      }
    }
    return Array.from(valueAggregates.entries()).map(([value, agg]) => ({ value, agg })).sort((a, b) => isDescending ? b.agg - a.agg : a.agg - b.agg).slice(0, maxToKeep).map((v) => v.value);
  }
  if (sortOrder === "descending") {
    return uniqueValues.reverse().slice(0, maxToKeep);
  }
  return uniqueValues.slice(0, maxToKeep);
};

// src/core/compute-layout.ts
var VL_SHORT_DISCRETE_CATEGORY_COUNT = 4;
var VL_SHORT_DISCRETE_LABEL_MAX_LEN = 8;
var APPROX_CHAR_WIDTH_RATIO = 0.62;
function computeDiscreteLabelStats(field, table) {
  if (!field) return null;
  const uniques = /* @__PURE__ */ new Set();
  for (const row of table) {
    const v = row[field];
    if (v == null || v === "") continue;
    uniques.add(String(v));
  }
  if (uniques.size === 0) return null;
  const labels = [...uniques];
  return {
    count: labels.length,
    maxLen: Math.max(...labels.map((s) => s.length)),
    allNumeric: labels.every((s) => s.trim() !== "" && isFinite(Number(s)))
  };
}
function discreteYAxisShouldUseHorizontalLabels(field, channelType, table) {
  if (!field) return false;
  if (channelType === "quantitative") return true;
  const stats = computeDiscreteLabelStats(field, table);
  if (!stats) return false;
  if (stats.count > VL_SHORT_DISCRETE_CATEGORY_COUNT) return false;
  return stats.maxLen <= VL_SHORT_DISCRETE_LABEL_MAX_LEN;
}
function resolveStretchCaps(options) {
  const def = options.maxStretch ?? DEFAULT_MAX_STRETCH;
  return {
    x: Math.max(1, options.maxStretchX ?? def),
    y: Math.max(1, options.maxStretchY ?? def)
  };
}
var DEFAULT_BASE_SIZE = { width: 400, height: 320 };
var DEFAULT_MAX_STRETCH = 1.5;
function resolveBaseSize(specBaseSize, ceiling) {
  const base = specBaseSize ?? { ...DEFAULT_BASE_SIZE };
  if (!ceiling) return { width: base.width, height: base.height };
  return {
    width: Math.min(base.width, ceiling.width),
    height: Math.min(base.height, ceiling.height)
  };
}
function deriveStretchCaps(baseSize, ceiling, options) {
  const def = options.maxStretch ?? DEFAULT_MAX_STRETCH;
  return {
    maxStretchX: ceiling ? Math.max(1, ceiling.width / baseSize.width) : def,
    maxStretchY: ceiling ? Math.max(1, ceiling.height / baseSize.height) : def
  };
}
function computeLayout(channelSemantics, declaration, table, canvasSize, options = {}, facetGrid) {
  const {
    elasticity: elasticityVal = 0.5,
    facetElasticity: facetElasticityVal = 0.3,
    minStep: minStepVal = 6,
    minSubplotSize: minSubplotVal = 60,
    stepPadding: stepPaddingVal = 0.1,
    maintainContinuousAxisRatio = false,
    continuousMarkCrossSection,
    facetAspectRatioResistance = 0
  } = options;
  const { x: maxStretchX, y: maxStretchY } = resolveStretchCaps(options);
  const defaultChartWidth = canvasSize.width;
  const defaultChartHeight = canvasSize.height;
  const fixW = options.facetFixedPadding?.width ?? 0;
  const fixH = options.facetFixedPadding?.height ?? 0;
  const gap = options.facetGap ?? 0;
  const baseRefSize = 300;
  const sizeRatio = Math.max(defaultChartWidth, defaultChartHeight) / baseRefSize;
  const baseBandSize = options.defaultBandSize ?? 20;
  const defaultStepSize = Math.round(baseBandSize * Math.max(1, sizeRatio));
  const isDiscreteType2 = (t) => t === "nominal" || t === "ordinal";
  const effectiveTypes = {};
  for (const [ch, cs] of Object.entries(channelSemantics)) {
    effectiveTypes[ch] = declaration.resolvedTypes?.[ch] || cs.type;
  }
  const axisFlags = declaration.axisFlags || {};
  const xBanded = axisFlags.x?.banded ?? false;
  const yBanded = axisFlags.y?.banded ?? false;
  const nominalCount = {
    x: 0,
    y: 0,
    column: 0,
    row: 0,
    group: 0
  };
  for (const channel of ["x", "y", "column", "row", "color"]) {
    const cs = channelSemantics[channel];
    if (!cs?.field) continue;
    const effectiveType = effectiveTypes[channel] || cs.type;
    if (!isDiscreteType2(effectiveType)) continue;
    const uniqueValues = [...new Set(table.map((r) => r[cs.field]))];
    nominalCount[channel] = uniqueValues.length;
  }
  let groupField = channelSemantics.group?.field;
  if (!groupField && declaration.colorActsAsGroup) {
    const colorCS = channelSemantics.color;
    const colorType = effectiveTypes.color ?? colorCS?.type;
    const axisField = isDiscreteType2(effectiveTypes.x ?? channelSemantics.x?.type) ? channelSemantics.x?.field : channelSemantics.y?.field;
    if (colorCS?.field && isDiscreteType2(colorType) && colorCS.field !== axisField) {
      groupField = colorCS.field;
    }
  }
  if (groupField) {
    const groupAxisField = isDiscreteType2(effectiveTypes.x ?? channelSemantics.x?.type) ? channelSemantics.x?.field : channelSemantics.y?.field;
    if (groupAxisField === groupField) {
      groupField = void 0;
    } else if (groupAxisField && planBandDodge(table, groupAxisField, groupField).maxPerBand <= 1) {
      groupField = void 0;
    }
  }
  let groupAxis;
  if (groupField) {
    nominalCount.group = declaration.groupLaneCount ?? new Set(table.map((r) => r[groupField])).size;
    if (isDiscreteType2(effectiveTypes.x ?? channelSemantics.x?.type)) groupAxis = "x";
    else if (isDiscreteType2(effectiveTypes.y ?? channelSemantics.y?.type)) groupAxis = "y";
  }
  const xGroupMultiplier = groupAxis === "x" && nominalCount.group > 1 ? nominalCount.group : 1;
  const yGroupMultiplier = groupAxis === "y" && nominalCount.group > 1 ? nominalCount.group : 1;
  const xTotalNominalCount = nominalCount.x * xGroupMultiplier;
  const yTotalNominalCount = nominalCount.y * yGroupMultiplier;
  const MIN_GROUP_GAP_PX = 3;
  let xContinuousAsDiscrete = 0;
  let yContinuousAsDiscrete = 0;
  for (const axis of ["x", "y"]) {
    const cs = channelSemantics[axis];
    if (!cs?.field) continue;
    const effectiveType = effectiveTypes[axis] || cs.type;
    if (isDiscreteType2(effectiveType)) continue;
    const isBanded = axis === "x" ? xBanded : yBanded;
    const isBinned = declaration.binnedAxes?.[axis];
    if (!isBanded && !isBinned) continue;
    let count;
    if (isBinned) {
      const binDef = declaration.binnedAxes[axis];
      count = typeof binDef === "object" && binDef.maxbins ? binDef.maxbins : 10;
    } else {
      count = new Set(table.map((r) => r[cs.field])).size;
    }
    if (count <= 1) continue;
    if (axis === "x") {
      xContinuousAsDiscrete = count;
    } else {
      yContinuousAsDiscrete = count;
    }
  }
  let facetCols = 1;
  let facetRows = 1;
  if (facetGrid) {
    facetCols = facetGrid.columns;
    facetRows = facetGrid.rows;
  } else {
    if (nominalCount.column > 0) facetCols = nominalCount.column;
    if (nominalCount.row > 0) facetRows = nominalCount.row;
  }
  const LOG_PX_PER_DECADE = 40;
  let logBoostX = 0;
  let logBoostY = 0;
  for (const axis of ["x", "y"]) {
    const cs = channelSemantics[axis];
    if (!cs?.field || !cs.scaleType) continue;
    if (cs.scaleType !== "log" && cs.scaleType !== "symlog") continue;
    const vals = table.map((r) => r[cs.field]).filter((v) => typeof v === "number" && v > 0 && isFinite(v));
    if (vals.length < 2) continue;
    const decades = Math.log10(Math.max(...vals)) - Math.log10(Math.min(...vals));
    const needed = Math.ceil(Math.max(1, decades)) * LOG_PX_PER_DECADE;
    if (axis === "x") logBoostX = needed;
    else logBoostY = needed;
  }
  const minContinuousSize = Math.max(10, minStepVal);
  const minContinuousSizeX = Math.max(minContinuousSize, logBoostX);
  const minContinuousSizeY = Math.max(minContinuousSize, logBoostY);
  let subplotWidth;
  if (facetCols > 1) {
    const stretch = Math.min(maxStretchX, Math.pow(facetCols, facetElasticityVal));
    subplotWidth = Math.round(Math.max(
      minContinuousSizeX,
      (defaultChartWidth * stretch - fixW) / facetCols - gap
    ));
  } else {
    subplotWidth = defaultChartWidth;
  }
  let subplotHeight;
  if (facetRows > 1) {
    const stretch = Math.min(maxStretchY, Math.pow(facetRows, facetElasticityVal));
    subplotHeight = Math.round(Math.max(
      minContinuousSizeY,
      (defaultChartHeight * stretch - fixH) / facetRows - gap
    ));
  } else {
    subplotHeight = defaultChartHeight;
  }
  const xIsContinuousNonBanded = xTotalNominalCount === 0 && xContinuousAsDiscrete === 0;
  const yIsContinuousNonBanded = yTotalNominalCount === 0 && yContinuousAsDiscrete === 0;
  const bothContinuousNonBanded = xIsContinuousNonBanded && yIsContinuousNonBanded;
  if (facetAspectRatioResistance > 0 && !bothContinuousNonBanded && (facetCols > 1 || facetRows > 1)) {
    const baseAR = defaultChartWidth / defaultChartHeight;
    const facetAR = subplotWidth / subplotHeight;
    const arDrift = facetAR / baseAR;
    if (arDrift < 1) {
      subplotHeight = Math.round(
        Math.max(minContinuousSizeY, subplotHeight * Math.pow(arDrift, facetAspectRatioResistance))
      );
    } else if (arDrift > 1) {
      subplotWidth = Math.round(
        Math.max(minContinuousSizeX, subplotWidth * Math.pow(1 / arDrift, facetAspectRatioResistance))
      );
    }
  }
  if (bothContinuousNonBanded) {
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    if (xCS?.field && yCS?.field) {
      const isTempX = (effectiveTypes.x || xCS.type) === "temporal";
      const isTempY = (effectiveTypes.y || yCS.type) === "temporal";
      const xNumeric = [];
      const yNumeric = [];
      for (const row of table) {
        let xv = row[xCS.field];
        let yv = row[yCS.field];
        if (xv == null || yv == null) continue;
        if (isTempX) xv = +new Date(xv);
        else xv = +xv;
        if (isTempY) yv = +new Date(yv);
        else yv = +yv;
        if (isNaN(xv) || isNaN(yv)) continue;
        xNumeric.push(xv);
        yNumeric.push(yv);
      }
      if (xNumeric.length > 1) {
        const xMin = Math.min(...xNumeric);
        const xMax = Math.max(...xNumeric);
        const yMin = Math.min(...yNumeric);
        const yMax = Math.max(...yNumeric);
        const xDomain = [xMin, xMax];
        const yDomain = [yMin, yMax];
        if (xCS.zero?.zero) {
          if (xDomain[0] > 0) xDomain[0] = 0;
          if (xDomain[1] < 0) xDomain[1] = 0;
        }
        if (yCS.zero?.zero) {
          if (yDomain[0] > 0) yDomain[0] = 0;
          if (yDomain[1] < 0) yDomain[1] = 0;
        }
        const xDataCoverage = xDomain[1] - xDomain[0] > 0 ? (xMax - xMin) / (xDomain[1] - xDomain[0]) : 1;
        const yDataCoverage = yDomain[1] - yDomain[0] > 0 ? (yMax - yMin) / (yDomain[1] - yDomain[0]) : 1;
        const BANKING_COVERAGE_THRESHOLD = 0.2;
        let gasPressureParams = DEFAULT_GAS_PRESSURE_PARAMS;
        if (continuousMarkCrossSection != null) {
          if (typeof continuousMarkCrossSection === "number") {
            gasPressureParams = { ...DEFAULT_GAS_PRESSURE_PARAMS, markCrossSection: continuousMarkCrossSection };
          } else {
            const maxCS = Math.max(continuousMarkCrossSection.x, continuousMarkCrossSection.y);
            gasPressureParams = {
              ...DEFAULT_GAS_PRESSURE_PARAMS,
              markCrossSection: maxCS,
              markCrossSectionX: continuousMarkCrossSection.x,
              markCrossSectionY: continuousMarkCrossSection.y,
              ...continuousMarkCrossSection.elasticity != null && { elasticity: continuousMarkCrossSection.elasticity },
              ...continuousMarkCrossSection.maxStretch != null && { maxStretch: continuousMarkCrossSection.maxStretch }
            };
            if (continuousMarkCrossSection.seriesCountAxis) {
              const resolvedAxis = continuousMarkCrossSection.seriesCountAxis === "auto" ? "y" : continuousMarkCrossSection.seriesCountAxis;
              const nSeries = countDistinctSeries(channelSemantics, table);
              if (resolvedAxis === "y") {
                gasPressureParams.yItemCountOverride = nSeries;
              } else {
                gasPressureParams.xItemCountOverride = nSeries;
              }
            }
          }
        }
        const perSubplotCanvasW = facetCols > 1 ? Math.max(
          minContinuousSizeX,
          (defaultChartWidth * Math.min(maxStretchX, Math.pow(facetCols, facetElasticityVal)) - fixW) / facetCols - gap
        ) : defaultChartWidth;
        const perSubplotCanvasH = facetRows > 1 ? Math.max(
          minContinuousSizeY,
          (defaultChartHeight * Math.min(maxStretchY, Math.pow(facetRows, facetElasticityVal)) - fixH) / facetRows - gap
        ) : defaultChartHeight;
        const idealResult = computeGasPressure(
          xNumeric,
          yNumeric,
          xDomain,
          yDomain,
          perSubplotCanvasW,
          perSubplotCanvasH,
          gasPressureParams
        );
        const isConnected = typeof continuousMarkCrossSection === "object" && !!continuousMarkCrossSection.seriesCountAxis;
        const useBanking = xDataCoverage >= BANKING_COVERAGE_THRESHOLD && yDataCoverage >= BANKING_COVERAGE_THRESHOLD;
        let idealW;
        let idealH;
        const rawW = perSubplotCanvasW * idealResult.rawStretchX;
        const rawH = perSubplotCanvasH * idealResult.rawStretchY;
        if (useBanking) {
          const seriesFields = [];
          const colorField = channelSemantics.color?.field;
          const detailField = channelSemantics.detail?.field;
          if (colorField) seriesFields.push(colorField);
          if (detailField && detailField !== colorField) seriesFields.push(detailField);
          const perPointSeriesKeys = new Array(xNumeric.length);
          if (seriesFields.length === 0) {
            perPointSeriesKeys.fill("");
          } else {
            let idx = 0;
            for (const row of table) {
              const xv = xCS?.field ? row[xCS.field] : void 0;
              const yv = yCS?.field ? row[yCS.field] : void 0;
              if (xv == null || yv == null) continue;
              const xn = isTempX ? +new Date(xv) : +xv;
              const yn = isTempY ? +new Date(yv) : +yv;
              if (isNaN(xn) || isNaN(yn)) continue;
              perPointSeriesKeys[idx++] = seriesFields.map((f) => String(row[f] ?? "")).join("\0");
            }
          }
          const bankingAR = computeBankingAR(
            xNumeric,
            yNumeric,
            xDomain,
            yDomain,
            perPointSeriesKeys,
            isConnected
          );
          const BANKING_BLEND = 0.5;
          const gasAR = rawW / rawH;
          const blendedAR = gasAR > 0 && bankingAR > 0 ? Math.exp((1 - BANKING_BLEND) * Math.log(gasAR) + BANKING_BLEND * Math.log(bankingAR)) : bankingAR;
          const rawArea = rawW * rawH;
          const maxArea = perSubplotCanvasW * perSubplotCanvasH * Math.max(maxStretchX, maxStretchY);
          const area = Math.min(rawArea, maxArea);
          idealW = Math.sqrt(area * blendedAR);
          idealH = Math.sqrt(area / blendedAR);
        } else {
          idealW = rawW;
          idealH = rawH;
        }
        const availW = facetCols > 1 ? Math.max(minContinuousSizeX, (defaultChartWidth * maxStretchX - fixW) / facetCols - gap) : defaultChartWidth * maxStretchX;
        const availH = facetRows > 1 ? Math.max(minContinuousSizeY, (defaultChartHeight * maxStretchY - fixH) / facetRows - gap) : defaultChartHeight * maxStretchY;
        const scaleX = idealW > availW ? availW / idealW : 1;
        const scaleY = idealH > availH ? availH / idealH : 1;
        const fitScale = Math.min(scaleX, scaleY);
        let finalW = idealW * fitScale;
        let finalH = idealH * fitScale;
        finalW = Math.max(finalW, minContinuousSizeX);
        finalH = Math.max(finalH, minContinuousSizeY);
        subplotWidth = Math.round(finalW);
        subplotHeight = Math.round(finalH);
      }
    }
  } else if (xIsContinuousNonBanded || yIsContinuousNonBanded) {
    const contAxis = xIsContinuousNonBanded ? "x" : "y";
    const otherAxisHasDiscreteItems = contAxis === "x" ? yTotalNominalCount > 0 || yContinuousAsDiscrete > 0 : xTotalNominalCount > 0 || xContinuousAsDiscrete > 0;
    let seriesStretchApplied = false;
    if (typeof continuousMarkCrossSection === "object" && continuousMarkCrossSection.seriesCountAxis) {
      const resolvedAxis = continuousMarkCrossSection.seriesCountAxis === "auto" ? contAxis : continuousMarkCrossSection.seriesCountAxis;
      if (resolvedAxis === contAxis) {
        const sigmaPerSeries = contAxis === "x" ? continuousMarkCrossSection.x : continuousMarkCrossSection.y;
        const baseDim = contAxis === "x" ? subplotWidth : subplotHeight;
        const nSeries = countDistinctSeries(channelSemantics, table);
        const pressure = nSeries * sigmaPerSeries / baseDim;
        const elast = continuousMarkCrossSection.elasticity ?? DEFAULT_GAS_PRESSURE_PARAMS.elasticity;
        const maxS = continuousMarkCrossSection.maxStretch ?? DEFAULT_GAS_PRESSURE_PARAMS.maxStretch;
        if (pressure > 1) {
          const stretch = Math.min(maxS, Math.pow(pressure, elast));
          if (contAxis === "x") {
            subplotWidth = Math.round(subplotWidth * stretch);
          } else {
            subplotHeight = Math.round(subplotHeight * stretch);
          }
        }
        seriesStretchApplied = true;
      }
    }
    if (!seriesStretchApplied && !otherAxisHasDiscreteItems) {
      const contCS = channelSemantics[contAxis];
      if (contCS?.field) {
        const isTemporal2 = (effectiveTypes[contAxis] || contCS.type) === "temporal";
        const contValues = [];
        for (const row of table) {
          let v = row[contCS.field];
          if (v == null) continue;
          if (isTemporal2) v = +new Date(v);
          else v = +v;
          if (!isNaN(v)) contValues.push(v);
        }
        const sigma1d = Math.sqrt(DEFAULT_GAS_PRESSURE_PARAMS.markCrossSection);
        const baseDim = contAxis === "x" ? subplotWidth : subplotHeight;
        const pressure1d = contValues.length * sigma1d / baseDim;
        if (pressure1d > 1) {
          const stretch1d = Math.min(
            DEFAULT_GAS_PRESSURE_PARAMS.maxStretch,
            Math.pow(pressure1d, DEFAULT_GAS_PRESSURE_PARAMS.elasticity)
          );
          if (contAxis === "x") {
            subplotWidth = Math.round(subplotWidth * stretch1d);
          } else {
            subplotHeight = Math.round(subplotHeight * stretch1d);
          }
        }
      }
    }
  }
  const elasticParamsX = {
    elasticity: elasticityVal,
    maxStretch: maxStretchX,
    defaultStepSize};
  const elasticParamsY = {
    elasticity: elasticityVal,
    maxStretch: maxStretchY,
    defaultStepSize};
  const xAxis = computeAxisStep(xTotalNominalCount, xContinuousAsDiscrete, subplotWidth, elasticParamsX);
  const yAxis = computeAxisStep(yTotalNominalCount, yContinuousAsDiscrete, subplotHeight, elasticParamsY);
  const xIsDiscrete = xTotalNominalCount > 0;
  const yIsDiscrete = yTotalNominalCount > 0;
  const xHasGrouping = groupAxis === "x" && nominalCount.group > 0;
  const yHasGrouping = groupAxis === "y" && nominalCount.group > 0;
  let xStepSize;
  let yStepSize;
  let xStepUnit;
  let yStepUnit;
  if (xIsDiscrete && xHasGrouping) {
    const itemsPerGroup = nominalCount.group;
    const defaultGroupStep = itemsPerGroup * defaultStepSize;
    const minGroupStep = Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * itemsPerGroup);
    const groupAxis2 = computeAxisStep(nominalCount.x, 0, subplotWidth, elasticParamsX);
    const groupStep = Math.max(minGroupStep, Math.min(defaultGroupStep, groupAxis2.step));
    xStepSize = groupStep;
    xStepUnit = "group";
  } else if (xIsDiscrete) {
    xStepSize = Math.max(minStepVal, Math.min(defaultStepSize, xAxis.step));
  } else if (xContinuousAsDiscrete > 0) {
    xStepSize = Math.max(minStepVal, Math.min(defaultStepSize, xAxis.step));
  } else {
    xStepSize = defaultStepSize;
  }
  if (yIsDiscrete && yHasGrouping) {
    const itemsPerGroup = nominalCount.group;
    const defaultGroupStep = itemsPerGroup * defaultStepSize;
    const minGroupStep = Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * itemsPerGroup);
    const groupAxis2 = computeAxisStep(nominalCount.y, 0, subplotHeight, elasticParamsY);
    const groupStep = Math.max(minGroupStep, Math.min(defaultGroupStep, groupAxis2.step));
    yStepSize = groupStep;
    yStepUnit = "group";
  } else if (yIsDiscrete) {
    yStepSize = Math.max(minStepVal, Math.min(defaultStepSize, yAxis.step));
  } else if (yContinuousAsDiscrete > 0) {
    yStepSize = Math.max(minStepVal, Math.min(defaultStepSize, yAxis.step));
  } else {
    yStepSize = defaultStepSize;
  }
  for (const axis of ["x", "y"]) {
    const count = axis === "x" ? xContinuousAsDiscrete : yContinuousAsDiscrete;
    if (count <= 0) continue;
    const stepSize = axis === "x" ? xStepSize : yStepSize;
    const continuousSize = Math.round(stepSize * (count + 1));
    if (axis === "x") {
      subplotWidth = continuousSize;
    } else {
      subplotHeight = continuousSize;
    }
  }
  const maxSubplotW = (defaultChartWidth * maxStretchX - fixW) / facetCols - gap;
  const maxSubplotH = (defaultChartHeight * maxStretchY - fixH) / facetRows - gap;
  if (xTotalNominalCount > 0) {
    const divisor = xStepUnit === "group" ? nominalCount.x : xTotalNominalCount;
    const cap = Math.max(minStepVal, Math.floor(maxSubplotW / divisor));
    if (xStepSize > cap) xStepSize = cap;
  }
  if (xContinuousAsDiscrete > 0) {
    const cap = Math.max(minStepVal, Math.floor(maxSubplotW / (xContinuousAsDiscrete + 1)));
    if (xStepSize > cap) xStepSize = cap;
  }
  if (yTotalNominalCount > 0) {
    const divisor = yStepUnit === "group" ? nominalCount.y : yTotalNominalCount;
    const cap = Math.max(minStepVal, Math.floor(maxSubplotH / divisor));
    if (yStepSize > cap) yStepSize = cap;
  }
  if (yContinuousAsDiscrete > 0) {
    const cap = Math.max(minStepVal, Math.floor(maxSubplotH / (yContinuousAsDiscrete + 1)));
    if (yStepSize > cap) yStepSize = cap;
  }
  for (const axis of ["x", "y"]) {
    const count = axis === "x" ? xContinuousAsDiscrete : yContinuousAsDiscrete;
    if (count <= 0) continue;
    const stepSize = axis === "x" ? xStepSize : yStepSize;
    if (axis === "x") subplotWidth = Math.round(stepSize * (count + 1));
    else subplotHeight = Math.round(stepSize * (count + 1));
  }
  subplotWidth = Math.min(subplotWidth, Math.round(maxSubplotW));
  subplotHeight = Math.min(subplotHeight, Math.round(maxSubplotH));
  const targetBandAR = options.targetBandAR;
  if (targetBandAR && targetBandAR > 0) {
    const xIsBanded = xTotalNominalCount > 0 || xContinuousAsDiscrete > 0;
    const yIsBanded = yTotalNominalCount > 0 || yContinuousAsDiscrete > 0;
    if (xIsBanded && !yIsBanded) {
      const actualBandAR = subplotHeight / xStepSize;
      if (actualBandAR > targetBandAR) {
        const idealH = xStepSize * targetBandAR;
        const blendedH = Math.exp(
          0.5 * Math.log(subplotHeight) + 0.5 * Math.log(idealH)
        );
        subplotHeight = Math.round(
          Math.max(minContinuousSizeY, Math.min(blendedH, subplotHeight))
        );
      }
    } else if (yIsBanded && !xIsBanded) {
      const actualBandAR = subplotWidth / yStepSize;
      if (actualBandAR > targetBandAR) {
        const idealW = yStepSize * targetBandAR;
        const blendedW = Math.exp(
          0.5 * Math.log(subplotWidth) + 0.5 * Math.log(idealW)
        );
        subplotWidth = Math.round(
          Math.max(minContinuousSizeX, Math.min(blendedW, subplotWidth))
        );
      }
    }
  }
  const xHasDiscreteItems = xTotalNominalCount > 0;
  const yHasDiscreteItems = yTotalNominalCount > 0;
  let xLabel = computeLabelSizing(xStepSize, xHasDiscreteItems);
  let yLabel = computeLabelSizing(yStepSize, yHasDiscreteItems);
  if (xHasDiscreteItems) {
    const xf = channelSemantics.x?.field;
    const xt = effectiveTypes.x || channelSemantics.x?.type;
    const stats = computeDiscreteLabelStats(xf, table);
    if (stats) {
      const numericLike = xt === "quantitative" || stats.allNumeric;
      let labelPx = stats.maxLen * xLabel.fontSize * APPROX_CHAR_WIDTH_RATIO;
      const fewShortStrings = !numericLike && stats.count <= VL_SHORT_DISCRETE_CATEGORY_COUNT && stats.maxLen <= VL_SHORT_DISCRETE_LABEL_MAX_LEN;
      if (fewShortStrings || numericLike && labelPx <= xStepSize) {
        if (labelPx > xStepSize) {
          const desiredStep = Math.ceil(labelPx) + 6;
          const cap = Math.max(minStepVal, Math.floor(maxSubplotW / stats.count));
          if (desiredStep <= cap) {
            xStepSize = Math.max(xStepSize, desiredStep);
            xLabel = computeLabelSizing(xStepSize, xHasDiscreteItems);
            labelPx = stats.maxLen * xLabel.fontSize * APPROX_CHAR_WIDTH_RATIO;
          }
        }
        if (labelPx <= xStepSize) {
          xLabel = {
            ...xLabel,
            labelAngle: 0,
            labelAlign: "center",
            labelBaseline: "top"
          };
        } else {
          xLabel = {
            ...xLabel,
            labelAngle: -45,
            labelAlign: "right",
            labelBaseline: "top"
          };
        }
      } else if (numericLike && labelPx > xStepSize && xLabel.labelAngle === void 0) {
        xLabel = {
          ...xLabel,
          labelAngle: -45,
          labelAlign: "right",
          labelBaseline: "top"
        };
      }
    }
  }
  if (yHasDiscreteItems) {
    const yf = channelSemantics.y?.field;
    const yt = effectiveTypes.y || channelSemantics.y?.type;
    if (discreteYAxisShouldUseHorizontalLabels(yf, yt, table)) {
      yLabel = {
        ...yLabel,
        labelAngle: 0,
        labelAlign: "right",
        labelBaseline: "middle"
      };
    }
  }
  return {
    subplotWidth,
    subplotHeight,
    xStep: xStepSize,
    yStep: yStepSize,
    xStepUnit,
    yStepUnit,
    xContinuousAsDiscrete,
    yContinuousAsDiscrete,
    xNominalCount: xTotalNominalCount,
    yNominalCount: yTotalNominalCount,
    xLabel,
    yLabel,
    stepPadding: stepPaddingVal,
    facet: facetCols > 1 || facetRows > 1 ? {
      columns: facetCols,
      rows: facetRows,
      subplotWidth,
      subplotHeight
    } : void 0,
    effectiveFacetGap: gap,
    truncations: []
    // Overflow truncations are handled by filterOverflow
  };
}
function countDistinctSeries(channelSemantics, data) {
  const seriesFields = [];
  const colorField = channelSemantics.color?.field;
  const detailField = channelSemantics.detail?.field;
  if (colorField) seriesFields.push(colorField);
  if (detailField && detailField !== colorField) seriesFields.push(detailField);
  if (seriesFields.length === 0) return 1;
  const seriesKeys = /* @__PURE__ */ new Set();
  for (const row of data) {
    const key = seriesFields.map((f) => String(row[f] ?? "")).join("\0");
    seriesKeys.add(key);
  }
  return seriesKeys.size;
}
function computeBankingAR(xValues, yValues, xDomain, yDomain, seriesKeys, isConnected) {
  const MIN_AR = 0.5;
  const MAX_AR = 3;
  const xRange = xDomain[1] - xDomain[0];
  const yRange = yDomain[1] - yDomain[0];
  if (xRange <= 0 || yRange <= 0) return 1;
  if (!isConnected) {
    const n = xValues.length;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += (xValues[i] - xDomain[0]) / xRange;
      sumY += (yValues[i] - yDomain[0]) / yRange;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    let varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = (xValues[i] - xDomain[0]) / xRange - meanX;
      const dy = (yValues[i] - yDomain[0]) / yRange - meanY;
      varX += dx * dx;
      varY += dy * dy;
    }
    const sdX = Math.sqrt(varX / n);
    const sdY = Math.sqrt(varY / n);
    if (sdY <= 0) return MAX_AR;
    if (sdX <= 0) return MIN_AR;
    const sdRatio = sdX / sdY;
    const ar2 = sdRatio > 1 ? 1 + (sdRatio - 1) * 0.3 : 1 - (1 - sdRatio) * 0.3;
    return Math.min(MAX_AR, Math.max(MIN_AR, ar2));
  }
  const seriesMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < xValues.length; i++) {
    const key = seriesKeys[i];
    let arr = seriesMap.get(key);
    if (!arr) {
      arr = [];
      seriesMap.set(key, arr);
    }
    arr.push({ x: xValues[i], y: yValues[i] });
  }
  for (const pts of seriesMap.values()) {
    pts.sort((a, b) => a.x - b.x);
  }
  const scaleMedians = [];
  let maxSeriesLen = 0;
  for (const pts of seriesMap.values()) {
    if (pts.length > maxSeriesLen) maxSeriesLen = pts.length;
  }
  const maxScale = Math.max(0, Math.floor(Math.log2(maxSeriesLen)) - 1);
  for (let scale = 0; scale <= maxScale; scale++) {
    const windowSize = 1 << scale;
    const absSlopes = [];
    for (const pts of seriesMap.values()) {
      const n = pts.length;
      if (n < 2) continue;
      const smoothed = [];
      for (let i = 0; i < n; i += windowSize) {
        const end = Math.min(i + windowSize, n);
        let sx = 0, sy = 0;
        for (let j = i; j < end; j++) {
          sx += pts[j].x;
          sy += pts[j].y;
        }
        const cnt = end - i;
        smoothed.push({ x: sx / cnt, y: sy / cnt });
      }
      for (let i = 1; i < smoothed.length; i++) {
        const dx = (smoothed[i].x - smoothed[i - 1].x) / xRange;
        const dy = (smoothed[i].y - smoothed[i - 1].y) / yRange;
        if (dx === 0) continue;
        absSlopes.push(Math.abs(dy / dx));
      }
    }
    if (absSlopes.length === 0) continue;
    absSlopes.sort((a, b) => a - b);
    const mid = absSlopes.length >> 1;
    const median2 = absSlopes.length % 2 === 1 ? absSlopes[mid] : (absSlopes[mid - 1] + absSlopes[mid]) / 2;
    if (median2 > 0) {
      scaleMedians.push(median2);
    }
  }
  if (scaleMedians.length === 0) return 1;
  let logSum = 0;
  for (const m of scaleMedians) {
    logSum += Math.log(m);
  }
  const combinedSlope = Math.exp(logSum / scaleMedians.length);
  if (combinedSlope <= 0) return MAX_AR;
  const ar = Math.max(1, combinedSlope);
  return Math.min(MAX_AR, Math.max(MIN_AR, ar));
}
function computeChannelBudgets(channelSemantics, declaration, data, canvasSize, options) {
  const {
    minStep: minStepVal = 6,
    stepPadding: stepPaddingVal = 0.1,
    maxColorValues: maxColorVal = 24
  } = options;
  const { x: maxStretchX, y: maxStretchY } = resolveStretchCaps(options);
  const fixW = options.facetFixedPadding?.width ?? 0;
  const fixH = options.facetFixedPadding?.height ?? 0;
  const gap = options.facetGap ?? 0;
  const isDiscreteType2 = (t) => t === "nominal" || t === "ordinal";
  const effectiveType = (ch) => declaration.resolvedTypes?.[ch] ?? channelSemantics[ch]?.type;
  const facetGrid = computeFacetGrid(
    channelSemantics,
    declaration,
    data,
    canvasSize,
    options
  );
  const facetCols = facetGrid?.columns ?? 1;
  const facetRows = facetGrid?.rows ?? 1;
  const maxSubplotW = Math.max(
    options.minSubplotSize ?? 60,
    (canvasSize.width * maxStretchX - fixW) / facetCols - gap
  );
  const maxSubplotH = Math.max(
    options.minSubplotSize ?? 60,
    (canvasSize.height * maxStretchY - fixH) / facetRows - gap
  );
  const groupField = channelSemantics.group?.field;
  let groupCount = 0;
  let groupAxis;
  if (groupField) {
    groupCount = new Set(data.map((r) => r[groupField])).size;
    if (isDiscreteType2(effectiveType("x"))) groupAxis = "x";
    else if (isDiscreteType2(effectiveType("y"))) groupAxis = "y";
  }
  const xGroupMultiplier = groupAxis === "x" && groupCount > 1 ? groupCount : 1;
  const yGroupMultiplier = groupAxis === "y" && groupCount > 1 ? groupCount : 1;
  const MIN_GROUP_GAP_PX = 3;
  const xMinGroupStep = xGroupMultiplier > 1 ? Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * xGroupMultiplier) : minStepVal;
  const yMinGroupStep = yGroupMultiplier > 1 ? Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * yGroupMultiplier) : minStepVal;
  let maxXToKeep = Math.floor(maxSubplotW / xMinGroupStep);
  let maxYToKeep = Math.floor(maxSubplotH / yMinGroupStep);
  if (facetGrid) {
    const canvasXCap = Math.max(1, Math.floor(canvasSize.width / xMinGroupStep));
    const canvasYCap = Math.max(1, Math.floor(canvasSize.height / yMinGroupStep));
    if (maxXToKeep > canvasXCap || maxYToKeep > canvasYCap) {
      maxXToKeep = Math.min(maxXToKeep, canvasXCap);
      maxYToKeep = Math.min(maxYToKeep, canvasYCap);
      const colField = channelSemantics.column?.field;
      const rowField = channelSemantics.row?.field;
      const colCount = colField ? new Set(data.map((r) => r[colField])).size : 0;
      if (colCount > 1 && !rowField) {
        const tighterW = Math.max(
          options.minSubplotSize ?? 60,
          maxXToKeep * xMinGroupStep
        );
        const totalW = canvasSize.width * maxStretchX - fixW;
        const totalH = canvasSize.height * maxStretchY - fixH;
        const revisedMaxCols = Math.max(1, Math.floor(
          totalW / (tighterW + gap)
        ));
        const revisedMaxRows = Math.max(1, Math.floor(
          totalH / ((options.minSubplotSize ?? 60) + gap)
        ));
        const maxTotal = revisedMaxCols * revisedMaxRows;
        const effectiveCount = Math.min(colCount, maxTotal);
        const visRows = Math.ceil(effectiveCount / revisedMaxCols);
        const visCols = Math.ceil(effectiveCount / visRows);
        facetGrid.columns = visCols;
        facetGrid.rows = visRows;
        facetGrid.maxColumnValues = maxTotal;
      }
    }
  }
  const maxValues = {
    x: maxXToKeep,
    y: maxYToKeep,
    column: facetGrid?.maxColumnValues ?? Infinity,
    row: facetGrid?.maxRowValues ?? Infinity,
    color: maxColorVal
  };
  return { maxValues, facetGrid };
}
function computeFacetGrid(channelSemantics, declaration, data, canvasSize, options) {
  const { x: msX, y: msY } = resolveStretchCaps(options);
  const fixW = options.facetFixedPadding?.width ?? 0;
  const fixH = options.facetFixedPadding?.height ?? 0;
  const gap = options.facetGap ?? 0;
  const minStep = options.minStep ?? 6;
  const stepPadding = options.stepPadding ?? 0.1;
  const baseMinSubplot = options.minSubplotSize ?? 60;
  const isDiscreteType2 = (t) => t === "nominal" || t === "ordinal";
  const maxW = canvasSize.width * msX - fixW;
  const maxH = canvasSize.height * msY - fixH;
  const MIN_GROUP_GAP_PX = 3;
  const groupField = channelSemantics.group?.field;
  let groupCount = 0;
  let groupAxis;
  if (groupField) {
    groupCount = new Set(data.map((r) => r[groupField])).size;
    const xType = declaration.resolvedTypes?.x ?? channelSemantics.x?.type;
    const yType = declaration.resolvedTypes?.y ?? channelSemantics.y?.type;
    if (isDiscreteType2(xType)) groupAxis = "x";
    else if (isDiscreteType2(yType)) groupAxis = "y";
  }
  let minSubplotWidth = baseMinSubplot;
  let minSubplotHeight = baseMinSubplot;
  const LOG_PX_PER_DECADE_FACET = 40;
  for (const axis of ["x", "y"]) {
    const cs = channelSemantics[axis];
    if (!cs?.field || !cs.scaleType) continue;
    if (cs.scaleType !== "log" && cs.scaleType !== "symlog") continue;
    const vals = data.map((r) => r[cs.field]).filter((v) => typeof v === "number" && v > 0 && isFinite(v));
    if (vals.length < 2) continue;
    const decades = Math.log10(Math.max(...vals)) - Math.log10(Math.min(...vals));
    const needed = Math.ceil(Math.max(1, decades)) * LOG_PX_PER_DECADE_FACET;
    if (axis === "x") minSubplotWidth = Math.max(minSubplotWidth, needed);
    else minSubplotHeight = Math.max(minSubplotHeight, needed);
  }
  for (const axis of ["x", "y"]) {
    const cs = channelSemantics[axis];
    if (!cs?.field) continue;
    const effectiveType = declaration.resolvedTypes?.[axis] ?? cs.type;
    const isBanded = declaration.axisFlags?.[axis]?.banded === true;
    if (!isDiscreteType2(effectiveType) && !isBanded) continue;
    const valueCount = new Set(data.map((r) => r[cs.field])).size;
    const axisGroupCount = groupAxis === axis && groupCount > 1 ? groupCount : 1;
    const maxDim = axis === "x" ? maxW : maxH;
    let perCategoryStep;
    if (axisGroupCount > 1) {
      const minGroupStep = Math.max(
        Math.ceil(MIN_GROUP_GAP_PX / stepPadding),
        2 * axisGroupCount
      );
      perCategoryStep = Math.max(minStep * axisGroupCount, minGroupStep);
    } else {
      perCategoryStep = minStep;
    }
    const dataDrivenMin = Math.min(perCategoryStep * valueCount, maxDim);
    const minDim = Math.max(baseMinSubplot, dataDrivenMin);
    if (axis === "x") {
      minSubplotWidth = minDim;
    } else {
      minSubplotHeight = minDim;
    }
  }
  const xIsCont = (() => {
    const cs = channelSemantics.x;
    if (!cs?.field) return false;
    const t = declaration.resolvedTypes?.x ?? cs.type;
    return !isDiscreteType2(t) && !(declaration.axisFlags?.x?.banded === true);
  })();
  const yIsCont = (() => {
    const cs = channelSemantics.y;
    if (!cs?.field) return false;
    const t = declaration.resolvedTypes?.y ?? cs.type;
    return !isDiscreteType2(t) && !(declaration.axisFlags?.y?.banded === true);
  })();
  if (xIsCont && yIsCont) {
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    if (xCS?.field && yCS?.field) {
      const isTempX = (declaration.resolvedTypes?.x ?? xCS.type) === "temporal";
      const isTempY = (declaration.resolvedTypes?.y ?? yCS.type) === "temporal";
      const cmcs = options.continuousMarkCrossSection;
      const isConn = typeof cmcs === "object" && !!cmcs.seriesCountAxis;
      const xNum = [];
      const yNum = [];
      const sKeys = [];
      const sFields = [];
      const colF = channelSemantics.column?.field;
      const rowF = channelSemantics.row?.field;
      if (colF) sFields.push(colF);
      if (rowF) sFields.push(rowF);
      const cf = channelSemantics.color?.field;
      const df = channelSemantics.detail?.field;
      if (cf) sFields.push(cf);
      if (df && df !== cf) sFields.push(df);
      for (const row of data) {
        const xv = row[xCS.field];
        const yv = row[yCS.field];
        if (xv == null || yv == null) continue;
        const xn = isTempX ? +new Date(xv) : +xv;
        const yn = isTempY ? +new Date(yv) : +yv;
        if (isNaN(xn) || isNaN(yn)) continue;
        xNum.push(xn);
        yNum.push(yn);
        sKeys.push(sFields.length > 0 ? sFields.map((f) => String(row[f] ?? "")).join("\0") : "");
      }
      if (xNum.length > 1) {
        const xMin = Math.min(...xNum);
        const xMax = Math.max(...xNum);
        const yMin = Math.min(...yNum);
        const yMax = Math.max(...yNum);
        const xDom = [xMin, xMax];
        const yDom = [yMin, yMax];
        if (xCS.zero?.zero) {
          if (xDom[0] > 0) xDom[0] = 0;
          if (xDom[1] < 0) xDom[1] = 0;
        }
        if (yCS.zero?.zero) {
          if (yDom[0] > 0) yDom[0] = 0;
          if (yDom[1] < 0) yDom[1] = 0;
        }
        const ar = computeBankingAR(xNum, yNum, xDom, yDom, sKeys, isConn);
        if (ar >= 1) {
          minSubplotWidth = Math.max(
            minSubplotWidth,
            Math.round(baseMinSubplot * Math.min(ar, msX))
          );
          minSubplotHeight = Math.max(minSubplotHeight, baseMinSubplot);
        } else {
          minSubplotWidth = Math.max(minSubplotWidth, baseMinSubplot);
          minSubplotHeight = Math.max(
            minSubplotHeight,
            Math.round(baseMinSubplot * Math.min(1 / ar, msY))
          );
        }
      }
    }
  }
  const effectiveW = maxW;
  const effectiveH = maxH;
  const maxFacetColumns = Math.max(1, Math.floor(
    effectiveW / (minSubplotWidth + gap)
  ));
  const maxFacetRows = Math.max(1, Math.floor(
    effectiveH / (minSubplotHeight + gap)
  ));
  const colField = channelSemantics.column?.field;
  const rowField = channelSemantics.row?.field;
  if (!colField && !rowField) return void 0;
  const colCount = colField ? new Set(data.map((r) => r[colField])).size : 0;
  const rowCount = rowField ? new Set(data.map((r) => r[rowField])).size : 0;
  if (colCount === 0 && rowCount === 0) return void 0;
  if (colCount > 0 && rowCount === 0) {
    if (colCount <= maxFacetColumns) {
      return {
        columns: colCount,
        rows: 1,
        maxColumnValues: colCount,
        maxRowValues: maxFacetRows
      };
    }
    let nCols = maxFacetColumns;
    let nRows = Math.ceil(colCount / nCols);
    while (nCols > 2 && colCount % nCols === 1) {
      nCols--;
      nRows = Math.ceil(colCount / nCols);
    }
    const visRows = Math.min(nRows, maxFacetRows);
    const maxTotal = nCols * visRows;
    return {
      columns: nCols,
      rows: visRows,
      maxColumnValues: maxTotal,
      maxRowValues: maxFacetRows
    };
  }
  return {
    columns: Math.max(1, Math.min(colCount, maxFacetColumns)),
    rows: Math.max(1, Math.min(rowCount, maxFacetRows)),
    maxColumnValues: maxFacetColumns,
    maxRowValues: maxFacetRows
  };
}
function computeMinSubplotDimensions(channelSemantics, declaration, data, options) {
  const minStep = options.minStep ?? 6;
  const minSubplot = options.minSubplotSize ?? 60;
  let minSubplotWidth = minSubplot;
  let minSubplotHeight = minSubplot;
  const LOG_PX_PER_DECADE_MIN = 40;
  for (const axis of ["x", "y"]) {
    const cs = channelSemantics[axis];
    if (!cs?.field || !cs.scaleType) continue;
    if (cs.scaleType !== "log" && cs.scaleType !== "symlog") continue;
    const vals = data.map((r) => r[cs.field]).filter((v) => typeof v === "number" && v > 0 && isFinite(v));
    if (vals.length < 2) continue;
    const decades = Math.log10(Math.max(...vals)) - Math.log10(Math.min(...vals));
    const needed = Math.ceil(Math.max(1, decades)) * LOG_PX_PER_DECADE_MIN;
    if (axis === "x") minSubplotWidth = Math.max(minSubplotWidth, needed);
    else minSubplotHeight = Math.max(minSubplotHeight, needed);
  }
  const isDiscreteType2 = (t) => t === "nominal" || t === "ordinal";
  for (const axis of ["x", "y"]) {
    const cs = channelSemantics[axis];
    if (!cs?.field) continue;
    const effectiveType = declaration.resolvedTypes?.[axis] ?? cs.type;
    const isBanded = declaration.axisFlags?.[axis]?.banded === true;
    const isDiscrete21 = isDiscreteType2(effectiveType);
    let itemCount = 0;
    if (isBanded || isDiscrete21) {
      itemCount = new Set(data.map((r) => r[cs.field])).size;
    }
    if (itemCount > 0) {
      const minDim = Math.max(minSubplot, itemCount * minStep);
      if (axis === "x") {
        minSubplotWidth = Math.max(minSubplotWidth, minDim);
      } else {
        minSubplotHeight = Math.max(minSubplotHeight, minDim);
      }
    }
  }
  return { minSubplotWidth, minSubplotHeight };
}

// src/core/static-series.ts
var STATIC_SERIES_KEY_COLUMN = "__flint_series_key";
var STATIC_SERIES_VALUE_COLUMN = "__flint_series_value";
var MEASURE_CHANNELS = /* @__PURE__ */ new Set(["x", "y"]);
function coerceEncodingValue(value) {
  if (typeof value === "string") {
    return { field: value };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => typeof entry === "string" ? { field: entry } : entry);
  }
  return value;
}
function normalizeEncodingShorthand(encodings) {
  const out = {};
  for (const [channel, value] of Object.entries(encodings)) {
    out[channel] = coerceEncodingValue(value);
  }
  return out;
}
function normalizeStaticSeries(rawEncodings, data, semanticTypes) {
  const encodings = normalizeEncodingShorthand(rawEncodings);
  const arrayChannels = [];
  for (const [channel2, enc] of Object.entries(encodings)) {
    if (Array.isArray(enc)) {
      arrayChannels.push({ channel: channel2, entries: enc });
    }
  }
  if (arrayChannels.length === 0) {
    return {
      encodings,
      data
    };
  }
  if (arrayChannels.length > 1) {
    const channelNames = arrayChannels.map((c) => c.channel).join(", ");
    throw new Error(
      `Static series (array encoding) found on multiple channels: ${channelNames}. Only one channel may use array encoding at a time.`
    );
  }
  const { channel, entries } = arrayChannels[0];
  if (!MEASURE_CHANNELS.has(channel)) {
    throw new Error(
      `Static series (array encoding) is only allowed on measure channels (${[...MEASURE_CHANNELS].join(", ")}), not "${channel}".`
    );
  }
  if (entries.length < 2) {
    throw new Error(
      `Static series requires at least 2 fields, got ${entries.length} on channel "${channel}".`
    );
  }
  const fields = [];
  for (const entry of entries) {
    if (!entry.field) {
      throw new Error(
        `Each static series entry must have a "field" property.`
      );
    }
    fields.push(entry.field);
  }
  const fieldSet = new Set(fields);
  if (fieldSet.size !== fields.length) {
    throw new Error(
      `Static series contains duplicate fields. Each field must be unique.`
    );
  }
  if (data.length > 0) {
    const dataColumns = new Set(Object.keys(data[0]));
    for (const field of fields) {
      if (!dataColumns.has(field)) {
        throw new Error(
          `Static series field "${field}" not found in data columns. Available columns: ${[...dataColumns].join(", ")}`
        );
      }
    }
  }
  for (const entry of entries) {
    const field = entry.field;
    const explicitType = entry.type;
    if (explicitType === "nominal" || explicitType === "ordinal") {
      throw new Error(
        `Static series field "${field}" has type "${explicitType}" \u2014 only quantitative or temporal fields are allowed in static series.`
      );
    }
    if (!explicitType && data.length > 0) {
      const semType = semanticTypes[field];
      const semTypeStr = typeof semType === "string" ? semType : semType?.semanticType || "";
      const fromRegistry = semTypeStr ? getVisCategory(semTypeStr) : null;
      const inferred = fromRegistry ?? inferVisCategory(data.map((r) => r[field]));
      if (inferred === "nominal" || inferred === "ordinal") {
        throw new Error(
          `Static series field "${field}" infers as "${inferred}" from data \u2014 only quantitative or temporal fields are allowed in static series.`
        );
      }
    }
  }
  const colorEnc = encodings.color;
  if (colorEnc && !Array.isArray(colorEnc) && colorEnc.field) {
    throw new Error(
      `Cannot use static series on "${channel}" when the color channel is already bound to field "${colorEnc.field}". Static series implicitly uses the color channel for series discrimination.`
    );
  }
  const foldedData = foldData(data, fields);
  const normalizedEncodings = {};
  for (const [ch, enc] of Object.entries(encodings)) {
    if (ch === channel) {
      normalizedEncodings[ch] = { field: STATIC_SERIES_VALUE_COLUMN, type: "quantitative" };
    } else if (Array.isArray(enc)) {
      normalizedEncodings[ch] = enc[0];
    } else {
      normalizedEncodings[ch] = enc;
    }
  }
  const colorScheme = !Array.isArray(colorEnc) && colorEnc?.scheme ? colorEnc.scheme : void 0;
  normalizedEncodings.color = {
    field: STATIC_SERIES_KEY_COLUMN,
    type: "nominal",
    ...colorScheme ? { scheme: colorScheme } : {}
  };
  const metadata = {
    channel,
    fields,
    keyColumn: STATIC_SERIES_KEY_COLUMN,
    valueColumn: STATIC_SERIES_VALUE_COLUMN
  };
  return {
    encodings: normalizedEncodings,
    data: foldedData,
    staticSeries: metadata
  };
}
function foldData(data, fields) {
  const fieldSet = new Set(fields);
  const result = [];
  for (const row of data) {
    const baseRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (!fieldSet.has(key)) {
        baseRow[key] = value;
      }
    }
    for (const field of fields) {
      const value = row[field];
      if (value == null) continue;
      result.push({
        ...baseRow,
        [STATIC_SERIES_KEY_COLUMN]: field,
        [STATIC_SERIES_VALUE_COLUMN]: value
      });
    }
  }
  return result;
}

// src/core/recommendation.ts
var FAMILY_XY_STANDARD = {
  x: "category",
  y: "measure",
  color: "series",
  opacity: "auxiliary",
  size: "auxiliary",
  shape: "auxiliary",
  detail: "auxiliary",
  group: "series",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_XY_HORIZONTAL = {
  y: "category",
  x: "measure",
  color: "series",
  opacity: "auxiliary",
  size: "auxiliary",
  shape: "auxiliary",
  detail: "auxiliary",
  group: "series",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_PIE = {
  color: "category",
  size: "measure",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_ROSE = {
  x: "category",
  y: "measure",
  color: "series",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_RADAR = {
  x: "category",
  y: "measure",
  color: "series",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_MAP = {
  latitude: "geo",
  longitude: "geo",
  color: "series",
  size: "auxiliary",
  opacity: "auxiliary"
};
var FAMILY_CHOROPLETH = {
  id: "geo",
  color: "measure",
  detail: "auxiliary"
};
var FAMILY_CANDLESTICK = {
  x: "category",
  open: "price",
  high: "price",
  low: "price",
  close: "price",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_HISTOGRAM = {
  x: "measure",
  color: "series",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_DENSITY = {
  x: "measure",
  color: "series",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_HEATMAP = {
  x: "category",
  y: "category",
  color: "measure",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_GAUGE = {
  size: "measure",
  column: "facetCol"
};
var FAMILY_FUNNEL = {
  y: "category",
  size: "measure"
};
var FAMILY_TREEMAP = {
  color: "category",
  size: "measure",
  detail: "auxiliary",
  group: "auxiliary"
};
var FAMILY_SANKEY = {
  x: "category",
  y: "category",
  size: "measure"
};
var FAMILY_GANTT = {
  y: "category",
  x: "measure",
  x2: "measure2",
  color: "series",
  detail: "auxiliary",
  column: "facetCol",
  row: "facetRow"
};
var FAMILY_BULLET = {
  y: "category",
  x: "measure",
  goal: "measure2",
  color: "series",
  column: "facetCol",
  row: "facetRow"
};
var CHART_ROLE_MAP = {
  // Axis-based (x/y standard)
  "Bar Chart": FAMILY_XY_STANDARD,
  "Pyramid Chart": FAMILY_XY_HORIZONTAL,
  "Grouped Bar Chart": FAMILY_XY_STANDARD,
  "Stacked Bar Chart": FAMILY_XY_STANDARD,
  "Lollipop Chart": FAMILY_XY_STANDARD,
  "Waterfall Chart": FAMILY_XY_STANDARD,
  "Gantt Chart": FAMILY_GANTT,
  "Bullet Chart": FAMILY_BULLET,
  "Bar Table": FAMILY_XY_HORIZONTAL,
  "Line Chart": FAMILY_XY_STANDARD,
  "Bump Chart": FAMILY_XY_STANDARD,
  "Area Chart": FAMILY_XY_STANDARD,
  "Streamgraph": FAMILY_XY_STANDARD,
  "Scatter Plot": FAMILY_XY_STANDARD,
  "Connected Scatter Plot": FAMILY_XY_STANDARD,
  "Regression": FAMILY_XY_STANDARD,
  "Ranged Dot Plot": FAMILY_XY_STANDARD,
  "Boxplot": FAMILY_XY_STANDARD,
  "Strip Plot": FAMILY_XY_STANDARD,
  // Pie-like
  "Pie Chart": FAMILY_PIE,
  // Polar
  "Rose Chart": FAMILY_ROSE,
  "Radar Chart": FAMILY_RADAR,
  // Heatmap
  "Heatmap": FAMILY_HEATMAP,
  // Histogram / Density
  "Histogram": FAMILY_HISTOGRAM,
  "Density Plot": FAMILY_DENSITY,
  // Geographic
  "Map": FAMILY_MAP,
  "Choropleth": FAMILY_CHOROPLETH,
  // Financial
  "Candlestick Chart": FAMILY_CANDLESTICK,
  // ECharts-only
  "Gauge Chart": FAMILY_GAUGE,
  "Funnel Chart": FAMILY_FUNNEL,
  "Treemap": FAMILY_TREEMAP,
  "Sunburst Chart": FAMILY_TREEMAP,
  "Sankey Diagram": FAMILY_SANKEY
};
function getChannelRole(chartType, channel) {
  const roleMap = CHART_ROLE_MAP[chartType];
  if (roleMap && channel in roleMap) return roleMap[channel];
  if (channel === "column") return "facetCol";
  if (channel === "row") return "facetRow";
  return "auxiliary";
}
function findChannelsByRole(chartType, templateChannels, role) {
  return templateChannels.filter((ch) => getChannelRole(chartType, ch) === role);
}
var FALLBACK_CHAIN = {
  measure2: ["measure", "auxiliary"],
  series: ["auxiliary"],
  category: ["series", "auxiliary"],
  measure: ["auxiliary"],
  geo: ["category"],
  price: ["measure", "auxiliary"]
};
var ROLE_PRIORITY = {
  category: 0,
  measure: 1,
  series: 2,
  facetCol: 3,
  facetRow: 4,
  measure2: 5,
  auxiliary: 6,
  geo: 7,
  price: 8
};
function adaptChannels(sourceType, targetType, targetChannels, encodings, data, semanticTypes, recommendFn) {
  if (data && data.length > 0) {
    return adaptViaRecommendation(sourceType, targetType, targetChannels, encodings, data, semanticTypes ?? {});
  }
  return adaptViaRoles(sourceType, targetType, targetChannels, encodings);
}
function adaptViaRecommendation(sourceType, targetType, targetChannels, encodings, data, semanticTypes, _recommendFn) {
  const FACET_CHANNELS = ["column", "row"];
  let facetedData = data;
  const prePinned = {};
  const prePinnedFields = /* @__PURE__ */ new Set();
  for (const ch of FACET_CHANNELS) {
    const field = encodings[ch];
    if (field && targetChannels.includes(ch)) {
      prePinned[ch] = field;
      prePinnedFields.add(field);
      if (facetedData.length > 0) {
        const firstVal = facetedData[0][field];
        facetedData = facetedData.filter((row) => row[field] === firstVal);
      }
    }
  }
  const tv = buildTableView(facetedData, semanticTypes);
  const isFieldCompatibleWithRole = (role, field) => {
    const ft = tv.fieldType[field] ?? "nominal";
    const st = tv.fieldSemanticType[field] ?? "";
    const card = tv.fieldLevels[field]?.length ?? 0;
    switch (role) {
      // 'category' is for true discrete axes (nominal/ordinal/temporal).
      // Quantitative fields — even low-cardinality ones — must NOT
      // satisfy this role, otherwise a measure can land on the
      // category axis (e.g. Bar Table y) and push the real discrete
      // field onto color.
      case "category":
        return !isQuantitativeField(ft, st) && isDiscreteLike(ft, st, card);
      case "measure":
        return isQuantitativeField(ft, st);
      case "series":
        return isDiscreteLike(ft, st, card);
      case "geo":
        return isGeoCoordinateType(st) || ft === "quantitative";
      case "facetCol":
      case "facetRow":
        return isDiscreteLike(ft, st, card);
      case "auxiliary":
        return true;
      default:
        return true;
    }
  };
  const assignCost = (srcCh, field, targetCh) => {
    const targetRole = getChannelRole(targetType, targetCh);
    if (!isFieldCompatibleWithRole(targetRole, field)) return Infinity;
    const srcRole = getChannelRole(sourceType, srcCh);
    if (srcCh === targetCh && srcRole === targetRole) return 0;
    if (srcRole === targetRole) return 0.5;
    if (srcCh === targetCh) return 1;
    return 1;
  };
  const COST_DROP = 1.5;
  const entries = Object.entries(encodings).filter(([ch, f]) => f && !FACET_CHANNELS.includes(ch) && !prePinnedFields.has(f));
  const availableTargets = targetChannels.filter((ch) => !(ch in prePinned));
  let bestCost = Infinity;
  let bestAssignment = {};
  const usedTargets = /* @__PURE__ */ new Set();
  function solve(idx, currentCost, assignment) {
    if (currentCost >= bestCost) return;
    if (idx === entries.length) {
      bestCost = currentCost;
      bestAssignment = { ...assignment };
      return;
    }
    const [srcCh, field] = entries[idx];
    for (const tch of availableTargets) {
      if (usedTargets.has(tch)) continue;
      const cost = assignCost(srcCh, field, tch);
      if (cost === Infinity) continue;
      usedTargets.add(tch);
      assignment[tch] = field;
      solve(idx + 1, currentCost + cost, assignment);
      delete assignment[tch];
      usedTargets.delete(tch);
    }
    solve(idx + 1, currentCost + COST_DROP, assignment);
  }
  solve(0, 0, {});
  const result = { ...prePinned, ...bestAssignment };
  return result;
}
function adaptViaRoles(sourceType, targetType, targetChannels, encodings) {
  const result = {};
  const filledEncodings = [];
  for (const [ch, field] of Object.entries(encodings)) {
    if (field) {
      filledEncodings.push({ channel: ch, role: getChannelRole(sourceType, ch), field });
    }
  }
  filledEncodings.sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]);
  const assigned = /* @__PURE__ */ new Set();
  for (const { channel: srcCh, role: srcRole, field } of filledEncodings) {
    let placed = false;
    if (targetChannels.includes(srcCh) && !assigned.has(srcCh)) {
      if (getChannelRole(targetType, srcCh) === srcRole) {
        result[srcCh] = field;
        assigned.add(srcCh);
        placed = true;
      }
    }
    if (!placed) {
      placed = tryAssign(srcRole, field, targetType, targetChannels, result, assigned, srcCh);
    }
    if (!placed) {
      const chain = FALLBACK_CHAIN[srcRole];
      if (chain) {
        for (const fallbackRole of chain) {
          placed = tryAssign(fallbackRole, field, targetType, targetChannels, result, assigned, srcCh);
          if (placed) break;
        }
      }
    }
  }
  return result;
}
function tryAssign(role, field, targetType, targetChannels, result, assigned, preferredName) {
  const candidates = findChannelsByRole(targetType, targetChannels, role).filter((ch) => !assigned.has(ch));
  if (candidates.length === 0) return false;
  const best = preferredName && candidates.includes(preferredName) ? preferredName : candidates[0];
  result[best] = field;
  assigned.add(best);
  return true;
}
function buildTableView(data, semanticTypes) {
  const names = data.length > 0 ? Object.keys(data[0]) : [];
  const fieldType = {};
  const fieldSemanticType = {};
  const fieldLevels = {};
  for (const name of names) {
    const values = data.map((r) => r[name]);
    const semanticType = semanticTypes[name] || "";
    fieldType[name] = semanticType && getVisCategory(semanticType) || inferVisCategory(values);
    fieldSemanticType[name] = semanticType;
    fieldLevels[name] = [...new Set(data.map((r) => r[name]).filter((v) => v != null))];
  }
  return { names, fieldType, fieldSemanticType, fieldLevels, rows: data };
}
var Pref = { STRONG: 3, OK: 2, WEAK: 1, EXCLUDE: -Infinity };
function resolveAssignment(tv, used, channelPrefs) {
  const candidates = tv.names.filter((n) => !used.has(n) && (!isLikelyIdentifierOrRank(n) || tv.preferredFields?.has(n)));
  const C = channelPrefs.length;
  const F = candidates.length;
  if (F < C) return {};
  const scores = [];
  for (let ci = 0; ci < C; ci++) {
    scores[ci] = [];
    for (let fi = 0; fi < F; fi++) {
      const name = candidates[fi];
      const type = tv.fieldType[name] ?? "nominal";
      const st = tv.fieldSemanticType[name] ?? "";
      const card = tv.fieldLevels[name]?.length ?? 0;
      scores[ci][fi] = channelPrefs[ci].pref(name, type, st, card, card > 0);
    }
  }
  let bestScore = -Infinity;
  let bestAssign;
  const perm = new Array(C);
  const usedF = new Uint8Array(F);
  function search(depth, totalScore) {
    if (depth === C) {
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestAssign = [...perm];
      }
      return;
    }
    for (let fi = 0; fi < F; fi++) {
      if (usedF[fi]) continue;
      const s = scores[depth][fi];
      if (s === -Infinity) continue;
      if (totalScore + s <= bestScore - (C - depth - 1) * Pref.STRONG) continue;
      perm[depth] = fi;
      usedF[fi] = 1;
      search(depth + 1, totalScore + s);
      usedF[fi] = 0;
    }
  }
  search(0, 0);
  if (!bestAssign) return {};
  const result = {};
  for (let ci = 0; ci < C; ci++) {
    const fieldName = candidates[bestAssign[ci]];
    result[channelPrefs[ci].channel] = fieldName;
    used.add(fieldName);
  }
  return result;
}
function isTemporalField(type, semanticType) {
  return type === "temporal" || isTimeSeriesType(semanticType);
}
function isQuantitativeField(type, semanticType) {
  if (isTemporalField(type, semanticType)) return false;
  if (type !== "quantitative") return false;
  if (isNonMeasureNumeric(semanticType)) return false;
  return isMeasureType(semanticType) || semanticType === "";
}
function isOrdinalField(type, semanticType, hasLevels) {
  if (hasLevels) return true;
  return isOrdinalType(semanticType);
}
function isCategoricalFieldCheck(type, semanticType) {
  if (isTemporalField(type, semanticType)) return false;
  if (isQuantitativeField(type, semanticType)) return false;
  return type === "nominal" || isCategoricalType(semanticType);
}
function isDiscreteLike(type, semanticType, cardinality, maxCard = 50) {
  if (isCategoricalFieldCheck(type, semanticType)) return true;
  if (isTemporalField(type, semanticType)) return true;
  if (isOrdinalType(semanticType)) return true;
  if (type === "quantitative" && cardinality > 0 && cardinality <= maxCard) return true;
  return false;
}
function nameMatches(name, patterns) {
  const lower = name.toLowerCase();
  return patterns.some((p) => lower === p) || patterns.some((p) => lower.includes(p));
}
function isLikelyIdentifierOrRank(name) {
  const lower = name.toLowerCase();
  const idPatterns = ["rank", "id", "index", "idx", "row", "order", "position", "pos"];
  return idPatterns.some((p) => lower === p || lower.endsWith("_" + p) || lower.endsWith(p));
}
function pick(tv, used, predicate) {
  const candidates = [];
  for (const name of tv.names) {
    if (used.has(name)) continue;
    const type = tv.fieldType[name] ?? "nominal";
    const semanticType = tv.fieldSemanticType[name] ?? "";
    const cardinality = tv.fieldLevels[name]?.length ?? 0;
    const hasLevels = cardinality > 0;
    if (predicate(name, type, semanticType, cardinality, hasLevels)) {
      candidates.push(name);
    }
  }
  if (candidates.length === 0) return void 0;
  if (tv.preferredFields) {
    const preferred = candidates.filter((n) => tv.preferredFields.has(n));
    if (preferred.length > 0) {
      const chosen2 = preferred[Math.floor(Math.random() * preferred.length)];
      used.add(chosen2);
      return chosen2;
    }
  }
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  used.add(chosen);
  return chosen;
}
var pickQuantitative = (tv, u) => pick(tv, u, (name, ty, st) => isQuantitativeField(ty, st) && (!isLikelyIdentifierOrRank(name) || !!tv.preferredFields?.has(name)));
var pickTemporal = (tv, u) => pick(tv, u, (_n, ty, st) => isTemporalField(ty, st));
var pickNominal = (tv, u) => pick(tv, u, (_n, ty, st) => isCategoricalFieldCheck(ty, st));
var pickLowCardNominal = (tv, u, maxCard = 30) => pick(tv, u, (_n, ty, st, card) => isCategoricalFieldCheck(ty, st) && card > 0 && card <= maxCard);
var pickOrdinal = (tv, u) => pick(tv, u, (_n, ty, st, _card, hasLevels) => isOrdinalField(ty, st, hasLevels));
var pickGeo = (tv, u) => pick(tv, u, (_n, _ty, st) => isGeoType(st));
var pickDiscrete = (tv, u) => pick(tv, u, (name, ty, st, card) => isDiscreteLike(ty, st, card) && (!isLikelyIdentifierOrRank(name) || !!tv.preferredFields?.has(name)));
var pickLowCardDiscrete = (tv, u, maxCard = 30) => pick(
  tv,
  u,
  (name, ty, st, card) => isDiscreteLike(ty, st, card, maxCard) && card > 0 && card <= maxCard && (!isLikelyIdentifierOrRank(name) || !!tv.preferredFields?.has(name))
);
var pickSeriesAxis = (tv, u) => pickTemporal(tv, u) ?? pickOrdinal(tv, u) ?? pickNominal(tv, u);
var pickQuantitativeByName = (tv, u, patterns) => pick(tv, u, (name, ty, st) => isQuantitativeField(ty, st) && nameMatches(name, patterns));
function pickAllQuantitative(tv, used) {
  const result = [];
  for (const name of tv.names) {
    if (used.has(name)) continue;
    const type = tv.fieldType[name] ?? "nominal";
    const semanticType = tv.fieldSemanticType[name] ?? "";
    if (isQuantitativeField(type, semanticType) && (!isLikelyIdentifierOrRank(name) || tv.preferredFields?.has(name))) {
      result.push(name);
    }
  }
  for (const name of result) used.add(name);
  return result;
}
function hasMultipleValuesPerField(tv, fieldName) {
  if (!fieldName || !tv.rows || tv.rows.length === 0) return false;
  const seen = /* @__PURE__ */ new Set();
  for (const row of tv.rows) {
    const val = row[fieldName];
    if (seen.has(val)) return true;
    seen.add(val);
  }
  return false;
}
function isValidGroupingField(tv, xField, colorField) {
  if (!xField || !colorField || !tv.rows || tv.rows.length === 0) return false;
  const seen = /* @__PURE__ */ new Set();
  for (const row of tv.rows) {
    const key = `${row[xField]}|||${row[colorField]}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
function pickValidGroupingField(tv, used, xField, maxCard = 20) {
  const candidates = [];
  for (const name of tv.names) {
    if (used.has(name)) continue;
    const type = tv.fieldType[name] ?? "nominal";
    const semanticType = tv.fieldSemanticType[name] ?? "";
    const cardinality = tv.fieldLevels[name]?.length ?? 0;
    if (!isDiscreteLike(type, semanticType, cardinality, maxCard)) continue;
    if (cardinality <= 0 || cardinality > maxCard) continue;
    if (isLikelyIdentifierOrRank(name) && !tv.preferredFields?.has(name)) continue;
    if (isValidGroupingField(tv, xField, name)) candidates.push(name);
  }
  if (candidates.length === 0) return void 0;
  if (tv.preferredFields) {
    const preferred = candidates.filter((n) => tv.preferredFields.has(n));
    if (preferred.length > 0) {
      const chosen2 = preferred[Math.floor(Math.random() * preferred.length)];
      used.add(chosen2);
      return chosen2;
    }
  }
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  used.add(chosen);
  return chosen;
}
function isValidLineSeriesData(tv, xField, colorField) {
  if (!tv.rows || tv.rows.length === 0) return false;
  const xColorCombinations = /* @__PURE__ */ new Set();
  const colorGroupCounts = /* @__PURE__ */ new Map();
  for (const row of tv.rows) {
    const xVal = row[xField];
    const colorVal = colorField ? row[colorField] : "__single__";
    const xColorKey = `${xVal}|||${colorVal}`;
    if (xColorCombinations.has(xColorKey)) return false;
    xColorCombinations.add(xColorKey);
    colorGroupCounts.set(colorVal, (colorGroupCounts.get(colorVal) ?? 0) + 1);
  }
  let validGroups = 0;
  let totalGroups = 0;
  for (const count of colorGroupCounts.values()) {
    totalGroups++;
    if (count >= 2) validGroups++;
  }
  return totalGroups > 0 && validGroups / totalGroups > 0.5;
}
function pickLineChartColorField(tv, used, xField, maxCard = 20) {
  const candidates = [];
  for (const name of tv.names) {
    if (used.has(name)) continue;
    const type = tv.fieldType[name] ?? "nominal";
    const semanticType = tv.fieldSemanticType[name] ?? "";
    const cardinality = tv.fieldLevels[name]?.length ?? 0;
    if (!isDiscreteLike(type, semanticType, cardinality, maxCard)) continue;
    if (cardinality <= 0 || cardinality > maxCard) continue;
    if (isLikelyIdentifierOrRank(name) && !tv.preferredFields?.has(name)) continue;
    if (isValidLineSeriesData(tv, xField, name)) candidates.push(name);
  }
  if (candidates.length === 0) return void 0;
  if (tv.preferredFields) {
    const preferred = candidates.filter((n) => tv.preferredFields.has(n));
    if (preferred.length > 0) {
      const chosen2 = preferred[Math.floor(Math.random() * preferred.length)];
      used.add(chosen2);
      return chosen2;
    }
  }
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  used.add(chosen);
  return chosen;
}
function calculateMultiplicity(tv, xField, colorField) {
  if (!tv.rows || tv.rows.length === 0) return 1;
  const groups = /* @__PURE__ */ new Set();
  for (const row of tv.rows) {
    const key = colorField ? `${row[xField]}|||${row[colorField]}` : `${row[xField]}`;
    groups.add(key);
  }
  return tv.rows.length / groups.size;
}
function pickBestGroupingField(tv, used, xField, maxMultiplicity = 5) {
  const baseMultiplicity = calculateMultiplicity(tv, xField);
  if (baseMultiplicity <= 1) return void 0;
  let bestField;
  let bestMultiplicity = baseMultiplicity;
  for (const name of tv.names) {
    if (used.has(name)) continue;
    const type = tv.fieldType[name] ?? "nominal";
    const semanticType = tv.fieldSemanticType[name] ?? "";
    const cardinality = tv.fieldLevels[name]?.length ?? 0;
    if (!isDiscreteLike(type, semanticType, cardinality)) continue;
    if (isLikelyIdentifierOrRank(name) && !tv.preferredFields?.has(name)) continue;
    const multiplicity = calculateMultiplicity(tv, xField, name);
    if (multiplicity < bestMultiplicity) {
      bestMultiplicity = multiplicity;
      bestField = name;
      if (multiplicity <= 1) break;
    }
  }
  if (bestField && bestMultiplicity < baseMultiplicity && bestMultiplicity <= maxMultiplicity) {
    used.add(bestField);
    return bestField;
  }
  return void 0;
}
function recommendChannels(chartType, data, semanticTypes, recommendFn) {
  const fn = recommendFn ?? getRecommendation;
  return fn(chartType, buildTableView(data, semanticTypes));
}
function getRecommendation(chartType, tv) {
  const used = /* @__PURE__ */ new Set();
  const rec = {};
  const assign = (channel, fieldName) => {
    if (fieldName) rec[channel] = fieldName;
  };
  switch (chartType) {
    case "Scatter Plot": {
      const yField = pickQuantitative(tv, used) ?? pickTemporal(tv, used) ?? pickNominal(tv, used);
      const xField = pickQuantitative(tv, used) ?? pickTemporal(tv, used) ?? pickNominal(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      assign("color", pickLowCardNominal(tv, used));
      break;
    }
    case "Bar Chart":
    case "Stacked Bar Chart": {
      const xField = pickDiscrete(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      if (hasMultipleValuesPerField(tv, xField)) {
        assign("color", pickBestGroupingField(tv, used, xField));
      }
      break;
    }
    case "Grouped Bar Chart": {
      const xField = pickDiscrete(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      const colorField = pickValidGroupingField(tv, used, xField, 20);
      if (!colorField) return {};
      assign("x", xField);
      assign("y", yField);
      assign("color", colorField);
      break;
    }
    case "Histogram": {
      const xField = pickQuantitative(tv, used);
      if (!xField) return {};
      assign("x", xField);
      break;
    }
    case "Heatmap": {
      const heatmapResult = resolveAssignment(tv, used, [
        {
          channel: "x",
          pref: (_n, ty, st, card) => {
            if (isTimeSeriesType(st)) return Pref.STRONG;
            if (isCategoricalType(st)) return Pref.OK;
            if (isOrdinalType(st)) return Pref.OK;
            if (isNonMeasureNumeric(st)) return Pref.OK;
            if (ty === "nominal") return Pref.OK;
            if (ty === "temporal") return Pref.STRONG;
            if (ty === "quantitative" && card > 0 && card <= 50) return Pref.WEAK;
            return Pref.EXCLUDE;
          }
        },
        {
          channel: "y",
          pref: (_n, ty, st, card) => {
            if (isCategoricalType(st)) return Pref.STRONG;
            if (isTimeSeriesType(st)) return Pref.OK;
            if (isOrdinalType(st)) return Pref.OK;
            if (isNonMeasureNumeric(st)) return Pref.OK;
            if (ty === "nominal") return Pref.STRONG;
            if (ty === "temporal") return Pref.OK;
            if (ty === "quantitative" && card > 0 && card <= 50) return Pref.WEAK;
            return Pref.EXCLUDE;
          }
        },
        {
          channel: "color",
          pref: (_n, ty, st) => {
            if (isMeasureType(st)) return Pref.STRONG;
            if (isOrdinalType(st)) return Pref.OK;
            if (ty === "quantitative" && !st) return Pref.STRONG;
            if (ty === "temporal") return Pref.WEAK;
            if (ty === "nominal") return Pref.WEAK;
            return Pref.EXCLUDE;
          }
        }
      ]);
      if (!heatmapResult["x"] || !heatmapResult["y"] || !heatmapResult["color"]) return {};
      assign("x", heatmapResult["x"]);
      assign("y", heatmapResult["y"]);
      assign("color", heatmapResult["color"]);
      break;
    }
    case "Line Chart": {
      const xField = pickSeriesAxis(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      if (!isValidLineSeriesData(tv, xField, void 0)) {
        const colorField = pickLineChartColorField(tv, used, xField, 20) ?? pickLineChartColorField(tv, used, xField, 200);
        if (!colorField) return {};
        assign("color", colorField);
      }
      break;
    }
    case "Boxplot": {
      const xField = pickDiscrete(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      break;
    }
    case "Pie Chart": {
      const sizeField = pickQuantitative(tv, used);
      const colorField = pickLowCardDiscrete(tv, used, 12);
      if (!sizeField || !colorField) return {};
      assign("size", sizeField);
      assign("color", colorField);
      break;
    }
    case "Area Chart": {
      const xField = pickSeriesAxis(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      assign("color", pickLineChartColorField(tv, used, xField, 20));
      break;
    }
    case "Streamgraph": {
      const streamResult = resolveAssignment(tv, used, [
        {
          channel: "x",
          pref: (_n, ty, st, card) => {
            if (isTimeSeriesType(st)) return Pref.STRONG;
            if (isOrdinalType(st)) return Pref.OK;
            if (isCategoricalType(st)) return Pref.OK;
            if (isNonMeasureNumeric(st)) return Pref.OK;
            if (ty === "temporal") return Pref.STRONG;
            if (ty === "nominal") return Pref.OK;
            if (ty === "quantitative" && card > 0 && card <= 50) return Pref.OK;
            return Pref.EXCLUDE;
          }
        },
        {
          channel: "y",
          pref: (_n, ty, st, card) => {
            if (isMeasureType(st)) return Pref.STRONG;
            if (isTimeSeriesType(st)) return Pref.EXCLUDE;
            if (isCategoricalType(st)) return Pref.EXCLUDE;
            if (isNonMeasureNumeric(st)) return Pref.EXCLUDE;
            if (ty === "quantitative" && !st)
              return card > 20 ? Pref.STRONG : Pref.OK;
            return Pref.EXCLUDE;
          }
        },
        {
          channel: "color",
          pref: (_n, ty, st, card) => {
            if (isCategoricalType(st)) return Pref.STRONG;
            if (isOrdinalType(st)) return Pref.OK;
            if (isTimeSeriesType(st)) return Pref.OK;
            if (ty === "nominal") return Pref.STRONG;
            if (ty === "temporal" || ty === "ordinal") return Pref.OK;
            if (isDiscreteLike(ty, st, card, 20)) return Pref.WEAK;
            return Pref.EXCLUDE;
          }
        }
      ]);
      if (!streamResult["x"] || !streamResult["y"] || !streamResult["color"]) return {};
      assign("x", streamResult["x"]);
      assign("y", streamResult["y"]);
      assign("color", streamResult["color"]);
      break;
    }
    case "Radar Chart": {
      const xField = pickDiscrete(tv, used) ?? pickLowCardDiscrete(tv, used, 20);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      assign("color", pickLowCardDiscrete(tv, used, 20));
      break;
    }
    case "Candlestick Chart": {
      const xField = pickTemporal(tv, used) ?? pick(tv, used, (name) => nameMatches(name, ["date", "time", "day", "datetime", "timestamp", "period"])) ?? pickQuantitativeByName(tv, used, ["date", "time", "day"]) ?? pickDiscrete(tv, used);
      if (!xField) return {};
      assign("x", xField);
      const openField = pickQuantitativeByName(tv, used, ["open"]);
      const highField = pickQuantitativeByName(tv, used, ["high"]);
      const lowField = pickQuantitativeByName(tv, used, ["low"]);
      const closeField = pickQuantitativeByName(tv, used, ["close"]);
      if (openField && highField && lowField && closeField) {
        assign("open", openField);
        assign("high", highField);
        assign("low", lowField);
        assign("close", closeField);
      } else {
        const quants = pickAllQuantitative(tv, used);
        if (quants.length >= 4) {
          assign("open", quants[0]);
          assign("high", quants[1]);
          assign("low", quants[2]);
          assign("close", quants[3]);
        }
      }
      break;
    }
  }
  return rec;
}

// src/core/aggregate.ts
function applyAggregation(encodings, data) {
  if (!data || data.length === 0) return data;
  const specs = [];
  for (const enc of Object.values(encodings)) {
    if (!enc || !enc.aggregate) continue;
    const op = enc.aggregate;
    if (op !== "count" && !enc.field) continue;
    const target = op === "count" ? "_count" : `${enc.field}_${op}`;
    specs.push({ field: enc.field, op, target });
  }
  if (specs.length === 0) return data;
  const firstRow = data[0];
  const allPresent = specs.every(
    (s) => Object.prototype.hasOwnProperty.call(firstRow, s.target)
  );
  if (allPresent) return data;
  const groupFields = [];
  const seen = /* @__PURE__ */ new Set();
  for (const enc of Object.values(encodings)) {
    if (!enc || enc.aggregate || !enc.field) continue;
    if (seen.has(enc.field)) continue;
    seen.add(enc.field);
    groupFields.push(enc.field);
  }
  const groups = /* @__PURE__ */ new Map();
  for (const row of data) {
    const key = JSON.stringify(groupFields.map((f) => row[f] ?? null));
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(row);
  }
  const toNum = (v) => typeof v === "number" ? v : Number(v);
  const reduceOp = (rows, spec) => {
    if (spec.op === "count") return rows.length;
    const nums = rows.map((r) => toNum(r[spec.field])).filter((v) => Number.isFinite(v));
    if (nums.length === 0) return 0;
    const sum = nums.reduce((a, b) => a + b, 0);
    return spec.op === "sum" ? sum : sum / nums.length;
  };
  const out = [];
  for (const rows of groups.values()) {
    const head = rows[0];
    const aggregated = {};
    for (const f of groupFields) aggregated[f] = head[f];
    for (const spec of specs) {
      const val = reduceOp(rows, spec);
      aggregated[spec.target] = val;
      if (spec.op !== "count" && spec.field) aggregated[spec.field] = val;
    }
    out.push(aggregated);
  }
  return out;
}

// src/vegalite/templates/utils.ts
function resolveAsDiscrete(encodingObj, table) {
  if (!encodingObj) return "nominal";
  const result = resolveDiscreteType(encodingObj.type, encodingObj.field, table);
  encodingObj.type = result;
  return result;
}
var defaultBuildEncodings = (spec, encodings) => {
  if (!spec.encoding) spec.encoding = {};
  for (const [channel, encodingObj] of Object.entries(encodings)) {
    if (Object.keys(encodingObj).length > 0) {
      const existing = spec.encoding[channel];
      if (existing && typeof existing === "object") {
        spec.encoding[channel] = { ...existing, ...encodingObj };
      } else {
        spec.encoding[channel] = encodingObj;
      }
    }
  }
};
function setMarkProp(mark, key, value) {
  if (typeof mark === "string") {
    return { type: mark, [key]: value };
  }
  return { ...mark, [key]: value };
}
var applyPointSizeScaling = (vgSpec, table, plotWidth = 400, plotHeight = 300, targetCoverage = 0.15, defaultSize = 30, minSize = 4) => {
  if (!table || table.length === 0) return vgSpec;
  const markType = typeof vgSpec.mark === "string" ? vgSpec.mark : vgSpec.mark?.type;
  if (!["circle", "point", "square"].includes(markType)) return vgSpec;
  if (vgSpec.encoding?.size?.field) return vgSpec;
  if (typeof vgSpec.mark === "object" && vgSpec.mark.size != null) return vgSpec;
  const n = table.length;
  const plotArea = plotWidth * plotHeight;
  const currentCoverage = n * defaultSize / plotArea;
  if (currentCoverage <= targetCoverage) return vgSpec;
  const size = Math.round(Math.max(minSize, targetCoverage * plotArea / n));
  vgSpec.mark = setMarkProp(vgSpec.mark, "size", size);
  return vgSpec;
};
function maxNonOverlapSize(field, table, isTemporal2, subplotDim, count, minSize = 2) {
  const nums = [...new Set(
    table.map((r) => {
      const v = r[field];
      if (v == null) return NaN;
      return isTemporal2 ? +new Date(v) : +v;
    }).filter((v) => !isNaN(v))
  )];
  if (nums.length < 2) return Infinity;
  nums.sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < nums.length; i++) {
    const gap = nums[i] - nums[i - 1];
    if (gap > 0 && gap < minGap) minGap = gap;
  }
  if (!isFinite(minGap)) return Infinity;
  const dataRange = nums[nums.length - 1] - nums[0];
  if (dataRange <= 0) return Infinity;
  const pixelsPerUnit = subplotDim * (count - 1) / (dataRange * count);
  const maxWidth = Math.floor(minGap * pixelsPerUnit);
  return Math.max(minSize, maxWidth);
}
function adjustBarMarks(spec, ctx) {
  const layout = ctx.layout;
  for (const axis of ["x", "y"]) {
    const count = axis === "x" ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
    if (count <= 0) continue;
    const enc = spec.encoding?.[axis];
    if (enc?.bin) continue;
    const effStep = axis === "x" ? layout.xStep : layout.yStep;
    const allMarkTypes = /* @__PURE__ */ new Set();
    const mt = typeof spec.mark === "string" ? spec.mark : spec.mark?.type;
    if (mt) allMarkTypes.add(mt);
    if (Array.isArray(spec.layer)) {
      for (const layer of spec.layer) {
        const lm = typeof layer.mark === "string" ? layer.mark : layer.mark?.type;
        if (lm) allMarkTypes.add(lm);
      }
    }
    const sizeKey = allMarkTypes.has("rect") ? axis === "x" ? "width" : "height" : "size";
    const subplotDim = axis === "x" ? layout.subplotWidth : layout.subplotHeight;
    const isTemporal2 = enc?.type === "temporal";
    const maxSize = enc?.field ? maxNonOverlapSize(enc.field, ctx.table, isTemporal2, subplotDim, count) : Infinity;
    const cellSize = Math.max(2, Math.min(Math.round(effStep * 0.9), maxSize));
    if (Array.isArray(spec.layer)) {
      for (const layer of spec.layer) {
        const lm = typeof layer.mark === "string" ? layer.mark : layer.mark?.type;
        if (lm === "bar" || lm === "rect") {
          layer.mark = setMarkProp(layer.mark, sizeKey, cellSize);
        }
      }
    } else if (spec.mark) {
      const markType = typeof spec.mark === "string" ? spec.mark : spec.mark?.type;
      if (markType === "bar" || markType === "rect") {
        spec.mark = setMarkProp(spec.mark, sizeKey, cellSize);
      }
    }
  }
}
function adjustRectTiling(spec, ctx) {
  const layout = ctx.layout;
  for (const axis of ["x", "y"]) {
    const enc = spec.encoding?.[axis];
    if (!enc?.field) continue;
    const t = enc.type;
    if (t === "nominal" || t === "ordinal") continue;
    if (enc.aggregate) continue;
    const uniqueVals = [...new Set(ctx.table.map((r) => r[enc.field]))];
    const cardinality = uniqueVals.length;
    if (cardinality <= 1) continue;
    const count = axis === "x" ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
    const effStep = axis === "x" ? layout.xStep : layout.yStep;
    const pixelSpacing = count > 0 ? effStep * (count + 1) / count : effStep;
    const subplotDim = axis === "x" ? layout.subplotWidth : layout.subplotHeight;
    const isTemporal2 = t === "temporal";
    const maxSize = maxNonOverlapSize(enc.field, ctx.table, isTemporal2, subplotDim, count);
    const cellSize = Math.max(1, Math.min(Math.floor(pixelSpacing * 0.98), maxSize));
    const sizeKey = axis === "x" ? "width" : "height";
    spec.mark = setMarkProp(spec.mark, sizeKey, cellSize);
  }
}

// src/vegalite/templates/scatter.ts
var isDiscreteType = (t) => t === "nominal" || t === "ordinal";
var BOXPLOT_BAND_FILL = 0.7;
var GROUPED_BOXPLOT_LANE_FILL = 0.85;
var USABLE_BAND_FRACTION = 0.8;
var scatterPlotDef = {
  chart: "Scatter Plot",
  template: { mark: "circle", encoding: {} },
  channels: ["x", "y", "color", "size", "shape", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    if (spec.encoding?.shape?.field) {
      spec.mark = setMarkProp(spec.mark, "type", "point");
    }
    applyPointSizeScaling(spec, ctx.table, ctx.canvasSize?.width, ctx.canvasSize?.height);
    const config = ctx.chartProperties;
    if (config?.opacity !== void 0 && config.opacity < 1) {
      spec.mark = setMarkProp(spec.mark, "opacity", config.opacity);
    }
  },
  properties: [
    { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.1, defaultValue: 1 }
  ],
  pivot: makeCartesianPivot({
    // Flip the axes (orientation) as its own generator.
    transpose: [["x", "y"]],
    // x/y/color/size are peer measure channels: reassign a measure field
    // between a precise axis and a demoted color/size channel. Profile typing
    // prunes anything touching a discrete series; aux↔aux (color↔size) and
    // x↔y (a transpose) are not offered here.
    permute: [["x", "y", "color", "size"]],
    // Route the discrete grouping field across color / facet channels so a
    // grouped scatter and a faceted scatter are states of one another.
    shift: ["color", "group", "column", "row"],
    // Chart-type transition: the discrete series field (wherever it sits —
    // color, column or row) moves onto the `x` category axis, re-rendering
    // the cloud as a Strip/Jitter plot. The displaced quantitative x spills
    // to a `color` gradient. Offered whenever a discrete series exists.
    transitions: [
      {
        to: "Strip Plot",
        label: "Jitter",
        route: { from: "series", to: "x", mode: "swap", spill: "color" }
      }
    ]
  })
};
var regressionDef = {
  chart: "Regression",
  template: {
    layer: [
      {
        mark: "circle",
        encoding: { x: {}, y: {}, color: {}, size: {} }
      },
      {
        mark: { type: "line", color: "red" },
        transform: [{ regression: "field1", on: "field2" }],
        encoding: { x: {}, y: {} }
      }
    ]
  },
  channels: ["x", "y", "size", "color", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { x, y, color, size, column, row } = ctx.resolvedEncodings;
    const config = ctx.chartProperties;
    if (x) {
      spec.layer[0].encoding.x = { ...spec.layer[0].encoding.x, ...x };
      spec.layer[1].encoding.x = { ...spec.layer[1].encoding.x, ...x };
      if (x.field) spec.layer[1].transform[0].on = x.field;
    }
    if (y) {
      spec.layer[0].encoding.y = { ...spec.layer[0].encoding.y, ...y };
      spec.layer[1].encoding.y = { ...spec.layer[1].encoding.y, ...y };
      if (y.field) spec.layer[1].transform[0].regression = y.field;
    }
    const method = config?.regressionMethod;
    if (method && method !== "linear") {
      spec.layer[1].transform[0].method = method;
      if (method === "poly") {
        const order = config?.polyOrder ?? 3;
        spec.layer[1].transform[0].order = order;
      }
    }
    if (color) {
      spec.layer[0].encoding.color = { ...spec.layer[0].encoding.color, ...color };
      if (color.field) {
        spec.layer[1].transform[0].groupby = [color.field];
        spec.layer[1].encoding.color = { ...color };
        spec.layer[1].mark = { type: "line" };
      }
    }
    if (size) spec.layer[0].encoding.size = { ...spec.layer[0].encoding.size, ...size };
    if (!spec.encoding) spec.encoding = {};
    if (column) spec.encoding.column = column;
    if (row) spec.encoding.row = row;
  },
  properties: [
    {
      key: "regressionMethod",
      label: "Method",
      type: "discrete",
      options: [
        { value: "linear", label: "Linear" },
        { value: "log", label: "Logarithmic" },
        { value: "exp", label: "Exponential" },
        { value: "pow", label: "Power" },
        { value: "quad", label: "Quadratic" },
        { value: "poly", label: "Polynomial" }
      ],
      defaultValue: "linear"
    },
    {
      key: "polyOrder",
      label: "Poly Order",
      type: "continuous",
      min: 2,
      max: 10,
      step: 1,
      defaultValue: 3
    }
  ]
};
var rangedDotPlotDef = {
  chart: "Ranged Dot Plot",
  template: {
    encoding: {},
    layer: [
      { mark: "line", encoding: { detail: {} } },
      { mark: { type: "point", filled: true }, encoding: { color: {} } }
    ]
  },
  channels: ["x", "y", "color"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { color, ...rest } = ctx.resolvedEncodings;
    if (!spec.encoding) spec.encoding = {};
    for (const [ch, enc] of Object.entries(rest)) {
      spec.encoding[ch] = { ...spec.encoding[ch] || {}, ...enc };
    }
    if (color) {
      spec.layer[1].encoding.color = { ...spec.layer[1].encoding.color || {}, ...color };
    }
    if (spec.encoding.y?.type === "nominal") {
      spec.layer[0].encoding.detail = JSON.parse(JSON.stringify(spec.encoding.y));
    } else if (spec.encoding.x?.type === "nominal") {
      spec.layer[0].encoding.detail = JSON.parse(JSON.stringify(spec.encoding.x));
    }
  }
};
var boxplotDef = {
  chart: "Boxplot",
  template: { mark: "boxplot", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: (cs, table, chartProperties) => {
    if (!cs.x?.field || !cs.y?.field) return {};
    const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: "x" });
    if (!result) return {};
    let colorActsAsGroup = false;
    let groupLaneCount;
    const colorField = cs.color?.field;
    const axisField = cs[result.axis]?.field;
    if (colorField && axisField && isDiscreteType(cs.color?.type)) {
      const plan = planBandDodge(table, axisField, colorField, {
        nestedSnapThreshold: chartProperties?.nestedSnapThreshold
      });
      const { mode } = resolveDodge(plan, chartProperties?.dodge);
      colorActsAsGroup = mode !== "none";
      if (mode === "local") groupLaneCount = Math.max(1, plan.maxPerBand);
    }
    return {
      axisFlags: { [result.axis]: { banded: true } },
      resolvedTypes: result.resolvedTypes,
      paramOverrides: { defaultBandSize: 28 },
      // box+whisker needs wider bands
      colorActsAsGroup,
      // dodge-by-color → budget band per category, shrink lanes
      ...groupLaneCount ? { groupLaneCount } : {}
    };
  },
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const props = ctx.chartProperties;
    const useMinMax = props?.whiskerMethod === "minmax";
    if (useMinMax) {
      spec.mark = setMarkProp(spec.mark, "extent", "min-max");
    }
    if (useMinMax || props?.showOutliers === false) {
      spec.mark = setMarkProp(spec.mark, "outliers", false);
    }
    const layout = ctx.layout;
    const hasDiscreteX = layout.xNominalCount > 0;
    const hasDiscreteAxis = hasDiscreteX || layout.yNominalCount > 0;
    const colorEnc = spec.encoding?.color;
    let subgroups = 1;
    const colorField = ctx.channelSemantics?.color?.field;
    const axisField = hasDiscreteX ? ctx.channelSemantics?.x?.field : ctx.channelSemantics?.y?.field;
    if (colorEnc?.field && colorField && axisField && isDiscreteType(ctx.channelSemantics?.color?.type) && hasDiscreteAxis && !spec.encoding.xOffset && !spec.encoding.yOffset) {
      const plan = planBandDodge(ctx.fullTable ?? ctx.table, axisField, colorField, {
        nestedSnapThreshold: ctx.chartProperties?.nestedSnapThreshold
      });
      const resolved = resolveDodge(plan, ctx.chartProperties?.dodge);
      if (resolved.mode !== "none") {
        const offsetChannel = hasDiscreteX ? "xOffset" : "yOffset";
        subgroups = Math.max(1, resolved.laneCount);
        if (resolved.mode === "local") {
          const maxPB = Math.max(1, plan.maxPerBand);
          spec.encoding[offsetChannel] = {
            field: "__off",
            type: "quantitative",
            scale: { domain: [-0.5, 0.5] },
            axis: null
          };
          spec.transform = [
            ...spec.transform ?? [],
            { window: [{ op: "dense_rank", as: "__laneIdx" }], groupby: [axisField], sort: [{ field: colorField, order: "ascending" }] },
            { joinaggregate: [{ op: "distinct", field: colorField, as: "__localCount" }], groupby: [axisField] },
            { calculate: `((datum.__laneIdx - 1) - (datum.__localCount - 1) / 2) / ${maxPB}`, as: "__off" }
          ];
        } else {
          const offsetEnc = { field: colorEnc.field, type: "nominal" };
          if (colorEnc.sort !== void 0) offsetEnc.sort = colorEnc.sort;
          spec.encoding[offsetChannel] = offsetEnc;
        }
      }
    }
    if (hasDiscreteAxis) {
      const boxStep = hasDiscreteX ? layout.xStep : layout.yStep;
      if (subgroups > 1) {
        const lanePitch = boxStep * USABLE_BAND_FRACTION / subgroups;
        const boxSize = Math.max(2, Math.round(lanePitch * GROUPED_BOXPLOT_LANE_FILL));
        spec.mark = setMarkProp(spec.mark, "size", boxSize);
      } else {
        const boxSize = Math.max(4, Math.round(boxStep * BOXPLOT_BAND_FILL));
        spec.mark = setMarkProp(spec.mark, "size", boxSize);
      }
    }
  },
  properties: [
    {
      key: "whiskerMethod",
      label: "Whiskers",
      type: "discrete",
      options: [
        { value: "iqr", label: "Tukey (1.5 \xD7 IQR)" },
        { value: "minmax", label: "Min\u2013Max" }
      ],
      defaultValue: "iqr"
    },
    {
      key: "showOutliers",
      label: "Outliers",
      type: "binary",
      defaultValue: true,
      // Outliers exist only with Tukey whiskers; min–max whiskers absorb
      // every point, so the toggle is irrelevant there.
      check: (ctx) => ({ applicable: ctx.chartProperties?.whiskerMethod !== "minmax" })
    },
    {
      key: "dodge",
      label: "Dodge",
      type: "discrete",
      options: [
        { value: "auto", label: "Auto" },
        { value: "local", label: "Local (compact)" },
        { value: "global", label: "Global (aligned)" }
      ],
      defaultValue: "auto",
      // Surface whenever color genuinely subdivides a band (maxPerBand > 1),
      // so the user can pick none / local / global; the compiler default is
      // reported as `recommendedValue`.
      check: (ctx) => {
        const colorField = ctx.channelSemantics?.color?.field;
        const xType = ctx.channelSemantics?.x?.type;
        const axisField = isDiscreteType(xType) ? ctx.channelSemantics?.x?.field : ctx.channelSemantics?.y?.field;
        const rows = ctx.data;
        if (!colorField || !axisField || !isDiscreteType(ctx.channelSemantics?.color?.type) || !rows) {
          return { applicable: false };
        }
        const plan = planBandDodge(rows, axisField, colorField, {
          nestedSnapThreshold: ctx.chartProperties?.nestedSnapThreshold
        });
        return {
          applicable: plan.ambiguous,
          recommendedValue: plan.mode === "none" ? "auto" : plan.mode
        };
      }
    }
  ]
};

// src/vegalite/templates/connected-scatter.ts
function resolveOrderType(csType, field, table) {
  const values = table.map((r) => r[field]).filter((v) => v != null && v !== "");
  const allNumeric = values.length > 0 && values.every((v) => typeof v === "number" || typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));
  if (allNumeric) return "quantitative";
  if (csType === "temporal") return "temporal";
  return csType === "ordinal" || csType === "nominal" ? csType : "nominal";
}
var connectedScatterDef = {
  chart: "Connected Scatter Plot",
  template: {
    mark: { type: "line", point: true, interpolate: "linear", strokeWidth: 2 },
    encoding: {}
  },
  channels: ["x", "y", "order", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const xEnc = spec.encoding?.x;
    const yEnc = spec.encoding?.y;
    if (!xEnc || !yEnc) return;
    const orderCS = ctx.channelSemantics.order;
    if (orderCS?.field) {
      spec.encoding.order = {
        field: orderCS.field,
        type: resolveOrderType(orderCS.type, orderCS.field, ctx.table)
      };
    } else {
      delete spec.encoding.order;
    }
    xEnc.scale = { ...xEnc.scale, nice: true, padding: 10 };
    yEnc.scale = { ...yEnc.scale, nice: true, padding: 10 };
  }
};

// src/vegalite/templates/bar.ts
var HEATMAP_SCHEME_COLORS = {
  viridis: ["#440154", "#fde725"],
  inferno: ["#000004", "#fcffa4"],
  magma: ["#000004", "#fcfdbf"],
  plasma: ["#0d0887", "#f0f921"],
  turbo: ["#30123b", "#7a0403"],
  blues: ["#f7fbff", "#08519c"],
  reds: ["#fff5f0", "#a50f15"],
  greens: ["#f7fcf5", "#00441b"],
  oranges: ["#fff5eb", "#7f2704"],
  purples: ["#fcfbfd", "#3f007d"],
  greys: ["#ffffff", "#252525"]
};
var DEFAULT_HEATMAP_SCHEME = "blues";
function isDivergingHeatmapScheme(scheme) {
  return scheme === "blueorange" || scheme === "redblue";
}
function hexLuma(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = n >> 16 & 255;
  const g = n >> 8 & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function getSafeHeatmapIntrinsicDomain(ctx, colorField) {
  if (!colorField) return void 0;
  const colorChannel = ctx.channelSemantics?.color;
  const annotation = colorChannel?.semanticAnnotation;
  if (annotation?.intrinsicDomain) {
    return annotation.intrinsicDomain;
  }
  const semanticType = annotation?.semanticType;
  if (semanticType === "Correlation") return [-1, 1];
  if (semanticType === "Latitude") return [-90, 90];
  if (semanticType === "Longitude") return [-180, 180];
  return void 0;
}
var barChartDef = {
  chart: "Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "group", "opacity", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes
    };
  },
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const config = ctx.chartProperties;
    if (config && config.cornerRadius > 0) {
      spec.mark = setMarkProp(spec.mark, "cornerRadius", config.cornerRadius);
    }
    adjustBarMarks(spec, ctx);
  },
  properties: [
    { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 15, step: 1, defaultValue: 0 }
  ],
  encodingActions: [makeSortAction()],
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"]
  })
};
var pyramidChartDef = {
  chart: "Pyramid Chart",
  template: {
    spacing: 0,
    resolve: { scale: { y: "shared" } },
    hconcat: [
      {
        mark: "bar",
        encoding: {
          y: {},
          x: { scale: { reverse: true }, stack: null },
          opacity: { value: 0.9 },
          color: { value: "#4e79a7" }
        }
      },
      {
        mark: "bar",
        encoding: {
          y: { axis: null },
          x: { stack: null },
          opacity: { value: 0.9 },
          color: { value: "#e15759" }
        }
      }
    ],
    config: { view: { stroke: null }, axis: { grid: false } }
  },
  channels: ["x", "y", "color"],
  markCognitiveChannel: "length",
  declareLayoutMode: () => ({
    axisFlags: { y: { banded: true } }
  }),
  instantiate: (spec, ctx) => {
    let { y, x } = ctx.resolvedEncodings;
    const { color } = ctx.resolvedEncodings;
    const isDiscreteType2 = (enc) => enc && (enc.type === "nominal" || enc.type === "ordinal");
    const isQuant = (enc) => enc && (enc.type === "quantitative" || enc.type === "temporal");
    if (isDiscreteType2(x) && isQuant(y)) {
      [x, y] = [y, x];
    }
    if (y) {
      const yEnc = { ...y };
      resolveAsDiscrete(yEnc, ctx.table);
      spec.hconcat[0].encoding.y = { ...spec.hconcat[0].encoding.y, ...yEnc };
      spec.hconcat[1].encoding.y = { ...spec.hconcat[1].encoding.y, ...yEnc };
    }
    if (x) {
      spec.hconcat[0].encoding.x = { ...spec.hconcat[0].encoding.x, ...x };
      spec.hconcat[1].encoding.x = { ...spec.hconcat[1].encoding.x, ...x };
    }
    const colorField = color?.field;
    const table = ctx.table;
    const canvasSize = ctx.canvasSize;
    try {
      if (table && colorField) {
        const groups = [...new Set(table.map((r) => r[colorField]))];
        const leftGroup = groups[0];
        const rightGroup = groups.length > 1 ? groups[1] : groups[0];
        spec.hconcat[0].transform = [{ filter: { field: colorField, equal: leftGroup } }];
        spec.hconcat[1].transform = [{ filter: { field: colorField, equal: rightGroup } }];
        spec.hconcat[0].title = String(leftGroup);
        spec.hconcat[1].title = String(rightGroup);
        if (groups.length > 2) {
          if (!spec._warnings) spec._warnings = [];
          spec._warnings.push({
            severity: "warning",
            code: "too-many-groups-pyramid",
            message: `Pyramid chart works best with exactly 2 groups, but found ${groups.length} (${groups.map((g) => `'${g}'`).join(", ")}). Only the first two are shown.`,
            channel: "color",
            field: colorField
          });
        }
      }
      if (table) {
        const xField = spec.hconcat[0].encoding.x?.field;
        if (xField) {
          const allVals = table.map((r) => r[xField]).filter((v) => typeof v === "number");
          if (allVals.length > 0) {
            const domain = [Math.min(0, ...allVals), Math.max(...allVals)];
            spec.hconcat[0].encoding.x.scale = { ...spec.hconcat[0].encoding.x.scale, domain };
            spec.hconcat[1].encoding.x.scale = { ...spec.hconcat[1].encoding.x.scale, domain };
          }
          if (allVals.some((v) => v < 0)) {
            if (!spec._warnings) spec._warnings = [];
            spec._warnings.push({
              severity: "warning",
              code: "negative-values-pyramid",
              message: `Negative values detected in '${xField}'. Pyramid charts work best with non-negative values.`,
              channel: "x",
              field: xField
            });
          }
        }
        const baseWidth = canvasSize?.width ?? 400;
        const baseHeight = canvasSize?.height ?? 320;
        const facetCols = 2;
        const facetStretch = Math.min(1.5, Math.pow(facetCols, 0.3));
        const panelWidth = Math.round(Math.max(40, baseWidth * facetStretch / facetCols));
        const yField = spec.hconcat[0].encoding.y?.field;
        let panelHeight = baseHeight;
        if (yField) {
          const yCardinality = new Set(table.map((r) => r[yField])).size;
          const baseRefSize = 300;
          const sizeRatio = Math.max(baseWidth, baseHeight) / baseRefSize;
          const defaultStep = Math.round(20 * Math.max(1, sizeRatio));
          if (yCardinality > 0) {
            const pressure = yCardinality * defaultStep / baseHeight;
            if (pressure > 1) {
              const stretch = Math.min(2, Math.pow(pressure, 0.5));
              panelHeight = Math.round(baseHeight * stretch);
            }
          }
        }
        for (const panel of spec.hconcat) {
          panel.width = panelWidth;
          panel.height = panelHeight;
        }
      }
    } catch {
    }
  }
};
var groupedBarChartDef = {
  chart: "Grouped Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "group", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table, chartProperties) => {
    const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: "x" });
    const axis = result?.axis || "x";
    const decl = {
      axisFlags: { [axis]: { banded: true } },
      resolvedTypes: result?.resolvedTypes
    };
    const groupField = cs.group?.field;
    const axisField = cs[axis]?.field;
    if (groupField && axisField) {
      const plan = planBandDodge(table, axisField, groupField);
      const { mode } = resolveDodge(plan, chartProperties?.dodge);
      if (mode === "local") decl.groupLaneCount = Math.max(1, plan.maxPerBand);
    }
    return decl;
  },
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    adjustBarMarks(spec, ctx);
    const offsetCh = spec.encoding?.xOffset ? "xOffset" : spec.encoding?.yOffset ? "yOffset" : void 0;
    const groupField = ctx.channelSemantics?.group?.field;
    const xDisc = ctx.channelSemantics?.x?.type === "nominal" || ctx.channelSemantics?.x?.type === "ordinal";
    const axisField = xDisc ? ctx.channelSemantics?.x?.field : ctx.channelSemantics?.y?.field;
    if (offsetCh && groupField && axisField) {
      const plan = planBandDodge(ctx.fullTable ?? ctx.table, axisField, groupField);
      const { mode } = resolveDodge(plan, ctx.chartProperties?.dodge);
      if (mode === "local") {
        const maxPB = Math.max(1, plan.maxPerBand);
        spec.encoding[offsetCh] = {
          field: "__off",
          type: "quantitative",
          scale: { domain: [-0.5, 0.5] },
          axis: null,
          title: null
        };
        spec.transform = [
          ...spec.transform ?? [],
          { window: [{ op: "dense_rank", as: "__laneIdx" }], groupby: [axisField], sort: [{ field: groupField, order: "ascending" }] },
          { joinaggregate: [{ op: "distinct", field: groupField, as: "__localCount" }], groupby: [axisField] },
          { calculate: `((datum.__laneIdx - 1) - (datum.__localCount - 1) / 2) / ${maxPB}`, as: "__off" }
        ];
        const band = offsetCh === "xOffset" ? ctx.layout?.xStep : ctx.layout?.yStep;
        if (band) {
          spec.mark = setMarkProp(spec.mark, "size", Math.max(2, Math.round(band * 0.8 / maxPB * 0.85)));
        }
      }
    }
  },
  encodingActions: [makeSortAction()],
  properties: [
    {
      key: "dodge",
      label: "Dodge",
      type: "discrete",
      options: [
        { value: "auto", label: "Auto" },
        { value: "local", label: "Local (compact)" },
        { value: "global", label: "Global (aligned)" }
      ],
      defaultValue: "auto",
      // The `group` field is what subdivides each category band.
      check: (ctx) => {
        const isDisc = (t) => t === "nominal" || t === "ordinal";
        const groupField = ctx.channelSemantics?.group?.field ?? ctx.encodings?.group?.field;
        const axisField = isDisc(ctx.channelSemantics?.x?.type) ? ctx.channelSemantics?.x?.field : ctx.channelSemantics?.y?.field;
        const rows = ctx.data;
        if (!groupField || !axisField || !rows) return { applicable: false };
        const plan = planBandDodge(rows, axisField, groupField);
        return { applicable: plan.ambiguous, recommendedValue: plan.mode === "none" ? "auto" : plan.mode };
      }
    }
  ],
  // Chart-type transition: the dodge series (`group`) becomes a stacked series
  // (`color`), re-rendering as a Stacked Bar Chart. Plus the orientation flip,
  // role swap (banded axis ↔ series), and series routing to column/row facets.
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"],
    transitions: [
      {
        to: "Stacked Bar Chart",
        label: "Stacked",
        route: { from: "group", to: "color", mode: "move" },
        requireDiscreteSource: true
      }
    ]
  })
};
var stackedBarChartDef = {
  chart: "Stacked Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes,
      paramOverrides: { continuousMarkCrossSection: { x: 20, y: 20, seriesCountAxis: "auto" } }
    };
  },
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const config = ctx.chartProperties;
    const hasStackSeries = !!ctx.channelSemantics.color?.field;
    if (config?.stackMode && hasStackSeries) {
      for (const axis of ["x", "y"]) {
        if (spec.encoding?.[axis]?.type === "quantitative" || spec.encoding?.[axis]?.aggregate) {
          spec.encoding[axis].stack = config.stackMode === "layered" ? null : config.stackMode;
          break;
        }
      }
    }
    adjustBarMarks(spec, ctx);
  },
  properties: [
    {
      key: "stackMode",
      label: "Stack",
      type: "discrete",
      // A stack mode only does something when a series dimension (color) is
      // present to stack; without it there is a single bar per category.
      check: (ctx) => ({ applicable: !!ctx.encodings.color?.field }),
      options: [
        { value: void 0, label: "Stacked (default)" },
        { value: "normalize", label: "Normalize (100%)" },
        { value: "center", label: "Center" },
        { value: "layered", label: "Layered (overlap)" }
      ]
    }
  ],
  encodingActions: [makeSortAction()],
  // Chart-type transition: the stacked series (`color`) becomes a dodge series
  // (`group`), re-rendering as a Grouped Bar Chart. Offered only when the series
  // cardinality is small enough to dodge readably. Plus the orientation flip,
  // role swap (banded axis ↔ series), and series routing to column/row facets.
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"],
    transitions: [
      {
        to: "Grouped Bar Chart",
        label: "Grouped",
        route: { from: "color", to: "group", mode: "move" },
        requireDiscreteSource: true,
        maxSourceCardinality: 12
      }
    ]
  })
};
var histogramDef = {
  chart: "Histogram",
  template: {
    mark: "bar",
    encoding: {
      x: { bin: true },
      y: { aggregate: "count" }
    }
  },
  channels: ["x", "color", "column", "row"],
  markCognitiveChannel: "length",
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const binCount = ctx.chartProperties?.binCount;
    if (binCount && spec.encoding?.x) {
      spec.encoding.x.bin = { maxbins: binCount };
    }
    adjustBarMarks(spec, ctx);
  },
  properties: [
    // 0 == auto (let the engine choose); 5–50 caps the bins (maxbins).
    { key: "binCount", label: "Max Bins", type: "continuous", min: 5, max: 50, step: 1, defaultValue: 0 }
  ],
  // A histogram has a single bound field (x); its y is a computed count, so
  // there is no τ transpose or σ permute. `shift` routes a discrete series to
  // the legend/facets, and the θ transition re-renders the same field as a
  // smooth kernel Density Plot.
  pivot: makeCartesianPivot({
    shift: ["color", "column", "row"],
    transitions: [
      { to: "Density Plot", label: "Density" }
    ]
  })
};
var heatmapDef = {
  chart: "Heatmap",
  template: { mark: "rect", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "color",
  declareLayoutMode: (_cs, _table, chartProperties) => {
    const showTextLabels = !!chartProperties?.showTextLabels;
    return {
      axisFlags: { x: { banded: true }, y: { banded: true } },
      // Labels need slightly larger cells so the value text isn't crushed,
      // but we keep this close to the unlabeled defaults (minStep 6 /
      // defaultBandSize 20) so a labeled heatmap doesn't balloon. The small
      // label font (see instantiate) is what lets these stay compact.
      paramOverrides: showTextLabels ? { minStep: 9, defaultBandSize: 22 } : void 0
    };
  },
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const config = ctx.chartProperties;
    const showTextLabels = !!config?.showTextLabels;
    const colorField = spec.encoding?.color?.field;
    const colorVals = colorField ? ctx.table.map((r) => Number(r[colorField])).filter((v) => Number.isFinite(v)) : [];
    const observedMin = colorVals.length > 0 ? Math.min(...colorVals) : 0;
    const observedMax = colorVals.length > 0 ? Math.max(...colorVals) : 1;
    const existingScheme = spec.encoding?.color?.scale?.scheme;
    const encScheme = ctx.encodings?.color?.scheme;
    const userScheme = encScheme && encScheme !== "default" ? encScheme : void 0;
    const semanticScheme = ctx.channelSemantics?.color?.colorScheme;
    const semanticIsDiverging = semanticScheme?.type === "diverging";
    const colorEncodingType = spec.encoding?.color?.type;
    const shouldUseHeatmapDefault = !userScheme && !semanticIsDiverging && !isDivergingHeatmapScheme(existingScheme) && colorEncodingType !== "nominal";
    const schemeName = userScheme || (semanticIsDiverging ? existingScheme || "redblue" : void 0) || (shouldUseHeatmapDefault ? DEFAULT_HEATMAP_SCHEME : existingScheme);
    const isDiverging = isDivergingHeatmapScheme(schemeName);
    const intrinsicDomain = getSafeHeatmapIntrinsicDomain(ctx, colorField);
    let effectiveMin = intrinsicDomain?.[0] ?? observedMin;
    let effectiveMax = intrinsicDomain?.[1] ?? observedMax;
    if (spec.encoding?.color) {
      if (!spec.encoding.color.scale) spec.encoding.color.scale = {};
      if (schemeName) {
        spec.encoding.color.scale.scheme = schemeName;
      }
      if (isDiverging && effectiveMin < 0 && effectiveMax > 0) {
        const sym = Math.max(Math.abs(effectiveMin), Math.abs(effectiveMax));
        effectiveMin = -sym;
        effectiveMax = sym;
        spec.encoding.color.scale.domain = [-sym, sym];
        spec.encoding.color.scale.domainMid = 0;
      } else if (intrinsicDomain) {
        const snapped = snapToBoundHeuristic(intrinsicDomain, colorVals);
        effectiveMin = snapped?.min ?? observedMin;
        effectiveMax = snapped?.max ?? observedMax;
        spec.encoding.color.scale.domain = [effectiveMin, effectiveMax];
      }
    }
    adjustBarMarks(spec, ctx);
    adjustRectTiling(spec, ctx);
    if (showTextLabels && spec.encoding?.color?.field) {
      const baseEncoding = spec.encoding || {};
      const xEncoding = baseEncoding.x;
      const yEncoding = baseEncoding.y;
      const span = effectiveMax - effectiveMin;
      const cellMinDim = Math.min(ctx.layout.xStep || 50, ctx.layout.yStep || 50);
      const labelFontSize = cellMinDim >= 40 ? 9 : cellMinDim >= 28 ? 8 : 7;
      const labelFormat = cellMinDim >= 44 ? ".2f" : ".1f";
      const sequentialPalette = HEATMAP_SCHEME_COLORS[schemeName || DEFAULT_HEATMAP_SCHEME] || HEATMAP_SCHEME_COLORS[DEFAULT_HEATMAP_SCHEME];
      const highIsLight = hexLuma(sequentialPalette[1]) >= hexLuma(sequentialPalette[0]);
      const strongThreshold = span > 0 ? isDiverging ? Math.max(Math.abs(effectiveMin), Math.abs(effectiveMax)) * 0.5 : effectiveMin + span * 0.6 : void 0;
      spec.layer = [
        {
          mark: spec.mark,
          encoding: {
            ...xEncoding ? { x: xEncoding } : {},
            ...yEncoding ? { y: yEncoding } : {},
            ...baseEncoding.color ? { color: baseEncoding.color } : {}
          }
        },
        {
          mark: {
            type: "text",
            align: "center",
            baseline: "middle",
            fontSize: labelFontSize
          },
          encoding: {
            ...xEncoding ? { x: xEncoding } : {},
            ...yEncoding ? { y: yEncoding } : {},
            text: {
              field: colorField,
              type: "quantitative",
              format: labelFormat
            },
            color: strongThreshold == null ? { value: "black" } : {
              condition: {
                test: isDiverging ? `datum.${colorField} > ${strongThreshold} || datum.${colorField} < ${-strongThreshold}` : `datum.${colorField} >= ${strongThreshold}`,
                value: isDiverging ? "white" : highIsLight ? "black" : "white"
              },
              value: isDiverging ? "black" : highIsLight ? "white" : "black"
            }
          }
        }
      ];
      delete spec.mark;
    }
  },
  properties: [
    { key: "showTextLabels", label: "Show labels", type: "binary", defaultValue: false }
  ],
  // Color scheme is an encoding-level edit (writes encoding.scheme on the
  // color channel), so it is exposed as a Category-B encoding action rather
  // than a chart-native property. The host stores the chosen value as an
  // override in chartProperties.colorScheme; the compiler composes it onto the
  // encoding (see applyEncodingOverrides). `dependencies` tells the host to
  // reset the override when the color channel's binding changes in the shelf.
  encodingActions: [
    {
      key: "colorScheme",
      label: "Scheme",
      isApplicable: (ctx) => !!ctx.encodings.color?.field,
      dependencies: ["color"],
      control: {
        type: "discrete",
        options: [
          { value: void 0, label: "Default (Blues)" },
          { value: "viridis", label: "Viridis" },
          { value: "inferno", label: "Inferno" },
          { value: "magma", label: "Magma" },
          { value: "plasma", label: "Plasma" },
          { value: "turbo", label: "Turbo" },
          { value: "blues", label: "Blues" },
          { value: "reds", label: "Reds" },
          { value: "greens", label: "Greens" },
          { value: "oranges", label: "Oranges" },
          { value: "purples", label: "Purples" },
          { value: "greys", label: "Greys" },
          { value: "blueorange", label: "Blue-Orange (diverging)" },
          { value: "redblue", label: "Red-Blue (diverging)" }
        ]
      },
      get: (encodings) => encodings.color?.scheme,
      set: (encodings, value) => ({ ...encodings, color: { ...encodings.color, scheme: value } })
    }
  ],
  pivot: makeCartesianPivot({ transpose: [["x", "y"]] })
};

// src/vegalite/templates/line.ts
var interpolateConfigProperty = {
  key: "interpolate",
  label: "Curve",
  type: "discrete",
  options: [
    { value: void 0, label: "Default (linear)" },
    { value: "linear", label: "Linear" },
    { value: "monotone", label: "Monotone (smooth)" },
    { value: "step", label: "Step" },
    { value: "step-before", label: "Step Before" },
    { value: "step-after", label: "Step After" },
    { value: "basis", label: "Basis (smooth)" },
    { value: "cardinal", label: "Cardinal" },
    { value: "catmull-rom", label: "Catmull-Rom" }
  ]
};
var showPointsProperty = {
  key: "showPoints",
  label: "Show points",
  type: "binary",
  defaultValue: false
};
function applyInterpolate(mark, config) {
  if (!config?.interpolate) return mark;
  return setMarkProp(mark, "interpolate", config.interpolate);
}
function applyShowPoints(mark, config) {
  if (!config?.showPoints) return mark;
  return setMarkProp(mark, "point", true);
}
function isContinuousColor(ctx) {
  const color = ctx.resolvedEncodings.color;
  if (!color?.field) return false;
  const type = color.type ?? ctx.channelSemantics.color?.type;
  return type === "quantitative" || type === "temporal";
}
function buildContinuousColorLayers(spec, resolvedEncodings, chartProperties) {
  const { color, column, row, x, y, strokeDash, detail, opacity, order, ...rest } = resolvedEncodings;
  const lineEncoding = {};
  for (const [ch, enc] of Object.entries({ x, y, strokeDash, detail, opacity, order, ...rest })) {
    if (enc && typeof enc === "object" && Object.keys(enc).length > 0) {
      lineEncoding[ch] = enc;
    }
  }
  const pointEncoding = {};
  if (x) pointEncoding.x = x;
  if (y) pointEncoding.y = y;
  if (color) pointEncoding.color = color;
  if (detail) pointEncoding.detail = detail;
  if (opacity) pointEncoding.opacity = opacity;
  spec.layer = [
    {
      mark: applyInterpolate({ type: "line", color: "#cccccc" }, chartProperties),
      encoding: lineEncoding
    },
    {
      mark: { type: "point", filled: true, size: 80 },
      encoding: pointEncoding
    }
  ];
  delete spec.mark;
  if (column || row) {
    if (!spec.encoding) spec.encoding = {};
    if (column) spec.encoding.column = column;
    if (row) spec.encoding.row = row;
  } else {
    delete spec.encoding;
  }
}
var lineChartDef = {
  chart: "Line Chart",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "color", "strokeDash", "detail", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" }, facetAspectRatioResistance: 0.5 }
  }),
  instantiate: (spec, ctx) => {
    if (isContinuousColor(ctx)) {
      buildContinuousColorLayers(spec, ctx.resolvedEncodings, ctx.chartProperties);
      return;
    }
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    spec.mark = applyInterpolate(spec.mark, ctx.chartProperties);
    spec.mark = applyShowPoints(spec.mark, ctx.chartProperties);
  },
  properties: [interpolateConfigProperty, showPointsProperty],
  // No `transpose`: a line pins its domain to `x` (never a vertical line, for any
  // x type). `permute` excludes `x`, so only a genuine dual-measure line offers a
  // y↔color swap; the series dimension is explored via `shift` (facets/legend).
  pivot: makeCartesianPivot({ permute: [["y", "color"]], shift: ["color", "group", "column", "row"] })
};

// src/vegalite/templates/sparkline.ts
var baselineProperty = {
  key: "baseline",
  label: "Reference line",
  type: "discrete",
  defaultValue: "mean",
  options: [
    { value: "mean", label: "Average" },
    { value: "zero", label: "Zero" },
    { value: "median", label: "Median" },
    { value: "none", label: "None" }
  ]
};
var DEFAULT_TREND_W = 240;
var trendWidthProperty = {
  key: "trendWidth",
  label: "Sparkline width",
  type: "continuous",
  min: 80,
  max: 600,
  step: 10,
  defaultValue: DEFAULT_TREND_W
};
var HEADER_STYLE = { fontSize: 11, fontWeight: "normal", color: "#999", offset: 6 };
var CHAR_PX = 6.6;
var MONO_LINE = "#555";
var MONO_VALUE = "#333";
var isCJK = (ch) => /[\u3000-\u303F\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch);
var textWidth = (s) => [...String(s ?? "")].reduce((a, ch) => a + (isCJK(ch) ? 2 : 1), 0);
var mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
var median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
var approxNum = (v) => {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(Math.round(v * 10) / 10);
};
var sparklineDef = {
  chart: "Sparkline",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "color", "detail", "row", "column"],
  markCognitiveChannel: "position",
  // Remap the series field onto `row` so each series becomes its own table
  // row. The series is the bound `color` field if present, else `detail`.
  // When it came from `color` we KEEP the color encoding (same field) so each
  // row's line/value is hued by its series — matching line-chart color
  // semantics (e.g. US vs China). `detail` series stay monochrome. An
  // explicit `row` binding wins.
  normalizeEncodings: (encodings) => {
    if (encodings.row?.field) return encodings;
    const fromColor = !!encodings.color?.field;
    const seriesEnc = fromColor ? encodings.color : encodings.detail?.field ? encodings.detail : void 0;
    if (!seriesEnc) return encodings;
    const next = { ...encodings, row: { ...seriesEnc } };
    if (!fromColor) delete next.detail;
    return next;
  },
  // The grid lays itself out manually (see `instantiate`), but the shared
  // pipeline still runs its facet-budget pass over the `row` channel. A low
  // `minSubplotSize` floor raises the row capacity so a normal sparkline
  // table (many short strips) doesn't trip a spurious "rows omitted" overflow
  // warning. The other knobs keep strips short and wide.
  declareLayoutMode: () => ({
    paramOverrides: {
      minSubplotSize: 24,
      continuousMarkCrossSection: { x: 100, y: 0, seriesCountAxis: "auto" },
      facetAspectRatioResistance: 0.3
    }
  }),
  instantiate: (spec, ctx) => {
    const enc = ctx.resolvedEncodings;
    const regionField = enc.row?.field;
    const xField = enc.x?.field;
    const yField = enc.y?.field;
    const hasColor = !!enc.color?.field;
    const baseline = ctx.chartProperties?.baseline ?? "mean";
    const useMedian = baseline === "median";
    const independentY = ctx.chartProperties?.independentYAxis !== false;
    if (!xField || !yField) {
      spec.encoding = {
        ...xField ? { x: { ...enc.x } } : {},
        ...yField ? { y: { ...enc.y } } : {}
      };
      return;
    }
    const table = ctx.fullTable ?? ctx.table ?? [];
    const facetField = regionField ?? "flintSparkSeries";
    const trendData = regionField ? table : table.map((r) => ({ ...r, [facetField]: "" }));
    const regions = [];
    const seen = /* @__PURE__ */ new Set();
    for (const r of trendData) {
      const v = r[facetField];
      if (!seen.has(v)) {
        seen.add(v);
        regions.push(v);
      }
    }
    const groups = /* @__PURE__ */ new Map();
    for (const r of trendData) {
      const v = Number(r[yField]);
      if (!Number.isFinite(v)) continue;
      const k = r[facetField];
      const arr = groups.get(k);
      if (arr) arr.push(v);
      else groups.set(k, [v]);
    }
    const aggOf = (k) => {
      const a = groups.get(k) ?? [];
      return useMedian ? median(a) : mean(a);
    };
    const categoryTitle = String(enc.row?.title ?? regionField ?? "");
    const trendTitle = String(enc.y?.title ?? yField ?? "");
    const avgTitle = useMedian ? "Median" : "Average";
    const catData = regions.map((r) => ({ [facetField]: r }));
    const avgData = regions.map((r) => ({ [facetField]: r, flintSparkAvg: aggOf(r) }));
    const canvas = ctx.canvasSize ?? { width: 480, height: 320 };
    const N = Math.max(1, regions.length);
    const HEADER_H = 18;
    const STRIP_GAP = 6;
    const INTER_GAP = 8;
    const stripH = Math.min(64, Math.max(
      16,
      Math.floor((canvas.height - HEADER_H - (N - 1) * STRIP_GAP) / N)
    ));
    const maxCatChars = Math.max(
      textWidth(categoryTitle),
      4,
      ...regions.map((r) => textWidth(r))
    );
    const maxAvgChars = Math.max(
      textWidth(avgTitle),
      4,
      ...avgData.map((d) => textWidth(approxNum(d.flintSparkAvg)))
    );
    const catW = Math.min(200, Math.max(40, Math.round(maxCatChars * CHAR_PX) + 10));
    const avgW = Math.min(96, Math.max(34, Math.round(maxAvgChars * CHAR_PX) + 8));
    const avail = canvas.width - catW - avgW - 2 * INTER_GAP;
    const tunedTrendW = Number(ctx.chartProperties?.trendWidth) || DEFAULT_TREND_W;
    const trendW = Math.max(90, Math.min(tunedTrendW, avail));
    const facetRow = { field: facetField, type: "nominal", sort: regions, header: null };
    const lineMark = applyInterpolate({ type: "line", strokeWidth: 1.5 }, ctx.chartProperties);
    const Y_INSET = 2;
    const trendYScale = { range: [stripH - Y_INSET, Y_INSET] };
    const layers = [{
      mark: lineMark,
      encoding: {
        x: { ...enc.x, axis: null },
        y: { ...enc.y, axis: null, scale: { ...enc.y.scale, ...trendYScale } },
        ...hasColor ? { color: { field: facetField, type: "nominal", legend: null } } : { color: { value: MONO_LINE } }
      }
    }];
    if (baseline !== "none") {
      const ruleY = baseline === "zero" ? { datum: 0, type: "quantitative", axis: null } : { field: yField, aggregate: baseline, type: "quantitative", axis: null };
      layers.push({
        mark: { type: "rule", strokeDash: [3, 2], stroke: "#9a9a9a", strokeWidth: 1, opacity: 0.7 },
        encoding: { y: ruleY }
      });
    }
    const catPanel = {
      data: { values: catData },
      facet: { row: facetRow },
      spec: {
        width: catW,
        height: stripH,
        mark: { type: "text", align: "left", baseline: "middle", fontSize: 11 },
        encoding: {
          y: { value: stripH / 2 },
          x: { value: 0 },
          text: { field: facetField, type: "nominal" }
        }
      },
      title: { text: categoryTitle, anchor: "start", ...HEADER_STYLE }
    };
    const trendPanel = {
      data: { values: trendData },
      facet: { row: facetRow },
      spec: { width: trendW, height: stripH, layer: layers },
      // Per-row y resolution: `independent` (default) self-scales each
      // strip so its trace fills the band and aligns with its row label;
      // `shared` (via `independentYAxis: false`) keeps every row on one
      // comparable scale.
      resolve: { scale: { y: independentY ? "independent" : "shared" } },
      title: { text: trendTitle, anchor: "middle", ...HEADER_STYLE }
    };
    const avgPanel = {
      data: { values: avgData },
      facet: { row: facetRow },
      spec: {
        width: avgW,
        height: stripH,
        mark: { type: "text", align: "right", baseline: "middle", fontSize: 11, fontWeight: 600 },
        encoding: {
          y: { value: stripH / 2 },
          x: { value: avgW },
          text: { field: "flintSparkAvg", type: "quantitative", format: ".3~s" },
          ...hasColor ? { color: { field: facetField, type: "nominal", legend: null } } : { color: { value: MONO_VALUE } }
        }
      },
      title: { text: avgTitle, anchor: "end", ...HEADER_STYLE }
    };
    delete spec.mark;
    delete spec.encoding;
    spec.hconcat = [catPanel, trendPanel, avgPanel];
    spec.spacing = INTER_GAP;
    spec.resolve = { scale: { y: "independent", color: "shared" } };
    spec.config = {
      view: { stroke: null },
      axis: { grid: false, domain: false, ticks: false },
      facet: { spacing: STRIP_GAP }
    };
  },
  properties: [interpolateConfigProperty, baselineProperty, trendWidthProperty]
};

// src/vegalite/templates/bump.ts
var RANK_SEMANTIC_TYPES = /* @__PURE__ */ new Set(["Rank", "Score", "Level"]);
var isDiscrete3 = (type) => type === "nominal" || type === "ordinal";
var bumpChartDef = {
  chart: "Bump Chart",
  template: {
    mark: { type: "line", point: true, interpolate: "monotone", strokeWidth: 2 },
    encoding: {}
  },
  channels: ["x", "y", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 80, y: 20, seriesCountAxis: "auto" }, facetAspectRatioResistance: 0.4 }
  }),
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const xEnc = spec.encoding?.x;
    const yEnc = spec.encoding?.y;
    if (!xEnc || !yEnc) return;
    const semanticTypes = ctx.semanticTypes;
    let rankAxis;
    const xSemType = xEnc.field && semanticTypes?.[xEnc.field] || "";
    const ySemType = yEnc.field && semanticTypes?.[yEnc.field] || "";
    const xIsRank = RANK_SEMANTIC_TYPES.has(xSemType);
    const yIsRank = RANK_SEMANTIC_TYPES.has(ySemType);
    if (yIsRank && !xIsRank) {
      rankAxis = "y";
    } else if (xIsRank && !yIsRank) {
      rankAxis = "x";
    } else if (isDiscrete3(xEnc.type) && !isDiscrete3(yEnc.type)) {
      rankAxis = "y";
    } else if (isDiscrete3(yEnc.type) && !isDiscrete3(xEnc.type)) {
      rankAxis = "x";
    } else {
      rankAxis = "y";
    }
    if (rankAxis === "y") {
      yEnc.scale = { ...yEnc.scale, reverse: true };
    }
    if (rankAxis === "x" && yEnc.field) {
      spec.encoding.order = {
        field: yEnc.field,
        type: yEnc.type || "quantitative"
      };
    }
  }
};

// src/vegalite/templates/slope.ts
var isDiscrete4 = (type) => type === "nominal" || type === "ordinal";
function orderedDistinct(table, field) {
  const seen = /* @__PURE__ */ new Map();
  for (const row of table) {
    const v = row[field];
    if (v == null) continue;
    const key = String(v);
    if (!seen.has(key)) seen.set(key, v);
  }
  const values = [...seen.values()];
  if (values.length <= 1) return values;
  const allNumeric = values.every((v) => typeof v === "number" || typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));
  if (allNumeric) {
    return [...values].sort((a, b) => Number(a) - Number(b));
  }
  const allDates = values.every((v) => !isNaN(Date.parse(String(v))));
  if (allDates) {
    return [...values].sort((a, b) => Date.parse(String(a)) - Date.parse(String(b)));
  }
  return values;
}
var slopeChartDef = {
  chart: "Slope Chart",
  template: {
    mark: { type: "line", point: true, interpolate: "linear", strokeWidth: 2 },
    encoding: {}
  },
  channels: ["x", "y", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: (cs, table) => {
    const resolvedTypes = {};
    const xcs = cs.x;
    if (xcs?.field && !isDiscrete4(xcs.type)) {
      resolvedTypes.x = resolveDiscreteType(xcs.type, xcs.field, table);
    }
    return {
      axisFlags: { x: { banded: true } },
      ...Object.keys(resolvedTypes).length ? { resolvedTypes } : {},
      paramOverrides: {
        // Spread the two periods well apart and keep the plot from being
        // squeezed tall: a wide band step + no series-count vertical
        // stretch yields the classic balanced slopegraph framing.
        defaultBandSize: 120,
        continuousMarkCrossSection: { x: 0, y: 0, seriesCountAxis: "auto" },
        facetAspectRatioResistance: 0.4
      }
    };
  },
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const xEnc = spec.encoding?.x;
    const yEnc = spec.encoding?.y;
    if (!xEnc || !yEnc) return;
    if (!isDiscrete4(xEnc.type)) {
      xEnc.type = resolveDiscreteType(xEnc.type, xEnc.field, ctx.table);
    }
    if ((xEnc.type === "ordinal" || xEnc.type === "nominal") && xEnc.sort == null && xEnc.field) {
      const order = orderedDistinct(ctx.table, xEnc.field);
      if (order.length > 1) xEnc.sort = order;
    }
    xEnc.scale = { ...xEnc.scale, padding: 0.4 };
    yEnc.scale = { ...yEnc.scale, zero: false, nice: true, padding: 12 };
  }
};

// src/vegalite/templates/area.ts
var interpolateConfigProperty2 = {
  key: "interpolate",
  label: "Curve",
  type: "discrete",
  options: [
    { value: void 0, label: "Default (linear)" },
    { value: "linear", label: "Linear" },
    { value: "monotone", label: "Monotone (smooth)" },
    { value: "step", label: "Step" },
    { value: "step-before", label: "Step Before" },
    { value: "step-after", label: "Step After" },
    { value: "basis", label: "Basis (smooth)" },
    { value: "cardinal", label: "Cardinal" },
    { value: "catmull-rom", label: "Catmull-Rom" }
  ]
};
function applyInterpolate2(vgSpec, config) {
  if (!config?.interpolate) return;
  vgSpec.mark = setMarkProp(vgSpec.mark, "interpolate", config.interpolate);
}
var areaChartDef = {
  chart: "Area Chart",
  template: { mark: "area", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" }, facetAspectRatioResistance: 0.5 }
  }),
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const config = ctx.chartProperties;
    applyInterpolate2(spec, config);
    if (config) {
      if (config.opacity !== void 0 && config.opacity < 1) {
        spec.mark = setMarkProp(spec.mark, "opacity", config.opacity);
      }
      if (config.stackMode) {
        for (const axis of ["x", "y"]) {
          if (spec.encoding?.[axis]?.type === "quantitative" || spec.encoding?.[axis]?.aggregate) {
            spec.encoding[axis].stack = config.stackMode === "layered" ? null : config.stackMode;
            break;
          }
        }
      }
    }
  },
  properties: [
    interpolateConfigProperty2,
    { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.1, defaultValue: 0.7 },
    {
      key: "stackMode",
      label: "Stack",
      type: "discrete",
      // A stack mode only does something when a series dimension (color) is
      // present to stack; without it there is a single area band.
      check: (ctx) => ({ applicable: !!ctx.encodings.color?.field }),
      options: [
        { value: void 0, label: "Stacked (default)" },
        { value: "normalize", label: "Normalize (100%)" },
        { value: "center", label: "Center" },
        { value: "layered", label: "Layered (overlap)" }
      ]
    }
  ],
  // Like a line, an area pins its domain to `x` (no τ transpose). `permute`
  // exposes the y↔color swap only for a genuine dual-measure area; the series
  // dimension is explored via `shift` (legend/facets).
  pivot: makeCartesianPivot({
    permute: [["y", "color"]],
    shift: ["color", "column", "row"]
  })
};
var streamgraphDef = {
  chart: "Streamgraph",
  template: { mark: "area", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" }, facetAspectRatioResistance: 0.5 }
  }),
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    if (spec.encoding?.y && !spec.encoding.y.stack) {
      spec.encoding.y.stack = "center";
      spec.encoding.y.axis = null;
    } else if (spec.encoding?.x && !spec.encoding.x.stack) {
      spec.encoding.x.stack = "center";
      spec.encoding.x.axis = null;
    }
    applyInterpolate2(spec, ctx.chartProperties);
  },
  properties: [interpolateConfigProperty2]
};

// src/vegalite/templates/range-area.ts
var interpolateConfigProperty3 = {
  key: "interpolate",
  label: "Curve",
  type: "discrete",
  options: [
    { value: void 0, label: "Default (linear)" },
    { value: "linear", label: "Linear" },
    { value: "monotone", label: "Monotone (smooth)" },
    { value: "step", label: "Step" },
    { value: "step-before", label: "Step Before" },
    { value: "step-after", label: "Step After" },
    { value: "basis", label: "Basis (smooth)" }
  ]
};
var rangeAreaChartDef = {
  chart: "Range Area Chart",
  template: { mark: { type: "area", opacity: 0.5, line: { strokeWidth: 1 } }, encoding: {} },
  channels: ["x", "y", "y2", "color", "column", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    paramOverrides: {
      continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" },
      facetAspectRatioResistance: 0.5
    }
  }),
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const yEnc = spec.encoding?.y;
    const y2Enc = spec.encoding?.y2;
    if (!yEnc || !y2Enc?.field) return;
    spec.encoding.y2 = { field: y2Enc.field };
    yEnc.scale = { ...yEnc.scale, zero: false, nice: true };
    if (spec.encoding.color) {
      yEnc.stack = null;
    }
    const config = ctx.chartProperties;
    if (config?.interpolate) {
      spec.mark = setMarkProp(spec.mark, "interpolate", config.interpolate);
    }
    if (config?.opacity !== void 0 && config.opacity < 1) {
      spec.mark = setMarkProp(spec.mark, "opacity", config.opacity);
    }
  },
  properties: [
    interpolateConfigProperty3,
    { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.1, defaultValue: 0.5 }
  ]
};

// src/vegalite/templates/pie.ts
var pieChartDef = {
  chart: "Pie Chart",
  template: { mark: "arc", encoding: {} },
  channels: ["size", "color", "column", "row"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    if (!spec.encoding) spec.encoding = {};
    for (const [ch, enc] of Object.entries(ctx.resolvedEncodings)) {
      if (ch === "size") {
        const { scale: _scale, ...thetaEnc } = enc;
        spec.encoding.theta = thetaEnc;
      } else {
        spec.encoding[ch] = enc;
      }
    }
    if (!spec.encoding.theta) {
      spec.encoding.theta = { aggregate: "count", type: "quantitative" };
    }
    const config = ctx.chartProperties;
    if (config && config.innerRadius > 0) {
      spec.mark = setMarkProp(spec.mark, "innerRadius", config.innerRadius);
    }
    const thetaField = spec.encoding.theta?.field;
    const colorField = spec.encoding.color?.field;
    const sortSlices = config?.sortSlices;
    if (sortSlices === "descending" || sortSlices === "ascending") {
      spec.encoding.order = thetaField ? { field: thetaField, type: "quantitative", sort: sortSlices } : { aggregate: "count", type: "quantitative", sort: sortSlices };
      if (spec.encoding.color) {
        spec.encoding.color = {
          ...spec.encoding.color,
          sort: thetaField ? { field: thetaField, op: "sum", order: sortSlices } : { op: "count", order: sortSlices }
        };
      }
    }
    let effectiveCount;
    if (thetaField && colorField) {
      const agg = /* @__PURE__ */ new Map();
      for (const row of ctx.table) {
        const cat = String(row[colorField] ?? "");
        const val = Number(row[thetaField]) || 0;
        agg.set(cat, (agg.get(cat) ?? 0) + val);
      }
      effectiveCount = computeEffectiveBarCount([...agg.values()]);
    } else if (colorField) {
      const cats = new Set(ctx.table.map((r) => String(r[colorField] ?? "")));
      effectiveCount = cats.size;
    } else {
      effectiveCount = ctx.table.length;
    }
    const { canvasW, canvasH } = computeCircumferencePressure(
      effectiveCount,
      ctx.canvasSize,
      {
        minArcPx: 45,
        minRadius: 60,
        maxStretch: ctx.assembleOptions?.maxStretch,
        maxStretchX: ctx.assembleOptions?.maxStretchX,
        maxStretchY: ctx.assembleOptions?.maxStretchY,
        margin: 50
        // room for labels around pie
      }
    );
    spec.width = canvasW;
    spec.height = canvasH;
  },
  properties: [
    { key: "innerRadius", label: "Donut", type: "continuous", min: 0, max: 100, step: 5, defaultValue: 0 },
    {
      key: "sortSlices",
      label: "Sort slices",
      type: "discrete",
      options: [
        { value: "none", label: "Data order" },
        { value: "descending", label: "Largest first" },
        { value: "ascending", label: "Smallest first" }
      ],
      defaultValue: "none"
    }
  ]
};

// src/vegalite/templates/lollipop.ts
var lollipopChartDef = {
  chart: "Lollipop Chart",
  template: {
    encoding: {},
    layer: [
      { mark: { type: "rule", strokeWidth: 1.5 }, encoding: {} },
      { mark: { type: "circle", size: 80, opacity: 1 }, encoding: {} }
    ]
  },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes,
      // Lollipops use the same base band size as bars but tolerate
      // more compression (minStep: 4 vs bar's 6, maxStretch: 3 vs 2)
      // since thin rules + small dots need less room than full-width bars.
      paramOverrides: { defaultBandSize: 20, minStep: 4, maxStretch: 3, targetBandAR: 240 }
    };
  },
  instantiate: (spec, ctx) => {
    const { color, column, row, ...positional } = ctx.resolvedEncodings;
    for (const [ch, enc] of Object.entries(positional)) {
      for (const layer of spec.layer) {
        layer.encoding[ch] = { ...layer.encoding[ch] || {}, ...enc };
      }
    }
    if (color) {
      spec.layer[1].encoding.color = { ...spec.layer[1].encoding.color || {}, ...color };
    }
    if (!spec.encoding) spec.encoding = {};
    if (column) spec.encoding.column = column;
    if (row) spec.encoding.row = row;
    const table = ctx.table;
    const config = ctx.chartProperties;
    const layout = ctx.layout;
    const xEnc = spec.layer[0]?.encoding?.x;
    const yEnc = spec.layer[0]?.encoding?.y;
    const xType = xEnc?.type;
    const yType = yEnc?.type;
    const isMeasure2 = (t) => t != null && t !== "nominal" && t !== "ordinal";
    if (isMeasure2(yType)) {
      spec.layer[0].encoding.y2 = { datum: 0 };
    } else if (isMeasure2(xType)) {
      spec.layer[0].encoding.x2 = { datum: 0 };
    }
    const n = table?.length ?? 0;
    const plotWidth = layout?.subplotWidth ?? ctx.canvasSize?.width ?? 400;
    const plotHeight = layout?.subplotHeight ?? ctx.canvasSize?.height ?? 300;
    const defaultDotSize = config?.dotSize ?? 80;
    const plotArea = plotWidth * plotHeight;
    const targetCoverage = 0.15;
    const currentCoverage = n * defaultDotSize / plotArea;
    let dotSize = defaultDotSize;
    if (n > 0 && currentCoverage > targetCoverage) {
      dotSize = Math.round(Math.max(4, targetCoverage * plotArea / n));
    }
    spec.layer[1].mark = { ...spec.layer[1].mark, size: dotSize };
    const baseStroke = 1.5;
    if (dotSize < defaultDotSize) {
      const ratio = dotSize / defaultDotSize;
      const stroke = Math.max(0.15, baseStroke * ratio);
      spec.layer[0].mark = { ...spec.layer[0].mark, strokeWidth: stroke };
    }
    const discreteAxis = !isMeasure2(xType) ? "x" : !isMeasure2(yType) ? "y" : null;
    const discreteField = discreteAxis === "x" ? xEnc?.field : discreteAxis === "y" ? yEnc?.field : null;
    if (discreteField && table && table.length > 0) {
      const counts = {};
      for (const row2 of table) {
        const key = String(row2[discreteField] ?? "");
        counts[key] = (counts[key] || 0) + 1;
      }
      const maxOverlap = Math.max(...Object.values(counts));
      if (maxOverlap > 1) {
        const currentStroke = spec.layer[0].mark.strokeWidth ?? baseStroke;
        const stroke = Math.max(0.15, currentStroke / maxOverlap);
        spec.layer[0].mark = { ...spec.layer[0].mark, strokeWidth: stroke };
      }
    }
    for (const axis of ["x", "y"]) {
      const count = axis === "x" ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
      if (count <= 0) continue;
      const effStep = axis === "x" ? layout.xStep : layout.yStep;
      const maxRuleWidth = Math.max(0.15, Math.min(effStep * 0.4, 2));
      const maxDotSize = Math.max(4, Math.round(effStep * effStep * 0.6));
      spec.layer[0].mark = setMarkProp(
        spec.layer[0].mark,
        "strokeWidth",
        Math.min(spec.layer[0].mark.strokeWidth ?? baseStroke, maxRuleWidth)
      );
      const currentDotSize = spec.layer[1].mark.size ?? dotSize;
      spec.layer[1].mark = setMarkProp(
        spec.layer[1].mark,
        "size",
        Math.min(currentDotSize, maxDotSize)
      );
    }
    if (config?.dotSize) {
      spec.layer[1].mark = { ...spec.layer[1].mark, size: config.dotSize };
    }
  },
  properties: [
    { key: "dotSize", label: "Dot Size", type: "continuous", min: 20, max: 300, step: 10, defaultValue: 80 }
  ],
  encodingActions: [makeSortAction()],
  // Mirrors the bar pivot (a lollipop is bar's thin-mark sibling): orientation
  // flip, banded-axis ↔ series role swap, and series routing to legend/facets.
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "column", "row"]
  })
};

// src/vegalite/templates/density.ts
function estimateBandwidth(values) {
  const n = values.length;
  if (n < 2) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mean2 = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v2) => s + (v2 - mean2) ** 2, 0) / n;
  const d = Math.sqrt(variance);
  const q1 = sorted[Math.floor((n - 1) * 0.25)];
  const q3 = sorted[Math.floor((n - 1) * 0.75)];
  const iqr = q3 != null && q1 != null ? q3 - q1 : 0;
  const h = iqr / 1.34;
  const v = Math.min(d, h || d) || d || 1;
  return 1.06 * v * Math.pow(n, -0.2);
}
function maxGroupBandwidth(table, field, groupby) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of table) {
    const v = Number(row[field]);
    if (!Number.isFinite(v)) continue;
    const key = groupby.length ? groupby.map((f) => String(row[f])).join("\0") : "";
    const arr = groups.get(key);
    if (arr) arr.push(v);
    else groups.set(key, [v]);
  }
  let mx = 0;
  for (const arr of groups.values()) {
    const bw = estimateBandwidth(arr);
    if (bw > mx) mx = bw;
  }
  return mx;
}
var densityPlotDef = {
  chart: "Density Plot",
  template: {
    mark: "area",
    transform: [{ density: "__field__" }],
    encoding: {
      x: { field: "value", type: "quantitative" },
      y: { field: "density", type: "quantitative" }
    }
  },
  channels: ["x", "color", "column", "row"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { x, color, column, row } = ctx.resolvedEncodings;
    if (x?.field) {
      spec.transform[0].density = x.field;
      spec.encoding.x.title = x.field;
    }
    const groupby = [];
    if (color?.field) {
      spec.encoding.color = { ...spec.encoding.color || {}, ...color };
      groupby.push(color.field);
    }
    if (column) {
      spec.encoding.column = column;
      if (column.field) groupby.push(column.field);
    }
    if (row) {
      spec.encoding.row = row;
      if (row.field) groupby.push(row.field);
    }
    if (groupby.length > 0) {
      spec.transform[0].groupby = groupby;
    }
    const config = ctx.chartProperties;
    if (config?.bandwidth && config.bandwidth > 0 && x?.field) {
      const base = maxGroupBandwidth(ctx.table, x.field, groupby);
      if (base > 0) spec.transform[0].bandwidth = base * config.bandwidth;
    }
  },
  properties: [
    { key: "bandwidth", label: "Bandwidth", type: "continuous", min: 0.05, max: 2, step: 0.05, defaultValue: 0 }
  ],
  // Mirrors the histogram: a single bound field (x) with a computed density, so
  // only `shift` (series → legend/facets) applies, plus the reciprocal θ edge
  // back to a binned Histogram.
  pivot: makeCartesianPivot({
    shift: ["color", "column", "row"],
    transitions: [
      { to: "Histogram", label: "Histogram" }
    ]
  })
};

// src/vegalite/templates/violin.ts
var isDiscrete5 = (t) => t === "nominal" || t === "ordinal";
function distinctValues(table, field) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const row of table) {
    const v = row[field];
    if (v == null) continue;
    const key = String(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}
function numericExtent(table, field) {
  let min = Infinity, max = -Infinity;
  for (const row of table) {
    const v = row[field];
    if (typeof v !== "number" || !isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity || max === -Infinity) return null;
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  return [min, max];
}
function quantileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function stdev(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean2 = values.reduce((s, x) => s + x, 0) / n;
  const v = values.reduce((s, x) => s + (x - mean2) * (x - mean2), 0) / (n - 1);
  return Math.sqrt(v);
}
function bandwidthNRD(values) {
  const n = values.length;
  if (n < 2) return 0;
  const s = [...values].sort((a, b) => a - b);
  const lo = quantileSorted(s, 0.25);
  const hi = quantileSorted(s, 0.75);
  const sd = stdev(s);
  let h = Math.min(sd, (hi - lo) / 1.34);
  if (!(h > 0)) h = sd || Math.abs(lo) || 1;
  return 1.06 * h * Math.pow(n, -0.2);
}
function maxGroupBandwidth2(table, measure, groupby) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of table) {
    const v = row[measure];
    if (typeof v !== "number" || !isFinite(v)) continue;
    const key = groupby.map((f) => String(row[f])).join("\0");
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(v);
  }
  let max = 0;
  for (const arr of groups.values()) {
    const bw = bandwidthNRD(arr);
    if (bw > max) max = bw;
  }
  return max;
}
var violinPlotDef = {
  chart: "Violin Plot",
  template: {
    mark: { type: "area", orient: "horizontal" },
    transform: [{ density: "__measure__", groupby: [], as: ["value", "density"] }],
    encoding: {
      // Measure → shared continuous value axis (vertical).
      y: { field: "value", type: "quantitative" },
      // Mirrored kernel density → horizontal width, centered (the violin).
      x: {
        field: "density",
        type: "quantitative",
        stack: "center",
        impute: null,
        title: null,
        axis: { labels: false, ticks: false, grid: false }
      }
    }
  },
  // `column` is consumed internally for the per-category panels; only `row`
  // is exposed as an additional outer facet.
  channels: ["x", "y", "color", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: (cs, table) => {
    if (!cs.x?.field || !cs.y?.field) return {};
    const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: "x" });
    if (!result) return {};
    return { resolvedTypes: result.resolvedTypes };
  },
  instantiate: (spec, ctx) => {
    const { x, y, color, row } = ctx.resolvedEncodings;
    const catField = x?.field;
    const measureField = y?.field;
    if (!catField || !measureField) return;
    const colorField = color?.field;
    const rowField = row?.field;
    const groupby = [catField];
    if (rowField && rowField !== catField) groupby.push(rowField);
    if (colorField && colorField !== catField && colorField !== rowField) groupby.push(colorField);
    spec.transform[0].density = measureField;
    spec.transform[0].groupby = groupby;
    const config = ctx.chartProperties;
    const baseBandwidth = maxGroupBandwidth2(ctx.table, measureField, groupby);
    const bwMultiplier = config?.bandwidth && config.bandwidth > 0 ? config.bandwidth : 0;
    const effectiveBw = bwMultiplier > 0 ? baseBandwidth * bwMultiplier : baseBandwidth;
    if (bwMultiplier > 0 && baseBandwidth > 0) {
      spec.transform[0].bandwidth = effectiveBw;
    }
    const extent = numericExtent(ctx.table, measureField);
    if (extent) {
      const range = extent[1] - extent[0];
      const pad = Math.max(range * 0.05, 1.5 * effectiveBw, 1e-6);
      spec.transform[0].extent = [extent[0] - pad, extent[1] + pad];
    }
    spec.encoding.y.title = measureField;
    const catType = isDiscrete5(x?.type) ? x.type : "nominal";
    const colorType = color?.type || "nominal";
    if (colorField) {
      spec.encoding.color = { ...color };
    } else {
      spec.encoding.color = { field: catField, type: catType };
    }
    if (!colorField || colorField === catField) {
      spec.encoding.color.legend = null;
    }
    const genuineSubgroup = !!colorField && colorField !== catField && !rowField && planBandDodge(ctx.table, catField, colorField).maxPerBand > 1;
    const subgroupCount = genuineSubgroup ? new Set(ctx.table.map((r) => String(r[colorField]))).size : 0;
    const useGrid = genuineSubgroup && subgroupCount >= 3;
    const cats = distinctValues(ctx.table, catField);
    const catCount = Math.max(1, cats.length);
    const canvasW = ctx.canvasSize?.width ?? 560;
    const canvasH = ctx.canvasSize?.height ?? 360;
    const spacing = 0;
    const reservedW = 60;
    const reservedH = 70;
    const minPanelW = 44;
    const facetDef = {
      field: catField,
      type: catType,
      ...x?.sort !== void 0 ? { sort: x.sort } : {},
      spacing,
      header: { titleOrient: "bottom", labelOrient: "bottom", labelPadding: 2 }
    };
    if (useGrid) {
      let panelW = Math.round((canvasW - reservedW) / catCount);
      panelW = Math.max(minPanelW, Math.min(panelW, 220));
      const panelH = Math.max(70, Math.round((canvasH - reservedH) / subgroupCount) - 10);
      spec.encoding.column = facetDef;
      spec.encoding.row = {
        field: colorField,
        type: colorType,
        ...color?.sort !== void 0 ? { sort: color.sort } : {},
        header: { labelAngle: 0 }
      };
      if (spec.encoding.color) spec.encoding.color.legend = null;
      spec.width = panelW;
      spec.height = panelH;
    } else {
      const maxPerRow = Math.max(1, Math.floor((canvasW - reservedW) / (minPanelW + spacing)));
      const columns = Math.min(catCount, maxPerRow);
      const gridRows = Math.ceil(catCount / columns);
      let panelW = Math.round((canvasW - reservedW - (columns - 1) * spacing) / columns);
      panelW = Math.max(minPanelW, Math.min(panelW, 220));
      const panelH = Math.max(120, Math.round((canvasH - reservedH) / gridRows) - (gridRows > 1 ? 24 : 0));
      if (row) {
        spec.encoding.column = facetDef;
        spec.encoding.row = row;
      } else {
        spec.encoding.facet = { ...facetDef, columns };
      }
      spec.width = panelW;
      spec.height = panelH;
    }
  },
  properties: [
    { key: "bandwidth", label: "Bandwidth", type: "continuous", min: 0.05, max: 2, step: 0.05, defaultValue: 0 }
  ]
};

// src/vegalite/templates/ecdf.ts
var showPointsProperty2 = {
  key: "showPoints",
  label: "Show points",
  type: "binary",
  defaultValue: false
};
function uniqueName(base, taken) {
  let name = base;
  while (taken.has(name)) name = `_${name}`;
  return name;
}
var ecdfPlotDef = {
  chart: "ECDF Plot",
  template: {
    mark: { type: "line", interpolate: "step-after" },
    transform: [],
    encoding: {}
  },
  channels: ["x", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: {
      continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" },
      facetAspectRatioResistance: 0.5
    }
  }),
  instantiate: (spec, ctx) => {
    const { x, color, detail, column, row } = ctx.resolvedEncodings;
    const measure = x?.field;
    if (!measure) return;
    const taken = /* @__PURE__ */ new Set();
    for (const r of ctx.table ?? []) {
      for (const k of Object.keys(r)) taken.add(k);
    }
    const cntName = uniqueName("__ecdf_count", taken);
    const totalName = uniqueName("__ecdf_total", taken);
    const ecdfName = uniqueName("__ecdf", taken);
    const groupby = [];
    const pushGroup = (f) => {
      if (f && f !== measure && !groupby.includes(f)) groupby.push(f);
    };
    pushGroup(color?.field);
    pushGroup(detail?.field);
    pushGroup(column?.field);
    pushGroup(row?.field);
    spec.transform = [
      {
        // Running count of rows ≤ the current value (sorted ascending),
        // i.e. frame [unbounded-preceding, current-row].
        window: [{ op: "count", field: measure, as: cntName }],
        sort: [{ field: measure, order: "ascending" }],
        ...groupby.length ? { groupby } : {},
        frame: [null, 0]
      },
      {
        // Per-group total (n) → the denominator.
        joinaggregate: [{ op: "count", field: measure, as: totalName }],
        ...groupby.length ? { groupby } : {}
      },
      { calculate: `datum['${cntName}'] / datum['${totalName}']`, as: ecdfName }
    ];
    spec.encoding.x = {
      ...x,
      type: "quantitative",
      title: measure,
      scale: { ...x?.scale ?? {}, zero: false }
    };
    spec.encoding.y = {
      field: ecdfName,
      type: "quantitative",
      scale: { domain: [0, 1] },
      title: "Cumulative proportion"
    };
    if (color?.field) spec.encoding.color = { ...color };
    if (detail?.field) spec.encoding.detail = { ...detail };
    if (column) spec.encoding.column = column;
    if (row) spec.encoding.row = row;
    if (ctx.chartProperties?.showPoints) {
      spec.mark = setMarkProp(spec.mark, "point", true);
    }
  },
  properties: [showPointsProperty2]
};

// src/vegalite/templates/jitter.ts
var stripPlotDef = {
  chart: "Strip Plot",
  template: {
    mark: { type: "circle", opacity: 0.7 },
    encoding: {}
  },
  channels: ["x", "y", "color", "size", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: { defaultBandSize: 50, minStep: 16 }
  }),
  instantiate: (spec, ctx) => {
    defaultBuildEncodings(spec, ctx.resolvedEncodings);
    const table = ctx.table;
    const canvasSize = ctx.canvasSize;
    const config = ctx.chartProperties;
    const stepWidth = config?.stepWidth ?? 20;
    let pointSize = config?.pointSize ?? 0;
    let opacity = config?.opacity ?? 0;
    const xType = spec.encoding?.x?.type;
    const yType = spec.encoding?.y?.type;
    const catAxis = xType === "nominal" || xType === "ordinal" ? "x" : yType === "nominal" || yType === "ordinal" ? "y" : null;
    let maxGroupCount = table?.length ?? 0;
    if (catAxis && spec.encoding?.[catAxis]?.field && table) {
      const catField = spec.encoding[catAxis].field;
      const groupCounts = {};
      for (const row of table) {
        const key = String(row[catField] ?? "");
        groupCounts[key] = (groupCounts[key] || 0) + 1;
      }
      maxGroupCount = Math.max(1, ...Object.values(groupCounts));
    }
    const contLen = catAxis === "x" ? canvasSize?.height || 400 : canvasSize?.width || 400;
    const areaBudget = stepWidth * contLen;
    const targetCoverage = 0.35;
    if (pointSize === 0) {
      const idealSize = targetCoverage * areaBudget / maxGroupCount;
      pointSize = Math.max(5, Math.min(100, Math.round(idealSize)));
    }
    if (opacity === 0) {
      const density = maxGroupCount * pointSize / areaBudget;
      if (density < 0.2) {
        opacity = 0.8;
      } else if (density < 0.5) {
        opacity = 0.6;
      } else if (density < 1) {
        opacity = 0.4;
      } else {
        opacity = Math.max(0.1, 0.3 / density);
      }
      opacity = Math.round(opacity * 20) / 20;
    }
    if (typeof spec.mark === "string") {
      spec.mark = { type: spec.mark };
    }
    spec.mark.size = pointSize;
    spec.mark.opacity = opacity;
    const jitterWidth = stepWidth * 0.6;
    if (catAxis === "x") {
      spec.width = { step: stepWidth };
    } else if (catAxis === "y") {
      spec.height = { step: stepWidth };
    }
    if (jitterWidth > 0) {
      if (!spec.transform) spec.transform = [];
      spec.transform.push({
        calculate: `${-jitterWidth / 2} + random() * ${jitterWidth}`,
        as: "__jitter"
      });
      const offsetEnc = {
        field: "__jitter",
        type: "quantitative",
        axis: null,
        scale: { domain: [-stepWidth / 2, stepWidth / 2] }
      };
      if (catAxis === "x") {
        spec.encoding.xOffset = offsetEnc;
      } else if (catAxis === "y") {
        spec.encoding.yOffset = offsetEnc;
      } else {
        spec.encoding.xOffset = offsetEnc;
      }
    }
  },
  properties: [
    { key: "stepWidth", label: "Jitter", type: "continuous", min: 10, max: 100, step: 5, defaultValue: 20 },
    { key: "pointSize", label: "Size", type: "continuous", min: 0, max: 150, step: 5, defaultValue: 0 },
    { key: "opacity", label: "Opacity", type: "continuous", min: 0, max: 1, step: 0.1, defaultValue: 0 }
  ],
  pivot: makeCartesianPivot({
    // Reverse of the scatter→Jitter hop: promote the spilled measure on
    // `color` back onto the `x` axis, and the categorical `x` spills back to
    // `color` as a discrete series — re-rendering the strip as a scatter
    // cloud. Inside a scatter's orbit this folds onto Default (θ round-trip);
    // standalone it gives a Strip Plot its own way back to a scatter.
    transitions: [
      {
        to: "Scatter Plot",
        label: "Scatter",
        route: { from: "color", to: "x", mode: "swap", spill: "color" }
      }
    ]
  })
};

// src/vegalite/templates/candlestick.ts
var candlestickChartDef = {
  chart: "Candlestick Chart",
  template: {
    encoding: {},
    layer: [
      { mark: "rule", encoding: {} },
      { mark: { type: "bar", size: 14 }, encoding: {} }
    ]
  },
  channels: ["x", "open", "high", "low", "close", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    axisFlags: { x: { banded: true } }
  }),
  instantiate: (spec, ctx) => {
    const { x, open, high, low, close, column, row } = ctx.resolvedEncodings;
    if (!spec.encoding) spec.encoding = {};
    if (x) {
      spec.encoding.x = x;
      if (x.type === "nominal" || x.type === "ordinal") {
        spec.encoding.x.sort = null;
      }
    }
    if (column) spec.encoding.column = column;
    if (row) spec.encoding.row = row;
    spec.encoding.y = {
      type: "quantitative",
      scale: { zero: false },
      axis: { title: null }
    };
    spec.title = { text: "Price", anchor: "start", fontSize: 11, fontWeight: "normal", color: "#666" };
    if (low) spec.layer[0].encoding.y = { field: low.field };
    if (high) spec.layer[0].encoding.y2 = { field: high.field };
    if (open) spec.layer[1].encoding.y = { field: open.field };
    if (close) spec.layer[1].encoding.y2 = { field: close.field };
    if (open?.field && close?.field) {
      spec.encoding.color = {
        condition: {
          test: `datum['${open.field}'] < datum['${close.field}']`,
          value: "#06982d"
        },
        value: "#ae1325"
      };
    }
    const table = ctx.table;
    const plotWidth = ctx.canvasSize?.width || 400;
    const xField = spec.encoding?.x?.field;
    let barSize;
    if (xField && table?.length > 0) {
      const cardinality = new Set(table.map((r) => r[xField])).size;
      barSize = Math.max(2, Math.min(20, Math.round(plotWidth * 0.6 / cardinality)));
    } else {
      barSize = 14;
    }
    spec.layer[1].mark = { ...spec.layer[1].mark, size: barSize };
  }
};

// src/core/waterfall.ts
function waterfallLastReconciles(values) {
  if (values.length < 2) return false;
  let cumPrev = 0;
  for (let i = 0; i < values.length - 1; i++) {
    if (!Number.isFinite(values[i])) return false;
    cumPrev += values[i];
  }
  const last = values[values.length - 1];
  if (!Number.isFinite(last)) return false;
  const tol = Math.max(1e-6, 5e-3 * Math.abs(cumPrev));
  return Math.abs(last - cumPrev) <= tol;
}
function recommendedTotalsMode(values) {
  return waterfallLastReconciles(values) ? "both" : "first";
}
function resolveTotalsMode(values, explicit) {
  if (explicit === "none" || explicit === "first" || explicit === "last" || explicit === "both") {
    return explicit;
  }
  return recommendedTotalsMode(values);
}

// src/vegalite/templates/waterfall.ts
var waterfallChartDef = {
  chart: "Waterfall Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: () => ({
    axisFlags: { x: { banded: true } }
  }),
  instantiate: (spec, ctx) => {
    const { x, y, color, column, row } = ctx.resolvedEncodings;
    const config = ctx.chartProperties;
    const xField = x?.field || "Category";
    const yField = y?.field || "Amount";
    const colorField = color?.field;
    if (!spec.encoding) spec.encoding = {};
    if (column) spec.encoding.column = column;
    if (row) spec.encoding.row = row;
    const hasTypeCol = !!colorField;
    const typeField = colorField || "__wf_type";
    const transforms = [];
    if (!hasTypeCol) {
      const wfValues = (ctx.fullTable ?? ctx.table ?? []).map((r) => Number(r[yField]));
      const totalsMode = resolveTotalsMode(wfValues, config?.totals);
      const wantFirst = totalsMode === "first" || totalsMode === "both";
      const wantLast = totalsMode === "last" || totalsMode === "both";
      if (wantFirst || wantLast) {
        transforms.push(
          { window: [{ op: "row_number", as: "__wf_row" }] },
          { joinaggregate: [{ op: "count", as: "__wf_total" }] }
        );
        const branches = [];
        if (wantFirst) branches.push(`datum.__wf_row === 1 ? 'start'`);
        if (wantLast) branches.push(`datum.__wf_row === datum.__wf_total ? 'end'`);
        transforms.push({
          calculate: `${branches.join(" : ")} : 'delta'`,
          as: typeField
        });
      } else {
        transforms.push({ calculate: `'delta'`, as: typeField });
      }
    }
    transforms.push({
      window: [{ op: "sum", field: yField, as: "__wf_sum_raw" }]
    });
    transforms.push({
      calculate: `datum['${typeField}'] === 'end' ? datum.__wf_sum_raw - datum['${yField}'] : datum.__wf_sum_raw`,
      as: "__wf_sum"
    });
    transforms.push({
      calculate: `datum['${typeField}'] === 'end' ? 0 : datum.__wf_sum - datum['${yField}']`,
      as: "__wf_prev_sum"
    });
    transforms.push({
      calculate: `(datum['${typeField}'] === 'start' || datum['${typeField}'] === 'end') ? 'total' : datum['${yField}'] >= 0 ? 'increase' : 'decrease'`,
      as: "__wf_color"
    });
    transforms.push({
      window: [{ op: "lead", field: xField, as: "__wf_lead" }]
    });
    transforms.push({
      calculate: `datum.__wf_lead === null ? datum['${xField}'] : datum.__wf_lead`,
      as: "__wf_lead"
    });
    transforms.push({
      calculate: `datum.__wf_lead === datum['${xField}'] ? null : datum.__wf_sum`,
      as: "__wf_connector_y"
    });
    spec.transform = transforms;
    const xEnc = {
      field: xField,
      type: "ordinal",
      sort: null,
      axis: { labelAngle: -45 }
    };
    const facetEncodings = {};
    if (spec.encoding?.column) facetEncodings.column = spec.encoding.column;
    if (spec.encoding?.row) facetEncodings.row = spec.encoding.row;
    const cornerRadius = config?.cornerRadius && config.cornerRadius > 0 ? config.cornerRadius : 0;
    const xStep = ctx.layout?.xStep ?? 0;
    const showLabels = !!config?.showTextLabels;
    const labelStep = xStep || 40;
    const labelFits = labelStep >= 18;
    const labelFontSize = labelStep >= 40 ? 10 : labelStep >= 26 ? 9 : 8;
    const labelFormat = labelStep >= 36 ? "," : "~s";
    const wfLevels = (() => {
      const vals = (ctx.fullTable ?? ctx.table ?? []).map((r) => Number(r[yField]) || 0);
      const lv = [0];
      let racc = 0;
      for (const v of vals) {
        racc += v;
        lv.push(racc);
      }
      return lv;
    })();
    const yMin = Math.min(...wfLevels);
    const yMax = Math.max(...wfLevels);
    const ySpan = yMax - yMin || 1;
    const plotH = ctx.layout?.subplotHeight || 300;
    const minDataHeight = (labelFontSize + 4) / plotH * ySpan;
    const labelPad = showLabels && labelFits ? (labelFontSize + 8) / plotH * ySpan : 0;
    const yDomain = labelPad > 0 ? [yMin - labelPad, yMax + labelPad] : null;
    spec.encoding = {
      x: xEnc,
      ...facetEncodings
    };
    spec.layer = [
      {
        mark: {
          type: "bar",
          ...cornerRadius > 0 ? { cornerRadius } : {}
        },
        encoding: {
          y: {
            field: "__wf_prev_sum",
            type: "quantitative",
            title: yField,
            ...yDomain ? { scale: { domain: yDomain } } : {}
          },
          y2: { field: "__wf_sum" },
          color: {
            field: "__wf_color",
            type: "nominal",
            scale: {
              domain: ["total", "increase", "decrease"],
              range: ["#f7e0b6", "#93c4aa", "#f78a64"]
            },
            legend: { title: "Type" }
          }
        }
      },
      // Thin connector lines bridging each bar to the next at the running
      // cumulative level, tracing the bar tops from the current bar's left
      // edge to the next bar's right edge. `bandPosition` (0 = band left
      // edge, 1 = band right edge) tracks the actual rendered band width, so
      // the connector shrinks/grows with the bars automatically rather than
      // relying on a pixel offset derived from the abstract layout step.
      {
        mark: {
          type: "rule",
          color: "#6b7280",
          opacity: 0.7,
          strokeWidth: 1
        },
        encoding: {
          x: { field: xField, type: "ordinal", sort: null, bandPosition: 0 },
          x2: { field: "__wf_lead", bandPosition: 1 },
          y: { field: "__wf_connector_y", type: "quantitative" }
        }
      }
    ];
    if (showLabels && labelFits) {
      spec.transform.push(
        { calculate: "(datum.__wf_sum + datum.__wf_prev_sum) / 2", as: "__wf_center" },
        {
          calculate: `datum.__wf_color === 'increase' ? '+' + format(datum['${yField}'], '${labelFormat}') : format(datum['${yField}'], '${labelFormat}')`,
          as: "__wf_delta_text"
        }
      );
      spec.layer.push(
        // Running total outside the bar (above increases / below decreases).
        {
          mark: {
            type: "text",
            align: "center",
            baseline: { expr: "datum.__wf_sum >= datum.__wf_prev_sum ? 'bottom' : 'top'" },
            dy: { expr: "datum.__wf_sum >= datum.__wf_prev_sum ? -4 : 4" },
            fontSize: labelFontSize,
            fill: "#374151"
          },
          encoding: {
            y: { field: "__wf_sum", type: "quantitative" },
            text: { field: "__wf_sum", type: "quantitative", format: labelFormat }
          }
        },
        // Delta inside the bar, muted in the bar's own hue. Skipped when the
        // bar is too short to hold the text.
        {
          transform: [{ filter: `abs(datum.__wf_sum - datum.__wf_prev_sum) >= ${minDataHeight}` }],
          mark: {
            type: "text",
            align: "center",
            baseline: "middle",
            fontSize: labelFontSize
          },
          encoding: {
            y: { field: "__wf_center", type: "quantitative" },
            text: { field: "__wf_delta_text", type: "nominal" },
            color: {
              condition: { test: "datum.__wf_color === 'total'", value: "#725a30" },
              value: "white"
            }
          }
        }
      );
    }
    delete spec.mark;
  },
  properties: [
    { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 8, step: 1, defaultValue: 0 },
    {
      key: "totals",
      label: "Totals",
      type: "discrete",
      options: [
        { value: "auto", label: "Auto" },
        { value: "none", label: "None" },
        { value: "first", label: "First" },
        { value: "last", label: "Last" },
        { value: "both", label: "Both" }
      ],
      defaultValue: "auto",
      // Only meaningful when Flint must infer the totals — i.e. there is no
      // explicit Type column. When the user binds a color/Type field their
      // start/delta/end is authoritative, so the toggle is not offered. The
      // default "auto" resolves to the data-aware recommendation inside the
      // template (see core/waterfall.ts resolveTotalsMode).
      check: (ctx) => ({ applicable: !ctx.encodings?.color?.field })
    },
    { key: "showTextLabels", label: "Show labels", type: "binary", defaultValue: false }
  ]
};

// src/vegalite/templates/gantt.ts
var ganttChartDef = {
  chart: "Gantt Chart",
  template: {
    mark: { type: "bar", cornerRadius: 2, height: { band: 0.7 } },
    encoding: {}
  },
  channels: ["y", "x", "x2", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    axisFlags: { y: { banded: true } }
  }),
  instantiate: (spec, ctx) => {
    const { x, x2, y, color, detail, column, row } = ctx.resolvedEncodings;
    if (!spec.encoding) spec.encoding = {};
    if (y) {
      spec.encoding.y = { ...y };
      spec.encoding.y.axis = { ...spec.encoding.y.axis ?? {}, title: null };
      if (x?.field) {
        spec.encoding.y.sort = { field: x.field, op: "min", order: "ascending" };
      }
    }
    if (x) {
      spec.encoding.x = { ...x };
      spec.encoding.x.axis = { ...spec.encoding.x.axis ?? {}, title: null };
      if (x.type === "quantitative") {
        spec.encoding.x.scale = { ...spec.encoding.x.scale ?? {}, zero: false };
      }
    }
    if (x2) spec.encoding.x2 = { field: x2.field };
    if (color) spec.encoding.color = color;
    if (detail) spec.encoding.detail = detail;
    if (column) spec.encoding.column = column;
    if (row) spec.encoding.row = row;
  }
};

// src/vegalite/templates/bullet.ts
var ZONE_GRAYS = ["#e2e2e2", "#ececec", "#f5f5f5"];
var STATUS_COLORS = { below: "#c44e52", met: "#2f855a" };
var STATUS_BELOW = "Below target";
var STATUS_MET = "Meets target";
var bulletChartDef = {
  chart: "Bullet Chart",
  template: {
    encoding: {},
    layer: []
  },
  channels: ["y", "x", "goal", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: () => ({
    axisFlags: { y: { banded: true } }
  }),
  instantiate: (spec, ctx) => {
    const { x, y, goal, color, column, row } = ctx.resolvedEncodings;
    const valueTitle = x ? x.title ?? x.field : void 0;
    const xAxis = valueTitle != null ? { title: valueTitle } : {};
    spec.encoding = {};
    const yEnc = y ? { ...y, axis: { ...y.axis ?? {}, title: null } } : void 0;
    if (yEnc) spec.encoding.y = yEnc;
    if (column) spec.encoding.column = column;
    if (row) spec.encoding.row = row;
    const table = ctx.table ?? [];
    const layers = [];
    if (x?.field && y?.field && goal?.field && table.length > 0) {
      const zoneData = [[], [], []];
      for (const r of table) {
        const cat = r[y.field];
        const g = Number(r[goal.field]);
        if (cat == null || !Number.isFinite(g) || g <= 0) continue;
        zoneData[0].push({ [y.field]: cat, __lo: 0, __hi: 0.25 * g });
        zoneData[1].push({ [y.field]: cat, __lo: 0.25 * g, __hi: 0.5 * g });
        zoneData[2].push({ [y.field]: cat, __lo: 0.5 * g, __hi: 0.75 * g });
      }
      zoneData.forEach((rows, i) => {
        if (rows.length === 0) return;
        layers.push({
          data: { values: rows },
          mark: { type: "rect", color: ZONE_GRAYS[i], opacity: 1 },
          encoding: {
            x: { field: "__lo", type: "quantitative", axis: xAxis },
            x2: { field: "__hi" }
          }
        });
      });
    }
    const barLayer = {
      mark: { type: "bar", height: { band: 0.5 } },
      encoding: {}
    };
    if (x) {
      barLayer.encoding.x = {
        ...x,
        scale: { ...x.scale ?? {}, zero: true },
        axis: { ...x.axis ?? {}, title: valueTitle }
      };
    }
    if (color) {
      barLayer.encoding.color = color;
    } else if (x?.field && goal?.field) {
      barLayer.transform = [{
        calculate: `datum[${JSON.stringify(x.field)}] >= datum[${JSON.stringify(goal.field)}] ? '${STATUS_MET}' : '${STATUS_BELOW}'`,
        as: "__status"
      }];
      barLayer.encoding.color = {
        field: "__status",
        type: "nominal",
        scale: {
          domain: [STATUS_BELOW, STATUS_MET],
          range: [STATUS_COLORS.below, STATUS_COLORS.met]
        },
        legend: { title: null },
        title: null
      };
    }
    layers.push(barLayer);
    if (goal) {
      const band = ctx.layout?.yStep;
      const tickSize = band && band > 0 ? Math.min(band, Math.max(8, Math.round(band * 0.72))) : 22;
      layers.push({
        mark: { type: "tick", color: "#1a1a1a", thickness: 3, opacity: 1, size: tickSize },
        encoding: {
          x: { field: goal.field, type: "quantitative", axis: xAxis }
        }
      });
    }
    spec.layer = layers;
  }
};

// src/vegalite/templates/bar-table.ts
var barTableDef = {
  chart: "Bar Table",
  template: {
    spacing: 4,
    resolve: { scale: { y: "shared" } },
    hconcat: [],
    config: { view: { stroke: null }, axis: { grid: false, domain: false, ticks: false } }
  },
  channels: ["y", "x", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table, chartProperties) => {
    const yField = cs.y?.field;
    const facetFields = [cs.column?.field, cs.row?.field].filter(Boolean);
    const rawRowCount = (() => {
      if (!yField) return 0;
      if (facetFields.length === 0) {
        return new Set((table ?? []).map((r) => r[yField])).size;
      }
      const perFacetRows = /* @__PURE__ */ new Map();
      for (const r of table ?? []) {
        const key = facetFields.map((f) => String(r[f] ?? "")).join("\0");
        const rows = perFacetRows.get(key) ?? /* @__PURE__ */ new Set();
        rows.add(r[yField]);
        perFacetRows.set(key, rows);
      }
      return Math.max(0, ...Array.from(perFacetRows.values()).map((rows) => rows.size));
    })();
    const maxRows = Math.max(0, Number(chartProperties?.maxRows ?? 20));
    const displayedRows = maxRows > 0 ? Math.min(rawRowCount, maxRows) : rawRowCount;
    const minSubplotSize = displayedRows >= 30 ? 360 : 280;
    return {
      axisFlags: { y: { banded: true } },
      paramOverrides: {
        // Wider per-row band than the basic 20: leaves room for
        // both the bar and the two text columns.
        defaultBandSize: 24,
        // Floor on overall subplot size — scales up when rows
        // are dense so the bar column doesn't collapse below
        // legibility.
        minSubplotSize,
        // Lengthen the continuous axis (bar) relative to the
        // step height. Without this, a tall narrow canvas
        // (many rows) leaves bars only a sliver wide.
        targetBandAR: 280
      }
    };
  },
  instantiate: (spec, ctx) => {
    const { x, y, color, column, row } = ctx.resolvedEncodings;
    const config = ctx.chartProperties;
    const table = ctx.fullTable ?? ctx.table ?? [];
    const canvasSize = ctx.canvasSize;
    const xField = x?.field || "Value";
    const yField = y?.field || "Category";
    const colorField = color?.field;
    const facetFields = [column?.field, row?.field].filter(Boolean);
    const hasFacet = facetFields.length > 0;
    const scopeKeyOf = (r) => facetFields.map((f) => String(r[f] ?? "")).join("\0");
    const scopeValuesOf = (r) => Object.fromEntries(facetFields.map((f) => [f, r[f]]));
    const xCS = ctx.channelSemantics?.x;
    const yCS = ctx.channelSemantics?.y;
    const xEntry = getRegistryEntry(xCS?.semanticAnnotation?.semanticType ?? "Unknown");
    let hasNegative = false;
    let hasPositive = false;
    for (const r of table) {
      const v = r[xField];
      if (typeof v === "number" && isFinite(v)) {
        if (v < 0) hasNegative = true;
        else if (v > 0) hasPositive = true;
      }
    }
    const showPercent = config?.showPercent === true;
    const useMeanForDisplay = xCS?.aggregationDefault === "average";
    const aggValue = (g) => useMeanForDisplay ? g.sum / Math.max(1, g.n) : g.sum;
    const scopedCategoryAgg = /* @__PURE__ */ new Map();
    for (const r of table) {
      const v = r[xField];
      if (typeof v !== "number" || !isFinite(v)) continue;
      const scopeKey = hasFacet ? scopeKeyOf(r) : "";
      let scope = scopedCategoryAgg.get(scopeKey);
      if (!scope) {
        scope = { facetValues: hasFacet ? scopeValuesOf(r) : {}, categories: /* @__PURE__ */ new Map() };
        scopedCategoryAgg.set(scopeKey, scope);
      }
      const g = scope.categories.get(r[yField]) ?? { sum: 0, n: 0 };
      g.sum += v;
      g.n += 1;
      scope.categories.set(r[yField], g);
    }
    const scopes = Array.from(scopedCategoryAgg.entries());
    const globalCategoryAgg = /* @__PURE__ */ new Map();
    for (const { categories } of scopedCategoryAgg.values()) {
      for (const [cat, g] of categories.entries()) {
        const total = globalCategoryAgg.get(cat) ?? { sum: 0, n: 0 };
        total.sum += g.sum;
        total.n += g.n;
        globalCategoryAgg.set(cat, total);
      }
    }
    const uniqueCats = Array.from(globalCategoryAgg.keys());
    const maxRows = Math.max(0, Number(config?.maxRows ?? 20));
    const ySortOrderForTrim = yCS?.ordinalSortOrder;
    const maxScopedCategoryCount = Math.max(0, ...scopes.map(([, scope]) => scope.categories.size));
    const canTrim = maxRows > 0 && !(ySortOrderForTrim && ySortOrderForTrim.length > 0) && maxScopedCategoryCount > maxRows;
    const sortRowsByValue = (items) => items.sort((a, b) => yCS?.reversed ? a.value - b.value : b.value - a.value);
    let displayTable = [];
    let othersCatLabel;
    let keptCatOrder;
    const perCatAggValues = [];
    const perScopeAggValues = [];
    let maxDisplayRowsPerScope = 0;
    if (canTrim) {
      const keepN = Math.max(1, maxRows - 1);
      const displayRows = [];
      for (const [scopeKey, scope] of scopes) {
        const sorted = sortRowsByValue(Array.from(scope.categories.entries()).map(([cat, g]) => ({ cat, value: aggValue(g) })));
        const keptItems = sorted.slice(0, keepN);
        const rest = sorted.slice(keepN);
        if (!hasFacet) {
          keptCatOrder = keptItems.map((a) => a.cat);
        }
        const keptCats = new Set(keptItems.map((a) => a.cat));
        if (colorField) {
          const keptRanks = new Map(keptItems.map((a, idx) => [a.cat, idx]));
          for (const r of table) {
            if ((hasFacet ? scopeKeyOf(r) : "") === scopeKey && keptCats.has(r[yField])) {
              displayRows.push({ ...r, __bt_sort: keptRanks.get(r[yField]) ?? 0, __bt_others: false, __bt_others_num: 0 });
            }
          }
        } else {
          keptItems.forEach((a, idx) => {
            displayRows.push({ ...scope.facetValues, [yField]: a.cat, [xField]: a.value, __bt_sort: idx, __bt_others: false, __bt_others_num: 0 });
          });
        }
        const restSum = rest.reduce((s, a) => s + a.value, 0);
        const othersValue = useMeanForDisplay && rest.length > 0 ? restSum / rest.length : restSum;
        const scopeOthersLabel = `Others (+${rest.length})`;
        othersCatLabel = othersCatLabel ?? scopeOthersLabel;
        displayRows.push({
          ...scope.facetValues,
          [yField]: scopeOthersLabel,
          [xField]: othersValue,
          __bt_sort: keptItems.length,
          __bt_others: true,
          __bt_others_num: 1
        });
        const scopeAggValues = [...keptItems.map((a) => a.value), othersValue];
        perCatAggValues.push(...scopeAggValues);
        perScopeAggValues.push(scopeAggValues);
        maxDisplayRowsPerScope = Math.max(maxDisplayRowsPerScope, keptItems.length + 1);
      }
      displayTable = displayRows;
    }
    if (!canTrim) {
      const sortRanksByScope = /* @__PURE__ */ new Map();
      for (const [scopeKey, scope] of scopes) {
        const sorted = sortRowsByValue(Array.from(scope.categories.entries()).map(([cat, g]) => ({ cat, value: aggValue(g) })));
        sortRanksByScope.set(scopeKey, new Map(sorted.map((a, idx) => [a.cat, idx])));
        const scopeAggValues = sorted.map((a) => a.value);
        perCatAggValues.push(...scopeAggValues);
        perScopeAggValues.push(scopeAggValues);
        maxDisplayRowsPerScope = Math.max(maxDisplayRowsPerScope, sorted.length);
      }
      displayTable = table.map((r) => {
        const scopeKey = hasFacet ? scopeKeyOf(r) : "";
        return { ...r, __bt_sort: sortRanksByScope.get(scopeKey)?.get(r[yField]) ?? 0, __bt_others: false, __bt_others_num: 0 };
      });
    }
    const categoryHeader = yField;
    const percentHeader = "%";
    const valueHeader = xField;
    const valueFmt = xCS?.format;
    const pctPattern = ".1%";
    const sortOp = xCS?.aggregationDefault === "average" ? "mean" : "sum";
    const uniqueGroupby = (fields) => Array.from(new Set(fields));
    const textGroupby = hasFacet ? uniqueGroupby([...facetFields, yField]) : [yField];
    const textPanelTransform = [
      { aggregate: [{ op: sortOp, field: xField, as: "__bt_val" }, { op: "min", field: "__bt_sort", as: "__bt_sort" }, { op: "max", field: "__bt_others_num", as: "__bt_others_num" }], groupby: textGroupby }
    ];
    if (showPercent) {
      const totalTransform = { joinaggregate: [{ op: "sum", field: "__bt_val", as: "__bt_total" }] };
      if (hasFacet) {
        totalTransform.groupby = facetFields;
      }
      textPanelTransform.push(
        totalTransform,
        { calculate: `datum.__bt_total === 0 ? null : datum.__bt_val / datum.__bt_total`, as: "__bt_pct" }
      );
    }
    const uniqueFacetValueCount = (field) => field ? new Set(displayTable.map((r) => r[field])).size : 0;
    const columnFacetCount = uniqueFacetValueCount(column?.field);
    const rowFacetCount = uniqueFacetValueCount(row?.field);
    const layoutFacetColumns = ctx.layout?.facet?.columns ?? (columnFacetCount || 1);
    const facetColsForSizing = hasFacet ? Math.max(1, Math.min(layoutFacetColumns, columnFacetCount || 1)) : 1;
    const facetRowsForSizing = hasFacet ? Math.max(1, rowFacetCount || Math.ceil(Math.max(1, columnFacetCount) / facetColsForSizing)) : 1;
    const subplotWidth = hasFacet ? ctx.layout?.subplotWidth ?? canvasSize?.width : canvasSize?.width;
    const layoutSubplotHeight = hasFacet ? ctx.layout?.subplotHeight ?? canvasSize?.height : canvasSize?.height;
    const facetHeightBudget = hasFacet && facetRowsForSizing > 1 ? (() => {
      const maxStretch = ctx.assembleOptions?.maxStretchY ?? ctx.assembleOptions?.maxStretch ?? 2;
      const facetElasticity = ctx.assembleOptions?.facetElasticity ?? 0.3;
      const fixH = ctx.assembleOptions?.facetFixedPadding?.height ?? 0;
      const gap = ctx.layout?.effectiveFacetGap ?? ctx.assembleOptions?.facetGap ?? 0;
      const stretch = Math.min(maxStretch, Math.pow(facetRowsForSizing, facetElasticity));
      return Math.max(0, Math.round((canvasSize.height * stretch - fixH) / facetRowsForSizing - gap));
    })() : layoutSubplotHeight;
    const displayCount = maxDisplayRowsPerScope || uniqueCats.length;
    const density = Math.min(1, Math.max(0, (displayCount - 12) / 40));
    const lerp = (a, b) => Math.round(a + (b - a) * density);
    const subplotWidthRatio = hasFacet && canvasSize?.width ? Math.min(1, Math.max(0, (subplotWidth ?? canvasSize.width) / canvasSize.width)) : 1;
    const subplotHeightRatio = hasFacet && canvasSize?.height ? Math.min(1, Math.max(0, (facetHeightBudget ?? canvasSize.height) / canvasSize.height)) : 1;
    const facetFontDrop = hasFacet ? Math.round((1 - Math.min(subplotWidthRatio, subplotHeightRatio)) * 3) : 0;
    const fontSize = Math.max(9, lerp(12, 10) - facetFontDrop);
    const labelFontSize = Math.max(9, lerp(13, 10) - facetFontDrop);
    const barCap = 16, barMin = 8;
    const gapMin = 2, gapRatio = 0.2;
    const compressStart = 30, compressEnd = 80;
    const compressT = Math.min(1, Math.max(
      0,
      (displayCount - compressStart) / (compressEnd - compressStart)
    ));
    const barPx = Math.round(barCap - (barCap - barMin) * compressT);
    const gapPx = Math.max(gapMin, Math.round(barPx * gapRatio));
    const rowStep = barPx + gapPx;
    const barBandRatio = +(barPx / rowStep).toFixed(3);
    const charPx = fontSize * 0.6;
    const textPad = 12;
    const minTextPanel = 36;
    const maxTextPanel = 140;
    const cjkRe = /[\u4E00-\u9FFF\u3000-\u303F]/;
    const headerStyle = {
      fontSize,
      fontWeight: "normal",
      color: "#999"
    };
    const ySortOrder = yCS?.ordinalSortOrder;
    const rankedCatOrder = (() => {
      if (canTrim && keptCatOrder && othersCatLabel) {
        return [...keptCatOrder, othersCatLabel];
      }
      return uniqueCats.map((cat) => ({ cat, value: aggValue(globalCategoryAgg.get(cat)) })).sort((a, b) => yCS?.reversed ? a.value - b.value : b.value - a.value).map((a) => a.cat);
    })();
    const ySort = ySortOrder && ySortOrder.length > 0 ? ySortOrder : hasFacet ? { field: "__bt_sort", op: "min", order: "ascending" } : rankedCatOrder;
    const categoryLabelWidth = (() => {
      const maxChars = displayTable.reduce((m, r) => {
        const s = String(r[yField] ?? "");
        const w = [...s].reduce((a, ch) => a + (cjkRe.test(ch) ? 2 : 1), 0);
        return Math.max(m, w);
      }, 0);
      return Math.min(220, Math.max(60, Math.round(maxChars * labelFontSize * 0.55 + 12)));
    })();
    const yEncWithLabels = {
      field: yField,
      type: "nominal",
      sort: ySort,
      axis: {
        title: null,
        domain: false,
        ticks: false,
        labelFontSize,
        labelAlign: "left",
        labelPadding: categoryLabelWidth,
        labelLimit: categoryLabelWidth
      }
    };
    const yEncNoLabels = { ...yEncWithLabels, axis: null };
    const isDiverging = !colorField && (xEntry.diverging === "inherent" || xEntry.diverging === "conditional" && hasNegative && hasPositive);
    const colorEnc = colorField ? (() => {
      const base = { ...color };
      if (canTrim) {
        const vals = Array.from(new Set(
          displayTable.filter((r) => !r.__bt_others).map((r) => r[colorField]).filter((v) => v !== void 0 && v !== null)
        ));
        base.scale = { ...base.scale || {}, domain: vals };
      }
      return base;
    })() : isDiverging ? {
      field: xField,
      type: "quantitative",
      legend: null,
      scale: { scheme: "redyellowgreen", domainMid: 0 }
    } : {
      field: xField,
      type: "quantitative",
      legend: null,
      scale: { range: ["#cdebd3", "#41a25f"] }
    };
    const approxFormat = (v) => {
      if (!Number.isFinite(v)) return "";
      if (!valueFmt) return String(v);
      const p = valueFmt.pattern || "";
      let body;
      if (p.includes("%")) {
        const dec = /\.(\d+)/.exec(p)?.[1];
        body = (v * 100).toFixed(dec ? parseInt(dec) : 1) + "%";
      } else if (p.includes("d")) {
        body = Math.round(v).toLocaleString("en-US");
      } else if (/~s|s$/.test(p)) {
        body = Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(0);
      } else if (p) {
        const dec = /\.(\d+)/.exec(p)?.[1];
        body = v.toLocaleString("en-US", {
          minimumFractionDigits: dec ? parseInt(dec) : 0,
          maximumFractionDigits: dec ? parseInt(dec) : 2
        });
      } else {
        body = String(v);
      }
      return (valueFmt.prefix ?? "") + body + (valueFmt.suffix ?? "");
    };
    const approxPct = (v) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "";
    const measure = (strs) => {
      const maxChars = strs.reduce((m, s) => Math.max(m, s.length), 0);
      return Math.min(maxTextPanel, Math.max(minTextPanel, Math.round(maxChars * charPx + textPad)));
    };
    const headerPad = 4;
    const headerWidthOf = (s) => Math.round(s.length * charPx) + headerPad;
    const wrapHeader = (label, maxPx) => {
      const single = headerWidthOf(label);
      if (single <= maxPx) return { text: label, widthPx: single };
      const tokens = label.split(/[_\s]+/).filter(Boolean);
      if (tokens.length < 2) return { text: label, widthPx: single };
      const totalLen = tokens.reduce((a, t) => a + t.length, 0);
      let acc = 0, splitAt = 1;
      for (let i = 0; i < tokens.length - 1; i++) {
        acc += tokens[i].length;
        if (acc >= totalLen / 2) {
          splitAt = i + 1;
          break;
        }
      }
      const line1 = tokens.slice(0, splitAt).join("_");
      const line2 = tokens.slice(splitAt).join("_");
      return { text: [line1, line2], widthPx: Math.max(headerWidthOf(line1), headerWidthOf(line2)) };
    };
    const valueHeaderWrap = wrapHeader(valueHeader, maxTextPanel - headerPad);
    const percentHeaderWrap = wrapHeader(percentHeader, maxTextPanel - headerPad);
    const valuePanelDataWidth = measure(perCatAggValues.map(approxFormat));
    const valuePanelWidth = Math.min(
      maxTextPanel,
      Math.max(valuePanelDataWidth, valueHeaderWrap.widthPx + headerPad, minTextPanel)
    );
    const pctValuesForSizing = perScopeAggValues.flatMap((values) => {
      const scopeTotal = values.reduce((a, b) => a + b, 0);
      return Math.abs(scopeTotal) > 1e-9 ? values.map((v) => v / scopeTotal) : [];
    });
    const percentPanelWidth = showPercent && pctValuesForSizing.length > 0 ? Math.min(
      maxTextPanel,
      Math.max(
        measure(pctValuesForSizing.map(approxPct)),
        percentHeaderWrap.widthPx + headerPad,
        minTextPanel
      )
    ) : 0;
    const totalWidth = subplotWidth ?? 480;
    const interPanelGap = 8;
    const reservedForText = valuePanelWidth + interPanelGap + (showPercent ? percentPanelWidth + interPanelGap : 0);
    const minBarPanelWidth = hasFacet ? Math.max(80, Math.round(totalWidth * 0.45)) : Math.max(180, Math.round(totalWidth * 0.45));
    const barPanelWidth = Math.max(minBarPanelWidth, totalWidth - reservedForText - categoryLabelWidth);
    const yCard = Math.max(1, maxDisplayRowsPerScope || new Set(displayTable.map((r) => r[yField])).size);
    const panelHeight = Math.max(facetHeightBudget ?? 0, yCard * rowStep);
    const buildTextEncoding = (sourceField, fmt, transformsOut, outFieldHint) => {
      if (!fmt || !fmt.pattern && !fmt.prefix && !fmt.suffix) {
        return { field: sourceField, type: "quantitative" };
      }
      const hasAffix = !!(fmt.prefix || fmt.suffix);
      if (!hasAffix) {
        return { field: sourceField, type: "quantitative", format: fmt.pattern };
      }
      const escPfx = (fmt.prefix ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const escSfx = (fmt.suffix ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const formatExpr = fmt.pattern ? `format(datum['${sourceField}'], '${fmt.pattern}')` : `datum['${sourceField}']`;
      transformsOut.push({
        calculate: `'${escPfx}' + ${formatExpr} + '${escSfx}'`,
        as: outFieldHint
      });
      return { field: outFieldHint, type: "nominal" };
    };
    const barXScale = { nice: false };
    if (isDiverging) barXScale.domainMid = 0;
    const datasetName = "__bt_displayTable";
    spec.datasets = { ...spec.datasets || {}, [datasetName]: displayTable };
    if (hasFacet) {
      spec.data = { name: datasetName };
    }
    const withData = (panel) => hasFacet ? panel : { data: { name: datasetName }, ...panel };
    const othersGray = "#bdbdbd";
    const othersTextTest = canTrim ? `datum.__bt_others_num === 1 || datum.__bt_others === true` : void 0;
    const barAggregate = useMeanForDisplay;
    const barTransform = barAggregate ? [{
      aggregate: [{ op: sortOp, field: xField, as: "__bt_val" }, { op: "min", field: "__bt_sort", as: "__bt_sort" }, { op: "max", field: "__bt_others_num", as: "__bt_others_num" }],
      groupby: uniqueGroupby([...facetFields, yField, ...colorField ? [colorField] : []])
    }] : void 0;
    const barXField = barAggregate ? "__bt_val" : xField;
    const barColorBase = !colorField && barAggregate ? isDiverging ? { field: "__bt_val", type: "quantitative", legend: null, scale: { scheme: "redyellowgreen", domainMid: 0 } } : { field: "__bt_val", type: "quantitative", legend: null, scale: { range: ["#cdebd3", "#41a25f"] } } : colorEnc;
    const barOthersTest = barAggregate ? othersTextTest : "datum.__bt_others";
    const barColorEnc = canTrim && barOthersTest ? { condition: { test: barOthersTest, value: othersGray }, ...barColorBase } : barColorBase;
    const barPanel = withData({
      width: barPanelWidth,
      height: panelHeight,
      // No `limit` here — the category header is allowed to
      // overflow the (narrow) y-label gutter into the bar area
      // so long field names stay legible.
      title: { text: categoryHeader, anchor: "start", offset: 6, ...headerStyle },
      ...barTransform ? { transform: barTransform } : {},
      mark: {
        type: "bar",
        height: { band: barBandRatio }
      },
      encoding: {
        y: yEncWithLabels,
        x: {
          field: barXField,
          type: "quantitative",
          axis: null,
          scale: barXScale
        },
        color: barColorEnc
      }
    });
    const panels = [barPanel];
    if (showPercent) {
      const pctColor = othersTextTest ? { condition: { test: othersTextTest, value: othersGray }, value: "#41a25f" } : { value: "#41a25f" };
      panels.push(withData({
        width: percentPanelWidth,
        height: panelHeight,
        transform: textPanelTransform,
        title: { text: percentHeaderWrap.text, anchor: "end", offset: 6, limit: Math.max(20, percentPanelWidth - headerPad), ...headerStyle },
        mark: {
          type: "text",
          align: "right",
          baseline: "middle",
          fontSize
        },
        encoding: {
          y: yEncNoLabels,
          x: { datum: 1, axis: null, scale: { type: "linear", domain: [0, 1] } },
          text: { field: "__bt_pct", type: "quantitative", format: pctPattern },
          color: pctColor
        }
      }));
    }
    {
      const valueTransforms = [...textPanelTransform];
      const textEnc = buildTextEncoding("__bt_val", valueFmt, valueTransforms, "__bt_val_str");
      const valColor = othersTextTest ? { condition: { test: othersTextTest, value: othersGray }, value: "#666" } : { value: "#666" };
      panels.push(withData({
        width: valuePanelWidth,
        height: panelHeight,
        transform: valueTransforms,
        title: { text: valueHeaderWrap.text, anchor: "end", offset: 6, limit: Math.max(20, valuePanelWidth - headerPad), ...headerStyle },
        mark: {
          type: "text",
          align: "right",
          baseline: "middle",
          fontSize
        },
        encoding: {
          y: yEncNoLabels,
          x: { datum: 1, axis: null, scale: { type: "linear", domain: [0, 1] } },
          text: textEnc,
          color: valColor
        }
      }));
    }
    spec.spacing = interPanelGap;
    spec.hconcat = panels;
    if (column || row) {
      spec.encoding = spec.encoding || {};
      if (column) spec.encoding.column = column;
      if (row) spec.encoding.row = row;
    }
  },
  properties: [
    { key: "maxRows", label: "Max Rows", type: "continuous", min: 5, max: 100, step: 1, defaultValue: 20 },
    // Off by default — safer for arbitrary measures. The agent (or
    // the user) can flip it on when a "% of total" share is
    // meaningful (additive, single-sign, non-zero total). Its `check`
    // reports applicability per render from the measure's data.
    {
      key: "showPercent",
      label: "Show % of Total",
      type: "binary",
      defaultValue: false,
      check: (ctx) => {
        const mcs = ctx.channelSemantics?.x;
        if (!mcs?.field || mcs.type !== "quantitative" || mcs.aggregationDefault === "average") {
          return { applicable: false };
        }
        let sum = 0, hasNeg = false, hasPos = false, count = 0;
        for (const row of ctx.data ?? []) {
          const v = row[mcs.field];
          if (typeof v !== "number" || !isFinite(v)) continue;
          count++;
          if (v < 0) hasNeg = true;
          else if (v > 0) hasPos = true;
          sum += v;
        }
        return { applicable: count > 0 && !(hasNeg && hasPos) && Math.abs(sum) > 0 };
      }
    }
  ]
};

// src/vegalite/templates/radar.ts
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const mantissa = v / pow;
  const nice = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 2.5 ? 2.5 : mantissa <= 5 ? 5 : 10;
  return nice * pow;
}
function buildRadarLayers(rows, axisField, valueField, groupField, opts) {
  const axes = [];
  const axisSet = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const a = String(row[axisField]);
    if (!axisSet.has(a)) {
      axisSet.add(a);
      axes.push(a);
    }
  }
  if (axes.length < 2) return [];
  const groups = [];
  if (groupField) {
    const groupSet = /* @__PURE__ */ new Set();
    for (const row of rows) {
      const g = String(row[groupField]);
      if (!groupSet.has(g)) {
        groupSet.add(g);
        groups.push(g);
      }
    }
  } else {
    groups.push("_all");
  }
  const axisMax = {};
  for (const axis of axes) {
    const vals = rows.filter((r) => String(r[axisField]) === axis).map((r) => Number(r[valueField])).filter((v) => isFinite(v));
    const mx = vals.length > 0 ? Math.max(...vals) : 1;
    axisMax[axis] = niceMax(mx);
  }
  const keyMap = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const grp = groupField ? String(row[groupField]) : "_all";
    const axis = String(row[axisField]);
    const raw = Number(row[valueField]) || 0;
    const mx = axisMax[axis];
    const norm2 = mx > 0 ? raw / mx : 0;
    const k = `${grp}|||${axis}`;
    if (!keyMap.has(k)) keyMap.set(k, { sum: 0, rawSum: 0, count: 0 });
    const entry = keyMap.get(k);
    entry.sum += norm2;
    entry.rawSum += raw;
    entry.count += 1;
  }
  const angleStep = 360 / axes.length;
  const finalData = [];
  for (const [k, v] of keyMap.entries()) {
    const [grp, axis] = k.split("|||");
    const axisIndex = axes.indexOf(axis);
    const angle = axisIndex * angleStep;
    const normVal = v.sum / v.count;
    const rawVal = Math.round(v.rawSum / v.count * 100) / 100;
    const rad = angle * Math.PI / 180;
    finalData.push({
      __group: grp,
      __axis: axis,
      __value: normVal,
      __raw: rawVal,
      __angle: angle,
      __x: normVal * Math.sin(rad),
      __y: -normVal * Math.cos(rad)
    });
  }
  const gridData = [];
  for (let idx = 0; idx < axes.length; idx++) {
    const ang = idx * angleStep * Math.PI / 180;
    gridData.push({
      __type: "spoke",
      __x: 0,
      __y: 0,
      __x2: Math.sin(ang),
      __y2: -Math.cos(ang)
    });
  }
  for (const level of [0.25, 0.5, 0.75, 1]) {
    const points = [];
    for (let i = 0; i <= axes.length; i++) {
      const ang = i % axes.length * angleStep * Math.PI / 180;
      points.push({ __x: level * Math.sin(ang), __y: -level * Math.cos(ang) });
    }
    for (let i = 0; i < points.length - 1; i++) {
      gridData.push({
        __type: "ring",
        __level: level,
        __x: points[i].__x,
        __y: points[i].__y,
        __x2: points[i + 1].__x,
        __y2: points[i + 1].__y
      });
    }
  }
  const labelData = axes.map((axis, i) => {
    const angDeg = i * angleStep;
    const ang = angDeg * Math.PI / 180;
    const r = 1.15;
    const mx = axisMax[axis];
    const maxStr = mx % 1 === 0 ? String(mx) : mx.toFixed(1);
    const sinA = Math.sin(ang);
    const cosA = -Math.cos(ang);
    let align;
    let baseline;
    let dx = 0;
    let dy = 0;
    if (Math.abs(sinA) < 0.15) {
      align = "center";
      baseline = cosA < 0 ? "bottom" : "top";
      dy = cosA < 0 ? -4 : 4;
    } else if (sinA > 0) {
      align = "left";
      baseline = Math.abs(cosA) < 0.3 ? "middle" : cosA < 0 ? "bottom" : "top";
      dx = 4;
    } else {
      align = "right";
      baseline = Math.abs(cosA) < 0.3 ? "middle" : cosA < 0 ? "bottom" : "top";
      dx = -4;
    }
    return {
      __label: [axis, `(${maxStr})`],
      __x: r * Math.sin(ang),
      __y: -r * Math.cos(ang),
      __align: align,
      __baseline: baseline,
      __dx: dx,
      __dy: dy
    };
  });
  const { filled, fillOpacity, strokeWidth, domainPad } = opts;
  const layers = [];
  layers.push({
    data: { values: gridData.filter((d) => d.__type === "spoke") },
    mark: { type: "rule", stroke: "#ddd", strokeWidth: 0.8 },
    encoding: {
      x: { field: "__x", type: "quantitative", scale: { domain: [-domainPad, domainPad] }, axis: null },
      y: { field: "__y", type: "quantitative", scale: { domain: [-domainPad, domainPad] }, axis: null },
      x2: { field: "__x2" },
      y2: { field: "__y2" }
    }
  });
  layers.push({
    data: { values: gridData.filter((d) => d.__type === "ring") },
    mark: { type: "rule", stroke: "#e0e0e0", strokeWidth: 0.6 },
    encoding: {
      x: { field: "__x", type: "quantitative", axis: null },
      y: { field: "__y", type: "quantitative", axis: null },
      x2: { field: "__x2" },
      y2: { field: "__y2" }
    }
  });
  for (const lbl of labelData) {
    const lines = lbl.__label;
    layers.push({
      data: { values: [lbl] },
      mark: {
        type: "text",
        fontSize: 10,
        fill: "#555",
        align: lbl.__align,
        baseline: lbl.__baseline,
        dx: lbl.__dx,
        dy: lbl.__dy,
        limit: 120,
        lineHeight: 13
      },
      encoding: {
        x: { field: "__x", type: "quantitative", axis: null },
        y: { field: "__y", type: "quantitative", axis: null },
        text: { value: lines }
      }
    });
  }
  const lineLayer = {
    data: { values: finalData },
    mark: {
      type: "line",
      interpolate: "linear-closed",
      strokeWidth,
      point: false,
      ...filled ? { fillOpacity } : {}
    },
    encoding: {
      x: { field: "__x", type: "quantitative", axis: null },
      y: { field: "__y", type: "quantitative", axis: null },
      order: { field: "__angle", type: "quantitative" },
      tooltip: [
        { field: "__axis", type: "nominal", title: axisField },
        { field: "__raw", type: "quantitative", title: valueField }
      ]
    }
  };
  if (groups.length > 1 && groupField) {
    lineLayer.encoding.stroke = { field: "__group", type: "nominal", title: groupField };
    if (filled) {
      lineLayer.encoding.fill = { field: "__group", type: "nominal", title: groupField, legend: null };
    }
  } else if (filled) {
    lineLayer.mark.fill = "#4c78a8";
  }
  layers.push(lineLayer);
  const pointLayer = {
    data: { values: finalData },
    mark: { type: "point", filled: true, size: 25 },
    encoding: {
      x: { field: "__x", type: "quantitative", axis: null },
      y: { field: "__y", type: "quantitative", axis: null },
      tooltip: [
        ...groupField ? [{ field: "__group", type: "nominal", title: groupField }] : [],
        { field: "__axis", type: "nominal", title: axisField },
        { field: "__raw", type: "quantitative", title: valueField }
      ]
    }
  };
  if (groups.length > 1 && groupField) {
    pointLayer.encoding.color = { field: "__group", type: "nominal", title: groupField, legend: null };
  }
  layers.push(pointLayer);
  return layers;
}
var radarChartDef = {
  chart: "Radar Chart",
  template: {
    description: "Radar / Spider chart",
    mark: "point",
    encoding: {}
  },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const axisField = ctx.resolvedEncodings.x?.field;
    const valueField = ctx.resolvedEncodings.y?.field;
    const groupField = ctx.resolvedEncodings.color?.field;
    const columnField = ctx.resolvedEncodings.column?.field;
    const rowField = ctx.resolvedEncodings.row?.field;
    const table = ctx.table;
    const canvasSize = ctx.canvasSize;
    const config = ctx.chartProperties;
    const filled = config?.filled ?? true;
    const fillOpacity = config?.fillOpacity ?? 0.15;
    const strokeWidth = config?.strokeWidth ?? 1.5;
    if (!table || table.length === 0 || !axisField || !valueField) {
      spec.mark = "point";
      return;
    }
    const size = Math.min(canvasSize?.width || 400, canvasSize?.height || 400);
    const layerOpts = { filled, fillOpacity, strokeWidth, domainPad: 1.18 };
    if (!columnField && !rowField) {
      const layers = buildRadarLayers(table, axisField, valueField, groupField, layerOpts);
      if (layers.length === 0) {
        spec.mark = "point";
        return;
      }
      const finalSpec2 = {
        width: size,
        height: size,
        layer: layers,
        config: { view: { stroke: null } }
      };
      for (const key of Object.keys(spec)) delete spec[key];
      Object.assign(spec, finalSpec2);
      return;
    }
    const colGroups = columnField ? [...new Set(table.map((r) => String(r[columnField])))] : ["_all"];
    const rowGroups = rowField ? [...new Set(table.map((r) => String(r[rowField])))] : ["_all"];
    const minSubplot = 200;
    const subplotSize = Math.max(minSubplot, size);
    const buildSubplot = (rows, title) => {
      const layers = buildRadarLayers(rows, axisField, valueField, groupField, layerOpts);
      if (layers.length === 0) return null;
      return {
        width: subplotSize,
        height: subplotSize,
        layer: layers,
        title: title || void 0
      };
    };
    let finalSpec;
    const concatSpacing = 5;
    if (rowField && columnField) {
      const vconcat = [];
      for (const rg of rowGroups) {
        const hconcat = [];
        for (const cg of colGroups) {
          const subset = table.filter((r) => String(r[rowField]) === rg && String(r[columnField]) === cg);
          const s = buildSubplot(subset, `${cg}`);
          if (s) hconcat.push(s);
        }
        if (hconcat.length > 0) {
          vconcat.push({ hconcat, spacing: concatSpacing, title: rg });
        }
      }
      finalSpec = { vconcat, spacing: concatSpacing, config: { view: { stroke: null } } };
    } else if (columnField) {
      const hconcat = [];
      for (const cg of colGroups) {
        const subset = table.filter((r) => String(r[columnField]) === cg);
        const s = buildSubplot(subset, cg);
        if (s) hconcat.push(s);
      }
      finalSpec = { hconcat, spacing: concatSpacing, config: { view: { stroke: null } } };
    } else {
      const vconcat = [];
      for (const rg of rowGroups) {
        const subset = table.filter((r) => String(r[rowField]) === rg);
        const s = buildSubplot(subset, rg);
        if (s) vconcat.push(s);
      }
      finalSpec = { vconcat, spacing: concatSpacing, config: { view: { stroke: null } } };
    }
    for (const key of Object.keys(spec)) delete spec[key];
    Object.assign(spec, finalSpec);
  },
  properties: [
    { key: "filled", label: "Filled", type: "binary", defaultValue: true },
    { key: "fillOpacity", label: "Fill Opacity", type: "continuous", min: 0, max: 0.5, step: 0.1, defaultValue: 0.15 },
    { key: "strokeWidth", label: "Line Width", type: "continuous", min: 0.5, max: 4, step: 0.5, defaultValue: 1.5 }
  ]
};

// src/vegalite/templates/rose.ts
var roseChartDef = {
  chart: "Rose Chart",
  template: {
    mark: {
      type: "arc",
      stroke: "white",
      padAngle: 0.02
    },
    encoding: {}
  },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "area",
  // Polar charts have no positional axes — declare no banded axes
  // so the layout pipeline won't produce step-based sizing.
  declareLayoutMode: () => ({}),
  instantiate: (spec, ctx) => {
    if (!spec.encoding) spec.encoding = {};
    const { x, y, color, column, row, ...rest } = ctx.resolvedEncodings;
    const isFaceted = !!(column || row);
    const sortSlices = ctx.chartProperties?.sortSlices;
    let sliceOrder;
    if ((sortSlices === "descending" || sortSlices === "ascending") && x?.field && y?.field) {
      const totals = /* @__PURE__ */ new Map();
      for (const rr of ctx.table) {
        const c = String(rr[x.field] ?? "");
        totals.set(c, (totals.get(c) ?? 0) + (Number(rr[y.field]) || 0));
      }
      sliceOrder = [...totals.keys()].sort(
        (a, b) => sortSlices === "descending" ? (totals.get(b) ?? 0) - (totals.get(a) ?? 0) : (totals.get(a) ?? 0) - (totals.get(b) ?? 0)
      );
    }
    if (x) {
      const thetaEnc = { ...x };
      if (thetaEnc.type === "quantitative" || thetaEnc.type === "temporal") {
        thetaEnc.type = "nominal";
      }
      if (typeof thetaEnc.sort === "string" && /^-?[xy]$/.test(thetaEnc.sort)) {
        delete thetaEnc.sort;
      }
      delete thetaEnc.scale;
      thetaEnc.stack = true;
      const n = new Set(ctx.table.map((r) => r[x.field])).size;
      if (n > 0) {
        const alignment = ctx.chartProperties?.alignment ?? "left";
        if (alignment === "center") {
          const halfSlice = Math.PI / n;
          thetaEnc.scale = { range: [-halfSlice, 2 * Math.PI - halfSlice] };
        }
      }
      if (sliceOrder) {
        thetaEnc.sort = sliceOrder;
      }
      spec.encoding.theta = thetaEnc;
    }
    let radiusEnc;
    let radiusField;
    if (y) {
      radiusEnc = { ...y };
      if (typeof radiusEnc.sort === "string" && /^-?[xy]$/.test(radiusEnc.sort)) {
        delete radiusEnc.sort;
      }
      radiusEnc.scale = { type: "sqrt" };
      if (color) {
        radiusEnc.stack = true;
      }
      radiusField = radiusEnc.field;
    }
    let colorEnc;
    if (color) {
      colorEnc = color;
    } else if (x) {
      colorEnc = { field: x.field, type: x.type || "nominal" };
      if (sliceOrder) {
        colorEnc.sort = sliceOrder;
      } else if (Array.isArray(x.sort)) {
        colorEnc.sort = x.sort;
      }
    }
    if (isFaceted) {
      if (radiusEnc) spec.encoding.radius = radiusEnc;
      if (colorEnc) spec.encoding.color = colorEnc;
      if (column && !row) {
        const facetEnc = { ...column };
        const facetCount = new Set(ctx.table.map((r) => r[column.field])).size;
        facetEnc.columns = facetCount <= 6 ? facetCount : Math.ceil(Math.sqrt(facetCount));
        spec.encoding.facet = facetEnc;
      } else if (row && !column) {
        spec.encoding.row = row;
      } else {
        spec.encoding.column = column;
        spec.encoding.row = row;
      }
    } else {
      const arcMark = spec.mark;
      spec.layer = [
        { mark: arcMark, encoding: {} },
        {
          mark: { type: "text", radiusOffset: 15, fontSize: 11 },
          encoding: {}
        }
      ];
      delete spec.mark;
      if (radiusEnc) {
        spec.layer[0].encoding.radius = radiusEnc;
      }
      if (colorEnc) {
        spec.layer[0].encoding.color = colorEnc;
      }
      if (x && spec.layer[1]) {
        const textLayer = spec.layer[1];
        textLayer.encoding.text = { field: x.field, type: x.type || "nominal" };
        if (radiusField) {
          textLayer.transform = [
            {
              aggregate: [{ op: "sum", field: radiusField, as: radiusField }],
              groupby: [x.field]
            }
          ];
          textLayer.encoding.radius = {
            field: radiusField,
            type: "quantitative",
            scale: { type: "sqrt" }
          };
        }
      }
    }
    const hasRadius = spec.encoding.radius || spec.layer?.[0]?.encoding?.radius;
    if (!hasRadius) {
      const fallback = { aggregate: "count", type: "quantitative", scale: { type: "sqrt" } };
      if (spec.layer) {
        spec.layer[0].encoding.radius = fallback;
      } else {
        spec.encoding.radius = fallback;
      }
    }
    if (!spec.encoding.theta) {
      spec.encoding.theta = { aggregate: "count", type: "quantitative" };
    }
    const mappedChannels = /* @__PURE__ */ new Set(["x", "y", "color", "column", "row", "radius", "size", "theta", "facet"]);
    for (const [ch, enc] of Object.entries(rest)) {
      if (mappedChannels.has(ch)) continue;
      if (!enc.field && !enc.aggregate) continue;
      spec.encoding[ch] = enc;
    }
    const subW = ctx.layout.subplotWidth ?? ctx.canvasSize.width;
    const subH = ctx.layout.subplotHeight ?? ctx.canvasSize.height;
    const size = Math.min(subW, subH);
    spec.width = size;
    spec.height = size;
    const config = ctx.chartProperties;
    if (config) {
      const markTarget = spec.layer ? spec.layer[0] : spec;
      if (config.padAngle > 0) {
        markTarget.mark = setMarkProp(markTarget.mark, "padAngle", config.padAngle);
      }
    }
  },
  properties: [
    { key: "padAngle", label: "Gap", type: "continuous", min: 0, max: 0.1, step: 5e-3, defaultValue: 0 },
    {
      key: "alignment",
      label: "Alignment",
      type: "discrete",
      options: [
        { value: "left", label: "Left (default)" },
        { value: "center", label: "Center" }
      ]
    },
    {
      key: "sortSlices",
      label: "Sort slices",
      type: "discrete",
      options: [
        { value: "none", label: "Data order" },
        { value: "descending", label: "Largest first" },
        { value: "ascending", label: "Smallest first" }
      ],
      defaultValue: "none"
    }
  ]
};

// src/vegalite/templates/geo-lookup.ts
function norm(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
var US_STATES = [
  [1, "Alabama", "AL"],
  [2, "Alaska", "AK"],
  [4, "Arizona", "AZ"],
  [5, "Arkansas", "AR"],
  [6, "California", "CA"],
  [8, "Colorado", "CO"],
  [9, "Connecticut", "CT"],
  [10, "Delaware", "DE"],
  [11, "District of Columbia", "DC"],
  [12, "Florida", "FL"],
  [13, "Georgia", "GA"],
  [15, "Hawaii", "HI"],
  [16, "Idaho", "ID"],
  [17, "Illinois", "IL"],
  [18, "Indiana", "IN"],
  [19, "Iowa", "IA"],
  [20, "Kansas", "KS"],
  [21, "Kentucky", "KY"],
  [22, "Louisiana", "LA"],
  [23, "Maine", "ME"],
  [24, "Maryland", "MD"],
  [25, "Massachusetts", "MA"],
  [26, "Michigan", "MI"],
  [27, "Minnesota", "MN"],
  [28, "Mississippi", "MS"],
  [29, "Missouri", "MO"],
  [30, "Montana", "MT"],
  [31, "Nebraska", "NE"],
  [32, "Nevada", "NV"],
  [33, "New Hampshire", "NH"],
  [34, "New Jersey", "NJ"],
  [35, "New Mexico", "NM"],
  [36, "New York", "NY"],
  [37, "North Carolina", "NC"],
  [38, "North Dakota", "ND"],
  [39, "Ohio", "OH"],
  [40, "Oklahoma", "OK"],
  [41, "Oregon", "OR"],
  [42, "Pennsylvania", "PA"],
  [44, "Rhode Island", "RI"],
  [45, "South Carolina", "SC"],
  [46, "South Dakota", "SD"],
  [47, "Tennessee", "TN"],
  [48, "Texas", "TX"],
  [49, "Utah", "UT"],
  [50, "Vermont", "VT"],
  [51, "Virginia", "VA"],
  [53, "Washington", "WA"],
  [54, "West Virginia", "WV"],
  [55, "Wisconsin", "WI"],
  [56, "Wyoming", "WY"]
];
var US_STATE_ALIASES = {
  // AP-style abbreviations
  ala: 1,
  ariz: 4,
  ark: 5,
  calif: 6,
  colo: 8,
  conn: 9,
  del: 10,
  fla: 12,
  ill: 17,
  ind: 18,
  kan: 20,
  kans: 20,
  mass: 25,
  mich: 26,
  minn: 27,
  miss: 28,
  mont: 30,
  neb: 31,
  nebr: 31,
  nev: 32,
  okla: 40,
  ore: 41,
  oreg: 41,
  penn: 42,
  penna: 42,
  tenn: 47,
  tex: 48,
  wash: 53,
  wis: 55,
  wisc: 55,
  wyo: 56,
  // Directional shorthand
  ncarolina: 37,
  scarolina: 45,
  ndakota: 38,
  sdakota: 46,
  wvirginia: 54,
  nhampshire: 33,
  njersey: 34,
  nmexico: 35,
  nyork: 36,
  // District of Columbia variants
  washingtondc: 11,
  dcusa: 11
};
var COUNTRIES = [
  [156, "China", "CN", "CHN"],
  [356, "India", "IN", "IND"],
  [840, "United States", "US", "USA"],
  [360, "Indonesia", "ID", "IDN"],
  [586, "Pakistan", "PK", "PAK"],
  [566, "Nigeria", "NG", "NGA"],
  [76, "Brazil", "BR", "BRA"],
  [50, "Bangladesh", "BD", "BGD"],
  [643, "Russia", "RU", "RUS"],
  [484, "Mexico", "MX", "MEX"],
  [231, "Ethiopia", "ET", "ETH"],
  [392, "Japan", "JP", "JPN"],
  [608, "Philippines", "PH", "PHL"],
  [818, "Egypt", "EG", "EGY"],
  [180, "DR Congo", "CD", "COD"],
  [704, "Vietnam", "VN", "VNM"],
  [364, "Iran", "IR", "IRN"],
  [792, "Turkey", "TR", "TUR"],
  [276, "Germany", "DE", "DEU"],
  [764, "Thailand", "TH", "THA"],
  [826, "United Kingdom", "GB", "GBR"],
  [250, "France", "FR", "FRA"],
  [710, "South Africa", "ZA", "ZAF"],
  [380, "Italy", "IT", "ITA"],
  [404, "Kenya", "KE", "KEN"],
  [170, "Colombia", "CO", "COL"],
  [724, "Spain", "ES", "ESP"],
  [32, "Argentina", "AR", "ARG"],
  [12, "Algeria", "DZ", "DZA"],
  [124, "Canada", "CA", "CAN"],
  [616, "Poland", "PL", "POL"],
  [804, "Ukraine", "UA", "UKR"],
  [682, "Saudi Arabia", "SA", "SAU"],
  [504, "Morocco", "MA", "MAR"],
  [604, "Peru", "PE", "PER"],
  [36, "Australia", "AU", "AUS"],
  [398, "Kazakhstan", "KZ", "KAZ"],
  [152, "Chile", "CL", "CHL"],
  [752, "Sweden", "SE", "SWE"],
  [578, "Norway", "NO", "NOR"],
  [528, "Netherlands", "NL", "NLD"],
  [56, "Belgium", "BE", "BEL"],
  [756, "Switzerland", "CH", "CHE"],
  [40, "Austria", "AT", "AUT"],
  [620, "Portugal", "PT", "PRT"],
  [300, "Greece", "GR", "GRC"],
  [372, "Ireland", "IE", "IRL"],
  [246, "Finland", "FI", "FIN"],
  [208, "Denmark", "DK", "DNK"],
  [554, "New Zealand", "NZ", "NZL"],
  [410, "South Korea", "KR", "KOR"],
  [458, "Malaysia", "MY", "MYS"],
  [862, "Venezuela", "VE", "VEN"],
  [218, "Ecuador", "EC", "ECU"],
  [4, "Afghanistan", "AF", "AFG"],
  [368, "Iraq", "IQ", "IRQ"],
  [887, "Yemen", "YE", "YEM"],
  [144, "Sri Lanka", "LK", "LKA"],
  [104, "Myanmar", "MM", "MMR"],
  [116, "Cambodia", "KH", "KHM"],
  [24, "Angola", "AO", "AGO"],
  [834, "Tanzania", "TZ", "TZA"],
  [800, "Uganda", "UG", "UGA"],
  [716, "Zimbabwe", "ZW", "ZWE"],
  [288, "Ghana", "GH", "GHA"],
  [384, "Ivory Coast", "CI", "CIV"],
  [686, "Senegal", "SN", "SEN"],
  // Additional countries — numeric ids verified present in world-110m.json.
  [268, "Georgia", "GE", "GEO"],
  [524, "Nepal", "NP", "NPL"],
  [192, "Cuba", "CU", "CUB"],
  [634, "Qatar", "QA", "QAT"],
  [400, "Jordan", "JO", "JOR"],
  [422, "Lebanon", "LB", "LBN"],
  [376, "Israel", "IL", "ISR"],
  [414, "Kuwait", "KW", "KWT"],
  [512, "Oman", "OM", "OMN"],
  [784, "United Arab Emirates", "AE", "ARE"],
  [788, "Tunisia", "TN", "TUN"],
  [434, "Libya", "LY", "LBY"],
  [729, "Sudan", "SD", "SDN"],
  [120, "Cameroon", "CM", "CMR"],
  [508, "Mozambique", "MZ", "MOZ"],
  [450, "Madagascar", "MG", "MDG"],
  [894, "Zambia", "ZM", "ZMB"],
  [466, "Mali", "ML", "MLI"],
  [854, "Burkina Faso", "BF", "BFA"],
  [562, "Niger", "NE", "NER"],
  [148, "Chad", "TD", "TCD"],
  [706, "Somalia", "SO", "SOM"],
  [68, "Bolivia", "BO", "BOL"],
  [600, "Paraguay", "PY", "PRY"],
  [858, "Uruguay", "UY", "URY"],
  [320, "Guatemala", "GT", "GTM"],
  [340, "Honduras", "HN", "HND"],
  [214, "Dominican Republic", "DO", "DOM"],
  [591, "Panama", "PA", "PAN"],
  [188, "Costa Rica", "CR", "CRI"],
  [191, "Croatia", "HR", "HRV"],
  [688, "Serbia", "RS", "SRB"],
  [703, "Slovakia", "SK", "SVK"],
  [705, "Slovenia", "SI", "SVN"],
  [100, "Bulgaria", "BG", "BGR"],
  [642, "Romania", "RO", "ROU"],
  [348, "Hungary", "HU", "HUN"],
  [112, "Belarus", "BY", "BLR"],
  [440, "Lithuania", "LT", "LTU"],
  [428, "Latvia", "LV", "LVA"],
  [233, "Estonia", "EE", "EST"],
  [352, "Iceland", "IS", "ISL"],
  [418, "Laos", "LA", "LAO"],
  [496, "Mongolia", "MN", "MNG"],
  [408, "North Korea", "KP", "PRK"],
  [158, "Taiwan", "TW", "TWN"],
  [64, "Bhutan", "BT", "BTN"],
  [760, "Syria", "SY", "SYR"],
  [203, "Czechia", "CZ", "CZE"],
  [795, "Turkmenistan", "TM", "TKM"],
  [860, "Uzbekistan", "UZ", "UZB"],
  [31, "Azerbaijan", "AZ", "AZE"],
  [51, "Armenia", "AM", "ARM"],
  [558, "Nicaragua", "NI", "NIC"]
];
var COUNTRY_ALIASES = {
  usa: 840,
  us: 840,
  unitedstatesofamerica: 840,
  america: 840,
  uk: 826,
  greatbritain: 826,
  britain: 826,
  england: 826,
  russianfederation: 643,
  southkorea: 410,
  korea: 410,
  republicofkorea: 410,
  skorea: 410,
  korearep: 410,
  koreasouth: 410,
  koreasouthrepublicof: 410,
  nkorea: 408,
  koreanorth: 408,
  koreademrep: 408,
  dprk: 408,
  democraticpeoplesrepublicofkorea: 408,
  democraticrepublicofthecongo: 180,
  congokinshasa: 180,
  drc: 180,
  vietnam: 704,
  vietnamsocialistrepublic: 704,
  ivorycoast: 384,
  cotedivoire: 384,
  iranislamicrepublicof: 364,
  syrianarabrepublic: 760,
  tanzaniaunitedrepublicof: 834,
  burma: 104,
  czechrepublic: 203,
  czechia: 203,
  uae: 784,
  unitedarabemirates: 784,
  holland: 528,
  thenetherlands: 528,
  turkiye: 792,
  laopdr: 418,
  laopeoplesdemocraticrepublic: 418
};
function buildMap(entries) {
  const m = /* @__PURE__ */ new Map();
  for (const [id, keys] of entries) {
    for (const k of keys) {
      const nk = norm(k);
      if (nk && !m.has(nk)) m.set(nk, id);
    }
  }
  return m;
}
var US_STATE_LOOKUP = (() => {
  const m = buildMap(US_STATES.map(([id, name, usps]) => [id, [name, usps]]));
  for (const [alias, id] of Object.entries(US_STATE_ALIASES)) {
    if (!m.has(alias)) m.set(alias, id);
  }
  return m;
})();
var COUNTRY_LOOKUP = (() => {
  const m = buildMap(COUNTRIES.map(([id, name, a2, a3]) => [id, [name, a2, a3]]));
  for (const [alias, id] of Object.entries(COUNTRY_ALIASES)) {
    if (!m.has(alias)) m.set(alias, id);
  }
  return m;
})();
function resolveWith(lookup, value) {
  if (value == null) return void 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const nk = norm(s);
  if (!nk) return void 0;
  const direct = lookup.get(nk);
  if (direct !== void 0) return direct;
  let r = nk;
  if (r.startsWith("stateof")) r = r.slice(7);
  if (r.endsWith("usa")) r = r.slice(0, -3);
  else if (r.endsWith("state")) r = r.slice(0, -5);
  if (r !== nk && r) return lookup.get(r);
  return void 0;
}
var resolveUsState = (value) => resolveWith(US_STATE_LOOKUP, value);
var resolveCountry = (value) => resolveWith(COUNTRY_LOOKUP, value);

// src/vegalite/templates/map.ts
var mapProjections = [
  { value: "mercator", label: "Mercator" },
  { value: "equalEarth", label: "Equal Earth" },
  { value: "orthographic", label: "Orthographic (Globe)" },
  { value: "stereographic", label: "Stereographic" },
  { value: "conicEqualArea", label: "Conic Equal Area" },
  { value: "conicEquidistant", label: "Conic Equidistant" },
  { value: "azimuthalEquidistant", label: "Azimuthal Equidistant" },
  { value: "mollweide", label: "Mollweide" }
];
var projectionCenterPresets = [
  { label: "World (Atlantic)", center: [0, 0] },
  { label: "World (Pacific)", center: [150, 0] },
  { label: "China", center: [105, 35] },
  { label: "USA", center: [-98, 39] },
  { label: "Europe", center: [10, 50] },
  { label: "Japan", center: [138, 36] },
  { label: "India", center: [78, 22] },
  { label: "Brazil", center: [-52, -14] },
  { label: "Australia", center: [134, -25] },
  { label: "Russia", center: [100, 60] },
  { label: "Africa", center: [20, 0] },
  { label: "Middle East", center: [45, 28] },
  { label: "Southeast Asia", center: [115, 5] },
  { label: "South America", center: [-60, -15] },
  { label: "North America", center: [-100, 45] },
  { label: "UK", center: [-2, 54] },
  { label: "Germany", center: [10, 51] },
  { label: "France", center: [2, 47] },
  { label: "Korea", center: [128, 36] }
];
var SCOPE_GEO = {
  us: {
    url: "https://vega.github.io/vega-lite/data/us-10m.json",
    feature: "states",
    projection: "albersUsa",
    width: 500,
    height: 300,
    strokeWidth: 0.5
  },
  world: {
    url: "https://vega.github.io/vega-lite/data/world-110m.json",
    feature: "countries",
    projection: "equalEarth",
    width: 600,
    height: 350,
    strokeWidth: 0.4
  }
};
var US_LON = [-170, -66];
var US_LAT = [18, 72];
function inUsBox(lon, lat) {
  return lon >= US_LON[0] && lon <= US_LON[1] && lat >= US_LAT[0] && lat <= US_LAT[1];
}
function inferBubbleScope(rows, lonField, latField) {
  if (!lonField || !latField) return "us";
  for (const r of rows) {
    const lon = Number(r[lonField]);
    const lat = Number(r[latField]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (!inUsBox(lon, lat)) return "world";
  }
  return "us";
}
function inferChoroplethScope(rows, idField) {
  if (!idField) return "us";
  for (const r of rows) {
    const v = r[idField];
    if (v == null || v === "") continue;
    if (resolveUsState(v) === void 0) return "world";
  }
  return "us";
}
var SEMANTIC_SCOPE = { State: "us", Country: "world" };
function semanticScope(semType) {
  if (!semType) return void 0;
  return Object.prototype.hasOwnProperty.call(SEMANTIC_SCOPE, semType) ? SEMANTIC_SCOPE[semType] : void 0;
}
function pickScope(chartProperties, semScope, infer) {
  const choice = chartProperties?.region;
  if (choice === "us" || choice === "world") return choice;
  if (semScope) return semScope;
  return infer();
}
function wouldBeWorld(ctx) {
  const choice = ctx.chartProperties?.region;
  if (choice === "us") return false;
  if (choice === "world") return true;
  const rows = ctx.data ?? [];
  const lonField = ctx.encodings?.longitude?.field;
  const latField = ctx.encodings?.latitude?.field;
  return inferBubbleScope(rows, lonField, latField) === "world";
}
var regionProperty = {
  key: "region",
  label: "Region",
  type: "discrete",
  options: [
    { value: "auto", label: "Auto-detect" },
    { value: "us", label: "United States" },
    { value: "world", label: "World" }
  ],
  defaultValue: "auto"
};
function applyPointEncodings(layer, resolved) {
  if (!layer.encoding) layer.encoding = {};
  for (const [ch, enc] of Object.entries(resolved)) {
    layer.encoding[ch] = { ...layer.encoding[ch] || {}, ...enc };
  }
  for (const ch of Object.keys(layer.encoding)) {
    const enc = layer.encoding[ch];
    if (enc && typeof enc === "object" && Object.keys(enc).length === 0) {
      delete layer.encoding[ch];
    }
  }
}
function configureBubble(spec, scope) {
  const g = SCOPE_GEO[scope];
  spec.width = g.width;
  spec.height = g.height;
  spec.layer[0].data = { url: g.url, format: { type: "topojson", feature: g.feature } };
  spec.layer[0].projection = { type: g.projection };
  spec.layer[1].projection = { type: g.projection };
}
function configureChoropleth(spec, scope) {
  const g = SCOPE_GEO[scope];
  spec.width = g.width;
  spec.height = g.height;
  spec.data = { url: g.url, format: { type: "topojson", feature: g.feature } };
  spec.projection = { type: g.projection };
  if (spec.mark && typeof spec.mark === "object") spec.mark.strokeWidth = g.strokeWidth;
}
var mapDef = {
  chart: "Map",
  template: {
    layer: [
      {
        mark: { type: "geoshape", fill: "lightgray", stroke: "white" }
      },
      {
        mark: "circle",
        encoding: { longitude: {}, latitude: {}, size: {}, color: {}, opacity: {} }
      }
    ]
  },
  channels: ["longitude", "latitude", "color", "size", "opacity"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const rows = ctx.fullTable ?? ctx.table ?? [];
    const lonField = ctx.resolvedEncodings.longitude?.field;
    const latField = ctx.resolvedEncodings.latitude?.field;
    const scope = pickScope(ctx.chartProperties, void 0, () => inferBubbleScope(rows, lonField, latField));
    configureBubble(spec, scope);
    applyPointEncodings(spec.layer[1], ctx.resolvedEncodings);
    if (scope === "world") {
      const config = ctx.chartProperties;
      if (config) {
        const projection = config.projection;
        const projectionCenter = config.projectionCenter;
        const applyProjection = (obj) => {
          if (obj?.projection) {
            if (projection && projection !== "default") {
              obj.projection.type = projection;
            }
            if (projectionCenter && obj.projection.type !== "albersUsa") {
              obj.projection.rotate = [-projectionCenter[0], -projectionCenter[1], 0];
            }
          }
        };
        for (const layer of spec.layer) applyProjection(layer);
      }
    }
  },
  properties: [
    regionProperty,
    {
      key: "projection",
      label: "Projection",
      type: "discrete",
      options: [
        { value: "default", label: "Default" },
        ...mapProjections.map((p) => ({ value: p.value, label: p.label }))
      ],
      defaultValue: "default",
      check: (ctx) => ({ applicable: wouldBeWorld(ctx) })
    },
    {
      key: "projectionCenter",
      label: "Center",
      type: "discrete",
      options: [
        { value: void 0, label: "Default" },
        ...projectionCenterPresets.map((p) => ({
          value: p.center,
          label: `${p.label} [${p.center[0]}, ${p.center[1]}]`
        }))
      ],
      defaultValue: void 0,
      check: (ctx) => ({ applicable: wouldBeWorld(ctx) })
    }
  ]
};
function buildChoroplethJoin(spec, ctx, resolver) {
  const idField = ctx.resolvedEncodings.id?.field;
  const colorEnc = ctx.resolvedEncodings.color;
  const valueField = colorEnc?.field;
  const labelField = ctx.resolvedEncodings.detail?.field ?? idField;
  const rows = ctx.fullTable ?? ctx.table ?? [];
  if (idField) {
    const joined = rows.map((r) => ({ ...r, __geo_id: resolver(r[idField]) }));
    const lookupFields = [valueField, labelField].filter(Boolean);
    spec.transform = [
      {
        lookup: "id",
        from: { data: { values: joined }, key: "__geo_id", fields: lookupFields }
      }
    ];
  }
  spec.encoding = {};
  if (colorEnc) {
    spec.encoding.color = { ...colorEnc };
  }
  const tooltip = [];
  if (labelField) tooltip.push({ field: labelField, type: "nominal" });
  if (valueField) tooltip.push({ field: valueField, type: colorEnc?.type ?? "quantitative" });
  if (tooltip.length) spec.encoding.tooltip = tooltip;
}
var choroplethDef = {
  chart: "Choropleth",
  template: {
    mark: { type: "geoshape", stroke: "white", strokeWidth: 0.5 },
    encoding: {}
  },
  channels: ["id", "color", "detail"],
  markCognitiveChannel: "color",
  instantiate: (spec, ctx) => {
    const rows = ctx.fullTable ?? ctx.table ?? [];
    const idField = ctx.resolvedEncodings.id?.field;
    const semType = idField ? toTypeString(ctx.semanticTypes?.[idField]) : "";
    const semScope = semanticScope(semType);
    const scope = pickScope(
      ctx.chartProperties,
      semScope,
      () => inferChoroplethScope(rows, idField)
    );
    configureChoropleth(spec, scope);
    const resolver = scope === "us" ? resolveUsState : resolveCountry;
    buildChoroplethJoin(spec, ctx, resolver);
  },
  properties: [regionProperty]
};

// src/vegalite/templates/kpi-card.ts
var PROGRESS_TRACK = "#e6e9ef";
var PROGRESS_ON_TRACK = "#5b8def";
var PROGRESS_EXCEEDED = "#22a06b";
var PROGRESS_BEHIND = "#e07a3c";
var CARD_FILL = "#ffffff";
var CARD_STROKE = "#e6e9ef";
var CARD_RADIUS = 8;
var kpiCardDef = {
  chart: "KPI Card",
  template: { layer: [] },
  channels: ["metric", "value", "goal"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { metric, value, goal } = ctx.resolvedEncodings;
    const config = ctx.chartProperties || {};
    const metricField = metric?.field;
    const valueField = value?.field;
    const goalField = goal?.field;
    const rawBehind = Number(config.behindThreshold);
    const behindThreshold = Number.isFinite(rawBehind) ? Math.min(1, Math.max(0, rawBehind)) : 0.5;
    const sourceTable = ctx.fullTable ?? ctx.table ?? [];
    const tiles = [];
    if (valueField) {
      for (const row of sourceTable) {
        if (!row) continue;
        const rawValue = row[valueField];
        if (rawValue == null) continue;
        const caption = metricField ? row[metricField] != null ? String(row[metricField]) : "" : valueField;
        const rawGoal = goalField ? row[goalField] : void 0;
        const valueText = renderScalar(rawValue);
        const goalText = rawGoal != null ? renderScalar(rawGoal) : void 0;
        let progress;
        if (typeof rawValue === "number" && Number.isFinite(rawValue) && typeof rawGoal === "number" && Number.isFinite(rawGoal) && rawGoal !== 0) {
          progress = {
            fraction: rawValue / rawGoal,
            valueNum: rawValue,
            goalNum: rawGoal
          };
        }
        tiles.push({ caption, valueText, goalText, progress });
      }
    }
    if (tiles.length === 0) {
      tiles.push({ caption: "Value", valueText: "\u2014" });
    }
    const baseW = ctx.canvasSize.width;
    const n = tiles.length;
    const requestedLayout = config.layout || "auto";
    const layout = requestedLayout === "horizontal" || requestedLayout === "vertical" || requestedLayout === "grid" ? requestedLayout : "grid";
    let cols;
    let rows;
    if (layout === "horizontal") {
      cols = n;
      rows = 1;
    } else if (layout === "vertical") {
      cols = 1;
      rows = n;
    } else {
      cols = Math.ceil(Math.sqrt(n));
      rows = Math.ceil(n / cols);
    }
    const spacing = 4;
    const MAX_STRETCH = 1.6;
    const TARGET_ASPECT = 1.4;
    const TARGET_TILE_W = 220;
    const MIN_TILE_W = 130;
    const MIN_TILE_H = Math.round(MIN_TILE_W / TARGET_ASPECT);
    const wishW = cols * TARGET_TILE_W + (cols - 1) * spacing;
    const budgetW = baseW * MAX_STRETCH;
    const minRequiredW = cols * MIN_TILE_W + (cols - 1) * spacing;
    const W = Math.max(
      minRequiredW,
      Math.min(budgetW, Math.max(baseW, wishW))
    );
    const tileW = Math.max(MIN_TILE_W, Math.floor((W - spacing * (cols - 1)) / cols));
    const tileH = Math.max(MIN_TILE_H, Math.round(tileW / TARGET_ASPECT));
    const cardLeftInset = Math.max(0.5, Math.floor(tileW * 0.04));
    const cardInnerPadX = Math.max(8, Math.floor(tileW * 0.06));
    const cardInnerW = Math.max(20, tileW - 2 * cardLeftInset - 2 * cardInnerPadX);
    const CHAR_W_BOLD = 0.66;
    const CHAR_W_REGULAR = 0.58;
    const maxValueChars = tiles.reduce((m, t) => Math.max(m, t.valueText.length), 1);
    const maxCaptionChars = tiles.reduce((m, t) => Math.max(m, t.caption.length), 1);
    const maxSubChars = tiles.reduce((m, t) => {
      if (t.progress) {
        const pct = Math.round(t.progress.fraction * 100);
        const text = `${pct}% of ${t.goalText ?? ""}`;
        return Math.max(m, text.length);
      }
      if (t.goalText != null) return Math.max(m, `Goal: ${t.goalText}`.length);
      return m;
    }, 1);
    const fontFitsWidth = (chars, charW) => Math.floor(cardInnerW / Math.max(1, chars * charW));
    const valueFontByWidth = fontFitsWidth(maxValueChars, CHAR_W_BOLD);
    const captionFontByWidth = fontFitsWidth(maxCaptionChars, CHAR_W_REGULAR);
    const subFontByWidth = fontFitsWidth(maxSubChars, CHAR_W_REGULAR);
    const hasSubLine = tiles.some((t) => t.progress || t.goalText != null);
    const hasProgress = tiles.some((t) => !!t.progress);
    const valueHCap = hasSubLine ? tileH / 2.6 : tileH / 2.1;
    const valueFont = Math.min(
      80,
      Math.max(10, Math.floor(Math.min(tileW / 5, valueHCap, valueFontByWidth)))
    );
    const captionFont = Math.max(11, Math.min(22, Math.floor(Math.min(valueFont / 3, captionFontByWidth))));
    const subFont = Math.max(10, Math.min(18, Math.floor(Math.min(captionFont, subFontByWidth))));
    const padTop = Math.max(4, Math.floor(captionFont * 0.55));
    const padBot = Math.max(4, Math.floor(subFont * 0.6));
    const gapCV = Math.max(6, Math.floor(captionFont * 0.55));
    const gapVS = Math.max(8, Math.floor(subFont * 1));
    const gapSB = Math.max(4, Math.floor(subFont * 0.55));
    const barHeight = Math.max(2, Math.floor(subFont * 0.4));
    const captionTop = padTop;
    const captionBot = captionTop + captionFont;
    const valueTop = captionBot + gapCV;
    const valueMid = valueTop + Math.floor(valueFont / 2);
    const valueBot = valueTop + valueFont;
    const subTop = valueBot + gapVS;
    const subBot = subTop + subFont;
    const barTop = subBot + gapSB;
    const barBot = barTop + barHeight;
    const contentBot = hasProgress ? barBot : hasSubLine ? subBot : valueBot;
    const slack = Math.max(0, tileH - (contentBot + padBot));
    const yOffset = Math.floor(slack / 2);
    const captionY = captionTop + yOffset;
    const valueY = valueMid + yOffset;
    const subY = subTop + yOffset;
    const barY = barTop + yOffset;
    const barPad = Math.max(4, Math.floor(tileW * 0.1));
    const barLeft = barPad;
    const barRight = tileW - barPad;
    const barWidth = Math.max(12, barRight - barLeft);
    const cardOuterPadY = Math.max(4, Math.floor(tileH * 0.06));
    const cardLeft = cardLeftInset;
    const cardRight = tileW - cardLeftInset;
    const cardTop = Math.max(0.5, cardOuterPadY);
    const cardBot = Math.min(tileH - 0.5, tileH - cardOuterPadY);
    const showCardFrame = config.style !== false;
    const buildTile = (t) => {
      const layers = [];
      if (showCardFrame) {
        layers.push({
          data: { values: [{}] },
          mark: {
            type: "rect",
            fill: CARD_FILL,
            stroke: CARD_STROKE,
            strokeWidth: 1,
            cornerRadius: CARD_RADIUS,
            tooltip: null
          },
          encoding: {
            x: { value: cardLeft },
            x2: { value: cardRight },
            y: { value: cardTop },
            y2: { value: cardBot }
          }
        });
      }
      layers.push({
        data: { values: [{}] },
        mark: {
          type: "text",
          fontSize: captionFont,
          fontWeight: 500,
          fill: "#4a4a4a",
          align: "center",
          baseline: "top",
          text: t.caption,
          tooltip: null
        },
        encoding: {
          x: { value: tileW / 2 },
          y: { value: captionY }
        }
      });
      layers.push({
        data: { values: [{}] },
        mark: {
          type: "text",
          fontSize: valueFont,
          fontWeight: "bold",
          fill: "#1a1a1a",
          align: "center",
          baseline: "middle",
          text: t.valueText,
          tooltip: null
        },
        encoding: {
          x: { value: tileW / 2 },
          y: { value: valueY }
        }
      });
      if (t.progress) {
        const pct = clamp(t.progress.fraction, 0, 1.5);
        const pctText = `${Math.round(t.progress.fraction * 100)}% of ${t.goalText}`;
        const isExceeded = t.progress.fraction >= 1;
        const isBehind = t.progress.fraction < behindThreshold;
        const fillColor = isExceeded ? PROGRESS_EXCEEDED : isBehind ? PROGRESS_BEHIND : PROGRESS_ON_TRACK;
        layers.push({
          data: { values: [{}] },
          mark: {
            type: "text",
            fontSize: subFont,
            fontWeight: isExceeded ? 600 : 400,
            fill: isExceeded ? PROGRESS_EXCEEDED : "#666",
            align: "center",
            baseline: "top",
            text: pctText,
            tooltip: null
          },
          encoding: {
            x: { value: tileW / 2 },
            y: { value: subY }
          }
        });
        layers.push({
          data: { values: [{}] },
          mark: {
            type: "rect",
            fill: PROGRESS_TRACK,
            cornerRadius: barHeight / 2,
            tooltip: null
          },
          encoding: {
            x: { value: barLeft },
            x2: { value: barRight },
            y: { value: barY },
            y2: { value: barY + barHeight }
          }
        });
        const fillEnd = barLeft + Math.min(1, pct) * barWidth;
        layers.push({
          data: { values: [{}] },
          mark: {
            type: "rect",
            fill: fillColor,
            cornerRadius: barHeight / 2,
            tooltip: null
          },
          encoding: {
            x: { value: barLeft },
            x2: { value: fillEnd },
            y: { value: barY },
            y2: { value: barY + barHeight }
          }
        });
      } else if (t.goalText != null) {
        layers.push({
          data: { values: [{}] },
          mark: {
            type: "text",
            fontSize: subFont,
            fill: "#666",
            align: "center",
            baseline: "top",
            text: `Goal: ${t.goalText}`,
            tooltip: null
          },
          encoding: {
            x: { value: tileW / 2 },
            y: { value: subY }
          }
        });
      }
      return {
        width: tileW,
        height: tileH,
        layer: layers,
        resolve: { scale: { x: "independent", y: "independent" } }
      };
    };
    const tileSpecs = tiles.map(buildTile);
    if (tileSpecs.length === 1) {
      const tile = tileSpecs[0];
      spec.width = tile.width;
      spec.height = tile.height;
      spec.layer = tile.layer;
      spec.resolve = tile.resolve;
      return;
    }
    delete spec.layer;
    delete spec.encoding;
    if (layout === "horizontal") {
      spec.hconcat = tileSpecs;
      spec.spacing = spacing;
    } else if (layout === "vertical") {
      spec.vconcat = tileSpecs;
      spec.spacing = spacing;
    } else {
      const grid = [];
      for (let r = 0; r < rows; r++) {
        const rowTiles = tileSpecs.slice(r * cols, (r + 1) * cols);
        if (rowTiles.length === 0) continue;
        grid.push({ hconcat: rowTiles, spacing });
      }
      spec.vconcat = grid;
      spec.spacing = spacing;
    }
  },
  properties: [
    {
      key: "layout",
      label: "Layout",
      type: "discrete",
      options: [
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" },
        { value: "grid", label: "Grid" }
      ],
      defaultValue: "grid"
    },
    {
      // When on (default), each tile renders inside a subtle
      // rounded card frame (white fill + 1px border). When off,
      // the tile is plain text — useful for single hero numbers
      // or when the surrounding panel already provides framing.
      key: "style",
      label: "Card style",
      type: "binary",
      defaultValue: true
    },
    {
      // Progress fraction below this threshold is considered
      // "behind" (amber). Between threshold and 1 is "on track"
      // (blue). >= 1 is "exceeded" (green). Only applies when a
      // goal channel is bound and both value and goal are numeric.
      key: "behindThreshold",
      label: "Behind threshold",
      type: "continuous",
      min: 0,
      max: 1,
      step: 0.05,
      defaultValue: 0.5,
      check: (ctx) => ({ applicable: !!ctx.encodings.goal?.field })
    }
  ]
};
function renderScalar(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Math.abs(v) < 1e-9) v = 0;
    return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(void 0, { maximumFractionDigits: 2 });
  }
  return String(v);
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// src/vegalite/templates/index.ts
var FACET_AXIS_PROPERTIES = [
  {
    key: "independentYAxis",
    label: "Independent Y",
    type: "binary",
    check: (ctx) => ({
      applicable: (!!ctx.encodings.column?.field || !!ctx.encodings.row?.field) && ctx.channelSemantics?.y?.type === "quantitative"
    })
  }
];
function makeLogScaleCheck(axis) {
  return (ctx) => {
    const cs = ctx.channelSemantics?.[axis];
    if (!cs?.field || cs.type !== "quantitative") return { applicable: false };
    let posMin = Infinity, posMax = -Infinity, posCount = 0, hasNegative = false;
    for (const row of ctx.data ?? []) {
      const v = row[cs.field];
      if (typeof v !== "number" || !isFinite(v)) continue;
      if (v < 0) hasNegative = true;
      else if (v > 0) {
        posCount++;
        if (v < posMin) posMin = v;
        if (v > posMax) posMax = v;
      }
    }
    const offerEligible = !hasNegative && posCount >= 5 && posMax / posMin >= 1e3;
    const choice = ctx.chartProperties?.[`logScale_${axis}`];
    const recommendsLog = cs.scaleType === "log" || cs.scaleType === "symlog";
    return {
      applicable: offerEligible || choice === true || choice === false,
      recommendedValue: recommendsLog
    };
  };
}
var LOG_SCALE_PROPERTIES = [
  {
    key: "logScale_x",
    label: "Log X",
    type: "binary",
    defaultValue: false,
    check: makeLogScaleCheck("x")
  },
  {
    key: "logScale_y",
    label: "Log Y",
    type: "binary",
    defaultValue: false,
    check: makeLogScaleCheck("y")
  }
];
function makeZeroBaselineCheck(axis) {
  return (ctx) => {
    const cs = ctx.channelSemantics?.[axis];
    if (!cs?.field || cs.type !== "quantitative") return { applicable: false };
    const decision = cs.zero;
    if (!decision) return { applicable: false };
    const choice = ctx.chartProperties?.[`includeZero_${axis}`];
    return {
      applicable: decision.uncertain || choice === true || choice === false,
      recommendedValue: decision.zero
    };
  };
}
var ZERO_BASELINE_PROPERTIES = [
  {
    key: "includeZero_x",
    label: "Zero X",
    type: "binary",
    check: makeZeroBaselineCheck("x")
  },
  {
    key: "includeZero_y",
    label: "Zero Y",
    type: "binary",
    check: makeZeroBaselineCheck("y")
  }
];
var AXIS_DTYPE_CHARTS = /* @__PURE__ */ new Set([
  "Bar Chart",
  "Line Chart",
  "Area Chart",
  "Lollipop Chart",
  "Heatmap"
]);
var AXIS_DTYPE_MAX_CATEGORIES = 50;
function makeAxisDtypeCheck(axis) {
  return (ctx) => {
    const cs = ctx.channelSemantics?.[axis];
    if (!cs?.field) return { applicable: false };
    const choice = ctx.chartProperties?.[`${axis}AxisType`];
    if (choice != null) return { applicable: true, recommendedValue: "temporal" };
    if (cs.type !== "temporal") return { applicable: false };
    const distinct = new Set(
      (ctx.data ?? []).map((r) => r[cs.field]).filter((v) => v != null && v !== "")
    );
    const dual = distinct.size >= 2 && distinct.size <= AXIS_DTYPE_MAX_CATEGORIES;
    return { applicable: dual, recommendedValue: "temporal" };
  };
}
var AXIS_DTYPE_PROPERTIES = [
  {
    key: "xAxisType",
    label: "X as",
    type: "discrete",
    options: [
      { value: "temporal", label: "Temporal" },
      { value: "nominal", label: "Discrete" }
    ],
    check: makeAxisDtypeCheck("x")
  },
  {
    key: "yAxisType",
    label: "Y as",
    type: "discrete",
    options: [
      { value: "temporal", label: "Temporal" },
      { value: "nominal", label: "Discrete" }
    ],
    check: makeAxisDtypeCheck("y")
  }
];
function withInjectedProperties(def) {
  const hasFacetChannels = def.channels?.some((ch) => ch === "column" || ch === "row");
  const isPosition = def.markCognitiveChannel === "position";
  const wantsAxisDtype = AXIS_DTYPE_CHARTS.has(def.chart);
  const extra = [
    ...hasFacetChannels ? FACET_AXIS_PROPERTIES : [],
    ...isPosition ? LOG_SCALE_PROPERTIES : [],
    ...isPosition ? ZERO_BASELINE_PROPERTIES : [],
    ...wantsAxisDtype ? AXIS_DTYPE_PROPERTIES : []
  ];
  if (extra.length === 0) return def;
  const ownKeys = new Set((def.properties ?? []).map((p) => p.key));
  return {
    ...def,
    properties: [...def.properties ?? [], ...extra.filter((p) => !ownKeys.has(p.key))]
  };
}
var vlTemplateDefs = Object.fromEntries(
  Object.entries({
    "Points": [scatterPlotDef, regressionDef, connectedScatterDef, rangedDotPlotDef, stripPlotDef],
    "Bars": [barChartDef, groupedBarChartDef, stackedBarChartDef, lollipopChartDef, waterfallChartDef, ganttChartDef, bulletChartDef],
    "Distributions": [histogramDef, densityPlotDef, ecdfPlotDef, violinPlotDef, boxplotDef, pyramidChartDef, candlestickChartDef],
    "Lines & Areas": [lineChartDef, sparklineDef, bumpChartDef, slopeChartDef, areaChartDef, streamgraphDef, rangeAreaChartDef],
    "Circular": [pieChartDef, roseChartDef, radarChartDef],
    "Tables & Maps": [heatmapDef, barTableDef, kpiCardDef, mapDef, choroplethDef]
  }).map(([category, defs]) => [category, defs.map(withInjectedProperties)])
);
var vlAllTemplateDefs = Object.values(vlTemplateDefs).flat();
function vlGetTemplateDef(chartType) {
  return vlAllTemplateDefs.find((t) => t.chart === chartType);
}
function vlGetTemplateChannels(chartType) {
  return vlGetTemplateDef(chartType)?.channels || [];
}

// src/vegalite/instantiate-spec.ts
var DEFAULT_QUANTITATIVE_AXIS_FORMAT = ",.12~g";
function vlApplyLayoutToSpec(vgObj, context, warnings) {
  const { channelSemantics, layout, canvasSize } = context;
  const xIsDiscrete = layout.xNominalCount > 0;
  const yIsDiscrete = layout.yNominalCount > 0;
  const collectEncodingTargets = (ch) => {
    const targets = [];
    if (vgObj.encoding?.[ch]) targets.push(vgObj.encoding[ch]);
    if (vgObj.spec?.encoding?.[ch]) targets.push(vgObj.spec.encoding[ch]);
    if (Array.isArray(vgObj.layer)) {
      for (const layer of vgObj.layer) {
        if (layer.encoding?.[ch]) targets.push(layer.encoding[ch]);
      }
    }
    if (Array.isArray(vgObj.spec?.layer)) {
      for (const layer of vgObj.spec.layer) {
        if (layer.encoding?.[ch]) targets.push(layer.encoding[ch]);
      }
    }
    return targets;
  };
  for (const ch of ["x", "y"]) {
    const cs = channelSemantics[ch];
    if (!cs?.zero) continue;
    const decision = cs.zero;
    const targets = collectEncodingTargets(ch).filter((enc) => enc.type === "quantitative");
    for (const enc of targets) {
      if (enc.bin) continue;
      if (cs.field && enc.field && enc.field !== cs.field) continue;
      if (!enc.scale) enc.scale = {};
      if (enc.scale.zero !== void 0) continue;
      if (enc.scale.domain && Array.isArray(enc.scale.domain)) continue;
      enc.scale.zero = decision.zero;
    }
  }
  vlApplyFieldContext(vgObj, channelSemantics, collectEncodingTargets, context);
  vlApplyDefaultQuantitativeAxisFormat(collectEncodingTargets);
  const applyTemporalFormat = (enc, channel, cs) => {
    if (!enc || !cs?.temporalFormat) return;
    if (enc.type === "temporal") {
      if (channel === "color") {
        if (!enc.legend) enc.legend = {};
        enc.legend.format = cs.temporalFormat;
      }
    }
  };
  const applyTemporalToEncoding = (encoding) => {
    for (const [ch, enc] of Object.entries(encoding)) {
      applyTemporalFormat(enc, ch, channelSemantics[ch]);
    }
  };
  if (vgObj.encoding) applyTemporalToEncoding(vgObj.encoding);
  if (vgObj.spec?.encoding) applyTemporalToEncoding(vgObj.spec.encoding);
  if (Array.isArray(vgObj.layer)) {
    for (const layer of vgObj.layer) {
      if (layer.encoding) applyTemporalToEncoding(layer.encoding);
    }
  }
  if (Array.isArray(vgObj.spec?.layer)) {
    for (const layer of vgObj.spec.layer) {
      if (layer.encoding) applyTemporalToEncoding(layer.encoding);
    }
  }
  for (const axis of ["x", "y"]) {
    const bandedCount = axis === "x" ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
    if (bandedCount <= 1) continue;
    const enc = vgObj.encoding?.[axis] || vgObj.spec?.encoding?.[axis];
    if (!enc) continue;
    if (enc.bin) continue;
    const isTemporal2 = enc.type === "temporal";
    const isContinuous = enc.type === "quantitative" || isTemporal2;
    if (!isContinuous) continue;
    if (enc.scale?.domain) continue;
    const numericVals = context.table.map((r) => {
      const raw = r[enc.field];
      if (raw == null) return NaN;
      if (isTemporal2) return +new Date(raw);
      return +raw;
    }).filter((v) => !isNaN(v));
    if (numericVals.length <= 1) continue;
    const minVal = Math.min(...numericVals);
    const maxVal = Math.max(...numericVals);
    const dataRange = maxVal - minVal;
    if (dataRange === 0) continue;
    const pad = dataRange / (bandedCount - 1) / 2;
    if (!enc.scale) enc.scale = {};
    enc.scale.nice = false;
    if (isTemporal2) {
      enc.scale.domain = [
        new Date(minVal - pad).toISOString(),
        new Date(maxVal + pad).toISOString()
      ];
    } else {
      enc.scale.domain = [minVal - pad, maxVal + pad];
    }
  }
  const axisXConfig = {
    labelLimit: layout.xLabel.labelLimit,
    labelFontSize: layout.xLabel.fontSize
  };
  if (layout.xLabel.labelAngle !== void 0) {
    axisXConfig.labelAngle = layout.xLabel.labelAngle;
    axisXConfig.labelAlign = layout.xLabel.labelAlign;
    axisXConfig.labelBaseline = layout.xLabel.labelBaseline;
  }
  const axisYConfig = { labelFontSize: layout.yLabel.fontSize };
  vgObj.config = {
    view: {
      continuousWidth: layout.subplotWidth,
      continuousHeight: layout.subplotHeight,
      ...(!vgObj.encoding || vgObj._hideViewStroke) && { stroke: null }
    },
    axisX: axisXConfig,
    axisY: axisYConfig
  };
  if (xIsDiscrete && typeof vgObj.width !== "number") {
    vgObj.width = layout.xStepUnit === "group" ? { step: layout.xStep, for: "position" } : { step: layout.xStep };
  }
  if (yIsDiscrete && typeof vgObj.height !== "number") {
    vgObj.height = layout.yStepUnit === "group" ? { step: layout.yStep, for: "position" } : { step: layout.yStep };
  }
  if (typeof vgObj.width === "number") {
    vgObj.config.view.continuousWidth = vgObj.width;
  } else if (vgObj.width && typeof vgObj.width === "object" && "step" in vgObj.width) {
    vgObj.width = layout.xStepUnit === "group" ? { step: layout.xStep, for: "position" } : { step: layout.xStep };
  }
  if (typeof vgObj.height === "number") {
    vgObj.config.view.continuousHeight = vgObj.height;
  } else if (vgObj.height && typeof vgObj.height === "object" && "step" in vgObj.height) {
    vgObj.height = layout.yStepUnit === "group" ? { step: layout.yStep, for: "position" } : { step: layout.yStep };
  }
  const totalFacets = (layout.facet?.columns ?? 1) * (layout.facet?.rows ?? 1);
  const facetRows = layout.facet?.rows ?? 1;
  const facetCols = layout.facet?.columns ?? 1;
  if (facetRows > 1 || facetCols > 1) {
    const enc = vgObj.encoding || vgObj.spec?.encoding;
    const facetDef = vgObj.facet || {};
    const hasRow = !!(enc?.row || facetDef.row);
    const hasColumn = !!(enc?.column || facetDef.column);
    const hasWrap = !!(enc?.facet || vgObj.facet && !facetDef.row && !facetDef.column);
    const fontCfg = totalFacets > 6 ? { labelFontSize: 9 } : {};
    const colLimit = Math.max(80, layout.subplotWidth + 20);
    const rowLimit = Math.max(30, layout.subplotHeight);
    if (hasColumn) {
      vgObj.config.headerColumn = { ...vgObj.config.headerColumn || {}, ...fontCfg, labelLimit: colLimit };
    }
    if (hasRow) {
      vgObj.config.headerRow = { ...vgObj.config.headerRow || {}, ...fontCfg, labelLimit: rowLimit };
    }
    if (hasWrap) {
      vgObj.config.headerFacet = { ...vgObj.config.headerFacet || {}, ...fontCfg, labelLimit: colLimit };
    }
  }
  const encTarget = vgObj.spec?.encoding || vgObj.encoding;
  if (facetRows > 1 || facetCols > 1) {
    if (!vgObj.config) vgObj.config = {};
    const lightTitle = { titleFontWeight: "normal", titleFontSize: 11, titleColor: "#666" };
    vgObj.config.axisX = { ...vgObj.config.axisX || {}, ...lightTitle };
    vgObj.config.axisY = { ...vgObj.config.axisY || {}, ...lightTitle };
  }
  const rowEnc = encTarget?.row || vgObj.facet?.row;
  const yEnc = encTarget?.y;
  if (yEnc && (rowEnc || facetRows > 1 && encTarget?.y)) {
    if (yEnc.type === "nominal") {
      if (!vgObj.config) vgObj.config = {};
      vgObj.config.axisY = { ...vgObj.config.axisY || {}, title: null };
      if (!yEnc.axis) yEnc.axis = {};
      yEnc.axis.title = null;
    } else if (rowEnc && vgObj.resolve?.scale?.y !== "independent" && !vgObj._suppressFacetMeasureTitle) {
      const yTitle = yEnc.axis && yEnc.axis.title || yEnc.title || yEnc.field;
      const rowTitle = rowEnc.header && rowEnc.header.title || rowEnc.title || rowEnc.field;
      if (yTitle && rowTitle) {
        if (!rowEnc.header) rowEnc.header = {};
        rowEnc.header.title = `${rowTitle}: ${yTitle}`;
        if (!vgObj.config) vgObj.config = {};
        vgObj.config.axisY = { ...vgObj.config.axisY || {}, title: null };
        if (!yEnc.axis) yEnc.axis = {};
        yEnc.axis.title = null;
      }
    }
  }
  const legendChannels = ["color", "size", "shape", "opacity", "strokeDash", "strokeWidth"].filter((ch) => {
    const targets = collectEncodingTargets(ch);
    return targets.some((enc) => enc.field && enc.legend !== null);
  });
  if (legendChannels.length >= 2) {
    const categoricalChs = [];
    const quantitativeChs = [];
    for (const ch of legendChannels) {
      const targets = collectEncodingTargets(ch);
      const isQuant = targets.some((enc) => enc.type === "quantitative" || enc.type === "temporal");
      if (isQuant) {
        quantitativeChs.push(ch);
      } else {
        categoricalChs.push(ch);
      }
    }
    if (categoricalChs.length > 0 && quantitativeChs.length > 0) {
      const QUANT_LEGEND_HEIGHT = 100;
      const CAT_TITLE_HEIGHT = 20;
      const CAT_ENTRY_HEIGHT = 20;
      let totalCatEntries = 0;
      for (const ch of categoricalChs) {
        const targets = collectEncodingTargets(ch);
        for (const enc of targets) {
          if (!enc.field) continue;
          const domainSize = new Set(context.table.map((r) => r[enc.field])).size;
          totalCatEntries += domainSize;
        }
      }
      const estCatHeight = CAT_TITLE_HEIGHT * categoricalChs.length + totalCatEntries * CAT_ENTRY_HEIGHT;
      const estTotalLegendHeight = QUANT_LEGEND_HEIGHT + estCatHeight + 20;
      const totalChartHeight = layout.subplotHeight * (layout.facet?.rows ?? 1) + (layout.facet?.rows ?? 1) * 10;
      const fitsOnRight = totalChartHeight >= estTotalLegendHeight;
      if (!fitsOnRight) {
        for (const ch of categoricalChs) {
          const targets = collectEncodingTargets(ch);
          for (const enc of targets) {
            if (!enc.field) continue;
            if (!enc.legend) enc.legend = {};
            enc.legend.orient = "bottom";
            enc.legend.direction = "horizontal";
            const domainValues = [...new Set(context.table.map((r) => r[enc.field]))];
            const domainSize = domainValues.length;
            const maxLabelLen = Math.max(
              ...domainValues.map((v) => String(v ?? "").length),
              3
            );
            const entryWidth = 15 + maxLabelLen * 5 + 8;
            const rightLegendWidth = 130;
            const availableWidth = canvasSize.width + rightLegendWidth;
            const columnsByWidth = Math.max(1, Math.floor(availableWidth / entryWidth));
            enc.legend.columns = Math.min(columnsByWidth, domainSize);
            const maxRows = 4;
            const maxVisible = columnsByWidth * maxRows;
            if (domainSize > maxVisible) {
              enc.legend.symbolLimit = maxVisible;
            }
          }
        }
      }
    }
  }
  for (const trunc of layout.truncations) {
    const ch = trunc.channel;
    const targets = collectEncodingTargets(ch);
    for (const enc of targets) {
      if (!enc.field) continue;
      if (ch === "x" || ch === "y") {
        if (enc.axis === null) continue;
        if (!enc.axis) enc.axis = {};
        enc.axis.labelColor = {
          condition: {
            test: `datum.label == '${trunc.placeholder}'`,
            value: "#999999"
          },
          value: "#000000"
        };
        if (!enc.scale) enc.scale = {};
        enc.scale.domain = [...trunc.keptValues, trunc.placeholder];
      } else if (ch === "color") {
        if (!enc.legend) enc.legend = {};
        enc.legend.values = [...trunc.keptValues, trunc.placeholder];
      }
    }
  }
}
function buildAbbreviationExpr(prefix, suffix) {
  const pfx = prefix ? `'${prefix}' + ` : "";
  const sfx = suffix ? ` + '${suffix}'` : "";
  return `${pfx}(abs(datum.value) >= 1e12 ? format(datum.value / 1e12, '~g') + 'T' : abs(datum.value) >= 1e9 ? format(datum.value / 1e9, '~g') + 'B' : abs(datum.value) >= 1e6 ? format(datum.value / 1e6, '~g') + 'M' : abs(datum.value) >= 1e3 ? format(datum.value / 1e3, '~g') + 'K' : format(datum.value, ','))${sfx}`;
}
function formatSpecToLabelExpr(fmt) {
  if (fmt.abbreviate) {
    return buildAbbreviationExpr(fmt.prefix, fmt.suffix);
  }
  if (!fmt.pattern) return null;
  const hasPrefix = !!fmt.prefix;
  const hasSuffix = !!fmt.suffix;
  if (!hasPrefix && !hasSuffix) {
    return null;
  }
  const pfx = hasPrefix ? `'${fmt.prefix}' + ` : "";
  const sfx = hasSuffix ? ` + '${fmt.suffix}'` : "";
  return `${pfx}format(datum.value, '${fmt.pattern}')${sfx}`;
}
function computeStackedExtremes(table, measureField, measureChannel, channelSemantics) {
  if (!table || table.length === 0) return void 0;
  const groupChannel = measureChannel === "y" ? "x" : "y";
  const groupCS = channelSemantics[groupChannel];
  if (!groupCS) return void 0;
  const groupField = groupCS.field;
  if (!groupField) return void 0;
  const facetFields = [];
  for (const ch of ["row", "column"]) {
    const fcs = channelSemantics[ch];
    if (fcs?.field) facetFields.push(fcs.field);
  }
  const posTotals = /* @__PURE__ */ new Map();
  const negTotals = /* @__PURE__ */ new Map();
  for (const row of table) {
    const val = row[measureField];
    if (typeof val !== "number" || isNaN(val)) continue;
    const keyParts = [String(row[groupField])];
    for (const ff of facetFields) {
      keyParts.push(String(row[ff]));
    }
    const key = keyParts.join("|||");
    if (val >= 0) {
      posTotals.set(key, (posTotals.get(key) ?? 0) + val);
    } else {
      negTotals.set(key, (negTotals.get(key) ?? 0) + val);
    }
  }
  if (posTotals.size === 0 && negTotals.size === 0) return void 0;
  const maxPos = posTotals.size > 0 ? Math.max(...posTotals.values()) : 0;
  const minNeg = negTotals.size > 0 ? Math.min(...negTotals.values()) : 0;
  return { maxPos, minNeg };
}
function hasRepeatedCategory(table, categoryField, measureField) {
  if (!table || table.length === 0 || !categoryField) return false;
  const seen = /* @__PURE__ */ new Set();
  for (const row of table) {
    const val = row[measureField];
    if (typeof val !== "number" || isNaN(val)) continue;
    const key = String(row[categoryField]);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
function getEffectiveIntrinsicDomain(cs, table, field) {
  if (cs.semanticAnnotation?.intrinsicDomain) {
    return cs.semanticAnnotation.intrinsicDomain;
  }
  const semanticType = cs.semanticAnnotation?.semanticType;
  if (!semanticType) return void 0;
  if (semanticType === "Latitude") return [-90, 90];
  if (semanticType === "Longitude") return [-180, 180];
  if (semanticType === "Correlation") return [-1, 1];
  if (semanticType === "Percentage") {
    const nums = table.map((r) => r[field]).filter((v) => typeof v === "number" && !isNaN(v));
    if (nums.length > 0) {
      const countBelow1 = nums.filter((v) => Math.abs(v) <= 1).length;
      const isFractional = countBelow1 / nums.length >= 0.8;
      return isFractional ? [0, 1] : [0, 100];
    }
  }
  return void 0;
}
function vlApplyFieldContext(vgObj, channelSemantics, collectEncodingTargets, context) {
  for (const [ch, cs] of Object.entries(channelSemantics)) {
    const targets = collectEncodingTargets(ch);
    if (targets.length === 0) continue;
    for (const enc of targets) {
      if (!enc.field) continue;
      if (cs.field && enc.field !== cs.field) continue;
      if (enc.bin && enc.type === "temporal") {
        enc.type = "quantitative";
        if (enc.axis !== null) {
          if (!enc.axis) enc.axis = {};
          if (!enc.axis.format) enc.axis.format = "d";
        }
      }
      if ((cs.format?.pattern || cs.format?.abbreviate) && (ch === "x" || ch === "y") && enc.type === "quantitative" && !enc.bin) {
        if (enc.axis === null) ; else if (!enc.axis?.format && !enc.axis?.labelExpr) {
          if (!enc.axis) enc.axis = {};
          const expr = formatSpecToLabelExpr(cs.format);
          if (expr) {
            enc.axis.labelExpr = expr;
          } else {
            enc.axis.format = cs.format.pattern;
          }
        }
      }
      const isExplicitlyStacked = enc.stack !== void 0 && enc.stack !== null && enc.stack !== false;
      const markType = typeof vgObj.mark === "string" ? vgObj.mark : vgObj.mark?.type;
      const isBarLike = ["bar", "area", "rect"].includes(markType);
      const hasColorEncoding = !!(vgObj.encoding?.color?.field || Array.isArray(vgObj.layer) && vgObj.layer.some((l) => l.encoding?.color?.field) || vgObj.spec?.encoding?.color?.field);
      const otherChannel = ch === "y" ? "x" : "y";
      const otherCS = channelSemantics[otherChannel];
      const otherIsDiscrete = otherCS?.type === "nominal" || otherCS?.type === "ordinal";
      const isImplicitlyStacked = isBarLike && otherIsDiscrete && enc.stack !== null && (hasColorEncoding || hasRepeatedCategory(context.table, otherCS?.field, enc.field));
      const isStacked = isExplicitlyStacked || isImplicitlyStacked;
      const isNormalizeStacked = enc.stack === "normalize";
      const isSumStacked = isStacked && !isNormalizeStacked;
      let skipDomain = false;
      let effectiveDomainConstraint = cs.domainConstraint;
      if (isSumStacked) {
        const intrinsic = getEffectiveIntrinsicDomain(cs, context.table, enc.field);
        if (intrinsic) {
          const extremes = computeStackedExtremes(
            context.table,
            enc.field,
            ch,
            channelSemantics
          );
          if (extremes !== void 0) {
            const { maxPos, minNeg } = extremes;
            const range = intrinsic[1] - intrinsic[0];
            const epsilon = range * 1e-6;
            const overflowsTop = maxPos > intrinsic[1] + epsilon;
            const overflowsBottom = minNeg < intrinsic[0] - epsilon;
            if (overflowsTop || overflowsBottom) {
              if (cs.domainConstraint) {
                skipDomain = true;
              }
            } else {
              const stackedSnap = snapToBoundHeuristic(intrinsic, [maxPos, minNeg]);
              if (stackedSnap) {
                if (cs.domainConstraint) {
                  effectiveDomainConstraint = {
                    min: cs.domainConstraint.min ?? stackedSnap.min,
                    max: cs.domainConstraint.max ?? stackedSnap.max,
                    clamp: cs.domainConstraint.clamp || stackedSnap.clamp
                  };
                } else {
                  effectiveDomainConstraint = stackedSnap;
                }
              }
            }
          }
        } else if (cs.domainConstraint) {
          skipDomain = true;
        }
      }
      if (effectiveDomainConstraint && enc.type === "quantitative" && (ch === "x" || ch === "y") && !enc.bin && !skipDomain) {
        if (!enc.scale) enc.scale = {};
        let { min } = effectiveDomainConstraint;
        const { max, clamp: clamp2 } = effectiveDomainConstraint;
        const wantsNoZero = cs.zero?.zero === false;
        if (!isBarLike && wantsNoZero && min === 0) min = void 0;
        if (min !== void 0 && max !== void 0) {
          enc.scale.domain = [min, max];
          if (!isBarLike && enc.scale.zero !== void 0 && !wantsNoZero) {
            delete enc.scale.zero;
          }
        } else {
          if (min !== void 0) enc.scale.domainMin = min;
          if (max !== void 0) enc.scale.domainMax = max;
          enc.scale.nice = true;
        }
        if (clamp2) {
          enc.scale.clamp = true;
        }
      }
      if (cs.tickConstraint && (ch === "x" || ch === "y") && enc.type === "quantitative" && !enc.bin) {
        if (enc.axis === null) ; else {
          if (!enc.axis) enc.axis = {};
          if (cs.tickConstraint.integersOnly && enc.axis.tickMinStep === void 0) {
            enc.axis.tickMinStep = cs.tickConstraint.minStep ?? 1;
          }
          if (cs.tickConstraint.exactTicks && !enc.axis.values) {
            enc.axis.values = cs.tickConstraint.exactTicks;
          }
          if (cs.tickConstraint.integersOnly && !enc.axis.labelExpr && !enc.axis.values) {
            enc.axis.labelExpr = "datum.value === ceil(datum.value) ? format(datum.value, ',d') : ''";
          }
          if (cs.tickConstraint.integersOnly && enc.axis.format) {
            enc.axis.format = enc.axis.format.replace(/\.\d+f$/, "d");
          }
          if (cs.tickConstraint.integersOnly && enc.axis.labelExpr) {
            enc.axis.labelExpr = enc.axis.labelExpr.replace(
              /format\(datum\.value,\s*'([^']*)\.\d+f'\)/,
              "format(datum.value, '$1d')"
            );
          }
        }
      }
      if (cs.reversed && (ch === "x" || ch === "y") && enc.type === "quantitative" && !enc.bin) {
        if (!enc.scale) enc.scale = {};
        if (enc.scale.reverse === void 0) {
          enc.scale.reverse = true;
        }
      }
      if (cs.nice === false && enc.type === "quantitative" && !enc.bin) {
        if (!enc.scale) enc.scale = {};
        if (enc.scale.nice === void 0) {
          enc.scale.nice = false;
        }
      }
      if (cs.scaleType && cs.scaleType !== "linear" && enc.type === "quantitative" && !enc.bin) {
        if (!enc.scale) enc.scale = {};
        if (!enc.scale.type) {
          enc.scale.type = cs.scaleType;
          if (cs.scaleType === "log" || cs.scaleType === "symlog") {
            if (enc.scale.zero !== void 0) {
              delete enc.scale.zero;
            }
            if (ch === "x" || ch === "y") {
              if (enc.axis === null) ; else {
                if (!enc.axis) enc.axis = {};
                enc.axis.gridColor = "#e8e8e8";
                enc.axis.gridOpacity = 0.5;
              }
            }
          }
        }
      }
    }
  }
}
function vlApplyDefaultQuantitativeAxisFormat(collectEncodingTargets) {
  for (const ch of ["x", "y"]) {
    for (const enc of collectEncodingTargets(ch)) {
      if (!enc || enc.type !== "quantitative" || enc.bin || enc.axis === null) continue;
      if (enc.axis?.format || enc.axis?.labelExpr) continue;
      if (!enc.axis) enc.axis = {};
      enc.axis.format = DEFAULT_QUANTITATIVE_AXIS_FORMAT;
    }
  }
}
function vlApplyTooltips(vgObj) {
  if (!vgObj.config) vgObj.config = {};
  vgObj.config.mark = { ...vgObj.config.mark, tooltip: true };
}

// src/core/normalize-properties.ts
function normalizeChartProperties(properties, chartProperties) {
  const warnings = [];
  if (!properties || !chartProperties) {
    return { chartProperties, warnings };
  }
  let result;
  const ensureCopy = () => {
    if (!result) result = { ...chartProperties };
    return result;
  };
  for (const def of properties) {
    if (def.type !== "discrete") continue;
    if (!(def.key in chartProperties)) continue;
    const value = chartProperties[def.key];
    if (value == null) continue;
    if (def.options.some((o) => o.value === value)) continue;
    const byLabel = typeof value === "string" ? def.options.find(
      (o) => o.label != null && o.label.toLowerCase() === value.trim().toLowerCase()
    ) : void 0;
    if (byLabel) {
      ensureCopy()[def.key] = byLabel.value;
      warnings.push({
        severity: "info",
        code: "coerced-option-label",
        message: `chartProperties.${def.key}: '${value}' is a display label; using the accepted value '${byLabel.value}' instead.`
      });
      continue;
    }
    const accepted = def.options.map((o) => o.value == null ? "(default)" : `'${o.value}'`).join(", ");
    const copy = ensureCopy();
    delete copy[def.key];
    warnings.push({
      severity: "warning",
      code: "invalid-option-value",
      message: `chartProperties.${def.key}: '${value}' is not a valid option (accepted: ${accepted}). Falling back to the default.`
    });
  }
  return { chartProperties: result ?? chartProperties, warnings };
}

// src/vegalite/assemble.ts
var escapeVlFieldName = (name) => name.replace(/[.[\]]/g, (ch) => `\\${ch}`);
function assembleVegaLite(input) {
  const chartType = input.chart_spec.chartType;
  const semanticTypes = input.semantic_types ?? {};
  const sizeCeiling = input.chart_spec.canvasSize;
  const baseSize = resolveBaseSize(input.chart_spec.baseSize, sizeCeiling);
  const canvasSize = baseSize;
  const options = input.options ?? {};
  let chartTemplate = vlGetTemplateDef(chartType);
  if (!chartTemplate) {
    throw new Error(`Unknown chart type: ${chartType}`);
  }
  const warnings = [];
  const normalizedProps = normalizeChartProperties(
    chartTemplate.properties,
    input.chart_spec.chartProperties
  );
  const chartProperties = normalizedProps.chartProperties;
  warnings.push(...normalizedProps.warnings);
  const rawData = input.data.values ?? [];
  const normalized = normalizeStaticSeries(
    input.chart_spec.encodings,
    rawData,
    semanticTypes
  );
  let data = normalized.data;
  const staticSeries = normalized.staticSeries;
  const prelimConvertedData = convertTemporalData(data, semanticTypes);
  const prelimSemantics = resolveChannelSemantics(
    normalized.encodings,
    data,
    semanticTypes,
    prelimConvertedData
  );
  const typedRawEncodings = {};
  for (const [ch, enc] of Object.entries(normalized.encodings)) {
    typedRawEncodings[ch] = enc.type ? enc : { ...enc, type: prelimSemantics[ch]?.type };
  }
  for (const axis of ["x", "y"]) {
    const choice = chartProperties?.[`${axis}AxisType`];
    if ((choice === "temporal" || choice === "nominal") && typedRawEncodings[axis]?.field) {
      typedRawEncodings[axis] = { ...typedRawEncodings[axis], type: choice };
    }
  }
  const pivoted = applyPivot(chartTemplate, typedRawEncodings, data, chartProperties, vlGetTemplateDef);
  if (pivoted.chartType && pivoted.chartType !== chartType) {
    const swapped = vlGetTemplateDef(pivoted.chartType);
    if (swapped) chartTemplate = swapped;
  }
  const composedEncodings = applyEncodingOverrides(chartTemplate, pivoted.encodings, chartProperties);
  const encodings = chartTemplate.normalizeEncodings ? chartTemplate.normalizeEncodings(composedEncodings, data) : composedEncodings;
  data = applyAggregation(encodings, data);
  const tplMark = chartTemplate.template?.mark;
  const templateMarkType = typeof tplMark === "string" ? tplMark : tplMark?.type;
  const convertedData = convertTemporalData(data, semanticTypes);
  const channelSemantics = resolveChannelSemantics(
    encodings,
    data,
    semanticTypes,
    convertedData
  );
  const effectiveMarkType = templateMarkType || "point";
  for (const [channel, cs] of Object.entries(channelSemantics)) {
    if ((channel === "x" || channel === "y") && cs.type === "quantitative") {
      const numericValues = data.map((r) => r[cs.field]).filter((v) => v != null && typeof v === "number" && !isNaN(v));
      cs.zero = computeZeroDecision(
        cs.semanticAnnotation.semanticType,
        channel,
        effectiveMarkType,
        numericValues
      );
    }
  }
  if (chartTemplate.markCognitiveChannel === "position") {
    for (const axis of ["x", "y"]) {
      const cs = channelSemantics[axis];
      if (!cs?.field || cs.type !== "quantitative" || !cs.zero) continue;
      const choice = chartProperties?.[`includeZero_${axis}`];
      if (choice === void 0) continue;
      cs.zero = { ...cs.zero, zero: choice };
    }
  }
  if (chartTemplate.markCognitiveChannel === "position") {
    for (const axis of ["x", "y"]) {
      const cs = channelSemantics[axis];
      if (!cs?.field || cs.type !== "quantitative") continue;
      if (chartTemplate.template?.encoding?.[axis]?.bin) continue;
      const choice = chartProperties?.[`logScale_${axis}`];
      if (choice === void 0) continue;
      const hasZero = data.some((row) => row[cs.field] === 0);
      cs.scaleType = choice === false ? void 0 : hasZero ? "symlog" : "log";
    }
  } else {
    for (const axis of ["x", "y"]) {
      const cs = channelSemantics[axis];
      if (cs?.scaleType === "log" || cs?.scaleType === "symlog") {
        cs.scaleType = void 0;
      }
    }
  }
  const declaration = chartTemplate.declareLayoutMode ? chartTemplate.declareLayoutMode(channelSemantics, data, chartProperties) : {};
  if (!declaration.binnedAxes) {
    const templateEnc = chartTemplate.template?.encoding;
    if (templateEnc) {
      const binnedAxes = {};
      for (const axis of ["x", "y"]) {
        if (templateEnc[axis]?.bin) {
          const propBins = chartProperties?.binCount;
          if (propBins) {
            binnedAxes[axis] = { maxbins: propBins };
          } else if (typeof templateEnc[axis].bin === "object" && templateEnc[axis].bin.maxbins) {
            binnedAxes[axis] = templateEnc[axis].bin;
          } else {
            binnedAxes[axis] = { maxbins: 10 };
          }
        }
      }
      if (Object.keys(binnedAxes).length > 0) {
        declaration.binnedAxes = binnedAxes;
      }
    }
  }
  const effectiveOptions = {
    ...options,
    ...declaration.paramOverrides || {}
  };
  const {
    addTooltips: addTooltipsOpt = false,
    minSubplotSize: minSubplotVal = 60
  } = effectiveOptions;
  if (effectiveOptions.facetFixedPadding == null) {
    effectiveOptions.facetFixedPadding = { width: 50, height: 40 };
  }
  if (effectiveOptions.facetGap == null) {
    effectiveOptions.facetGap = 10;
  }
  if (effectiveOptions.targetBandAR == null) {
    effectiveOptions.targetBandAR = 10;
  }
  const caps = deriveStretchCaps(baseSize, sizeCeiling, effectiveOptions);
  effectiveOptions.maxStretchX = caps.maxStretchX;
  effectiveOptions.maxStretchY = caps.maxStretchY;
  const facetFixW = effectiveOptions.facetFixedPadding.width;
  const facetFixH = effectiveOptions.facetFixedPadding.height;
  const allMarkTypes = /* @__PURE__ */ new Set();
  if (templateMarkType) allMarkTypes.add(templateMarkType);
  if (Array.isArray(chartTemplate.template?.layer)) {
    for (const layer of chartTemplate.template.layer) {
      const lm = typeof layer.mark === "string" ? layer.mark : layer.mark?.type;
      if (lm) allMarkTypes.add(lm);
    }
  }
  const budgets = computeChannelBudgets(
    channelSemantics,
    declaration,
    convertedData,
    canvasSize,
    effectiveOptions
  );
  const facetGridResult = budgets.facetGrid;
  const overflowResult = filterOverflow(
    channelSemantics,
    declaration,
    encodings,
    convertedData,
    budgets,
    allMarkTypes
  );
  const values = overflowResult.filteredData;
  const nominalCounts = overflowResult.nominalCounts;
  warnings.push(...overflowResult.warnings);
  const layoutResult = computeLayout(
    channelSemantics,
    declaration,
    values,
    // post-overflow filtered data
    canvasSize,
    effectiveOptions,
    facetGridResult
  );
  layoutResult.truncations = overflowResult.truncations;
  let fieldDisplayNames = input.field_display_names;
  if (staticSeries) {
    fieldDisplayNames = { ...fieldDisplayNames };
    if (!fieldDisplayNames[staticSeries.keyColumn]) {
      fieldDisplayNames[staticSeries.keyColumn] = "Series";
    }
    if (!fieldDisplayNames[staticSeries.valueColumn]) {
      fieldDisplayNames[staticSeries.valueColumn] = "Value";
    }
  }
  const resolvedEncodings = buildVLEncodings(
    encodings,
    channelSemantics,
    declaration,
    data,
    canvasSize,
    semanticTypes,
    templateMarkType,
    chartTemplate,
    fieldDisplayNames,
    chartProperties
  );
  for (const enc of Object.values(resolvedEncodings)) {
    const field = enc?.field;
    if (!field) continue;
    const valMap = /* @__PURE__ */ new Map();
    for (const r of values) {
      const v = r[field];
      if (v != null && !valMap.has(String(v))) valMap.set(String(v), v);
    }
    if (valMap.size === 0) continue;
    const remap = (arr) => arr.map((v) => {
      const key = String(v);
      return valMap.has(key) ? valMap.get(key) : v;
    });
    if (Array.isArray(enc.sort)) enc.sort = remap(enc.sort);
    if (Array.isArray(enc.scale?.domain)) enc.scale.domain = remap(enc.scale.domain);
  }
  const isDiscreteType2 = (t) => t === "nominal" || t === "ordinal";
  if (Array.isArray(chartTemplate.template?.layer)) {
    for (const axis of ["x", "y"]) {
      if (nominalCounts[axis] === 0) {
        for (const layer of chartTemplate.template.layer) {
          const layerEnc = layer.encoding?.[axis];
          if (layerEnc?.field && isDiscreteType2(layerEnc.type)) {
            nominalCounts[axis] = new Set(values.map((r) => r[layerEnc.field])).size;
            break;
          }
        }
        if (nominalCounts[axis] === 0 && resolvedEncodings[axis]?.field) {
          const enc = resolvedEncodings[axis];
          if (isDiscreteType2(enc.type)) {
            nominalCounts[axis] = new Set(values.map((r) => r[enc.field])).size;
          }
        }
      }
    }
  }
  const vgObj = structuredClone(chartTemplate.template);
  const instantiateContext = {
    channelSemantics,
    layout: layoutResult,
    table: values,
    fullTable: convertedData,
    resolvedEncodings,
    encodings,
    chartProperties,
    staticSeries,
    canvasSize,
    semanticTypes,
    chartType,
    assembleOptions: effectiveOptions
  };
  chartTemplate.instantiate(vgObj, instantiateContext);
  if (vgObj._warnings && Array.isArray(vgObj._warnings)) {
    warnings.push(...vgObj._warnings);
    delete vgObj._warnings;
  }
  restructureFacets(vgObj, nominalCounts, facetGridResult);
  vlApplyLayoutToSpec(vgObj, instantiateContext);
  const defaultChartWidth = canvasSize.width;
  const defaultChartHeight = canvasSize.height;
  const { minSubplotWidth, minSubplotHeight } = computeMinSubplotDimensions(
    channelSemantics,
    declaration,
    values,
    effectiveOptions
  );
  const refGap = effectiveOptions.facetGap ?? 0;
  const subplotDim = Math.min(layoutResult.subplotWidth, layoutResult.subplotHeight);
  const REF_SUBPLOT = 100;
  const facetGapVal = Math.max(6, Math.round(refGap * subplotDim / REF_SUBPLOT));
  vgObj.config = vgObj.config || {};
  vgObj.config.facet = { spacing: facetGapVal };
  const maxFacetColumns = Math.max(2, Math.floor((defaultChartWidth * caps.maxStretchX - facetFixW) / (minSubplotWidth + facetGapVal)));
  const maxFacetRows = Math.max(2, Math.floor((defaultChartHeight * caps.maxStretchY - facetFixH) / (minSubplotHeight + facetGapVal)));
  const maxFacetNominalValues = maxFacetColumns * maxFacetRows;
  for (const channel of ["facet", "column", "row"]) {
    const enc = vgObj.encoding?.[channel];
    if (enc?.type === "quantitative") {
      const fieldName = enc.field;
      const uniqueValues = [...new Set(values.map((r) => r[fieldName]))];
      if (uniqueValues.length > maxFacetNominalValues) {
        enc.bin = true;
      }
    }
  }
  const effectiveEncoding = vgObj.spec?.encoding || vgObj.encoding;
  const layerEncodings = (vgObj.spec?.layer || vgObj.layer || []).map((l) => l.encoding).filter(Boolean);
  const yEnc = effectiveEncoding?.y || layerEncodings.find((e) => e.y)?.y;
  const effectiveFacet = vgObj.facet || vgObj.encoding?.facet;
  const hasFacetedQuant = effectiveFacet != void 0 && yEnc?.type === "quantitative";
  let computedIndependentYAxis = false;
  if (hasFacetedQuant) {
    const userChoice = chartProperties?.independentYAxis;
    if (userChoice === void 0) {
      const yField = yEnc.field;
      const columnField = effectiveFacet.field;
      if (yField && columnField) {
        const columnGroups = /* @__PURE__ */ new Map();
        for (const row of data) {
          const columnValue = row[columnField];
          const yValue = row[yField];
          if (yValue != null && !isNaN(yValue)) {
            const currentMax = columnGroups.get(columnValue) || 0;
            columnGroups.set(columnValue, Math.max(currentMax, Math.abs(yValue)));
          }
        }
        const maxValues = Array.from(columnGroups.values()).filter((v) => v > 0);
        if (maxValues.length >= 2) {
          const maxValue = Math.max(...maxValues);
          const minValue = Math.min(...maxValues);
          const ratio = maxValue / minValue;
          const totalFacets = (layoutResult.facet?.columns ?? 1) * (layoutResult.facet?.rows ?? 1);
          if (ratio >= 100 && totalFacets < 6) {
            computedIndependentYAxis = true;
          }
        }
      }
    } else {
      computedIndependentYAxis = !!userChoice;
    }
    if (computedIndependentYAxis) {
      if (!vgObj.resolve) vgObj.resolve = {};
      if (!vgObj.resolve.scale) vgObj.resolve.scale = {};
      vgObj.resolve.scale.y = "independent";
    }
  }
  if (addTooltipsOpt) {
    vlApplyTooltips(vgObj);
  }
  const result = { ...vgObj, data: vgObj.data ?? { values } };
  if (warnings.length > 0) {
    result._warnings = warnings;
  }
  result._width = layoutResult.subplotWidth;
  result._height = layoutResult.subplotHeight;
  const evalCtx = {
    encodings,
    channelSemantics,
    data,
    chartProperties
  };
  const layoutCoupledRecommendation = {
    independentYAxis: computedIndependentYAxis
  };
  result._options = (chartTemplate.properties ?? []).map((def) => {
    const ev = def.check?.(evalCtx);
    const applicable = ev ? ev.applicable : true;
    const recommended = layoutCoupledRecommendation[def.key] ?? ev?.recommendedValue;
    const value = chartProperties?.[def.key] ?? recommended ?? def.defaultValue;
    const { check, ...rest } = def;
    return { ...rest, applicable, value };
  });
  if (pivoted.surface) {
    result._pivot = pivoted.surface;
  }
  return result;
}
function getChartOptions(input) {
  const spec = assembleVegaLite(input);
  return spec && Array.isArray(spec._options) ? spec._options : [];
}
function getChartPivot(input) {
  const spec = assembleVegaLite(input);
  return spec && spec._pivot ? spec._pivot : void 0;
}
function buildVLEncodings(encodings, channelSemantics, declaration, data, canvasSize, semanticTypes, templateMarkType, chartTemplate, fieldDisplayNames, chartProperties) {
  const resolvedEncodings = {};
  const templateChannels = /* @__PURE__ */ new Set([
    ...chartTemplate.channels || [],
    "column",
    "row"
    // faceting is always allowed
  ]);
  for (const [channel, encoding] of Object.entries(encodings)) {
    if (!templateChannels.has(channel)) continue;
    const encodingObj = {};
    const fieldName = encoding.field;
    const cs = channelSemantics[channel];
    if (channel === "radius") {
      encodingObj.scale = { type: "sqrt", zero: true };
    }
    if (!fieldName && encoding.aggregate === "count") {
      encodingObj.field = "_count";
      encodingObj.title = "Count";
      encodingObj.type = "quantitative";
    }
    if (fieldName) {
      const escapedFieldName = escapeVlFieldName(fieldName);
      encodingObj.field = escapedFieldName;
      if (escapedFieldName !== fieldName) {
        encodingObj.title = fieldName;
      }
      encodingObj.type = cs?.type || "nominal";
      if (encoding.type) {
        encodingObj.type = encoding.type;
      } else if (channel === "column" || channel === "row") {
        if (encodingObj.type !== "nominal" && encodingObj.type !== "ordinal") {
          encodingObj.type = "nominal";
        }
      }
      if (encoding.aggregate) {
        if (encoding.aggregate === "count") {
          encodingObj.field = "_count";
          encodingObj.title = "Count";
          encodingObj.type = "quantitative";
        } else {
          encodingObj.field = escapeVlFieldName(`${fieldName}_${encoding.aggregate}`);
          encodingObj.type = "quantitative";
        }
      }
      if (encodingObj.type === "quantitative" && channel === "x") {
        if (templateMarkType === "line" || templateMarkType === "area" || templateMarkType === "trail" || templateMarkType === "point") {
          encodingObj.scale = { nice: false };
        }
      }
      if (encodingObj.type === "nominal" && (channel === "color" || channel === "group")) {
        const actualDomain = [...new Set(data.map((r) => r[fieldName]))];
        if (actualDomain.length >= 16) {
          if (!encodingObj.legend) encodingObj.legend = {};
          encodingObj.legend.symbolSize = 12;
          encodingObj.legend.labelFontSize = 8;
        }
      }
    }
    if (channel === "size") {
      const vlDefaultMax = 361;
      const plotArea = canvasSize.width * canvasSize.height;
      const n = Math.max(data.length, 1);
      const fairShare = plotArea / n;
      const targetPct = 0.6;
      const absoluteMin = 16;
      const isQuantitative = encodingObj.type === "quantitative" || encodingObj.type === "temporal";
      if (isQuantitative) {
        const maxSize = Math.round(Math.max(absoluteMin, Math.min(vlDefaultMax, fairShare * targetPct)));
        const minSize = 9;
        encodingObj.scale = { type: "sqrt", zero: true, range: [minSize, maxSize] };
      } else {
        const maxSize = Math.round(Math.max(absoluteMin, Math.min(vlDefaultMax, fairShare * targetPct)));
        const minSize = Math.round(maxSize / 4);
        encodingObj.scale = { range: [minSize, maxSize] };
      }
    }
    const fieldIsNumeric = fieldName ? data.some((r) => typeof r[fieldName] === "number") : false;
    const preserveDomainTypes = (arr) => {
      if (!fieldIsNumeric) return arr;
      return arr.map((v) => {
        if (typeof v === "string") {
          const n = Number(v);
          if (!isNaN(n) && String(n) === v.trim()) return n;
        }
        return v;
      });
    };
    if (encoding.sortBy || encoding.sortOrder) {
      if (!encoding.sortBy) {
        if (encoding.sortOrder) {
          encodingObj.sort = encoding.sortOrder;
        }
      } else if (encoding.sortBy === "x" || encoding.sortBy === "y") {
        if (encoding.sortBy === channel) {
          encodingObj.sort = `${encoding.sortOrder === "descending" ? "-" : ""}${encoding.sortBy}`;
        } else {
          encodingObj.sort = `${encoding.sortOrder === "ascending" ? "" : "-"}${encoding.sortBy}`;
        }
      } else if (encoding.sortBy === "color") {
        if (encodings.color?.field) {
          encodingObj.sort = `${encoding.sortOrder === "ascending" ? "" : "-"}${encoding.sortBy}`;
        }
      } else {
        if (encodingObj.type !== "temporal") {
          try {
            if (fieldName) {
              const fieldSemType = toTypeString(semanticTypes[fieldName]);
              const fieldVisCat = inferVisCategory(data.map((r) => r[fieldName]));
              let sortedValues = JSON.parse(encoding.sortBy);
              if (fieldVisCat === "temporal" || fieldSemType === "Year" || fieldSemType === "Decade") {
                sortedValues = sortedValues.map((v) => v.toString());
              }
              sortedValues = preserveDomainTypes(sortedValues);
              encodingObj.sort = encoding.sortOrder === "ascending" || !encoding.sortOrder ? sortedValues : sortedValues.reverse();
            }
          } catch {
            console.warn(`sort error > ${encoding.sortBy}`);
          }
        }
      }
    } else {
      const isDiscreteType2 = encodingObj.type === "nominal" || encodingObj.type === "ordinal";
      if (isDiscreteType2) {
        if (cs?.ordinalSortOrder && cs.ordinalSortOrder.length > 0) {
          encodingObj.sort = preserveDomainTypes(cs.ordinalSortOrder);
        } else if (fieldIsNumeric && fieldName) {
          encodingObj.sort = "ascending";
        } else {
          encodingObj.sort = null;
        }
      }
    }
    if (channel === "color" || channel === "group") {
      if (encoding.scheme && encoding.scheme !== "default") {
        if ("scale" in encodingObj) {
          encodingObj.scale.scheme = encoding.scheme;
        } else {
          encodingObj.scale = { scheme: encoding.scheme };
        }
      } else if (fieldName && cs?.colorScheme) {
        if (!("scale" in encodingObj)) {
          encodingObj.scale = {};
        }
        encodingObj.scale.scheme = cs.colorScheme.scheme;
        if (cs.colorScheme.type === "diverging" && cs.colorScheme.domainMid !== void 0) {
          encodingObj.scale.domainMid = cs.colorScheme.domainMid;
        }
      }
    }
    if (fieldDisplayNames && fieldName && fieldDisplayNames[fieldName] && !encodingObj.title) {
      encodingObj.title = fieldDisplayNames[fieldName];
    }
    if (Object.keys(encodingObj).length !== 0) {
      resolvedEncodings[channel] = encodingObj;
    }
  }
  if (declaration.resolvedTypes) {
    for (const [ch, type] of Object.entries(declaration.resolvedTypes)) {
      if (resolvedEncodings[ch]) {
        resolvedEncodings[ch].type = type;
      }
    }
  }
  const groupCS = channelSemantics.group;
  if (groupCS?.field && resolvedEncodings.group) {
    const xType = resolvedEncodings.x?.type;
    const yType = resolvedEncodings.y?.type;
    const isDiscreteT = (t) => t === "nominal" || t === "ordinal";
    const groupAxis = isDiscreteT(xType) ? "x" : isDiscreteT(yType) ? "y" : "x";
    const offsetChannel = groupAxis === "x" ? "xOffset" : "yOffset";
    if (!resolvedEncodings.color) {
      resolvedEncodings.color = { ...resolvedEncodings.group };
    }
    delete resolvedEncodings.group;
    const groupAxisField = channelSemantics[groupAxis]?.field;
    const groupPlan = groupAxisField ? planBandDodge(data, groupAxisField, groupCS.field) : void 0;
    const groupMode = groupPlan ? resolveDodge(groupPlan, chartProperties?.dodge).mode : "global";
    const groupIsNested = !!groupAxisField && (groupAxisField === groupCS.field || groupMode === "none");
    if (!groupIsNested && !resolvedEncodings[offsetChannel]) {
      const offsetEnc = { field: groupCS.field, type: "nominal" };
      if (resolvedEncodings.color?.sort !== void 0) {
        offsetEnc.sort = resolvedEncodings.color.sort;
      }
      resolvedEncodings[offsetChannel] = offsetEnc;
    }
  }
  const templateEncoding = chartTemplate.template?.encoding;
  if (templateEncoding) {
    for (const [ch, enc] of Object.entries(templateEncoding)) {
      if (enc && typeof enc === "object" && Object.keys(enc).length > 0) {
        if (resolvedEncodings[ch]) {
          resolvedEncodings[ch] = { ...enc, ...resolvedEncodings[ch] };
        }
      }
    }
  }
  return resolvedEncodings;
}
function restructureFacets(vgObj, nominalCounts, facetGrid) {
  const isConcatSpec = () => Array.isArray(vgObj.hconcat) || Array.isArray(vgObj.vconcat) || Array.isArray(vgObj.concat);
  const hoistConcatIntoFacet = (facetDef, wrapColumns) => {
    const childSpec = {};
    for (const key of ["hconcat", "vconcat", "concat", "resolve", "spacing", "align", "bounds", "center"]) {
      if (vgObj[key] !== void 0) {
        childSpec[key] = vgObj[key];
        delete vgObj[key];
      }
    }
    if (vgObj.encoding && Object.keys(vgObj.encoding).length > 0) {
      childSpec.encoding = vgObj.encoding;
      delete vgObj.encoding;
    }
    vgObj.facet = facetDef;
    if (wrapColumns != null) {
      vgObj.columns = wrapColumns;
    }
    vgObj.spec = childSpec;
    vgObj.resolve = {
      ...vgObj.resolve || {},
      scale: { ...vgObj.resolve?.scale || {}, y: "independent" }
    };
  };
  if (vgObj.encoding?.column != void 0 && vgObj.encoding?.row == void 0) {
    vgObj.encoding.facet = vgObj.encoding.column;
    const numCols = facetGrid?.columns ?? (nominalCounts.column || 1);
    facetGrid?.rows ?? 1;
    vgObj.encoding.facet.columns = numCols;
    delete vgObj.encoding.column;
    if (isConcatSpec()) {
      const facetDef = { ...vgObj.encoding.facet };
      delete facetDef.columns;
      delete vgObj.encoding.facet;
      if (Object.keys(vgObj.encoding).length === 0) {
        delete vgObj.encoding;
      }
      hoistConcatIntoFacet(facetDef, numCols);
      return;
    }
    if (vgObj.layer && Array.isArray(vgObj.layer)) {
      const facetDef = { ...vgObj.encoding.facet };
      const wrapColumns = facetDef.columns;
      delete facetDef.columns;
      delete vgObj.encoding.facet;
      vgObj.facet = facetDef;
      if (wrapColumns != null) {
        vgObj.columns = wrapColumns;
      }
      vgObj.spec = {
        layer: vgObj.layer,
        encoding: vgObj.encoding
      };
      delete vgObj.layer;
      delete vgObj.encoding;
    }
    return;
  }
  if (isConcatSpec() && (vgObj.encoding?.column || vgObj.encoding?.row)) {
    const facetDef = {};
    if (vgObj.encoding.column) {
      facetDef.column = vgObj.encoding.column;
      delete vgObj.encoding.column;
    }
    if (vgObj.encoding.row) {
      facetDef.row = vgObj.encoding.row;
      delete vgObj.encoding.row;
    }
    if (Object.keys(vgObj.encoding).length === 0) {
      delete vgObj.encoding;
    }
    hoistConcatIntoFacet(facetDef);
    return;
  }
  if (vgObj.layer && Array.isArray(vgObj.layer) && (vgObj.encoding?.column || vgObj.encoding?.row)) {
    const facetDef = {};
    if (vgObj.encoding.column) {
      facetDef.column = vgObj.encoding.column;
      delete vgObj.encoding.column;
    }
    if (vgObj.encoding.row) {
      facetDef.row = vgObj.encoding.row;
      delete vgObj.encoding.row;
    }
    vgObj.facet = facetDef;
    vgObj.spec = {
      layer: vgObj.layer,
      encoding: vgObj.encoding
    };
    delete vgObj.layer;
    delete vgObj.encoding;
  }
}

// src/vegalite/recommendation.ts
function vlGetRecommendation(chartType, tv) {
  const used = /* @__PURE__ */ new Set();
  const rec = {};
  const assign = (channel, fieldName) => {
    if (fieldName) rec[channel] = fieldName;
  };
  switch (chartType) {
    case "Regression":
      return getRecommendation("Scatter Plot", tv);
    case "Ranged Dot Plot": {
      const yField = pickGeo(tv, used) ?? pickDiscrete(tv, used);
      const xField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("y", yField);
      assign("x", xField);
      return rec;
    }
    case "Pyramid Chart": {
      const yField = pickDiscrete(tv, used);
      const xField = pickQuantitative(tv, used);
      const colorField = pickDiscrete(tv, used);
      if (!xField || !yField || !colorField) return {};
      assign("y", yField);
      assign("x", xField);
      assign("color", colorField);
      return rec;
    }
    case "Bump Chart": {
      const xField = pickSeriesAxis(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      if (!isValidLineSeriesData(tv, xField, void 0)) {
        const colorField = pickLineChartColorField(tv, used, xField, 20) ?? pickLineChartColorField(tv, used, xField, 200);
        if (!colorField) return {};
        assign("color", colorField);
      }
      return rec;
    }
    case "Lollipop Chart": {
      const xField = pickDiscrete(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      if (hasMultipleValuesPerField(tv, xField)) {
        assign("color", pickBestGroupingField(tv, used, xField));
      }
      return rec;
    }
    case "Density Plot": {
      const xField = pickQuantitative(tv, used);
      if (!xField) return {};
      assign("x", xField);
      assign("color", pickLowCardNominal(tv, used, 15));
      return rec;
    }
    case "Waterfall Chart": {
      const xField = pickDiscrete(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      return rec;
    }
    case "Bar Table": {
      const yField = pickDiscrete(tv, used);
      const xField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("y", yField);
      assign("x", xField);
      assign("color", pickLowCardNominal(tv, used, 20));
      return rec;
    }
    case "Strip Plot": {
      const xField = pickDiscrete(tv, used);
      const yField = pickQuantitative(tv, used);
      if (!xField || !yField) return {};
      assign("x", xField);
      assign("y", yField);
      assign("color", pickLowCardDiscrete(tv, used, 20));
      return rec;
    }
    case "Gantt Chart": {
      const yField = pickDiscrete(tv, used);
      const startField = pickTemporal(tv, used) ?? pickQuantitative(tv, used);
      const endField = pickTemporal(tv, used) ?? pickQuantitative(tv, used);
      if (!yField || !startField || !endField) return {};
      assign("y", yField);
      assign("x", startField);
      assign("x2", endField);
      assign("color", pickLowCardNominal(tv, used, 12));
      return rec;
    }
    case "Bullet Chart": {
      const yField = pickDiscrete(tv, used);
      const valueField = pickQuantitative(tv, used);
      const goalField = pickQuantitative(tv, used);
      if (!yField || !valueField) return {};
      assign("y", yField);
      assign("x", valueField);
      if (goalField) assign("goal", goalField);
      return rec;
    }
    case "Map": {
      const latField = pick(tv, used, (_n, _ty, st) => st === "Latitude") ?? pick(tv, used, (n) => nameMatches(n, ["latitude", "lat"]));
      const lonField = pick(tv, used, (_n, _ty, st) => st === "Longitude") ?? pick(tv, used, (n) => nameMatches(n, ["longitude", "lon", "lng", "long"]));
      if (!latField || !lonField) return {};
      assign("latitude", latField);
      assign("longitude", lonField);
      assign("color", pickQuantitative(tv, used) ?? pickLowCardNominal(tv, used));
      return rec;
    }
    case "Choropleth": {
      const GEO_PLACE = ["State", "Country", "Region", "Province", "County", "Continent"];
      const idField = pick(tv, used, (_n, _ty, st) => GEO_PLACE.includes(st)) ?? pick(tv, used, (n) => nameMatches(n, ["state", "country", "region", "province", "nation", "county"])) ?? pickDiscrete(tv, used);
      const measure = pickQuantitative(tv, used);
      if (!idField || !measure) return {};
      assign("id", idField);
      assign("color", measure);
      return rec;
    }
    default:
      return getRecommendation(chartType, tv);
  }
}
function vlAdaptChart(sourceType, targetType, encodings, data, semanticTypes) {
  const targetChannels = vlGetTemplateChannels(targetType);
  return adaptChannels(sourceType, targetType, targetChannels, encodings, data, semanticTypes);
}
function vlRecommendEncodings(chartType, data, semanticTypes) {
  const rec = recommendChannels(chartType, data, semanticTypes, vlGetRecommendation);
  const validChannels = vlGetTemplateChannels(chartType);
  const result = {};
  for (const [ch, field] of Object.entries(rec)) {
    if (validChannels.includes(ch)) {
      result[ch] = field;
    }
  }
  return result;
}

// src/echarts/templates/utils.ts
function getCategoryOrder(ctx, channel) {
  return ctx.resolvedEncodings?.[channel]?.ordinalSortOrder ?? ctx.channelSemantics?.[channel]?.ordinalSortOrder;
}
var isDiscrete6 = (type) => type === "nominal" || type === "ordinal";
function extractCategories(data, field, ordinalSortOrder) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const row of data) {
    const val = row[field];
    if (val != null) {
      const key = String(val);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
  }
  if (ordinalSortOrder && ordinalSortOrder.length > 0) {
    const orderMap = new Map(ordinalSortOrder.map((v, i) => [v, i]));
    result.sort((a, b) => {
      const ia = orderMap.get(a);
      const ib = orderMap.get(b);
      if (ia !== void 0 && ib !== void 0) return ia - ib;
      if (ia !== void 0) return -1;
      if (ib !== void 0) return 1;
      return 0;
    });
  }
  return result;
}
function groupBy(data, field) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of data) {
    const key = String(row[field] ?? "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}
var DEFAULT_COLORS = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#ea7ccc",
  "#48b8d0"
];
function detectAxes(channelSemantics) {
  const xCS = channelSemantics.x;
  const yCS = channelSemantics.y;
  if (xCS && isDiscrete6(xCS.type)) {
    return { categoryAxis: "x", valueAxis: "y" };
  }
  if (yCS && isDiscrete6(yCS.type)) {
    return { categoryAxis: "y", valueAxis: "x" };
  }
  if (xCS?.type === "quantitative" && yCS?.type === "temporal") {
    return { categoryAxis: "y", valueAxis: "x" };
  }
  if (xCS?.type === "temporal" && yCS?.type === "quantitative") {
    return { categoryAxis: "x", valueAxis: "y" };
  }
  return { categoryAxis: "x", valueAxis: "y" };
}

// src/echarts/colormap.ts
var ECHARTS_COLOR_MAPS = [
  {
    id: "cat10",
    type: "categorical",
    supportsDiscrete: true,
    supportsContinuous: false,
    background: "any",
    maxCategories: 10,
    colorblindSafe: false,
    colors: [
      "#5470c6",
      "#91cc75",
      "#fac858",
      "#ee6666",
      "#73c0de",
      "#3ba272",
      "#fc8452",
      "#9a60b4",
      "#ea7ccc",
      "#d48265"
    ]
  },
  {
    id: "cat20",
    type: "categorical",
    supportsDiscrete: true,
    supportsContinuous: false,
    background: "any",
    maxCategories: 20,
    colorblindSafe: false,
    colors: [
      "#5470c6",
      "#91cc75",
      "#fac858",
      "#ee6666",
      "#73c0de",
      "#3ba272",
      "#fc8452",
      "#9a60b4",
      "#ea7ccc",
      "#d48265",
      "#749f83",
      "#ca8622",
      "#bda29a",
      "#6e7074",
      "#546570",
      "#c4ccd3",
      "#4b565b",
      "#2f4554",
      "#61a0a8",
      "#c23531"
    ]
  },
  {
    id: "viridis",
    type: "sequential",
    supportsDiscrete: true,
    supportsContinuous: true,
    background: "any",
    colorblindSafe: true,
    colors: [
      "#440154",
      "#46327e",
      "#365c8d",
      "#277f8e",
      "#1fa187",
      "#4ac16d",
      "#a0da39",
      "#fde725"
    ]
  },
  {
    id: "RdBu",
    type: "diverging",
    supportsDiscrete: true,
    supportsContinuous: true,
    background: "any",
    colorblindSafe: false,
    diverging: true,
    preferredMidpoint: 0,
    colors: [
      "#b2182b",
      "#d6604d",
      "#f4a582",
      "#fddbc7",
      "#f7f7f7",
      "#d1e5f0",
      "#92c5de",
      "#4393c3",
      "#2166ac"
    ]
  }
];
function getMapById(id) {
  if (!id) return void 0;
  const key = String(id).toLowerCase();
  return ECHARTS_COLOR_MAPS.find((m) => m.id.toLowerCase() === key);
}
function getPaletteForScheme(id) {
  const entry = getMapById(id);
  return entry?.colors;
}
function pickEChartsPalette(decision) {
  if (!decision) {
    return DEFAULT_COLORS;
  }
  const { schemeType, schemeId, categoryCount } = decision;
  if (schemeId) {
    const fromId = getPaletteForScheme(schemeId);
    if (fromId && fromId.length > 0) {
      return fromId;
    }
  }
  const mapsOfType = ECHARTS_COLOR_MAPS.filter((m) => m.type === schemeType);
  if (schemeType === "categorical") {
    const k = categoryCount ?? 0;
    if (mapsOfType.length) {
      const candidates = mapsOfType.filter((m) => m.supportsDiscrete);
      if (candidates.length) {
        const byCapacity = candidates.filter((m) => m.maxCategories == null || m.maxCategories >= k).sort((a, b) => (a.maxCategories ?? Infinity) - (b.maxCategories ?? Infinity));
        const picked = byCapacity[0] ?? candidates[0];
        if (picked.colors.length) {
          return picked.colors;
        }
      }
    }
  } else if (schemeType === "sequential") {
    const seq = mapsOfType.find((m) => m.supportsContinuous) ?? getMapById("viridis");
    if (seq && seq.colors.length) {
      return seq.colors;
    }
  } else if (schemeType === "diverging") {
    const divergingFirst = mapsOfType.find((m) => m.diverging) ?? getMapById("RdBu");
    if (divergingFirst && divergingFirst.colors.length) {
      return divergingFirst.colors;
    }
  }
  return DEFAULT_COLORS;
}

// src/echarts/templates/rose.ts
var EC_ROSE_LEGEND_BRIDGE_SERIES_NAME = "__dfRoseLegendBridge__";
function roseRadius(value) {
  return Math.sqrt(Math.max(0, value));
}
var ecRoseChartDef = {
  chart: "Rose Chart",
  template: { mark: "arc", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const catField = channelSemantics.x?.field;
    const valField = channelSemantics.y?.field;
    const colorField = channelSemantics.color?.field;
    if (!catField || !valField) return;
    const categories = extractCategories(table, catField, channelSemantics.x?.ordinalSortOrder);
    if (categories.length === 0) return;
    const sortSlices = ctx.chartProperties?.sortSlices;
    if (sortSlices === "descending" || sortSlices === "ascending") {
      const totals = /* @__PURE__ */ new Map();
      for (const c of categories) totals.set(c, 0);
      for (const row of table) {
        const c = String(row[catField] ?? "");
        if (totals.has(c)) totals.set(c, totals.get(c) + (Number(row[valField]) || 0));
      }
      categories.sort(
        (a, b) => sortSlices === "descending" ? (totals.get(b) ?? 0) - (totals.get(a) ?? 0) : (totals.get(a) ?? 0) - (totals.get(b) ?? 0)
      );
    }
    const seriesArr = [];
    const legendData = [];
    if (colorField) {
      const groups = groupBy(table, colorField);
      const cumSum = categories.map(() => 0);
      for (const [name, rows] of groups) {
        legendData.push(name);
        const catAgg = /* @__PURE__ */ new Map();
        for (const row of rows) {
          const cat = String(row[catField] ?? "");
          const val = Number(row[valField]) || 0;
          catAgg.set(cat, (catAgg.get(cat) ?? 0) + val);
        }
        const data = categories.map((c, i) => {
          const val = catAgg.get(c) ?? 0;
          const prev = cumSum[i];
          const next = prev + val;
          cumSum[i] = next;
          return { value: roseRadius(next) - roseRadius(prev), _rawValue: val };
        });
        seriesArr.push({
          type: "bar",
          name,
          data,
          coordinateSystem: "polar",
          stack: "rose",
          emphasis: { focus: "series" }
        });
      }
    } else {
      const catAgg = /* @__PURE__ */ new Map();
      for (const row of table) {
        const cat = String(row[catField] ?? "");
        const val = Number(row[valField]) || 0;
        catAgg.set(cat, (catAgg.get(cat) ?? 0) + val);
      }
      const values = categories.map((c) => catAgg.get(c) ?? 0);
      for (const c of categories) {
        legendData.push(String(c));
      }
      seriesArr.push({
        type: "bar",
        data: categories.map((c, i) => ({
          value: roseRadius(values[i]),
          name: String(c),
          _rawValue: values[i]
        })),
        coordinateSystem: "polar",
        emphasis: { focus: "series" }
      });
      seriesArr.push({
        type: "pie",
        name: EC_ROSE_LEGEND_BRIDGE_SERIES_NAME,
        z: -10,
        silent: true,
        tooltip: { show: false },
        radius: 0,
        center: ["50%", "50%"],
        label: { show: false },
        labelLine: { show: false },
        emphasis: { disabled: true },
        data: categories.map((c) => ({
          name: String(c),
          value: 1,
          label: { show: false },
          labelLine: { show: false }
        }))
      });
    }
    const alignment = ctx.chartProperties?.alignment ?? "left";
    const n = categories.length;
    const startAngle = alignment === "center" && n > 0 ? 90 + 180 / n : 90;
    const hasLegend = legendData.length > 0;
    const maxLabelLen = hasLegend ? Math.max(...legendData.map((d) => d.length), 3) : 0;
    const estimatedLegendWidth = hasLegend ? Math.min(150, maxLabelLen * 7 + 40) : 0;
    const { radius: pressureRadius, canvasW: rawCanvasW, canvasH } = computeCircumferencePressure(categories.length, ctx.canvasSize, {
      minArcPx: 45,
      minRadius: 80,
      maxStretch: ctx.assembleOptions?.maxStretch,
      maxStretchX: ctx.assembleOptions?.maxStretchX,
      maxStretchY: ctx.assembleOptions?.maxStretchY
    });
    const canvasW = rawCanvasW + (hasLegend ? estimatedLegendWidth : 0);
    const polarRadius = hasLegend ? Math.min(pressureRadius, (canvasW - estimatedLegendWidth - 40) / 2, (canvasH - 40) / 2) : pressureRadius;
    const polarCenter = hasLegend ? [`${Math.round((canvasW - estimatedLegendWidth) / 2)}px`, "50%"] : void 0;
    const option = {
      tooltip: {
        trigger: "item",
        // Radii are sqrt-transformed for area-truth; show the true value
        // (stashed on each data item as `_rawValue`) instead of the radius.
        formatter: (params) => {
          const raw = params?.data?._rawValue;
          const shown = raw != null ? raw : params?.value;
          const cat = params?.name != null && params.name !== "" ? String(params.name) : "";
          const series = params?.seriesName;
          const head = series && series !== cat ? cat ? `${cat} \xB7 ${series}` : String(series) : cat;
          const marker = params?.marker ?? "";
          return `${marker}${head}: <b>${shown}</b>`;
        }
      },
      angleAxis: {
        type: "category",
        data: categories,
        startAngle
      },
      radiusAxis: {
        // hide axis line for cleaner look
        axisLine: { show: false },
        axisTick: { show: false },
        // Radii encode sqrt(value); showing the raw sqrt tick numbers would
        // misrepresent the scale, so suppress them (values live in tooltips).
        axisLabel: { show: false }
      },
      polar: {
        radius: polarRadius,
        ...polarCenter != null ? { center: polarCenter } : {}
      },
      series: seriesArr,
      // 颜色调色板由 color-decisions / ecApplyLayoutToSpec 注入到 option.color
      // Canvas size
      _width: canvasW,
      _height: canvasH
    };
    if (hasLegend) {
      option.legend = {
        data: legendData,
        type: legendData.length > 8 ? "scroll" : "plain",
        orient: "vertical",
        right: 10,
        top: "middle",
        textStyle: { fontSize: 11 }
      };
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "alignment",
      label: "Alignment",
      type: "discrete",
      options: [
        { value: "left", label: "Left (default)" },
        { value: "center", label: "Center" }
      ]
    },
    {
      key: "sortSlices",
      label: "Sort slices",
      type: "discrete",
      options: [
        { value: "none", label: "Data order" },
        { value: "descending", label: "Largest first" },
        { value: "ascending", label: "Smallest first" }
      ],
      defaultValue: "none"
    }
  ]
};

// src/echarts/instantiate-spec.ts
function pickEvenlySpacedColorIndices(paletteLength, count) {
  if (paletteLength <= 0 || count <= 0) return [];
  if (count === 1) return [0];
  if (count >= paletteLength) {
    return Array.from({ length: count }, (_, i) => i % paletteLength);
  }
  const maxIndex = paletteLength - 1;
  const step = maxIndex / (count - 1);
  const indices = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.round(i * step);
    indices.push(idx);
  }
  return indices;
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const intVal = parseInt(m[1], 16);
  return {
    r: intVal >> 16 & 255,
    g: intVal >> 8 & 255,
    b: intVal & 255
  };
}
function componentToHex(c) {
  const v = Math.max(0, Math.min(255, Math.round(c)));
  const s = v.toString(16);
  return s.length === 1 ? `0${s}` : s;
}
function rgbToHex(r, g, b) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}
function samplePaletteTo256(base) {
  if (base.length === 0) return [];
  if (base.length === 1) return new Array(256).fill(base[0]);
  const stops = base.map(hexToRgb);
  if (stops.some((s) => s == null)) {
    return Array.from({ length: 256 }, (_, i) => base[i % base.length]);
  }
  const rgbStops = stops;
  const segmentCount = rgbStops.length - 1;
  const result = [];
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const pos = t * segmentCount;
    const idx = Math.floor(pos);
    const localT = pos - idx;
    const c0 = rgbStops[idx];
    const c1 = rgbStops[Math.min(idx + 1, segmentCount)];
    const r = c0.r + (c1.r - c0.r) * localT;
    const g = c0.g + (c1.g - c0.g) * localT;
    const b = c0.b + (c1.b - c0.b) * localT;
    result.push(rgbToHex(r, g, b));
  }
  return result;
}
function buildRankColorLookupFromLegend(legendData, palette) {
  const labels = legendData.map(
    (d) => typeof d === "string" ? d : d?.name ?? String(d ?? "")
  );
  const numericEntries = labels.map((name) => {
    const v = Number(name);
    return Number.isFinite(v) ? { name, value: v } : null;
  }).filter((x) => x != null);
  if (numericEntries.length === 0) return /* @__PURE__ */ new Map();
  const values = numericEntries.map((e) => e.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = maxVal - minVal;
  const sampled = samplePaletteTo256(palette);
  if (sampled.length === 0) return /* @__PURE__ */ new Map();
  const colorMap = /* @__PURE__ */ new Map();
  for (const { name, value } of numericEntries) {
    let t;
    if (!Number.isFinite(span) || span === 0) {
      t = 0.5;
    } else {
      t = (value - minVal) / span;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
    }
    const idx = Math.round(t * (sampled.length - 1));
    colorMap.set(name, sampled[idx]);
  }
  return colorMap;
}
function roundAxisNumber(v) {
  if (!Number.isFinite(v)) return v;
  return Number(v.toFixed(10));
}
function cleanAxisNumericFields(axis) {
  if (!axis || typeof axis !== "object") return;
  for (const key of ["min", "max", "interval"]) {
    if (typeof axis[key] === "number") {
      axis[key] = roundAxisNumber(axis[key]);
    }
  }
}
function pyramidPanelHeightMatchVegaLite(yCardinality, canvasSize) {
  const baseWidth = canvasSize.width ?? 400;
  const baseHeight = canvasSize.height ?? 320;
  const baseRefSize = 300;
  const sizeRatio = Math.max(baseWidth, baseHeight) / baseRefSize;
  const defaultStep = Math.round(20 * Math.max(1, sizeRatio));
  let panelHeight = baseHeight;
  if (yCardinality > 0) {
    const pressure = yCardinality * defaultStep / baseHeight;
    if (pressure > 1) {
      const stretch = Math.min(2, Math.pow(pressure, 0.5));
      panelHeight = Math.round(baseHeight * stretch);
    }
  }
  return panelHeight;
}
function estimatePyramidYCategoryInsetPx(option, gw) {
  const data = option.yAxis?.data;
  if (!Array.isArray(data) || data.length === 0) return 0;
  const maxLen = Math.max(...data.map((d) => String(d).length), 1);
  const est = Math.round(8 + maxLen * 7.5 + 4);
  return Math.min(Math.max(0, est), Math.floor(gw * 0.45));
}
function pyramidNiceSymmetricMax(absMax) {
  if (!Number.isFinite(absMax) || absMax <= 0) return 1;
  const exp = Math.floor(Math.log10(absMax));
  const f = absMax / 10 ** exp;
  let ceilF;
  if (f <= 1) ceilF = 1;
  else if (f <= 2) ceilF = 2;
  else if (f <= 3) ceilF = 3;
  else if (f <= 5) ceilF = 5;
  else if (f <= 6) ceilF = 6;
  else if (f <= 10) ceilF = 10;
  else ceilF = 10;
  return ceilF * 10 ** exp;
}
function pyramidNiceTickStep(niceMax3) {
  const candidates = [1, 2, 2.5, 5, 10].flatMap((m) => [m, m * 10, m * 100, m * 1e3, m * 1e4, m * 1e5, m * 1e6]);
  const sorted = [...new Set(candidates)].filter((s) => s > 0 && s <= niceMax3 / 2).sort((a, b) => b - a);
  for (const step of sorted) {
    const n = niceMax3 / step;
    if (n >= 2 && n <= 8 && Number.isInteger(n)) return step;
  }
  return niceMax3 / 4;
}
function estimateGroupedBoxplotMinPlotWidth(option, layout) {
  if (option?.xAxis?.type !== "category" || !Array.isArray(option?.series)) return 0;
  const boxplotSeriesCount = option.series.filter((s) => s?.type === "boxplot").length;
  if (boxplotSeriesCount <= 1) return 0;
  let categoryCount = Array.isArray(option.xAxis?.data) ? option.xAxis.data.length : 0;
  if (categoryCount <= 0 && layout.xNominalCount > 0) {
    categoryCount = Math.max(1, Math.round(layout.xNominalCount / boxplotSeriesCount));
  }
  if (categoryCount <= 0) return 0;
  const MIN_BOX_WIDTH = 10;
  const MIN_INNER_GAP = 3;
  const SIDE_PADDING = 6;
  const perCategoryWidth = boxplotSeriesCount * MIN_BOX_WIDTH + (boxplotSeriesCount - 1) * MIN_INNER_GAP + SIDE_PADDING * 2;
  return categoryCount * perCategoryWidth;
}
function placePyramidChannelHeaders(option) {
  const hdr = option._pyramidChannelHeader;
  if (!hdr || !option.grid) return;
  const cw = Number(option._width);
  if (!Number.isFinite(cw) || cw <= 0) return;
  delete option._pyramidChannelHeader;
  const gl = Number(option.grid.left) || 0;
  const gr = Number(option.grid.right) || 0;
  const gt = Number(option.grid.top) || 0;
  const gw = Math.max(0, cw - gl - gr);
  const centerX = gl + gw / 2;
  const dx = gw / 4;
  const topY = Math.max(4, gt - 10);
  const L = estimatePyramidYCategoryInsetPx(option, gw);
  const innerW = Math.max(gw - L, 1);
  const zX = gl + L + innerW / 2;
  const style = {
    fontSize: 11,
    fontWeight: "bold",
    fill: "#555",
    textAlign: "center",
    textVerticalAlign: "bottom"
  };
  if (hdr.mode === "single") {
    option.graphic = [{ type: "text", left: zX, top: topY, z: 100, style: { ...style, text: hdr.text } }];
  } else {
    const directX = centerX - dx;
    const geoPartnerX = centerX + dx;
    const innerPartnerX = zX + innerW / 4;
    const partnerX = 0.9 * geoPartnerX - 0.02 * innerPartnerX;
    option.graphic = [
      { type: "text", left: directX, top: topY, z: 100, style: { ...style, text: hdr.left } },
      { type: "text", left: partnerX, top: topY, z: 100, style: { ...style, text: hdr.right } }
    ];
  }
}
function ecApplyLayoutToSpec(option, context, warnings) {
  const { channelSemantics, layout, canvasSize } = context;
  const hasAxes = !!(option.xAxis || option.yAxis);
  for (const axis of ["x", "y"]) {
    const axisObj = option[`${axis}Axis`];
    if (!axisObj || axisObj.type !== "value") continue;
    const cs = channelSemantics[axis];
    if (!cs?.zero) continue;
    const decision = cs.zero;
    if (axisObj.scale === void 0) {
      axisObj.scale = !decision.zero;
    }
    if (!decision.zero && decision.domainPadFraction > 0 && cs.field) {
      const pairField = axis === "y" ? channelSemantics.y2?.field : axis === "x" ? channelSemantics.x2?.field : void 0;
      const domainFields = pairField ? [cs.field, pairField] : [cs.field];
      const numericValues = context.table.flatMap((r) => domainFields.map((f) => r[f])).filter((v) => v != null && typeof v === "number" && !isNaN(v));
      const padded = computePaddedDomain(numericValues, decision.domainPadFraction);
      if (padded) {
        axisObj.min = padded[0];
        axisObj.max = padded[1];
      }
    }
  }
  for (const axis of ["x", "y"]) {
    const bandedCount = axis === "x" ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
    if (bandedCount <= 1) continue;
    const axisObj = option[`${axis}Axis`];
    if (!axisObj || axisObj.type !== "value" || axisObj.min != null) continue;
    const cs = channelSemantics[axis];
    if (!cs?.field || cs.type !== "quantitative" && cs.type !== "temporal") continue;
    const isTemporal2 = cs.type === "temporal";
    const numericVals = context.table.map((r) => {
      const raw = r[cs.field];
      if (raw == null) return NaN;
      return isTemporal2 ? +new Date(raw) : +raw;
    }).filter((v) => !isNaN(v));
    if (numericVals.length <= 1) continue;
    const minVal = Math.min(...numericVals);
    const maxVal = Math.max(...numericVals);
    const dataRange = maxVal - minVal;
    if (dataRange === 0) continue;
    const pad = dataRange / (bandedCount - 1) / 2;
    axisObj.min = minVal - pad;
    axisObj.max = maxVal + pad;
  }
  if (option.xAxis) {
    if (option.xAxis.name) {
      option.xAxis.nameLocation = option.xAxis.nameLocation || "middle";
      option.xAxis.nameGap = option.xAxis.nameGap || 25;
      option.xAxis.nameTextStyle = { fontSize: 12, ...option.xAxis.nameTextStyle || {} };
    }
  }
  if (option.yAxis) {
    if (option.yAxis.name) {
      option.yAxis.nameLocation = option.yAxis.nameLocation || "middle";
      option.yAxis.nameGap = option.yAxis.nameGap || 45;
      option.yAxis.nameTextStyle = { fontSize: 12, ...option.yAxis.nameTextStyle || {} };
    }
  }
  if (option.singleAxis) {
    if (option.singleAxis.name) {
      option.singleAxis.nameLocation = option.singleAxis.nameLocation || "middle";
      option.singleAxis.nameGap = option.singleAxis.nameGap || 25;
      option.singleAxis.nameTextStyle = { fontSize: 12, ...option.singleAxis.nameTextStyle || {} };
    }
    if (!option.singleAxis.axisLabel) option.singleAxis.axisLabel = {};
    option.singleAxis.axisLabel.fontSize = option.singleAxis.axisLabel.fontSize || 11;
  }
  const hasLegend = !!option.legend;
  const hasVisualMap = !!option.visualMap;
  const isDualLegend = hasLegend && hasVisualMap;
  if (hasLegend) {
    const alreadyPositioned = option.legend.orient && (option.legend.right !== void 0 || option.legend.left !== void 0);
    let legendTitle = option._legendTitle;
    if (legendTitle == null) {
      const colorField = channelSemantics?.color?.field;
      const groupField = channelSemantics?.group?.field;
      legendTitle = colorField || groupField;
    }
    if (legendTitle != null) delete option._legendTitle;
    if (!alreadyPositioned) {
      const rawLegendData = option.legend.data || [];
      const legendLabels = rawLegendData.map((d) => typeof d === "string" ? d : d?.name ?? "");
      if (isDualLegend) {
        const highCardinality = legendLabels.length >= 16;
        option._legendWidth = 0;
        option.legend = {
          ...option.legend,
          bottom: 0,
          left: "center",
          orient: "horizontal",
          textStyle: {
            fontSize: highCardinality ? 8 : 11,
            ...option.legend.textStyle || {}
          },
          ...legendLabels.length > 10 ? { type: "scroll" } : {},
          ...highCardinality ? { itemWidth: 12, itemHeight: 12 } : {}
        };
        if (legendTitle != null) {
          const titleGraphic = {
            type: "text",
            bottom: 22,
            left: "center",
            z: 100,
            style: {
              text: legendTitle,
              fontSize: 11,
              fontWeight: "bold",
              fill: "#333",
              textAlign: "center"
            }
          };
          const existing = option.graphic;
          option.graphic = Array.isArray(existing) ? [...existing, titleGraphic] : existing ? [existing, titleGraphic] : [titleGraphic];
        }
      } else {
        const maxLabelLen = Math.max(...legendLabels.map((l) => l.length), 3);
        const highCardinality = legendLabels.length >= 16;
        const legendSymbolWidth = highCardinality ? 12 : 14;
        const legendItemGap = 5;
        const estimatedTextWidth = Math.min(120, maxLabelLen * 7 + 30);
        option._legendWidth = legendSymbolWidth + legendItemGap + estimatedTextWidth;
        const LEGEND_GAP2 = 12;
        const CANVAS_BUFFER2 = 16;
        const rightMarginPx = option._legendWidth + LEGEND_GAP2 + CANVAS_BUFFER2;
        const hasYTitle2 = !!option.yAxis?.name;
        const gridLeft = (hasYTitle2 ? 70 : 50) + CANVAS_BUFFER2;
        let plotW = layout?.subplotWidth ?? canvasSize?.width ?? 400;
        const xIsDiscreteForLegend = layout.xNominalCount > 0 || layout.xContinuousAsDiscrete > 0;
        if (xIsDiscreteForLegend) {
          let xItemCount = layout.xNominalCount || layout.xContinuousAsDiscrete || 0;
          if (layout.xStepUnit === "group" && option.series && Array.isArray(option.series) && layout.xNominalCount > 0) {
            const barSeriesCount = option.series.filter((s) => s.type === "bar").length || option.series.length;
            if (barSeriesCount > 0) {
              xItemCount = Math.max(1, Math.round(layout.xNominalCount / barSeriesCount));
            }
          }
          plotW = xItemCount > 0 ? layout.xStep * xItemCount : plotW;
        }
        const boxplotMinWForLegend = estimateGroupedBoxplotMinPlotWidth(option, layout);
        if (boxplotMinWForLegend > 0) {
          plotW = Math.max(plotW, boxplotMinWForLegend);
        }
        const effectiveChartWidth = plotW + gridLeft + rightMarginPx;
        const legendLeftPx = Math.max(0, effectiveChartWidth - rightMarginPx);
        option.legend = {
          ...option.legend,
          top: legendTitle != null ? 20 : 0,
          left: legendLeftPx,
          orient: option.legend.orient || "vertical",
          align: "left",
          // icon on left, text on right
          textStyle: {
            fontSize: highCardinality ? 8 : 11,
            ...option.legend.textStyle || {}
          },
          ...legendLabels.length > 10 ? { type: "scroll" } : {},
          ...highCardinality ? { itemWidth: 12, itemHeight: 12 } : {}
        };
        if (legendTitle != null) {
          const titleGraphic = {
            type: "text",
            left: legendLeftPx,
            top: 4,
            z: 100,
            style: {
              text: legendTitle,
              fontSize: 11,
              fontWeight: "bold",
              fill: "#333",
              textAlign: "left"
            }
          };
          const existing = option.graphic;
          option.graphic = Array.isArray(existing) ? [...existing, titleGraphic] : existing ? [existing, titleGraphic] : [titleGraphic];
        }
      }
    } else {
      const rawData = option.legend.data || [];
      const legendLabels = rawData.map((d) => typeof d === "string" ? d : d?.name ?? "");
      const maxLabelLen = Math.max(...legendLabels.map((l) => l.length), 3);
      option._legendWidth = Math.min(150, maxLabelLen * 7 + 30);
    }
  }
  const hasXTitle = !!option.xAxis?.name;
  const hasYTitle = !!option.yAxis?.name;
  const CANVAS_BUFFER = 16;
  const LEGEND_GAP = 12;
  const VISUALMAP_GAP = 18;
  const VISUALMAP_RIGHT_OFFSET = 10;
  const legendWidth = hasLegend ? option._legendWidth || 120 : 20;
  const visualMapWidth = option._visualMapWidth || 0;
  if (visualMapWidth) delete option._visualMapWidth;
  const rightMargin = isDualLegend ? hasVisualMap ? VISUALMAP_RIGHT_OFFSET + visualMapWidth + VISUALMAP_GAP : 10 : (hasLegend ? legendWidth : hasVisualMap ? visualMapWidth + VISUALMAP_GAP : 10) + LEGEND_GAP;
  const bottomLegendExtra = isDualLegend ? 30 : 0;
  const gridMargin = {
    left: (hasYTitle ? 70 : 50) + CANVAS_BUFFER,
    right: rightMargin + CANVAS_BUFFER,
    top: 20 + CANVAS_BUFFER,
    bottom: (hasXTitle ? 45 : 30) + CANVAS_BUFFER + bottomLegendExtra
  };
  if (hasAxes) {
    if (!option.grid) option.grid = {};
    option.grid.left = gridMargin.left;
    option.grid.right = gridMargin.right;
    option.grid.top = gridMargin.top;
    option.grid.bottom = gridMargin.bottom;
  }
  if ((hasAxes || option.singleAxis) && !option._width) {
    const xIsDiscrete = layout.xNominalCount > 0 || layout.xContinuousAsDiscrete > 0;
    const yIsDiscrete = layout.yNominalCount > 0 || layout.yContinuousAsDiscrete > 0;
    let plotWidth;
    let plotHeight;
    if (xIsDiscrete) {
      let xItemCount = layout.xNominalCount || layout.xContinuousAsDiscrete || 0;
      if (layout.xStepUnit === "group" && option.series && Array.isArray(option.series) && layout.xNominalCount > 0) {
        const barSeriesCount = option.series.filter((s) => s.type === "bar").length || option.series.length;
        if (barSeriesCount > 0) {
          xItemCount = Math.max(1, Math.round(layout.xNominalCount / barSeriesCount));
        }
      }
      plotWidth = xItemCount > 0 ? layout.xStep * xItemCount : layout.subplotWidth || canvasSize.width;
      const boxplotMinW = estimateGroupedBoxplotMinPlotWidth(option, layout);
      if (boxplotMinW > 0) {
        plotWidth = Math.max(plotWidth, boxplotMinW);
      }
    } else {
      plotWidth = layout.subplotWidth || canvasSize.width;
    }
    if (yIsDiscrete && layout.yStepUnit !== "group") {
      const yItemCount = layout.yNominalCount || layout.yContinuousAsDiscrete || 0;
      plotHeight = yItemCount > 0 ? layout.yStep * yItemCount : layout.subplotHeight || canvasSize.height;
    } else {
      plotHeight = layout.subplotHeight || canvasSize.height;
    }
    if (context.chartType === "Pyramid Chart" && yIsDiscrete && layout.yStepUnit !== "group") {
      const yItemCount = layout.yNominalCount || layout.yContinuousAsDiscrete || 0;
      if (yItemCount > 0) {
        plotHeight = Math.max(
          plotHeight,
          pyramidPanelHeightMatchVegaLite(yItemCount, canvasSize)
        );
      }
    }
    option._width = plotWidth + gridMargin.left + gridMargin.right;
    option._height = plotHeight + gridMargin.top + gridMargin.bottom;
  }
  if (context.chartType === "Pyramid Chart") {
    placePyramidChannelHeaders(option);
  }
  if (option.series && Array.isArray(option.series)) {
    const barSeries = option.series.filter((s) => s.type === "bar");
    if (barSeries.length > 0) {
      const catAxis = option.xAxis?.type === "category" ? "x" : "y";
      const step = catAxis === "x" ? layout.xStep : layout.yStep;
      const stepUnit = catAxis === "x" ? layout.xStepUnit : layout.yStepUnit;
      const isStacked = barSeries.some((s) => s.stack != null);
      const isPyramidMirror = context.chartType === "Pyramid Chart" && barSeries.length === 2 && !isStacked;
      const isRosePolar = context.chartType === "Rose Chart" && barSeries.every((s) => s.coordinateSystem === "polar");
      if (step > 0) {
        const bandPadding = layout.stepPadding;
        const catGapPct = `${Math.round(bandPadding * 100)}%`;
        if (!isStacked && (stepUnit === "group" || barSeries.length > 1) && !isPyramidMirror && !isRosePolar) {
          const usableStep = step * (1 - bandPadding);
          const barW = Math.max(1, Math.floor(usableStep / (barSeries.length + 1)));
          for (const s of barSeries) {
            s.barWidth = barW;
            s.barGap = "0%";
          }
          barSeries[0].barCategoryGap = catGapPct;
        } else {
          for (const s of barSeries) {
            s.barCategoryGap = catGapPct;
          }
          if (isPyramidMirror) {
            for (const s of barSeries) {
              s.barGap = "-100%";
            }
          }
        }
      }
    }
  }
  if (option.xAxis && layout.xLabel) {
    if (!option.xAxis.axisLabel) option.xAxis.axisLabel = {};
    const templateRotate = option.xAxis.axisLabel.rotate;
    const isCategoryX = option.xAxis.type === "category";
    const isTimeX = option.xAxis.type === "time";
    const preserveTemplateRotate = isCategoryX && (templateRotate === 0 || templateRotate === 90) || isTimeX && templateRotate === 90;
    if (layout.xLabel.labelAngle != null && layout.xLabel.labelAngle !== 0 && !preserveTemplateRotate) {
      option.xAxis.axisLabel.rotate = -layout.xLabel.labelAngle;
    }
    if (layout.xLabel.fontSize) {
      option.xAxis.axisLabel.fontSize = layout.xLabel.fontSize;
    }
    if (layout.xLabel.labelLimit && layout.xLabel.labelLimit < 100) {
      const maxLen = layout.xLabel.labelLimit;
      option.xAxis.axisLabel.formatter = (value) => {
        if (typeof value === "string" && value.length > maxLen) {
          return value.substring(0, maxLen) + "\u2026";
        }
        return value;
      };
    }
  }
  if (option.xAxis && option.grid && option.xAxis.axisLabel) {
    const rotate = Math.abs(option.xAxis.axisLabel.rotate || 0);
    if (rotate >= 45) {
      const labelFontSize = option.xAxis.axisLabel.fontSize || 11;
      const labelLimit = layout.xLabel?.labelLimit || 20;
      const categoryData = Array.isArray(option.xAxis.data) ? option.xAxis.data : void 0;
      const actualMaxChars = categoryData && categoryData.length > 0 ? Math.max(...categoryData.map((d) => String(d?.value ?? d ?? "").length)) : labelLimit;
      const maxChars = Math.min(actualMaxChars, labelLimit);
      const estimatedLabelWidth = maxChars * labelFontSize * 0.6;
      const rotatedHeight = Math.min(estimatedLabelWidth, 120);
      const extraBottom = Math.max(0, rotatedHeight - 30);
      if (extraBottom > 0) {
        option.grid.bottom = (option.grid.bottom || 61) + extraBottom;
        if (option.xAxis.name) {
          option.xAxis.nameGap = (option.xAxis.nameGap || 25) + extraBottom;
        }
        if (option._height) {
          option._height = option._height + extraBottom;
        }
      }
    }
  }
  if (option.yAxis && layout.yLabel) {
    if (!option.yAxis.axisLabel) option.yAxis.axisLabel = {};
    if (layout.yLabel.labelAngle && layout.yLabel.labelAngle !== 0 && option.yAxis.type !== "category") {
      option.yAxis.axisLabel.rotate = -layout.yLabel.labelAngle;
    }
    if (layout.yLabel.fontSize) {
      option.yAxis.axisLabel.fontSize = layout.yLabel.fontSize;
    }
  }
  if (context.chartType === "Pyramid Chart") {
    const lineStyle = { color: "#333", width: 1 };
    const tickStyle = { color: "#333", width: 1 };
    if (option.xAxis?.type === "value") {
      const xAxis = option.xAxis;
      const rawAbs = Math.max(
        Math.abs(Number(xAxis.min) || 0),
        Math.abs(Number(xAxis.max) || 0)
      );
      if (rawAbs > 0 && Number.isFinite(rawAbs)) {
        const nice = pyramidNiceSymmetricMax(rawAbs);
        xAxis.min = -nice;
        xAxis.max = nice;
        xAxis.interval = pyramidNiceTickStep(nice);
      }
      xAxis.axisLine = { show: true, lineStyle, ...xAxis.axisLine || {} };
      xAxis.axisLine.show = true;
      xAxis.axisTick = {
        show: true,
        length: 6,
        lineStyle: tickStyle,
        ...typeof xAxis.axisTick === "object" ? xAxis.axisTick : {}
      };
      xAxis.axisTick.show = true;
      if (!xAxis.axisLabel) xAxis.axisLabel = {};
      if (xAxis.axisLabel.fontSize == null) xAxis.axisLabel.fontSize = 11;
      if (xAxis.axisLabel.color == null) xAxis.axisLabel.color = "#333";
      if (!xAxis.nameTextStyle) xAxis.nameTextStyle = { fontSize: 12, color: "#333" };
    }
    if (option.yAxis?.type === "category") {
      const yAxis = option.yAxis;
      if (yAxis.boundaryGap === void 0) yAxis.boundaryGap = true;
      yAxis.axisLine = {
        show: true,
        onZero: false,
        lineStyle,
        ...typeof yAxis.axisLine === "object" && yAxis.axisLine ? yAxis.axisLine : {}
      };
      yAxis.axisLine.show = true;
      yAxis.axisTick = {
        show: true,
        alignWithLabel: true,
        interval: 0,
        length: 6,
        lineStyle: tickStyle,
        ...typeof yAxis.axisTick === "object" && yAxis.axisTick ? yAxis.axisTick : {}
      };
      yAxis.axisTick.show = true;
      if (!yAxis.axisLabel) yAxis.axisLabel = {};
      if (yAxis.axisLabel.fontSize == null) yAxis.axisLabel.fontSize = 11;
      if (yAxis.axisLabel.color == null) yAxis.axisLabel.color = "#333";
      if (!yAxis.nameTextStyle) yAxis.nameTextStyle = { fontSize: 12, color: "#333" };
    }
  }
  for (const axis of ["x", "y"]) {
    const axisObj = option[`${axis}Axis`];
    if (!axisObj || axisObj.type !== "category") continue;
    const cs = channelSemantics[axis];
    if (!cs?.field || cs.type !== "nominal" && cs.type !== "ordinal") continue;
    const semanticType = toTypeString(context.semanticTypes[cs.field]);
    if (getVisCategory(semanticType) !== "temporal") continue;
    const fieldVals = context.table.map((r) => r[cs.field]).filter((v) => v != null);
    const datelikeCnt = fieldVals.filter(
      (v) => typeof v !== "string" || looksLikeDateString(String(v))
    ).length;
    if (datelikeCnt < fieldVals.length * 0.5) continue;
    const analysis = analyzeTemporalField(fieldVals);
    if (!analysis) continue;
    const votes = computeDataVotes(analysis.same);
    const semLevel = SEMANTIC_LEVEL[semanticType];
    if (semLevel !== void 0) votes[semLevel] += 3;
    const { level, score } = pickBestLevel(votes);
    if (score < 5) continue;
    const fmt = levelToFormat(level, analysis);
    if (!fmt) continue;
    if (!axisObj.axisLabel) axisObj.axisLabel = {};
    const existingFormatter = axisObj.axisLabel.formatter;
    axisObj.axisLabel.formatter = (value) => {
      const formatted = formatCategoryTemporal(value, fmt);
      return typeof existingFormatter === "function" ? existingFormatter(formatted) : formatted;
    };
  }
  for (const axis of ["x", "y"]) {
    const cs = channelSemantics[axis];
    if (cs?.temporalFormat && option[`${axis}Axis`]) {
      const axisObj = option[`${axis}Axis`];
      if (axisObj.type === "time") {
        if (!axisObj.axisLabel) axisObj.axisLabel = {};
        axisObj.axisLabel.formatter = convertTemporalFormat(cs.temporalFormat);
      }
      if (axisObj.type === "value" && cs.type === "temporal") {
        if (axisObj.name === "Count") continue;
        if (!axisObj.axisLabel) axisObj.axisLabel = {};
        const fmt = cs.temporalFormat;
        axisObj.axisLabel.formatter = (val) => formatTimestamp(val, fmt);
      }
    }
  }
  for (const axisKey of ["xAxis", "yAxis"]) {
    const axisVal = option[axisKey];
    if (Array.isArray(axisVal)) {
      axisVal.forEach(cleanAxisNumericFields);
    } else {
      cleanAxisNumericFields(axisVal);
    }
  }
  const enc = option._encodingTooltip;
  if (enc?.trigger === "axis" && enc.categoryLabel != null && option.xAxis?.type === "time") {
    const xFmt = channelSemantics?.x?.temporalFormat;
    if (xFmt) {
      option._encodingTooltip = { ...enc, categoryFormat: "temporal", temporalFormat: xFmt };
    }
  }
  const visualMapOwnsSeriesColor = context.chartType === "Heatmap" && !!option.visualMap;
  const decisions = context.colorDecisions;
  const colorDecision = decisions ? decisions.color ?? decisions.group : void 0;
  let effectivePalette;
  if (decisions && colorDecision) {
    let palette;
    const isCategoricalScheme = colorDecision.schemeType === "categorical";
    if (isCategoricalScheme) {
      const fromResolved = context.resolvedEncodings?.color?.colorPalette ?? context.resolvedEncodings?.group?.colorPalette;
      if (colorDecision.schemeId) {
        const fromRegistry = getPaletteForScheme(colorDecision.schemeId);
        if (fromRegistry && fromRegistry.length > 0) {
          palette = fromRegistry;
        }
      }
      if (!palette) {
        const targetId = (colorDecision.categoryCount ?? 0) > 10 ? "cat20" : "cat10";
        palette = getPaletteForScheme(targetId) ?? (fromResolved && fromResolved.length > 0 ? fromResolved : DEFAULT_COLORS);
      }
    } else {
      if (colorDecision.schemeId) {
        const fromRegistry = getPaletteForScheme(colorDecision.schemeId);
        if (fromRegistry && fromRegistry.length > 0) {
          palette = fromRegistry;
        }
      }
      if (!palette) {
        if (colorDecision.schemeType === "sequential") {
          palette = getPaletteForScheme("viridis") ?? DEFAULT_COLORS;
        } else if (colorDecision.schemeType === "diverging") {
          palette = getPaletteForScheme("RdBu") ?? DEFAULT_COLORS;
        } else {
          palette = DEFAULT_COLORS;
        }
      }
    }
    if (palette && palette.length) {
      option.color = [...palette];
      effectivePalette = palette;
    }
  } else {
    const colorPalette = context.resolvedEncodings?.color?.colorPalette ?? context.resolvedEncodings?.group?.colorPalette;
    if (colorPalette?.length) {
      option.color = [...colorPalette];
      effectivePalette = colorPalette;
    }
  }
  if (!effectivePalette || effectivePalette.length === 0) {
    const cat10 = getPaletteForScheme("cat10");
    if (cat10 && cat10.length > 0) {
      effectivePalette = cat10;
      if (!option.color) {
        option.color = [...cat10];
      }
    }
  }
  if (visualMapOwnsSeriesColor) {
    delete option.color;
    effectivePalette = void 0;
  }
  if (effectivePalette && effectivePalette.length > 0 && Array.isArray(option.series)) {
    const palette_ = effectivePalette;
    const n = palette_.length;
    const schemeType = colorDecision?.schemeType;
    let drivingColorChannel;
    if (decisions?.color && channelSemantics.color) {
      drivingColorChannel = channelSemantics.color;
    } else if (decisions?.group && channelSemantics.group) {
      drivingColorChannel = channelSemantics.group;
    }
    const colorSemanticType = drivingColorChannel?.semanticAnnotation?.semanticType;
    const isRankLikeColor = !!colorSemanticType && colorSemanticType === "Rank";
    const useEvenSpacing = !isRankLikeColor && (schemeType === "sequential" || schemeType === "diverging");
    if (context.chartType === "Regression" && option.legend && Array.isArray(option.legend.data)) {
      const legendLabels = option.legend.data.map(
        (d) => typeof d === "string" ? d : d?.name ?? ""
      );
      const categoryToColor = /* @__PURE__ */ new Map();
      if (useEvenSpacing) {
        const spacedLegendIndices = pickEvenlySpacedColorIndices(n, legendLabels.length);
        legendLabels.forEach((name, i) => {
          if (!name) return;
          const paletteIndex = spacedLegendIndices[i] ?? i % n;
          categoryToColor.set(name, palette_[paletteIndex]);
        });
      } else {
        let colorIdx = 0;
        for (const name of legendLabels) {
          if (!name) continue;
          categoryToColor.set(name, palette_[colorIdx % n]);
          colorIdx += 1;
        }
      }
      option.series.forEach((s, idx) => {
        if (!s) return;
        const rawName = typeof s.name === "string" ? s.name : "";
        const baseName = rawName.endsWith(" (trend)") ? rawName.slice(0, -" (trend)".length) : rawName;
        const mappedColor = baseName && categoryToColor.has(baseName) ? categoryToColor.get(baseName) : palette_[idx % n];
        s.itemStyle = s.itemStyle || {};
        s.itemStyle.color = mappedColor;
      });
    } else if (context.chartType === "Boxplot" && option.legend && Array.isArray(option.legend.data)) {
      const legendLabels = option.legend.data.map(
        (d) => typeof d === "string" ? d : d?.name ?? ""
      );
      const categoryToColor = /* @__PURE__ */ new Map();
      legendLabels.forEach((name, i) => {
        if (!name) return;
        categoryToColor.set(name, palette_[i % n]);
      });
      option.series.forEach((s, idx) => {
        if (!s) return;
        const rawName = typeof s.name === "string" ? s.name : s.name != null ? String(s.name) : "";
        const baseName = rawName.endsWith(" (outliers)") ? rawName.slice(0, -" (outliers)".length) : rawName;
        const mappedColor = baseName && categoryToColor.has(baseName) ? categoryToColor.get(baseName) : palette_[idx % n];
        s.itemStyle = s.itemStyle || {};
        s.itemStyle.color = mappedColor;
        if (s.type === "boxplot") {
          s.itemStyle.borderColor = mappedColor;
        }
      });
    } else if (context.chartType === "Pyramid Chart" && Array.isArray(option.series)) {
      const pal = effectivePalette && effectivePalette.length > 0 ? effectivePalette : DEFAULT_COLORS;
      const cLeft = pal[0];
      const cRight = pal.length > 3 ? pal[3] : pal[Math.min(1, pal.length - 1)];
      let barIdx = 0;
      for (const s of option.series) {
        if (!s || s.type !== "bar") continue;
        s.itemStyle = s.itemStyle || {};
        s.itemStyle.color = barIdx === 0 ? cLeft : cRight;
        barIdx += 1;
        if (barIdx >= 2) break;
      }
    } else if (context.chartType === "Rose Chart" && Array.isArray(option.series)) {
      const polarBars = option.series.filter(
        (s) => s && s.type === "bar" && s.coordinateSystem === "polar"
      );
      const stacked = polarBars.some((s) => s.stack != null && s.stack !== "");
      const single = polarBars.length === 1 && !stacked;
      if (single && Array.isArray(polarBars[0].data)) {
        const legendLabels = option.legend?.data?.map(
          (d) => typeof d === "string" ? d : d?.name ?? ""
        ) ?? [];
        const categoryToColor = /* @__PURE__ */ new Map();
        legendLabels.forEach((name, i) => {
          if (!name) return;
          categoryToColor.set(name, effectivePalette[i % n]);
        });
        const s0 = polarBars[0];
        s0.data.forEach((item, i) => {
          const rawName = typeof item === "object" && item != null && typeof item.name === "string" ? item.name : legendLabels[i] ?? "";
          const mapped = rawName && categoryToColor.has(rawName) ? categoryToColor.get(rawName) : effectivePalette[i % n];
          const color = mapped;
          if (item != null && typeof item === "object") {
            item.itemStyle = item.itemStyle || {};
            if (item.itemStyle.color == null) item.itemStyle.color = color;
          } else {
            s0.data[i] = { value: item, name: String(rawName || i), itemStyle: { color } };
          }
        });
        const bridge = option.series.find(
          (s) => s && s.type === "pie" && s.name === EC_ROSE_LEGEND_BRIDGE_SERIES_NAME
        );
        if (bridge && Array.isArray(bridge.data)) {
          bridge.data.forEach((item, i) => {
            const rawName = typeof item === "object" && item != null && typeof item.name === "string" ? item.name : "";
            const color = (rawName && categoryToColor.get(rawName)) ?? effectivePalette[i % n];
            if (item != null && typeof item === "object") {
              item.itemStyle = item.itemStyle || {};
              if (item.itemStyle.color == null) item.itemStyle.color = color;
            }
          });
        }
        if (option.legend) {
          const order = Array.isArray(option.angleAxis?.data) && option.angleAxis.data.length > 0 ? option.angleAxis.data.map((c) => String(c)) : legendLabels.filter(Boolean);
          const names = order.length > 0 ? order : s0.data.map((item, j) => typeof item === "object" && item != null && item.name != null ? String(item.name) : String(j));
          names.forEach((name, i) => {
            if (!name || categoryToColor.has(name)) return;
            categoryToColor.set(name, effectivePalette[i % n]);
          });
          option.legend.show = true;
          option.legend.selectedMode = false;
          option.legend.data = names;
        }
      }
    } else {
      const colorByDataItem = context.chartType === "Pie Chart" || context.chartType === "Rose Chart" || context.chartType === "Streamgraph" || context.chartType === "Sunburst Chart";
      if (colorByDataItem) ; else if (context.chartType === "Radar Chart") {
        const legendLabels = option.legend?.data?.map(
          (d) => typeof d === "string" ? d : d?.name ?? ""
        ) ?? [];
        const categoryToColor = /* @__PURE__ */ new Map();
        legendLabels.forEach((name, i) => {
          if (!name) return;
          categoryToColor.set(name, palette_[i % n]);
        });
        const radarSeries = Array.isArray(option.series) ? option.series.find((s) => s && s.type === "radar") : null;
        if (radarSeries && Array.isArray(radarSeries.data)) {
          radarSeries.data.forEach((item, i) => {
            if (!item) return;
            const rawName = typeof item.name === "string" ? item.name : "";
            const mapped = rawName && categoryToColor.has(rawName) ? categoryToColor.get(rawName) : palette_[i % n];
            const color = mapped;
            item.itemStyle = item.itemStyle || {};
            if (item.itemStyle.color == null) item.itemStyle.color = color;
            item.areaStyle = item.areaStyle || {};
            if (item.areaStyle.color == null) item.areaStyle.color = color;
            item.lineStyle = item.lineStyle || {};
            if (item.lineStyle.color == null) item.lineStyle.color = color;
          });
        }
      } else {
        const hasLegend2 = !!option.legend && Array.isArray(option.legend.data);
        const rankLegendColorMap = isRankLikeColor && hasLegend2 ? buildRankColorLookupFromLegend(option.legend.data, palette_) : /* @__PURE__ */ new Map();
        const colorableCount = option.series.filter((s) => s && s.itemStyle?.color == null).length;
        const spacedIndices = useEvenSpacing && colorableCount > 0 ? pickEvenlySpacedColorIndices(n, colorableCount) : null;
        let colorIdx = 0;
        option.series.forEach((s, idx) => {
          if (!s) return;
          s.itemStyle = s.itemStyle || {};
          if (s.itemStyle.color != null) return;
          if (isRankLikeColor && rankLegendColorMap.size > 0) {
            const rawName = typeof s.name === "string" ? s.name : s.name != null ? String(s.name) : "";
            const mapped = rawName ? rankLegendColorMap.get(rawName) : void 0;
            if (mapped) {
              s.itemStyle.color = mapped;
              if (s.type === "boxplot") s.itemStyle.borderColor = mapped;
              colorIdx += 1;
              return;
            }
          }
          const paletteIndex = spacedIndices ? spacedIndices[colorIdx] ?? colorIdx % n : colorIdx % n;
          const color = palette_[paletteIndex];
          s.itemStyle.color = color;
          if (s.type === "boxplot") {
            s.itemStyle.borderColor = color;
          }
          colorIdx += 1;
        });
      }
    }
  }
  if (layout.truncations && layout.truncations.length > 0) {
    const axisPlaceholders = { xAxis: /* @__PURE__ */ new Set(), yAxis: /* @__PURE__ */ new Set() };
    for (const trunc of layout.truncations) {
      warnings.push({
        severity: "warning",
        code: "overflow",
        message: trunc.message,
        channel: trunc.channel,
        field: trunc.field
      });
      const axisKey = trunc.channel === "x" ? "xAxis" : "yAxis";
      if (trunc.channel === "x" || trunc.channel === "y") {
        axisPlaceholders[axisKey].add(trunc.placeholder);
        if (option[axisKey]?.data && Array.isArray(option[axisKey].data)) {
          option[axisKey].data.push(trunc.placeholder);
        }
      }
    }
    for (const axisKey of ["xAxis", "yAxis"]) {
      const placeholders = axisPlaceholders[axisKey];
      if (placeholders.size === 0 || !option[axisKey]) continue;
      if (!option[axisKey].axisLabel) option[axisKey].axisLabel = {};
      const existingColor = option[axisKey].axisLabel.color;
      option[axisKey].axisLabel.color = (params) => placeholders.has(params) ? "#999999" : typeof existingColor === "function" ? existingColor(params) : existingColor ?? "#000";
    }
  }
}
function convertTemporalFormat(d3Format) {
  return d3Format.replace(/%Y/g, "{yyyy}").replace(/%y/g, "{yy}").replace(/%b/g, "{MMM}").replace(/%B/g, "{MMMM}").replace(/%m/g, "{MM}").replace(/%d/g, "{dd}").replace(/%H/g, "{HH}").replace(/%M/g, "{mm}").replace(/%S/g, "{ss}");
}
var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var MONTH_FULL2 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function formatCategoryTemporal(value, d3Format) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return formatTimestamp(d.getTime(), d3Format);
}
function formatTimestamp(val, d3Format) {
  const d = new Date(val);
  const pad = (n) => n < 10 ? "0" + n : String(n);
  return d3Format.replace(/%Y/g, String(d.getFullYear())).replace(/%y/g, String(d.getFullYear()).slice(-2)).replace(/%B/g, MONTH_FULL2[d.getMonth()]).replace(/%b/g, MONTH_ABBR[d.getMonth()]).replace(/%m/g, pad(d.getMonth() + 1)).replace(/%d/g, pad(d.getDate())).replace(/%H/g, pad(d.getHours())).replace(/%M/g, pad(d.getMinutes())).replace(/%S/g, pad(d.getSeconds()));
}
function fmtNumForTooltip(v) {
  if (v == null) return "";
  const n = Number(v);
  return isNaN(n) ? String(v) : Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function buildEncodingTooltipFormatter(option) {
  const enc = option._encodingTooltip;
  if (!enc) return null;
  if (enc.trigger === "axis" && enc.categoryLabel != null) {
    const categoryLabel = enc.categoryLabel;
    const valueLabel = enc.valueLabel ?? "Value";
    const categoryFormat = enc.categoryFormat;
    const temporalFormat = enc.temporalFormat ?? "%b %d, %Y";
    const filterScatterOnly = !!enc.filterScatterOnly;
    return (params) => {
      const rawList = Array.isArray(params) ? params : [params];
      const list = filterScatterOnly ? rawList.filter((item) => item && item.seriesType === "scatter") : rawList;
      if (list.length === 0) return "";
      const p = list[0];
      let cat;
      const rawCat = p.axisValue ?? p.name ?? "";
      if (categoryFormat === "temporal" && (rawCat !== "" && rawCat != null)) {
        const ts = typeof rawCat === "number" ? rawCat : new Date(rawCat).getTime();
        cat = Number.isFinite(ts) ? formatTimestamp(ts, temporalFormat) : String(rawCat);
      } else {
        cat = String(rawCat);
      }
      const parts2 = [`${categoryLabel}: ${cat}`];
      for (const item of list) {
        const name = item.seriesName ?? valueLabel;
        let val = item.value != null ? item.value : Array.isArray(item.data) ? item.data[item.dataIndex] : item.data;
        if (Array.isArray(val) && val.length >= 2) val = val[1];
        parts2.push(`${name}: ${fmtNumForTooltip(val)}`);
      }
      return parts2.join("<br/>");
    };
  }
  const parts = enc.parts;
  if (!parts || !Array.isArray(parts) || parts.length === 0) return null;
  return (params) => {
    if (params == null) return "";
    const d = Array.isArray(params.data) ? params.data : params.data != null ? [params.data] : [];
    const out = [];
    for (const p of parts) {
      let val;
      if (p.from === "series") {
        val = params.seriesName ?? params.name;
      } else if (p.from === "name") {
        val = params.name;
      } else if (p.from === "value") {
        val = params.value;
      } else {
        const idx = p.index ?? 0;
        val = d[idx];
        if (val != null && typeof val === "object" && "value" in val) val = val.value;
      }
      if (val == null && p.from !== "series" && p.from !== "name") continue;
      let str;
      if (p.format === "temporal") {
        const ts = typeof val === "number" ? val : new Date(val).getTime();
        str = Number.isFinite(ts) ? formatTimestamp(ts, p.temporalFormat ?? "%b %d, %Y") : String(val ?? "");
      } else if (p.format === "category" && p.categoryNames) {
        const i = Number(val);
        str = Number.isInteger(i) && p.categoryNames[i] != null ? p.categoryNames[i] : String(val ?? "");
      } else if (p.format === "number" || p.from === "data" && p.format !== "category") {
        str = fmtNumForTooltip(val);
      } else {
        str = String(val ?? "");
      }
      out.push(`${p.label}: ${str}`);
    }
    return out.join("<br/>");
  };
}
function ecApplyTooltips(option) {
  if (!option.tooltip) {
    option.tooltip = {};
  }
  const encodingFormatter = buildEncodingTooltipFormatter(option);
  if (encodingFormatter) {
    delete option._encodingTooltip;
    option.tooltip.formatter = encodingFormatter;
  }
  if (!option.tooltip.trigger) {
    const hasScatter = option.series?.some((s) => s.type === "scatter");
    const hasPie = option.series?.some((s) => s.type === "pie");
    const hasRadar = option.series?.some((s) => s.type === "radar");
    const hasHeatmap = option.series?.some((s) => s.type === "heatmap");
    const hasCandlestick = option.series?.some((s) => s.type === "candlestick");
    const hasThemeRiver = option.series?.some((s) => s.type === "themeRiver");
    option.tooltip.trigger = hasScatter || hasPie || hasRadar || hasHeatmap || hasThemeRiver ? "item" : "axis";
    if (hasCandlestick && !option.tooltip.axisPointer) {
      option.tooltip.axisPointer = { type: "cross" };
    }
    if (hasThemeRiver && !option.tooltip.formatter) {
      option.tooltip.formatter = (params) => {
        if (!params || !params.data) return "";
        const [date, value, name] = params.data;
        const color = params.color || "#333";
        const dateStr = date instanceof Date ? date.toLocaleDateString() : String(date);
        return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;"></span><b>${name}</b><br/>${dateStr}: ${value}`;
      };
    }
  }
}

// src/echarts/templates/scatter.ts
function computeSymbolSize(width, height, pointCount) {
  const canvasArea = width * height;
  const areaPerPoint = canvasArea / Math.max(1, pointCount);
  const idealDiameter = Math.sqrt(areaPerPoint * 0.05);
  return Math.max(3, Math.min(12, Math.round(idealDiameter)));
}
var ecScatterPlotDef = {
  chart: "Scatter Plot",
  template: { mark: "circle", encoding: {} },
  // skeleton for compatibility
  channels: ["x", "y", "color", "size", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const xField = channelSemantics.x?.field;
    const yField = channelSemantics.y?.field;
    const colorField = channelSemantics.color?.field;
    const sizeField = channelSemantics.size?.field;
    const sizeRange = ctx.resolvedEncodings?.size?.sizeRange;
    const sizeType = channelSemantics.size?.type;
    if (!xField || !yField) return;
    const EC_SIZE_MIN = 4;
    const EC_SIZE_MAX = 30;
    let rangeMin = Math.max(EC_SIZE_MIN, Math.min(EC_SIZE_MAX, sizeRange?.[0] ?? 6));
    let rangeMaxClamped = Math.max(EC_SIZE_MIN, Math.min(EC_SIZE_MAX, sizeRange?.[1] ?? 20));
    rangeMaxClamped = Math.max(rangeMin, rangeMaxClamped);
    if (rangeMaxClamped <= rangeMin) {
      rangeMin = EC_SIZE_MIN;
      rangeMaxClamped = EC_SIZE_MAX;
    }
    const sizeUniqueCount = sizeField && table.length > 0 ? new Set(table.map((r) => String(r[sizeField]))).size : 0;
    const sizeValuesSample = sizeField && table.length > 0 ? table.slice(0, 50).map((r) => r[sizeField]).filter((v) => v != null) : [];
    const allSizeValuesNumeric = sizeValuesSample.length > 0 && sizeValuesSample.every((v) => !isNaN(Number(v)) && String(v).trim() !== "");
    const useOrdinalSize = sizeType === "ordinal" || sizeType === "nominal" || sizeType === "quantitative" && sizeUniqueCount >= 2 && sizeUniqueCount <= 12 || sizeField && sizeUniqueCount >= 2 && sizeUniqueCount <= 12 && !allSizeValuesNumeric;
    let scaleSize;
    let sizeOrderForLegend;
    let sizeDomainMin;
    let sizeDomainMax;
    if (useOrdinalSize && sizeField) {
      const sizeOrder = extractCategories(table, sizeField, getCategoryOrder(ctx, "size"));
      sizeOrderForLegend = sizeOrder;
      const orderMap = new Map(sizeOrder.map((val, i) => [String(val), i]));
      const n = sizeOrder.length;
      scaleSize = (raw) => {
        if (raw == null) return rangeMin;
        const key = String(raw);
        const index = orderMap.get(key);
        if (index === void 0) return rangeMin;
        const t = n > 1 ? index / (n - 1) : 0;
        return Math.round(rangeMin + t * (rangeMaxClamped - rangeMin));
      };
    } else if (sizeField) {
      const vals = table.map((r) => r[sizeField]).map((v) => v != null ? Number(v) : NaN).filter((v) => !isNaN(v));
      const sizeMin = vals.length ? Math.min(...vals) : 0;
      const sizeMax = vals.length ? Math.max(...vals) : 1;
      sizeDomainMin = sizeMin;
      sizeDomainMax = sizeMax;
      scaleSize = (raw) => {
        const v = raw != null ? Number(raw) : NaN;
        if (isNaN(v)) return rangeMin;
        let t;
        if (sizeMax === sizeMin) t = 0.5;
        else {
          const sqrtMin = Math.sqrt(Math.max(0, sizeMin));
          const sqrtMax = Math.sqrt(Math.max(0, sizeMax));
          const sqrtV = Math.sqrt(Math.max(0, v));
          t = (sqrtV - sqrtMin) / (sqrtMax - sqrtMin);
        }
        t = Math.max(0, Math.min(1, t));
        return Math.round(rangeMin + t * (rangeMaxClamped - rangeMin));
      };
    } else {
      scaleSize = () => rangeMin;
    }
    const usePiecewiseSizeVisualMap = sizeOrderForLegend && sizeOrderForLegend.length > 0 && sizeField;
    const useContinuousSizeVisualMap = sizeField != null && sizeDomainMin !== void 0 && sizeDomainMax !== void 0;
    const useVisualMapForSize = usePiecewiseSizeVisualMap || useContinuousSizeVisualMap;
    const xType = channelSemantics.x?.type;
    const yType = channelSemantics.y?.type;
    const xIsCategorical = xType === "nominal" || xType === "ordinal";
    const yIsCategorical = yType === "nominal" || yType === "ordinal";
    const xCategories = xIsCategorical ? extractCategories(table, xField, getCategoryOrder(ctx, "x")) : [];
    const yCategories = yIsCategorical ? extractCategories(table, yField, getCategoryOrder(ctx, "y")) : [];
    const xCategoryToIndex = new Map(xCategories.map((c, i) => [String(c), i]));
    const yCategoryToIndex = new Map(yCategories.map((c, i) => [String(c), i]));
    const option = {
      tooltip: { trigger: "item" },
      xAxis: xIsCategorical ? {
        type: "category",
        data: xCategories,
        name: xField,
        nameLocation: "middle",
        nameGap: 30,
        axisLabel: { interval: 0, rotate: 90 },
        axisTick: { show: true, alignWithLabel: true },
        axisLine: { show: true }
      } : { type: "value", name: xField, nameLocation: "middle", nameGap: 30 },
      yAxis: yIsCategorical ? {
        type: "category",
        data: yCategories,
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisLabel: { interval: 0, rotate: 0 },
        axisTick: { show: true, alignWithLabel: true },
        axisLine: { show: true }
      } : { type: "value", name: yField, nameLocation: "middle", nameGap: 40 },
      series: []
    };
    if (usePiecewiseSizeVisualMap) {
      option.visualMap = [
        {
          type: "piecewise",
          show: false,
          dimension: 2,
          pieces: sizeOrderForLegend.map((name) => ({
            value: name,
            symbolSize: scaleSize(name)
          })),
          orient: "vertical",
          right: 10,
          top: "center",
          itemGap: 8,
          itemSymbol: "circle",
          formatter: (value) => value,
          title: sizeField
        }
      ];
      option._visualMapWidth = 88;
      const ordLegendRight = 28;
      const ordGap = 8;
      const ordRowGap = 6;
      const ordFontSize = 10;
      const ordTitleHeight = 20;
      const ordLabelWidth = 44;
      const canvasH = ctx.canvasSize?.height ?? 300;
      const maxCircleR = Math.max(...sizeOrderForLegend.map((name) => scaleSize(name) / 2));
      const legendWidth = ordLabelWidth + ordGap + 2 * maxCircleR;
      const hasColorEncoding = !!channelSemantics.color?.field;
      const fallbackPalette = getPaletteForScheme("cat10") ?? DEFAULT_COLORS;
      const fallbackColor = fallbackPalette[0];
      const scatterColor = hasColorEncoding ? "#cccccc" : ctx.resolvedEncodings?.color?.colorPalette?.[0] ?? fallbackColor;
      const rowHeights = sizeOrderForLegend.map((name) => Math.max(scaleSize(name), 16) + ordRowGap);
      const totalLegendHeight = ordTitleHeight + rowHeights.reduce((a, b) => a + b, 0);
      const ordLegendTop = Math.max(10, (canvasH - totalLegendHeight) / 2);
      const legendChildren = [
        {
          type: "text",
          left: 0,
          top: 0,
          style: {
            text: sizeField,
            fontSize: 11,
            fontWeight: "bold",
            fill: "#333",
            textAlign: "left"
          }
        }
      ];
      let rowTop = ordTitleHeight;
      for (let i = 0; i < sizeOrderForLegend.length; i++) {
        const name = sizeOrderForLegend[i];
        const r = scaleSize(name) / 2;
        const rowH = rowHeights[i];
        const circleTop = rowTop + (rowH - scaleSize(name)) / 2;
        const textTop = rowTop + (rowH - ordFontSize) / 2;
        legendChildren.push({
          type: "circle",
          left: maxCircleR - r,
          top: circleTop - r,
          shape: { cx: r, cy: r, r },
          style: { fill: scatterColor }
        });
        legendChildren.push({
          type: "text",
          left: 2 * maxCircleR + ordGap,
          top: textTop,
          style: {
            text: name,
            fontSize: ordFontSize,
            fill: "#333",
            textAlign: "left"
          }
        });
        rowTop += rowH;
      }
      const ordLegendGraphic = {
        type: "group",
        right: ordLegendRight,
        top: ordLegendTop,
        width: legendWidth,
        z: 100,
        children: legendChildren
      };
      const existingGraphic = option.graphic;
      option.graphic = Array.isArray(existingGraphic) ? [...existingGraphic, ordLegendGraphic] : existingGraphic ? [existingGraphic, ordLegendGraphic] : [ordLegendGraphic];
    } else if (useContinuousSizeVisualMap) {
      const SIZE_SPREAD_MIN = 20;
      const sizeMaxForMap = Math.max(rangeMaxClamped, rangeMin + SIZE_SPREAD_MIN);
      const fmtSize = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1);
      const sizeVisualMap = {
        type: "continuous",
        show: true,
        min: sizeDomainMin,
        max: sizeDomainMax,
        dimension: 2,
        inRange: { symbolSize: [rangeMin, sizeMaxForMap] },
        orient: "vertical",
        right: 50,
        top: "10.0%",
        bottom: "10.0%",
        padding: 0,
        itemGap: 0,
        text: [fmtSize(sizeDomainMax), fmtSize(sizeDomainMin)],
        textStyle: { fontSize: 10 },
        seriesIndex: 0,
        name: sizeField
      };
      const hasColorEncoding = !!colorField;
      if (hasColorEncoding) {
        sizeVisualMap.controller = {
          inRange: {
            color: ["#888"]
          }
        };
      } else {
        const basePalette = ctx.resolvedEncodings?.color?.colorPalette ?? getPaletteForScheme("cat10") ?? DEFAULT_COLORS;
        const baseColor = basePalette[0];
        sizeVisualMap.controller = {
          inRange: {
            color: [baseColor]
          }
        };
      }
      if (option.visualMap) {
        option.visualMap.push(sizeVisualMap);
      } else {
        option.visualMap = [sizeVisualMap];
      }
      option._visualMapWidth = 70;
      option.graphic = option.graphic || [];
      const existingGraphic = Array.isArray(option.graphic) ? option.graphic : [option.graphic];
      option.graphic = [
        ...existingGraphic,
        {
          type: "text",
          right: 50,
          top: 10,
          z: 100,
          style: {
            text: sizeField,
            fontSize: 11,
            fontWeight: "bold",
            fill: "#333",
            textAlign: "right"
          }
        }
      ];
    }
    if (!xIsCategorical) {
      option.xAxis.scale = channelSemantics.x?.zero ? !channelSemantics.x.zero.zero : true;
    }
    if (!yIsCategorical) {
      option.yAxis.scale = channelSemantics.y?.zero ? !channelSemantics.y.zero.zero : true;
    }
    const opacity = chartProperties?.opacity ?? 1;
    const xVal = (row) => xIsCategorical ? xCategoryToIndex.get(String(row[xField] ?? "")) ?? 0 : row[xField];
    const yVal = (row) => yIsCategorical ? yCategoryToIndex.get(String(row[yField] ?? "")) ?? 0 : row[yField];
    const pointData = (row) => sizeField != null ? [xVal(row), yVal(row), row[sizeField]] : [xVal(row), yVal(row)];
    const colorPalette = ctx.resolvedEncodings?.color?.colorPalette ?? ctx.resolvedEncodings?.group?.colorPalette ?? DEFAULT_COLORS;
    const legendOpts = ctx.resolvedEncodings?.color ?? ctx.resolvedEncodings?.group;
    const colorType = channelSemantics.color?.type ?? ctx.resolvedEncodings?.color?.type;
    const isTemporalColor = colorField && colorType === "temporal";
    const isContinuousColor2 = colorField && (colorType === "quantitative" || colorType === "temporal");
    if (isContinuousColor2) {
      const colorDim = sizeField != null ? 3 : 2;
      const toColorVal = isTemporalColor ? (v) => v != null ? new Date(v).getTime() : NaN : (v) => v != null ? Number(v) : NaN;
      const pointDataWithColor = (row) => {
        const x = xVal(row);
        const y = yVal(row);
        const c = toColorVal(row[colorField]);
        if (sizeField != null) return [x, y, row[sizeField], c];
        return [x, y, c];
      };
      const colorVals = table.map((r) => toColorVal(r[colorField])).filter((v) => !isNaN(v));
      const colorMin = colorVals.length ? Math.min(...colorVals) : isTemporalColor ? Date.now() : 0;
      const colorMax = colorVals.length ? Math.max(...colorVals) : isTemporalColor ? Date.now() : 1;
      const scheme = ctx.encodings?.color?.scheme ?? "";
      const defaultGrayRange = ["#f5f5f5", "#e0e0e0", "#9e9e9e", "#616161", "#424242"];
      const greensRange = ["#f7fcf5", "#c7e9c0", "#41ab5d", "#006d2c", "#00441b"];
      const decisionSchemeId = colorDecisions?.color?.schemeId ?? colorDecisions?.group?.schemeId;
      const paletteFromDecision = decisionSchemeId ? getPaletteForScheme(decisionSchemeId) : void 0;
      const inRange = paletteFromDecision && paletteFromDecision.length > 0 ? paletteFromDecision : /green/i.test(scheme) ? greensRange : colorPalette.length >= 2 ? [colorPalette[colorPalette.length - 1], colorPalette[0]] : defaultGrayRange;
      const VM_BAR_RIGHT = 50;
      const VM_BAR_WIDTH = 70;
      const VM_GAP = 16;
      const VM_TITLE_TOP = 10;
      const VM_FONT_SIZE = 10;
      const REF_H = 400;
      const VM_BAR_TOP_PX = 40;
      const VM_BAR_BOTTOM_PX = 40;
      const VM_TOP_PCT = (VM_BAR_TOP_PX / REF_H * 100).toFixed(1) + "%";
      const VM_BOTTOM_PCT = (VM_BAR_BOTTOM_PX / REF_H * 100).toFixed(1) + "%";
      const hasSizeVisualMap = option.visualMap && Array.isArray(option.visualMap) && option.visualMap.some((vm) => vm.inRange?.symbolSize != null);
      const colorBarRight = hasSizeVisualMap ? VM_BAR_RIGHT + VM_BAR_WIDTH + VM_GAP : VM_BAR_RIGHT;
      const temporalFormat2 = channelSemantics.color?.temporalFormat ?? "%b %d, %Y";
      const formatColorLabel = (val) => isTemporalColor ? formatTimestamp(val, temporalFormat2) : String(val);
      const colorVisualMap = {
        type: "continuous",
        min: colorMin,
        max: colorMax,
        dimension: colorDim,
        inRange: { color: inRange },
        orient: "vertical",
        right: colorBarRight,
        top: VM_TOP_PCT,
        bottom: VM_BOTTOM_PCT,
        padding: 0,
        itemGap: 0,
        text: [formatColorLabel(colorMax), formatColorLabel(colorMin)],
        formatter: formatColorLabel,
        textStyle: { fontSize: VM_FONT_SIZE },
        show: true,
        seriesIndex: 0,
        name: colorField
      };
      if (option.visualMap) {
        option.visualMap.push(colorVisualMap);
      } else {
        option.visualMap = colorVisualMap;
      }
      option._visualMapWidth = hasSizeVisualMap ? VM_BAR_WIDTH + VM_GAP + VM_BAR_WIDTH : VM_BAR_WIDTH;
      const vmGraphics = [
        {
          type: "text",
          right: colorBarRight,
          top: VM_TITLE_TOP,
          z: 100,
          style: {
            text: colorField,
            fontSize: 11,
            fontWeight: "bold",
            fill: "#333",
            textAlign: "right"
          }
        }
      ];
      const existingGraphic = option.graphic;
      option.graphic = Array.isArray(existingGraphic) ? [...existingGraphic, ...vmGraphics] : existingGraphic ? [existingGraphic, ...vmGraphics] : vmGraphics;
      const data = table.map((row) => pointDataWithColor(row));
      const seriesOpt = {
        type: "scatter",
        data,
        itemStyle: { opacity }
      };
      if (sizeField != null && !useVisualMapForSize) {
        seriesOpt.symbolSize = (value) => scaleSize(Array.isArray(value) ? value[2] : value);
      }
      option.series.push(seriesOpt);
    } else if (colorField) {
      const colorOrder = extractCategories(table, colorField, getCategoryOrder(ctx, "color"));
      const groups = /* @__PURE__ */ new Map();
      for (const row of table) {
        const key = String(row[colorField] ?? "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(pointData(row));
      }
      const legendNames = colorOrder.length > 0 ? colorOrder : [...groups.keys()];
      const hasSizeBySeries = sizeField != null && !useVisualMapForSize;
      option.legend = {
        data: legendNames.map((name) => {
          const data = groups.get(name) ?? [];
          if (!hasSizeBySeries || data.length === 0) return name;
          const sizes = data.map((d) => d.length >= 3 ? scaleSize(d[2]) : rangeMin);
          sizes.sort((a, b) => a - b);
          const medianSize = sizes[Math.floor(sizes.length / 2)] ?? rangeMin;
          return { name, symbolSize: medianSize, itemStyle: { symbolSize: medianSize } };
        }),
        show: true
      };
      option._legendTitle = colorField;
      if (legendOpts?.legendSymbolSize != null && !hasSizeBySeries) {
        option.legend.itemWidth = legendOpts.legendSymbolSize;
        option.legend.itemHeight = legendOpts.legendSymbolSize;
        option.legend.itemGap = 8;
      }
      if (legendOpts?.legendLabelFontSize != null) {
        option.legend.textStyle = option.legend.textStyle ?? {};
        option.legend.textStyle.fontSize = legendOpts.legendLabelFontSize;
      }
      legendNames.forEach((name) => {
        const data = groups.get(name) ?? [];
        if (data.length === 0) return;
        const seriesOpt = {
          name,
          type: "scatter",
          data,
          // 不在模板中显式设置颜色，交由 ecApplyLayoutToSpec 使用
          // colorDecisions / colormap（通常是 cat10）统一分配。
          itemStyle: {
            opacity
          }
        };
        if (hasSizeBySeries) {
          seriesOpt.symbolSize = (value) => scaleSize(Array.isArray(value) ? value[2] : value);
        }
        option.series.push(seriesOpt);
      });
    } else {
      const data = table.map((row) => pointData(row));
      const seriesOpt = {
        type: "scatter",
        data,
        itemStyle: { opacity }
      };
      if (sizeField != null && !useVisualMapForSize) {
        seriesOpt.symbolSize = (value) => scaleSize(Array.isArray(value) ? value[2] : value);
      } else if (useContinuousSizeVisualMap && sizeDomainMin !== void 0 && sizeDomainMax !== void 0) {
        const SIZE_SPREAD_MIN = 20;
        const sizeSpread = Math.max(rangeMaxClamped - rangeMin, SIZE_SPREAD_MIN);
        const sizeMaxMapped = rangeMin + sizeSpread;
        seriesOpt.symbolSize = (value) => {
          const v = Array.isArray(value) ? value[2] : value;
          const num = Number(v);
          if (v == null || isNaN(num)) return rangeMin;
          const span = sizeDomainMax - sizeDomainMin;
          const t = span <= 0 ? 0.5 : Math.max(0, Math.min(1, (num - sizeDomainMin) / span));
          return Math.round(rangeMin + t * (sizeMaxMapped - rangeMin));
        };
      }
      option.series.push(seriesOpt);
    }
    const xName = option.xAxis?.name ?? xField ?? "X";
    const yName = option.yAxis?.name ?? yField ?? "Y";
    const sizeName = sizeField ?? null;
    const colorName = colorField ?? null;
    const temporalFormat = channelSemantics.color?.temporalFormat ?? "%b %d, %Y";
    const tooltipParts = [
      { from: "data", index: 0, label: xName, format: xIsCategorical ? "category" : "number", categoryNames: xIsCategorical ? xCategories : void 0 },
      { from: "data", index: 1, label: yName, format: yIsCategorical ? "category" : "number", categoryNames: yIsCategorical ? yCategories : void 0 }
    ];
    if (sizeName != null) tooltipParts.push({ from: "data", index: 2, label: sizeName, format: "number" });
    if (colorName != null) {
      if (isContinuousColor2) {
        tooltipParts.push({
          from: "data",
          index: sizeField != null ? 3 : 2,
          label: colorName,
          format: isTemporalColor ? "temporal" : "number",
          temporalFormat
        });
      } else {
        tooltipParts.push({ from: "series", label: colorName });
      }
    }
    option.tooltip = option.tooltip ?? {};
    option._encodingTooltip = { trigger: "item", parts: tooltipParts };
    const vmList = Array.isArray(option.visualMap) ? option.visualMap : option.visualMap ? [option.visualMap] : [];
    const seriesCount = option.series?.length ?? 0;
    if (seriesCount > 1) {
      const allIndices = option.series.map((_, i) => i);
      for (const vm of vmList) {
        if (vm.type === "continuous" && vm.inRange?.symbolSize != null) {
          vm.seriesIndex = allIndices;
        }
      }
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 1 }
  ],
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color", "size"]],
    shift: ["color", "group", "column", "row"],
    transitions: [
      {
        to: "Strip Plot",
        label: "Jitter",
        route: { from: "series", to: "x", mode: "swap", spill: "color" }
      }
    ]
  }),
  postProcess: (option, ctx) => {
    if (!option.series || !Array.isArray(option.series)) return;
    const vmList = Array.isArray(option.visualMap) ? option.visualMap : option.visualMap ? [option.visualMap] : [];
    const visualMapControlsSize = vmList.some(
      (vm) => vm.type === "piecewise" && Array.isArray(vm.pieces) && vm.pieces.some((p) => p.symbolSize != null) || vm.type === "continuous" && vm.inRange?.symbolSize != null
    );
    if (visualMapControlsSize) return;
    const w = option._width || ctx.canvasSize.width;
    const h = option._height || ctx.canvasSize.height;
    const pointCount = ctx.table.length;
    const size = computeSymbolSize(w, h, pointCount);
    for (const series of option.series) {
      if (series.type !== "scatter") continue;
      const hasSizeEncoding = series.data?.length && Array.isArray(series.data[0]) && series.data[0].length >= 3;
      if (hasSizeEncoding) continue;
      if (series.symbolSize == null) {
        series.symbolSize = size;
      }
    }
  }
};
function linearRegression(data) {
  const n = data.length;
  if (n === 0) return { slope: 0, intercept: 0, xMin: 0, xMax: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  let xMin = data[0][0], xMax = data[0][0];
  for (const [x, y] of data) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) || 0;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, xMin, xMax };
}
function polyRegression(data, order) {
  const n = data.length;
  if (n === 0) return { coeffs: [0], xMin: 0, xMax: 0 };
  let xMin = data[0][0];
  let xMax = data[0][0];
  for (const [x] of data) {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  const k = order + 1;
  const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty = new Array(k).fill(0);
  for (const [x, y] of data) {
    const xp = new Array(2 * order + 1);
    xp[0] = 1;
    for (let p = 1; p < xp.length; p++) {
      xp[p] = xp[p - 1] * x;
    }
    for (let i = 0; i < k; i++) {
      xty[i] += y * xp[i];
      for (let j = 0; j < k; j++) {
        xtx[i][j] += xp[i + j];
      }
    }
  }
  const aug = xtx.map((row, i) => [...row, xty[i]]);
  for (let col = 0; col < k; col++) {
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = col; j <= k; j++) {
      aug[col][j] /= pivot;
    }
    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= k; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }
  const coeffs = aug.map((row) => row[k]);
  return { coeffs, xMin, xMax };
}
function polyEval(coeffs, x) {
  let result = 0, xp = 1;
  for (const c of coeffs) {
    result += c * xp;
    xp *= x;
  }
  return result;
}
function regressionCurvePoints(data, method, order, numPoints = 50) {
  if (data.length === 0) return [];
  if (method === "linear" || !method) {
    const reg2 = linearRegression(data);
    return [
      [reg2.xMin, reg2.slope * reg2.xMin + reg2.intercept],
      [reg2.xMax, reg2.slope * reg2.xMax + reg2.intercept]
    ];
  }
  if (method === "log") {
    const filtered = data.filter(([x]) => x > 0);
    if (filtered.length < 2) return [];
    const logData = filtered.map(([x, y]) => [Math.log(x), y]);
    const reg2 = linearRegression(logData);
    let xMin = Infinity, xMax = -Infinity;
    for (const [x] of filtered) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
    const pts = [];
    for (let i = 0; i < numPoints; i++) {
      const x = xMin + (xMax - xMin) * i / (numPoints - 1);
      pts.push([x, reg2.intercept + reg2.slope * Math.log(x)]);
    }
    return pts;
  }
  if (method === "exp") {
    const filtered = data.filter(([, y]) => y > 0);
    if (filtered.length < 2) return [];
    const logData = filtered.map(([x, y]) => [x, Math.log(y)]);
    const reg2 = linearRegression(logData);
    let xMin = Infinity, xMax = -Infinity;
    for (const [x] of filtered) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
    const pts = [];
    for (let i = 0; i < numPoints; i++) {
      const x = xMin + (xMax - xMin) * i / (numPoints - 1);
      pts.push([x, Math.exp(reg2.intercept + reg2.slope * x)]);
    }
    return pts;
  }
  if (method === "pow") {
    const filtered = data.filter(([x, y]) => x > 0 && y > 0);
    if (filtered.length < 2) return [];
    const logData = filtered.map(([x, y]) => [Math.log(x), Math.log(y)]);
    const reg2 = linearRegression(logData);
    let xMin = Infinity, xMax = -Infinity;
    for (const [x] of filtered) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
    const pts = [];
    for (let i = 0; i < numPoints; i++) {
      const x = xMin + (xMax - xMin) * i / (numPoints - 1);
      pts.push([x, Math.exp(reg2.intercept) * Math.pow(x, reg2.slope)]);
    }
    return pts;
  }
  if (method === "quad") {
    const reg2 = polyRegression(data, 2);
    const pts = [];
    for (let i = 0; i < numPoints; i++) {
      const x = reg2.xMin + (reg2.xMax - reg2.xMin) * i / (numPoints - 1);
      pts.push([x, polyEval(reg2.coeffs, x)]);
    }
    return pts;
  }
  if (method === "poly") {
    const reg2 = polyRegression(data, order);
    const pts = [];
    for (let i = 0; i < numPoints; i++) {
      const x = reg2.xMin + (reg2.xMax - reg2.xMin) * i / (numPoints - 1);
      pts.push([x, polyEval(reg2.coeffs, x)]);
    }
    return pts;
  }
  const reg = linearRegression(data);
  return [
    [reg.xMin, reg.slope * reg.xMin + reg.intercept],
    [reg.xMax, reg.slope * reg.xMax + reg.intercept]
  ];
}
var ecRegressionDef = {
  chart: "Regression",
  template: { mark: "circle", encoding: {} },
  channels: ["x", "y", "size", "color", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xField = channelSemantics.x?.field;
    const yField = channelSemantics.y?.field;
    const colorField = channelSemantics.color?.field;
    if (!xField || !yField) return;
    const method = chartProperties?.regressionMethod ?? "linear";
    const polyOrder = chartProperties?.polyOrder ?? 3;
    const option = {
      tooltip: { trigger: "item" },
      xAxis: { type: "value", name: xField, nameLocation: "middle", nameGap: 30, axisTick: { show: true } },
      yAxis: { type: "value", name: yField, nameLocation: "middle", nameGap: 40, axisTick: { show: true } },
      series: []
    };
    if (channelSemantics.x?.zero) option.xAxis.scale = !channelSemantics.x.zero.zero;
    if (channelSemantics.y?.zero) option.yAxis.scale = !channelSemantics.y.zero.zero;
    const opacity = chartProperties?.opacity ?? 1;
    if (colorField) {
      const groups = groupBy(table, colorField);
      option.legend = { data: [...groups.keys()] };
      option._legendTitle = colorField;
      let colorIdx = 0;
      for (const [name, rows] of groups) {
        const data = rows.map((r) => [r[xField], r[yField]]);
        const lineData = regressionCurvePoints(data, method, polyOrder);
        option.series.push({
          name,
          type: "scatter",
          data,
          itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length], opacity }
        });
        option.series.push({
          name: `${name} (trend)`,
          type: "line",
          data: lineData,
          showSymbol: false,
          smooth: method !== "linear",
          lineStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length], width: 2 }
        });
        colorIdx++;
      }
    } else {
      const data = table.map((r) => [r[xField], r[yField]]);
      const lineData = regressionCurvePoints(data, method, polyOrder);
      option.series.push({ type: "scatter", data, itemStyle: { opacity } });
      option.series.push({
        name: "Trend",
        type: "line",
        data: lineData,
        showSymbol: false,
        smooth: method !== "linear",
        lineStyle: { color: "#ee6666", width: 2 }
      });
    }
    const xName = option.xAxis?.name ?? xField ?? "X";
    const yName = option.yAxis?.name ?? yField ?? "Y";
    const tooltipParts = [
      { from: "data", index: 0, label: xName, format: "number" },
      { from: "data", index: 1, label: yName, format: "number" }
    ];
    if (colorField) tooltipParts.push({ from: "series", label: colorField });
    option._encodingTooltip = { trigger: "item", parts: tooltipParts };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "regressionMethod",
      label: "Method",
      type: "discrete",
      options: [
        { value: "linear", label: "Linear" },
        { value: "log", label: "Logarithmic" },
        { value: "exp", label: "Exponential" },
        { value: "pow", label: "Power" },
        { value: "quad", label: "Quadratic" },
        { value: "poly", label: "Polynomial" }
      ],
      defaultValue: "linear"
    },
    {
      key: "polyOrder",
      label: "Poly Order",
      type: "continuous",
      min: 2,
      max: 10,
      step: 1,
      defaultValue: 3
    }
  ]
};

// src/echarts/templates/connected-scatter.ts
function sortByOrder(rows, field) {
  if (!field) return rows;
  const tagged = rows.map((row, idx) => ({ row, idx, key: row[field] }));
  const present = tagged.filter((t) => t.key != null && t.key !== "");
  const allNumeric = present.length > 0 && present.every((t) => typeof t.key === "number" || typeof t.key === "string" && t.key.trim() !== "" && !isNaN(Number(t.key)));
  const allDates = !allNumeric && present.length > 0 && present.every((t) => !isNaN(Date.parse(String(t.key))));
  const rank = (k) => {
    if (allNumeric) return Number(k);
    if (allDates) return Date.parse(String(k));
    return String(k);
  };
  return [...tagged].sort((a, b) => {
    const ra = rank(a.key);
    const rb = rank(b.key);
    if (ra < rb) return -1;
    if (ra > rb) return 1;
    return a.idx - b.idx;
  }).map((t) => t.row);
}
function toPoints(rows, xField, yField) {
  return rows.map((r) => {
    const x = r[xField];
    const y = r[yField];
    return [
      x != null && !isNaN(Number(x)) ? Number(x) : null,
      y != null && !isNaN(Number(y)) ? Number(y) : null
    ];
  });
}
var ecConnectedScatterDef = {
  chart: "Connected Scatter Plot",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "order", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const orderField = channelSemantics.order?.field;
    const groupField = channelSemantics.color?.field ?? channelSemantics.detail?.field;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const option = {
      tooltip: { trigger: "item" },
      xAxis: {
        type: "value",
        name: xField,
        nameLocation: "middle",
        nameGap: 30,
        axisTick: { show: true }
      },
      yAxis: {
        type: "value",
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true }
      },
      series: []
    };
    option.xAxis.scale = channelSemantics.x?.zero ? !channelSemantics.x.zero.zero : true;
    option.yAxis.scale = channelSemantics.y?.zero ? !channelSemantics.y.zero.zero : true;
    const baseSeriesOpt = {
      type: "line",
      showSymbol: true,
      symbol: "circle",
      symbolSize: 8,
      // Straight segments — never smooth, so a looping path crosses itself.
      smooth: false,
      lineStyle: { width: 2 },
      // Don't clip symbols at the grid edge: a point that lands exactly on
      // an axis bound would otherwise have its marker cut in half.
      clip: false
    };
    if (groupField) {
      const groups = groupBy(table, groupField);
      option.legend = { data: [...groups.keys()] };
      for (const [name, rows] of groups) {
        const sorted = sortByOrder(rows, orderField);
        option.series.push({
          name,
          ...baseSeriesOpt,
          data: toPoints(sorted, xField, yField)
          // Colors assigned by ecApplyLayoutToSpec from colorDecisions.
        });
      }
    } else {
      const sorted = sortByOrder(table, orderField);
      option.series.push({
        ...baseSeriesOpt,
        data: toPoints(sorted, xField, yField)
      });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/bar.ts
var isDiscrete7 = (type) => type === "nominal" || type === "ordinal";
function buildLocalLaneSeries(table, categories, catField, groupField, valField, groupColor) {
  const globalGroups = [...new Set(table.map((r) => String(r[groupField] ?? "")))].filter(Boolean);
  const perBand = /* @__PURE__ */ new Map();
  for (const cat of categories) perBand.set(cat, []);
  for (const r of table) {
    const cat = String(r[catField] ?? "");
    const g = String(r[groupField] ?? "");
    if (!perBand.has(cat) || !g) continue;
    const arr = perBand.get(cat);
    if (!arr.includes(g)) arr.push(g);
  }
  for (const arr of perBand.values()) arr.sort();
  const maxPerBand = Math.max(1, ...[...perBand.values()].map((a) => a.length));
  if (maxPerBand <= 1) return null;
  const valAt = /* @__PURE__ */ new Map();
  for (const r of table) {
    const v = Number(r[valField]);
    if (isFinite(v)) valAt.set(`${r[catField]}\0${r[groupField]}`, v);
  }
  const series = Array.from({ length: maxPerBand }, (_, lane) => ({
    type: "bar",
    name: `__lane${lane}`,
    data: categories.map((cat) => {
      const g = perBand.get(cat)?.[lane];
      if (g === void 0) return "-";
      const v = valAt.get(`${cat}\0${g}`);
      return v === void 0 ? "-" : { value: v, itemStyle: { color: groupColor(g) } };
    })
  }));
  const legendData = globalGroups.map((g) => ({ name: g, itemStyle: { color: groupColor(g) } }));
  return { series, legendData };
}
function buildCategoryValues(rows, categoryField, valueField, categories) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const cat = String(row[categoryField] ?? "");
    const val = row[valueField];
    if (val != null && !isNaN(val)) {
      map.set(cat, (map.get(cat) ?? 0) + Number(val));
    }
  }
  return categories.map((cat) => map.get(cat) ?? null);
}
function buildCategoryCounts(rows, categoryField, categories) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const cat = String(row[categoryField] ?? "");
    map.set(cat, (map.get(cat) ?? 0) + 1);
  }
  return categories.map((cat) => map.get(cat) ?? 0);
}
function buildCategoryGroupCounts(rows, categoryField, groupField, categories, groups) {
  return groups.map(
    (group) => categories.map(
      (cat) => rows.filter((r) => String(r[categoryField] ?? "") === cat && String(r[groupField] ?? "") === group).length
    )
  );
}
function areHeatmapCategoriesNumeric(cats) {
  if (cats.length === 0) return true;
  return cats.every((c) => {
    const s = String(c).trim();
    if (s === "") return false;
    const n = Number(s);
    return !isNaN(n) && isFinite(n);
  });
}
var EC_BAR_SHORT_CATEGORY_COUNT = 4;
var EC_BAR_SHORT_CATEGORY_LABEL_LEN = 8;
function categoryAxisLabelRotateDeg(categories, channelType) {
  if (channelType === "quantitative") return 0;
  const labels = categories.map((c) => String(c));
  if (labels.length === 0) return 0;
  const maxLen = Math.max(...labels.map((s) => s.length));
  if (labels.length <= EC_BAR_SHORT_CATEGORY_COUNT && maxLen <= EC_BAR_SHORT_CATEGORY_LABEL_LEN) {
    return 0;
  }
  return 90;
}
var ecBarChartDef = {
  chart: "Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes
    };
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
    const catField = channelSemantics[categoryAxis]?.field;
    const valField = channelSemantics[valueAxis]?.field;
    if (!catField || !valField) return;
    const catCS = channelSemantics[categoryAxis];
    const valCS = channelSemantics[valueAxis];
    const colorField = channelSemantics.color?.field;
    const bothDiscrete = isDiscrete7(channelSemantics.x?.type) && isDiscrete7(channelSemantics.y?.type);
    if (bothDiscrete) {
      const categories2 = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
      const groups = extractCategories(table, valField, getCategoryOrder(ctx, valueAxis));
      const countMatrix = buildCategoryGroupCounts(table, catField, valField, categories2, groups);
      const heatData = [];
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (let yi = 0; yi < groups.length; yi++) {
        for (let xi = 0; xi < categories2.length; xi++) {
          const v = countMatrix[yi][xi];
          heatData.push([xi, yi, v]);
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
      }
      if (minVal === Infinity) minVal = 0;
      if (maxVal === -Infinity) maxVal = 1;
      const option2 = {
        tooltip: { position: "top" },
        _encodingTooltip: {
          trigger: "item",
          parts: [
            { from: "data", index: 0, label: catField, format: "category", categoryNames: categories2 },
            { from: "data", index: 1, label: valField, format: "category", categoryNames: groups },
            { from: "data", index: 2, label: "Count", format: "number" }
          ]
        },
        xAxis: {
          type: "category",
          data: categories2,
          name: catField,
          splitArea: { show: true },
          axisTick: { show: true, alignWithLabel: true },
          axisLabel: {
            rotate: areHeatmapCategoriesNumeric(categories2) ? 0 : categoryAxisLabelRotateDeg(categories2, catCS?.type)
          }
        },
        yAxis: {
          type: "category",
          data: groups,
          name: valField,
          splitArea: { show: true },
          axisTick: { show: true, alignWithLabel: true },
          axisLabel: { rotate: 0 }
        },
        visualMap: {
          min: minVal,
          max: maxVal,
          calculable: true,
          orient: "vertical",
          right: 10,
          top: "center",
          itemGap: 15,
          inRange: { color: ["#f0f9ff", "#0ea5e9", "#0369a1"] }
        },
        _visualMapWidth: 50,
        series: [{
          type: "heatmap",
          data: heatData,
          label: { show: heatData.length <= 100 },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: "rgba(0, 0, 0, 0.5)" }
          }
        }]
      };
      Object.assign(spec, option2);
      delete spec.mark;
      delete spec.encoding;
      return;
    }
    if (colorField && valCS?.type === "quantitative") {
      const categories2 = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
      const isHorizontal2 = categoryAxis === "y";
      const option2 = {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        xAxis: isHorizontal2 ? { type: "value", name: valField } : {
          type: "category",
          data: categories2,
          name: catField,
          axisLabel: { rotate: categoryAxisLabelRotateDeg(categories2, catCS?.type) },
          axisTick: { show: true, alignWithLabel: true },
          axisLine: { show: true }
        },
        yAxis: isHorizontal2 ? { type: "category", data: categories2, name: catField } : { type: "value", name: valField },
        series: []
      };
      option2._encodingTooltip = { trigger: "axis", categoryLabel: catField, valueLabel: valField };
      const groups = groupBy(table, colorField);
      const legendKeys = [...groups.keys()];
      const highCardinality = legendKeys.length > 10;
      option2.legend = {
        data: legendKeys,
        orient: "vertical",
        right: 10,
        top: highCardinality ? 30 : 20,
        bottom: highCardinality ? 10 : void 0,
        type: highCardinality ? "scroll" : "plain",
        align: "left"
      };
      if (colorField) {
        const titleGraphic = {
          type: "text",
          right: 10,
          top: 4,
          z: 100,
          style: {
            text: colorField,
            fontSize: 11,
            fontWeight: "bold",
            fill: "#333",
            textAlign: "right"
          }
        };
        const existingGraphic = spec.graphic ?? option2.graphic;
        option2.graphic = Array.isArray(existingGraphic) ? [...existingGraphic, titleGraphic] : existingGraphic ? [existingGraphic, titleGraphic] : [titleGraphic];
      }
      for (const [name, rows] of groups) {
        const data = buildCategoryValues(rows, catField, valField, categories2);
        option2.series.push({
          name,
          type: "bar",
          data,
          stack: "total"
          // 颜色由 ecApplyLayoutToSpec 中的 palette 决定，这里不再硬编码。
        });
      }
      Object.assign(spec, option2);
      delete spec.mark;
      delete spec.encoding;
      return;
    }
    if (categoryAxis === "y" && valCS?.type === "temporal") {
      const dateCategories = extractCategories(table, valField, getCategoryOrder(ctx, valueAxis));
      dateCategories.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const groups = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
      const countMatrix = buildCategoryGroupCounts(table, valField, catField, dateCategories, groups);
      const virtualDecision = {
        schemeType: "categorical",
        // 这里没有真实的 encoding.color，但我们知道会画按 group 分类的条形，
        // 因此用 group 数作为 categoryCount，方便 colormap 选择 cat10/cat20。
        categoryCount: groups.length || void 0};
      const palette = pickEChartsPalette(virtualDecision);
      const option2 = {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: { data: groups },
        xAxis: {
          type: "category",
          data: dateCategories,
          name: valField,
          axisLabel: { rotate: categoryAxisLabelRotateDeg(dateCategories, "temporal") },
          axisTick: { show: true, alignWithLabel: true },
          axisLine: { show: true }
        },
        yAxis: { type: "value", name: "Count", axisTick: { show: true } },
        // 显式把 palette 写到 option.color，方便和其它图类型保持一致
        color: palette,
        series: groups.map((name, i) => ({
          name,
          type: "bar",
          data: countMatrix[i],
          itemStyle: {
            color: palette[i % palette.length],
            borderRadius: chartProperties?.cornerRadius ?? 0
          }
        }))
      };
      option2._encodingTooltip = { trigger: "axis", categoryLabel: valField, valueLabel: "Count", groupLabel: catField };
      Object.assign(spec, option2);
      delete spec.mark;
      delete spec.encoding;
      return;
    }
    let categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
    let values;
    if (valCS?.type === "temporal") {
      values = buildCategoryCounts(table, catField, categories);
    } else {
      values = buildCategoryValues(table, catField, valField, categories);
    }
    if (catCS?.type === "temporal") {
      const pairs = categories.map((c, i) => [c, values[i]]);
      pairs.sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
      categories = pairs.map((p) => p[0]);
      values = pairs.map((p) => p[1]);
    }
    const isHorizontal = categoryAxis === "y";
    const valueLabel = valCS?.type === "temporal" ? "Count" : valField;
    const option = {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: isHorizontal ? { type: "value", name: valueLabel } : {
        type: "category",
        data: categories,
        name: catField,
        axisLabel: { rotate: categoryAxisLabelRotateDeg(categories, catCS?.type) },
        axisTick: { show: true, alignWithLabel: true },
        axisLine: { show: true }
      },
      yAxis: isHorizontal ? { type: "category", data: categories, name: catField } : { type: "value", name: valueLabel },
      series: [{
        type: "bar",
        data: values,
        itemStyle: {
          borderRadius: chartProperties?.cornerRadius ?? 0
        }
      }]
    };
    option._encodingTooltip = { trigger: "axis", categoryLabel: catField, valueLabel };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 15, step: 1, defaultValue: 0 }
  ],
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"]
  })
};
var ecStackedBarChartDef = {
  chart: "Stacked Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes,
      paramOverrides: { continuousMarkCrossSection: { x: 20, y: 20, seriesCountAxis: "auto" } }
    };
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
    const colorField = channelSemantics.color?.field;
    const catField = channelSemantics[categoryAxis]?.field;
    const valField = channelSemantics[valueAxis]?.field;
    if (!catField || !valField) return;
    const catCS = channelSemantics[categoryAxis];
    const valCS = channelSemantics[valueAxis];
    let categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
    if (catCS?.type === "temporal") {
      categories = [...categories].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    }
    const isHorizontal = categoryAxis === "y";
    const valueLabel = valCS?.type === "temporal" ? "Count" : valField;
    if (colorField && isDiscrete7(channelSemantics.x?.type) && isDiscrete7(channelSemantics.y?.type)) {
      const categoriesX = extractCategories(table, channelSemantics.x.field, getCategoryOrder(ctx, "x"));
      const groups = groupBy(table, colorField);
      const option2 = {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        xAxis: {
          type: "category",
          data: categoriesX,
          name: channelSemantics.x.field,
          axisLabel: {
            rotate: categoryAxisLabelRotateDeg(categoriesX, channelSemantics.x?.type)
          },
          axisTick: { show: true, alignWithLabel: true },
          axisLine: { show: true }
        },
        yAxis: { type: "value", name: "Count", axisTick: { show: true } },
        series: []
      };
      option2._encodingTooltip = {
        trigger: "axis",
        categoryLabel: channelSemantics.x.field,
        valueLabel: "Count",
        groupLabel: colorField
      };
      const legendKeys = [...groups.keys()];
      const highCardinality = legendKeys.length > 10;
      option2.legend = {
        data: legendKeys,
        orient: "vertical",
        right: 10,
        top: highCardinality ? 30 : 20,
        bottom: highCardinality ? 10 : void 0,
        type: highCardinality ? "scroll" : "plain",
        align: "left"
      };
      const titleGraphic = {
        type: "text",
        right: 10,
        top: 4,
        z: 100,
        style: {
          text: colorField,
          fontSize: 11,
          fontWeight: "bold",
          fill: "#333",
          textAlign: "right"
        }
      };
      const existingGraphic = spec.graphic ?? option2.graphic;
      option2.graphic = Array.isArray(existingGraphic) ? [...existingGraphic, titleGraphic] : existingGraphic ? [existingGraphic, titleGraphic] : [titleGraphic];
      for (const [name, rows] of groups) {
        const data = buildCategoryCounts(rows, channelSemantics.x.field, categoriesX);
        option2.series.push({
          name,
          type: "bar",
          data,
          stack: "total"
          // 颜色由全局 palette 决定。
        });
      }
      Object.assign(spec, option2);
      delete spec.mark;
      delete spec.encoding;
      return;
    }
    const option = {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: isHorizontal ? { type: "value", name: valueLabel } : {
        type: "category",
        data: categories,
        name: catField,
        axisLabel: { rotate: categoryAxisLabelRotateDeg(categories, catCS?.type) },
        axisTick: { show: true, alignWithLabel: true },
        axisLine: { show: true }
      },
      yAxis: isHorizontal ? { type: "category", data: categories, name: catField } : { type: "value", name: valueLabel },
      series: []
    };
    option._encodingTooltip = { trigger: "axis", categoryLabel: catField, valueLabel };
    const stackMode = colorField ? chartProperties?.stackMode : void 0;
    const stackGroup = colorField && stackMode !== "layered" ? "total" : void 0;
    if (colorField) {
      const groups = groupBy(table, colorField);
      const legendKeys = [...groups.keys()];
      const highCardinality = legendKeys.length > 10;
      option.legend = {
        data: legendKeys,
        orient: "vertical",
        right: 10,
        top: highCardinality ? 30 : 20,
        bottom: highCardinality ? 10 : void 0,
        type: highCardinality ? "scroll" : "plain",
        align: "left"
      };
      const titleField = colorField;
      if (titleField) {
        const titleGraphic = {
          type: "text",
          right: 10,
          top: 4,
          z: 100,
          style: {
            text: titleField,
            fontSize: 11,
            fontWeight: "bold",
            fill: "#333",
            textAlign: "right"
          }
        };
        const existingGraphic = spec.graphic ?? option.graphic;
        option.graphic = Array.isArray(existingGraphic) ? [...existingGraphic, titleGraphic] : existingGraphic ? [existingGraphic, titleGraphic] : [titleGraphic];
      }
      for (const [name, rows] of groups) {
        const data = valCS?.type === "temporal" ? buildCategoryCounts(rows, catField, categories) : buildCategoryValues(rows, catField, valField, categories);
        const series = {
          name,
          type: "bar",
          data
          // 颜色由全局 palette 决定。
        };
        if (stackGroup) {
          series.stack = stackGroup;
        }
        if (stackMode === "normalize") {
          series.stack = "total";
        }
        option.series.push(series);
      }
    } else {
      const data = valCS?.type === "temporal" ? buildCategoryCounts(table, catField, categories) : buildCategoryValues(table, catField, valField, categories);
      option.series.push({ type: "bar", data });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "stackMode",
      label: "Stack",
      type: "discrete",
      options: [
        { value: void 0, label: "Stacked (default)" },
        { value: "normalize", label: "Normalize (100%)" },
        { value: "layered", label: "Layered (overlap)" }
      ],
      check: (ctx) => ({ applicable: !!ctx.encodings.color?.field })
    }
  ],
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"],
    transitions: [
      {
        to: "Grouped Bar Chart",
        label: "Grouped",
        route: { from: "color", to: "group", mode: "move" },
        requireDiscreteSource: true,
        maxSourceCardinality: 12
      }
    ]
  })
};
var ecGroupedBarChartDef = {
  chart: "Grouped Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "group", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table, chartProperties) => {
    const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: "x" });
    const axis = result?.axis || "x";
    const decl = {
      axisFlags: { [axis]: { banded: true } },
      resolvedTypes: result?.resolvedTypes
    };
    const groupField = cs.group?.field || cs.color?.field;
    const axisField = cs[axis]?.field;
    if (groupField && axisField) {
      const plan = planBandDodge(table, axisField, groupField);
      const { mode } = resolveDodge(plan, chartProperties?.dodge);
      if (mode === "local") decl.groupLaneCount = Math.max(1, plan.maxPerBand);
    }
    return decl;
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const groupField = channelSemantics.group?.field || channelSemantics.color?.field;
    if (channelSemantics.x?.type === "temporal" && isDiscrete7(channelSemantics.y?.type) && groupField && channelSemantics.x.field) {
      const xField = channelSemantics.x.field;
      const xCS = channelSemantics.x;
      const dateCategories = extractCategories(table, xField, getCategoryOrder(ctx, "x"));
      dateCategories.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const segments = extractCategories(table, groupField, getCategoryOrder(ctx, "group"));
      const countMatrix = buildCategoryGroupCounts(table, xField, groupField, dateCategories, segments);
      const option2 = {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: { data: segments },
        xAxis: {
          type: "category",
          data: dateCategories,
          name: xField,
          axisLabel: { rotate: categoryAxisLabelRotateDeg(dateCategories, xCS?.type) },
          axisTick: { show: true, alignWithLabel: true },
          axisLine: { show: true }
        },
        yAxis: { type: "value", name: "Count", axisTick: { show: true } },
        series: segments.map((name, i) => ({
          name,
          type: "bar",
          data: countMatrix[i]
          // 颜色由全局 palette 决定。
        }))
      };
      option2._legendTitle = groupField;
      option2._encodingTooltip = {
        trigger: "axis",
        categoryLabel: xField,
        valueLabel: "Count",
        groupLabel: groupField
      };
      Object.assign(spec, option2);
      delete spec.mark;
      delete spec.encoding;
      return;
    }
    const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
    const catField = channelSemantics[categoryAxis]?.field;
    const valField = channelSemantics[valueAxis]?.field;
    const valType = channelSemantics[valueAxis]?.type;
    if ((!valField || valType === "nominal" || valType === "ordinal") && groupField && channelSemantics.x?.field) {
      const xField = channelSemantics.x.field;
      const xCS = channelSemantics.x;
      let categories2 = extractCategories(table, xField, getCategoryOrder(ctx, "x"));
      if (xCS?.type === "temporal") {
        categories2 = [...categories2].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      }
      const groups = groupBy(table, groupField);
      const legendKeys = [...groups.keys()];
      const highCardinality = legendKeys.length > 10;
      const option2 = {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        xAxis: {
          type: "category",
          data: categories2,
          name: xField,
          axisLabel: { rotate: categoryAxisLabelRotateDeg(categories2, xCS?.type) },
          axisTick: { show: true, alignWithLabel: true },
          axisLine: { show: true }
        },
        yAxis: { type: "value", name: "Count", axisTick: { show: true } },
        series: []
      };
      option2._encodingTooltip = {
        trigger: "axis",
        categoryLabel: xField,
        valueLabel: "Count",
        groupLabel: groupField
      };
      option2.legend = {
        data: legendKeys,
        orient: "vertical",
        right: 10,
        top: highCardinality ? 30 : 20,
        bottom: highCardinality ? 10 : void 0,
        type: highCardinality ? "scroll" : "plain",
        align: "left"
      };
      const titleGraphic = {
        type: "text",
        right: 10,
        top: 4,
        z: 100,
        style: {
          text: groupField,
          fontSize: 11,
          fontWeight: "bold",
          fill: "#333",
          textAlign: "right"
        }
      };
      const existingGraphic = spec.graphic ?? option2.graphic;
      option2.graphic = Array.isArray(existingGraphic) ? [...existingGraphic, titleGraphic] : existingGraphic ? [existingGraphic, titleGraphic] : [titleGraphic];
      for (const [name, rows] of groups) {
        const data = buildCategoryCounts(rows, xField, categories2);
        option2.series.push({
          name,
          type: "bar",
          data
          // 颜色由全局 palette 决定。
        });
      }
      Object.assign(spec, option2);
      delete spec.mark;
      delete spec.encoding;
      return;
    }
    if (!catField || !valField) return;
    const catCS = channelSemantics[categoryAxis];
    let categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
    if (catCS?.type === "temporal") {
      categories = [...categories].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    }
    const isHorizontal = categoryAxis === "y";
    const option = {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: isHorizontal ? { type: "value", name: valField } : {
        type: "category",
        data: categories,
        name: catField,
        axisLabel: { rotate: categoryAxisLabelRotateDeg(categories, catCS?.type) },
        axisTick: { show: true, alignWithLabel: true },
        axisLine: { show: true }
      },
      yAxis: isHorizontal ? { type: "category", data: categories, name: catField } : { type: "value", name: valField },
      series: []
    };
    option._encodingTooltip = { trigger: "axis", categoryLabel: catField, valueLabel: valField };
    if (groupField) {
      const groups = groupBy(table, groupField);
      const legendKeys = [...groups.keys()];
      const highCardinality = legendKeys.length > 10;
      option.legend = {
        data: legendKeys,
        orient: "vertical",
        right: 10,
        top: highCardinality ? 30 : 20,
        bottom: highCardinality ? 10 : void 0,
        type: highCardinality ? "scroll" : "plain",
        align: "left"
      };
      const titleField = groupField;
      if (titleField) {
        const titleGraphic = {
          type: "text",
          right: 10,
          top: 4,
          z: 100,
          style: {
            text: titleField,
            fontSize: 11,
            fontWeight: "bold",
            fill: "#333",
            textAlign: "right"
          }
        };
        const existingGraphic = spec.graphic ?? option.graphic;
        option.graphic = Array.isArray(existingGraphic) ? [...existingGraphic, titleGraphic] : existingGraphic ? [existingGraphic, titleGraphic] : [titleGraphic];
      }
      for (const [name, rows] of groups) {
        const data = buildCategoryValues(rows, catField, valField, categories);
        option.series.push({
          name,
          type: "bar",
          data
          // 颜色由全局 palette 决定。
        });
      }
      const gAxisField = channelSemantics[categoryAxis]?.field;
      if (gAxisField) {
        const plan = planBandDodge(ctx.fullTable ?? table, gAxisField, groupField);
        const { mode } = resolveDodge(plan, ctx.chartProperties?.dodge);
        if (mode === "local") {
          const palette = pickEChartsPalette(ctx.colorDecisions?.group ?? ctx.colorDecisions?.color);
          const colorFor = (g) => palette[legendKeys.indexOf(g) % palette.length] ?? palette[0];
          const built = buildLocalLaneSeries(table, categories, catField, groupField, valField, colorFor);
          if (built) {
            option.series = built.series;
            option.legend.data = built.legendData;
          }
        }
      }
    } else {
      const data = buildCategoryValues(table, catField, valField, categories);
      option.series.push({ type: "bar", data });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "dodge",
      label: "Dodge",
      type: "discrete",
      options: [
        { value: "auto", label: "Auto" },
        { value: "local", label: "Local (compact)" },
        { value: "global", label: "Global (aligned)" }
      ],
      defaultValue: "auto",
      check: (ctx) => {
        const groupField = ctx.channelSemantics?.group?.field ?? ctx.encodings?.group?.field;
        const axisField = isDiscrete7(ctx.channelSemantics?.x?.type) ? ctx.channelSemantics?.x?.field : ctx.channelSemantics?.y?.field;
        const rows = ctx.data;
        if (!groupField || !axisField || !rows) return { applicable: false };
        const plan = planBandDodge(rows, axisField, groupField);
        return { applicable: plan.ambiguous, recommendedValue: plan.mode === "none" ? "auto" : plan.mode };
      }
    }
  ],
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"],
    transitions: [
      {
        to: "Stacked Bar Chart",
        label: "Stacked",
        route: { from: "group", to: "color", mode: "move" },
        requireDiscreteSource: true
      }
    ]
  })
};

// src/echarts/templates/line.ts
var isDiscrete8 = (type) => type === "nominal" || type === "ordinal";
function areCategoriesNumeric(cats) {
  if (cats.length === 0) return true;
  return cats.every((c) => {
    const s = String(c).trim();
    if (s === "") return false;
    const n = Number(s);
    return !isNaN(n) && isFinite(n);
  });
}
var ecLineChartDef = {
  chart: "Line Chart",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" } }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const colorField = channelSemantics.color?.field;
    const colorType = channelSemantics.color?.type;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const xIsDiscrete = isDiscrete8(xCS.type);
    const xIsTemporal = xCS.type === "temporal";
    const yIsDiscrete = isDiscrete8(yCS.type);
    const isContinuousColor2 = !!colorField && (colorType === "quantitative" || colorType === "temporal");
    const categories = xIsDiscrete ? extractCategories(table, xField, getCategoryOrder(ctx, "x")) : void 0;
    const yCategories = yIsDiscrete ? extractCategories(table, yField, getCategoryOrder(ctx, "y")) : void 0;
    const option = {
      tooltip: {
        trigger: "axis"
      },
      xAxis: (() => {
        const type = xIsDiscrete ? "category" : xIsTemporal ? "time" : "value";
        const base = {
          type,
          name: xField,
          nameLocation: "middle",
          nameGap: 30,
          ...categories ? { data: categories } : {}
        };
        if (xIsDiscrete && categories) {
          base.axisTick = { show: true, alignWithLabel: true };
          base.axisLabel = { rotate: areCategoriesNumeric(categories) ? 0 : 90 };
        } else if (xIsTemporal) {
          base.axisTick = { show: true, alignWithLabel: true };
          base.axisLabel = { rotate: 90 };
        } else {
          base.axisTick = { show: true };
        }
        return base;
      })(),
      yAxis: yIsDiscrete && yCategories ? {
        type: "category",
        data: yCategories,
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: { rotate: 0 }
      } : {
        type: "value",
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      },
      series: []
    };
    option._encodingTooltip = isContinuousColor2 ? {
      trigger: "item",
      parts: [
        { from: "data", index: 0, label: xField, format: "number" },
        { from: "data", index: 1, label: yField, format: "number" },
        { from: "data", index: 2, label: colorField, format: "number" }
      ]
    } : { trigger: "axis", categoryLabel: xField, valueLabel: yField };
    if (channelSemantics.y?.zero) {
      option.yAxis.scale = !channelSemantics.y.zero.zero;
    }
    const interpolate = chartProperties?.interpolate;
    const showPoints = !!chartProperties?.showPoints;
    const smooth = interpolate === "monotone" || interpolate === "basis" || interpolate === "cardinal" || interpolate === "catmull-rom";
    const step = interpolate === "step" ? "middle" : interpolate === "step-before" ? "start" : interpolate === "step-after" ? "end" : void 0;
    if (isContinuousColor2 && colorField) {
      const sorted = [...table].sort((a, b) => {
        const ax = a[xField];
        const bx = b[xField];
        if (xIsTemporal) return new Date(ax).getTime() - new Date(bx).getTime();
        const na = Number(ax);
        const nb = Number(bx);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(ax).localeCompare(String(bx));
      });
      const pointData = sorted.map((r) => [r[xField], r[yField], r[colorField]]);
      const lineData = sorted.map((r) => [r[xField], r[yField]]);
      const nums = sorted.map((r) => Number(r[colorField])).filter((v) => !isNaN(v) && isFinite(v));
      const cMin = nums.length ? Math.min(...nums) : 0;
      const cMax = nums.length ? Math.max(...nums) : 1;
      const decisionSchemeId = colorDecisions?.color?.schemeId;
      const paletteFromDecision = decisionSchemeId ? getPaletteForScheme(decisionSchemeId) : void 0;
      option.visualMap = {
        type: "continuous",
        min: cMin,
        max: cMax,
        dimension: 2,
        // [x, y, color]
        orient: "vertical",
        right: 10,
        top: "center",
        // 优先使用 colordecisions palette，找不到时退回原来的绿色色带。
        inRange: {
          color: paletteFromDecision && paletteFromDecision.length > 0 ? paletteFromDecision : ["#f7fcf5", "#74c476", "#00441b"]
        },
        seriesIndex: 1,
        // apply to point series
        name: colorField,
        textStyle: { fontSize: 10 },
        calculable: true
      };
      option._visualMapWidth = 70;
      option.graphic = [
        ...Array.isArray(option.graphic) ? option.graphic : option.graphic ? [option.graphic] : [],
        {
          type: "text",
          right: 10,
          top: 4,
          z: 100,
          style: {
            text: colorField,
            fontSize: 11,
            fontWeight: "bold",
            fill: "#333",
            textAlign: "right"
          }
        }
      ];
      option.series.push({
        type: "line",
        data: lineData,
        itemStyle: { color: "#cccccc" },
        lineStyle: { color: "#cccccc" },
        showSymbol: false,
        symbol: "none",
        ...smooth ? { smooth: true } : {},
        ...step ? { step } : {}
      });
      option.series.push({
        type: "scatter",
        data: pointData,
        symbol: "circle",
        symbolSize: 7,
        itemStyle: { opacity: 1 }
      });
    } else if (colorField && isDiscrete8(colorType)) {
      const groups = groupBy(table, colorField);
      option.legend = { data: [...groups.keys()] };
      for (const [name, rows] of groups) {
        const seriesData = yIsDiscrete && yCategories ? buildCategoryAlignedXYData(rows, xField, yField, yCategories) : xIsDiscrete ? buildCategoryAlignedData(rows, xField, yField, categories) : rows.map((r) => [r[xField], r[yField]]);
        const series = {
          name,
          type: "line",
          data: seriesData,
          // Default line chart: don't draw point markers (unless showPoints is set).
          showSymbol: !!showPoints,
          symbol: showPoints ? "circle" : "none",
          ...showPoints ? { symbolSize: 6 } : {}
        };
        if (smooth) series.smooth = true;
        if (step) series.step = step;
        option.series.push(series);
      }
    } else {
      const seriesData = yIsDiscrete && yCategories ? buildCategoryAlignedXYData(table, xField, yField, yCategories) : xIsDiscrete ? categories.map((cat) => {
        const row = table.find((r) => String(r[xField]) === cat);
        return row ? row[yField] : null;
      }) : table.map((r) => [r[xField], r[yField]]);
      const series = {
        type: "line",
        data: seriesData,
        // Default line chart: don't draw point markers (unless showPoints is set).
        showSymbol: !!showPoints,
        symbol: showPoints ? "circle" : "none",
        ...showPoints ? { symbolSize: 6 } : {}
      };
      if (smooth) series.smooth = true;
      if (step) series.step = step;
      option.series.push(series);
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "interpolate",
      label: "Curve",
      type: "discrete",
      options: [
        { value: void 0, label: "Default (linear)" },
        { value: "linear", label: "Linear" },
        { value: "monotone", label: "Monotone (smooth)" },
        { value: "step", label: "Step" },
        { value: "step-before", label: "Step Before" },
        { value: "step-after", label: "Step After" }
      ]
    },
    { key: "showPoints", label: "Show points", type: "binary", defaultValue: false }
  ],
  pivot: makeCartesianPivot({
    permute: [["y", "color"]],
    shift: ["color", "group", "column", "row"]
  })
};
function buildCategoryAlignedData(rows, xField, yField, categories, yTransform) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const v = row[yField];
    if (v != null && !isNaN(Number(v))) map.set(String(row[xField]), Number(v));
  }
  return categories.map((cat) => {
    const v = map.get(cat);
    return v != null ? yTransform ? yTransform(v) : v : null;
  });
}
function buildCategoryAlignedXYData(rows, xField, yField, yCategories) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = String(row[yField] ?? "");
    if (!map.has(key)) {
      map.set(key, row[xField]);
    }
  }
  return yCategories.filter((cat) => map.has(cat)).map((cat) => [map.get(cat), cat]);
}
var RANK_SEMANTIC_TYPES2 = /* @__PURE__ */ new Set(["Rank", "Score", "Level"]);
var ecBumpChartDef = {
  chart: "Bump Chart",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 80, y: 20, seriesCountAxis: "auto" } }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, semanticTypes } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const colorField = channelSemantics.color?.field;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const ySemType = toTypeString(semanticTypes?.[yField]);
    const xSemType = toTypeString(semanticTypes?.[xField]);
    const yIsRank = RANK_SEMANTIC_TYPES2.has(ySemType);
    const xIsRank = RANK_SEMANTIC_TYPES2.has(xSemType);
    const rankOnY = yIsRank && !xIsRank;
    const xIsDiscrete = isDiscrete8(xCS.type);
    const xIsTemporal = xCS.type === "temporal";
    const categories = xIsDiscrete ? extractCategories(table, xField, getCategoryOrder(ctx, "x")) : void 0;
    const rankValues = table.map((r) => Number(r[yField])).filter((v) => !isNaN(v) && isFinite(v));
    const maxRank = rankValues.length ? Math.max(...rankValues) : 1;
    const rankCategories = Array.from({ length: maxRank }, (_, i) => String(i + 1));
    const rankToIndex = (rank) => Math.max(0, Math.min(maxRank - 1, Math.round(rank) - 1));
    const toXValue = (v) => {
      if (v == null) return NaN;
      if (xIsTemporal) return typeof v === "number" ? v : new Date(String(v)).getTime();
      const n = Number(v);
      return isNaN(n) ? String(v) : n;
    };
    const sortRowsByX = (rows) => [...rows].sort((a, b) => {
      const ax = toXValue(a[xField]);
      const bx = toXValue(b[xField]);
      if (typeof ax === "number" && typeof bx === "number") return ax - bx;
      return String(ax).localeCompare(String(bx));
    });
    const option = {
      tooltip: { trigger: "axis" },
      xAxis: (() => {
        const type = xIsDiscrete ? "category" : xIsTemporal ? "time" : "value";
        const base = {
          type,
          name: xField,
          nameLocation: "middle",
          nameGap: 30,
          axisLine: { show: true },
          ...categories ? { data: categories } : {}
        };
        if (xIsDiscrete && categories) {
          base.axisTick = { show: true, alignWithLabel: true };
          base.axisLabel = { rotate: areCategoriesNumeric(categories) ? 0 : 90 };
        } else if (xIsTemporal) {
          base.axisTick = { show: true, alignWithLabel: true };
          base.axisLabel = { rotate: 90 };
        } else {
          base.axisTick = { show: true };
        }
        return base;
      })(),
      yAxis: rankOnY ? {
        type: "category",
        data: rankCategories,
        inverse: true,
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisLabel: { rotate: 0 },
        axisTick: { show: true, alignWithLabel: true }
      } : {
        type: "value",
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      },
      series: []
    };
    if (rankOnY) {
      option.tooltip = {
        trigger: "axis",
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          if (list.length === 0) return "";
          const p = list[0];
          const cat = p.axisValue ?? p.name ?? "";
          let html = `<b>${cat}</b><br/>`;
          list.forEach((item) => {
            const idx = item.value != null ? Number(item.value) : null;
            const displayRank = idx != null && Number.isInteger(idx) ? String(idx + 1) : "\u2013";
            html += `${item.marker} ${item.seriesName}: ${displayRank}<br/>`;
          });
          return html;
        }
      };
    } else {
      option._encodingTooltip = { trigger: "axis", categoryLabel: xField, valueLabel: yField };
    }
    const baseSeriesOpt = { showSymbol: true, symbolSize: 6, smooth: true };
    if (colorField) {
      const groups = groupBy(table, colorField);
      option.legend = { data: [...groups.keys()] };
      for (const [name, rows] of groups) {
        const orderedRows = xIsDiscrete ? rows : sortRowsByX(rows);
        const seriesData = xIsDiscrete ? buildCategoryAlignedData(rows, xField, yField, categories, rankOnY ? rankToIndex : void 0) : orderedRows.map((r) => [toXValue(r[xField]), rankOnY ? rankToIndex(Number(r[yField])) : r[yField]]);
        option.series.push({
          name,
          type: "line",
          data: seriesData,
          ...baseSeriesOpt
          // 颜色由 ecApplyLayoutToSpec 根据 colorDecisions 统一分配
        });
      }
    } else {
      const rows = xIsDiscrete ? table : sortRowsByX(table);
      const seriesData = xIsDiscrete ? buildCategoryAlignedData(rows, xField, yField, categories, rankOnY ? rankToIndex : void 0) : rows.map((r) => [toXValue(r[xField]), rankOnY ? rankToIndex(Number(r[yField])) : r[yField]]);
      option.series.push({ type: "line", data: seriesData, ...baseSeriesOpt });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/slope.ts
function orderPeriods(categories) {
  if (categories.length <= 1) return categories;
  const allNumeric = categories.every((c) => c.trim() !== "" && !isNaN(Number(c)));
  if (allNumeric) return [...categories].sort((a, b) => Number(a) - Number(b));
  const allDates = categories.every((c) => !isNaN(Date.parse(c)));
  if (allDates) return [...categories].sort((a, b) => Date.parse(a) - Date.parse(b));
  return categories;
}
function alignToPeriods(rows, xField, yField, categories) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const v = row[yField];
    if (v != null && !isNaN(Number(v))) map.set(String(row[xField]), Number(v));
  }
  return categories.map((cat) => {
    const v = map.get(cat);
    return v != null ? v : null;
  });
}
var ecSlopeChartDef = {
  chart: "Slope Chart",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    axisFlags: { x: { banded: true } },
    paramOverrides: {
      defaultBandSize: 120,
      continuousMarkCrossSection: { x: 0, y: 0, seriesCountAxis: "auto" }
    }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const groupField = channelSemantics.color?.field ?? channelSemantics.detail?.field;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const categories = orderPeriods(extractCategories(table, xField, getCategoryOrder(ctx, "x")));
    const option = {
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: categories,
        name: xField,
        nameLocation: "middle",
        nameGap: 30,
        boundaryGap: true,
        axisLine: { show: true },
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: { rotate: 0 }
      },
      yAxis: {
        type: "value",
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      },
      series: []
    };
    option._encodingTooltip = { trigger: "axis", categoryLabel: xField, valueLabel: yField };
    if (channelSemantics.y?.zero) {
      option.yAxis.scale = !channelSemantics.y.zero.zero;
    } else {
      option.yAxis.scale = true;
    }
    const baseSeriesOpt = {
      type: "line",
      showSymbol: true,
      symbol: "circle",
      symbolSize: 7,
      // Straight segments — never smooth/monotone for a slopegraph.
      smooth: false
    };
    if (groupField) {
      const groups = groupBy(table, groupField);
      option.legend = { data: [...groups.keys()] };
      for (const [name, rows] of groups) {
        option.series.push({
          name,
          ...baseSeriesOpt,
          data: alignToPeriods(rows, xField, yField, categories)
          // Colors assigned by ecApplyLayoutToSpec from colorDecisions.
        });
      }
    } else {
      option.series.push({
        ...baseSeriesOpt,
        data: alignToPeriods(table, xField, yField, categories)
      });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/area.ts
var isDiscrete9 = (type) => type === "nominal" || type === "ordinal";
function areCategoriesNumeric2(cats) {
  if (cats.length === 0) return true;
  return cats.every((c) => {
    const s = String(c).trim();
    if (s === "") return false;
    const n = Number(s);
    return !isNaN(n) && isFinite(n);
  });
}
var ecAreaChartDef = {
  chart: "Area Chart",
  template: { mark: "area", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" } }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const colorField = channelSemantics.color?.field;
    const colorType = channelSemantics.color?.type;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const xIsDiscrete = isDiscrete9(xCS.type);
    const xIsTemporal = xCS.type === "temporal";
    const yIsDiscrete = isDiscrete9(yCS.type);
    const isContinuousColor2 = !!colorField && (colorType === "quantitative" || colorType === "temporal");
    const categories = xIsDiscrete ? extractCategories(table, xField, getCategoryOrder(ctx, "x")) : void 0;
    const yCategories = yIsDiscrete ? extractCategories(table, yField, getCategoryOrder(ctx, "y")) : void 0;
    const option = {
      tooltip: { trigger: "axis" },
      xAxis: (() => {
        const type = xIsDiscrete ? "category" : xIsTemporal ? "time" : "value";
        const base = {
          type,
          name: xField,
          nameLocation: "middle",
          nameGap: 30,
          boundaryGap: xIsDiscrete,
          ...categories ? { data: categories } : {}
        };
        if (xIsDiscrete && categories) {
          base.axisTick = { show: true, alignWithLabel: true };
          base.axisLabel = { rotate: areCategoriesNumeric2(categories) ? 0 : 90 };
        } else if (xIsTemporal) {
          base.axisTick = { show: true, alignWithLabel: true };
          base.axisLabel = { rotate: 90 };
        } else {
          base.axisTick = { show: true };
          base.axisLabel = { rotate: 0 };
        }
        return base;
      })(),
      yAxis: yIsDiscrete && yCategories ? {
        type: "category",
        data: yCategories,
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: { rotate: 0 }
      } : {
        type: "value",
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      },
      series: []
    };
    option._encodingTooltip = { trigger: "axis", categoryLabel: xField, valueLabel: yField };
    if (channelSemantics.y?.zero) {
      option.yAxis.scale = !channelSemantics.y.zero.zero;
    }
    const stackMode = chartProperties?.stackMode;
    const stackGroup = stackMode === "layered" ? void 0 : "total";
    const opacity = chartProperties?.opacity ?? 0.7;
    const interpolate = chartProperties?.interpolate;
    const smooth = interpolate === "monotone" || interpolate === "basis" || interpolate === "cardinal" || interpolate === "catmull-rom";
    const step = interpolate === "step" ? "middle" : interpolate === "step-before" ? "start" : interpolate === "step-after" ? "end" : void 0;
    if (isContinuousColor2 && colorField) {
      const sorted = [...table].sort((a, b) => {
        const ax = a[xField];
        const bx = b[xField];
        if (xIsTemporal) return new Date(ax).getTime() - new Date(bx).getTime();
        const na = Number(ax);
        const nb = Number(bx);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(ax).localeCompare(String(bx));
      });
      const pointData = sorted.map((r) => [r[xField], r[yField], r[colorField]]);
      const lineData = sorted.map((r) => [r[xField], r[yField]]);
      const nums = sorted.map((r) => Number(r[colorField])).filter((v) => !isNaN(v) && isFinite(v));
      const cMin = nums.length ? Math.min(...nums) : 0;
      const cMax = nums.length ? Math.max(...nums) : 1;
      option.tooltip = { trigger: "item" };
      option._encodingTooltip = {
        trigger: "item",
        parts: [
          { from: "data", index: 0, label: xField, format: xIsTemporal ? "temporal" : "number", temporalFormat: channelSemantics.x?.temporalFormat ?? "%b %d, %Y" },
          { from: "data", index: 1, label: yField, format: "number" },
          { from: "data", index: 2, label: colorField, format: colorType === "temporal" ? "temporal" : "number", temporalFormat: channelSemantics.color?.temporalFormat ?? "%b %d, %Y" }
        ]
      };
      const decisionSchemeId = colorDecisions?.color?.schemeId;
      const paletteFromDecision = decisionSchemeId ? getPaletteForScheme(decisionSchemeId) : void 0;
      option.visualMap = {
        type: "continuous",
        min: cMin,
        max: cMax,
        dimension: 2,
        orient: "vertical",
        right: 10,
        top: "center",
        inRange: {
          color: paletteFromDecision && paletteFromDecision.length > 0 ? paletteFromDecision : ["#f7fcf5", "#74c476", "#00441b"]
        },
        seriesIndex: 1,
        name: colorField,
        textStyle: { fontSize: 10 },
        calculable: true
      };
      option._visualMapWidth = 70;
      option.graphic = [
        ...Array.isArray(option.graphic) ? option.graphic : option.graphic ? [option.graphic] : [],
        {
          type: "text",
          right: 10,
          top: 4,
          z: 100,
          style: {
            text: colorField,
            fontSize: 11,
            fontWeight: "bold",
            fill: "#333",
            textAlign: "right"
          }
        }
      ];
      option.series.push({
        type: "line",
        data: lineData,
        showSymbol: false,
        symbol: "none",
        areaStyle: { opacity },
        itemStyle: { color: "#999" },
        lineStyle: { color: "#999" },
        ...smooth ? { smooth: true } : {},
        ...step ? { step } : {}
      });
      option.series.push({
        type: "scatter",
        data: pointData,
        symbol: "circle",
        symbolSize: 8,
        itemStyle: { opacity: 1 }
      });
    } else if (colorField) {
      const groups = groupBy(table, colorField);
      option.legend = { data: [...groups.keys()] };
      const useValueAlignedStack = stackGroup && !xIsDiscrete && !xIsTemporal && !yIsDiscrete;
      const sortedX = useValueAlignedStack ? getSortedUniqueXValues(table, xField) : void 0;
      if (useValueAlignedStack && sortedX && sortedX.length > 0) {
        option.xAxis = {
          type: "category",
          data: sortedX,
          boundaryGap: false,
          name: xField,
          nameLocation: "middle",
          nameGap: 30,
          axisLabel: { rotate: 0 }
        };
      }
      const sortedDates = xIsTemporal ? getSortedUniqueDates(table, xField) : void 0;
      for (const [name, rows] of groups) {
        const seriesData = xIsDiscrete ? buildCategoryAlignedData2(rows, xField, yField, categories) : useValueAlignedStack && sortedX ? buildValueAlignedYData(rows, xField, yField, sortedX) : sortedDates ? buildTimeAlignedData(rows, xField, yField, sortedDates) : rows.map((r) => [r[xField], r[yField]]);
        const series = {
          name,
          type: "line",
          data: seriesData,
          showSymbol: false,
          symbol: "none",
          areaStyle: { opacity }
          // 颜色由 ecApplyLayoutToSpec 根据 colorDecisions 统一分配
        };
        if (stackGroup) series.stack = stackGroup;
        if (smooth) series.smooth = true;
        if (step) series.step = step;
        option.series.push(series);
      }
    } else {
      const seriesData = yIsDiscrete && yCategories ? buildCategoryAlignedXYData2(table, xField, yField, yCategories) : xIsDiscrete ? categories.map((cat) => {
        const row = table.find((r) => String(r[xField]) === cat);
        return row ? row[yField] : null;
      }) : xIsTemporal ? (() => {
        const sorted = [...table].sort((a, b) => new Date(a[xField]).getTime() - new Date(b[xField]).getTime());
        return sorted.map((r) => [r[xField], r[yField]]);
      })() : table.map((r) => [r[xField], r[yField]]);
      const series = {
        type: "line",
        data: seriesData,
        showSymbol: false,
        symbol: "none",
        areaStyle: { opacity }
      };
      if (smooth) series.smooth = true;
      if (step) series.step = step;
      option.series.push(series);
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "interpolate",
      label: "Curve",
      type: "discrete",
      options: [
        { value: void 0, label: "Default (linear)" },
        { value: "linear", label: "Linear" },
        { value: "monotone", label: "Monotone (smooth)" },
        { value: "step", label: "Step" },
        { value: "step-before", label: "Step Before" },
        { value: "step-after", label: "Step After" }
      ]
    },
    { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 0.7 },
    {
      key: "stackMode",
      label: "Stack",
      type: "discrete",
      options: [
        { value: void 0, label: "Stacked (default)" },
        { value: "normalize", label: "Normalize (100%)" },
        { value: "center", label: "Center" },
        { value: "layered", label: "Layered (overlap)" }
      ]
    }
  ]
};
function buildCategoryAlignedData2(rows, xField, yField, categories) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const v = row[yField];
    if (v != null && !isNaN(Number(v))) {
      const k = String(row[xField]);
      map.set(k, (map.get(k) ?? 0) + Number(v));
    }
  }
  return categories.map((cat) => map.get(cat) ?? null);
}
function buildCategoryAlignedXYData2(rows, xField, yField, yCategories) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = String(row[yField] ?? "");
    if (!map.has(key)) {
      map.set(key, row[xField]);
    }
  }
  return yCategories.filter((cat) => map.has(cat)).map((cat) => [map.get(cat), cat]);
}
function getSortedUniqueDates(table, xField) {
  const set = /* @__PURE__ */ new Set();
  for (const row of table) {
    const v = row[xField];
    if (v != null && v !== "") set.add(String(v));
  }
  return [...set].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}
function getSortedUniqueXValues(table, xField) {
  const set = /* @__PURE__ */ new Set();
  for (const row of table) {
    const v = row[xField];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}
function buildValueAlignedYData(rows, xField, yField, sortedX) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const x = Number(row[xField]);
    const y = Number(row[yField]);
    if (!Number.isFinite(x)) continue;
    map.set(x, Number.isFinite(y) ? y : 0);
  }
  return sortedX.map((x) => map.get(x) ?? 0);
}
function buildTimeAlignedData(rows, xField, yField, sortedDates) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const n = Number(row[yField]);
    map.set(String(row[xField]), Number.isFinite(n) ? n : 0);
  }
  return sortedDates.map((d) => [d, map.get(d) ?? 0]);
}

// src/echarts/templates/range-area.ts
var isDiscrete10 = (type) => type === "nominal" || type === "ordinal";
function orderedXLabels(table, xField, xType, ordinalOrder) {
  if (isDiscrete10(xType)) {
    return { labels: extractCategories(table, xField, ordinalOrder), isTemporal: false };
  }
  const isTemporal2 = xType === "temporal";
  const seen = /* @__PURE__ */ new Map();
  for (const row of table) {
    const v = row[xField];
    if (v == null || v === "") continue;
    const key = String(v);
    if (!seen.has(key)) seen.set(key, v);
  }
  const raw = [...seen.values()];
  if (isTemporal2) {
    raw.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  } else {
    raw.sort((a, b) => Number(a) - Number(b));
  }
  return { labels: raw.map((v) => String(v)), isTemporal: isTemporal2 };
}
function fmtTemporalLabel(s) {
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return s;
  return new Date(t).toLocaleDateString(void 0, { month: "short", day: "numeric", year: "numeric" });
}
function alignBounds(rows, xField, lowField, highField, labels) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const lo = Number(row[lowField]);
    const hi = Number(row[highField]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    map.set(String(row[xField]), { low: Math.min(lo, hi), high: Math.max(lo, hi) });
  }
  return labels.map((l) => {
    const v = map.get(l);
    return v ? { low: v.low, high: v.high } : { low: null, high: null };
  });
}
var ecRangeAreaChartDef = {
  chart: "Range Area Chart",
  template: { mark: "area", encoding: {} },
  channels: ["x", "y", "y2", "color", "column", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" } }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const y2CS = channelSemantics.y2;
    const colorField = channelSemantics.color?.field;
    if (!xCS?.field || !yCS?.field || !y2CS?.field) return;
    const xField = xCS.field;
    const lowField = yCS.field;
    const highField = y2CS.field;
    const { labels, isTemporal: isTemporal2 } = orderedXLabels(
      table,
      xField,
      xCS.type,
      getCategoryOrder(ctx, "x")
    );
    const displayLabels = isTemporal2 ? labels.map(fmtTemporalLabel) : labels;
    const opacity = ctx.chartProperties?.opacity ?? 0.35;
    const valueTitle = lowField === highField ? lowField : `${lowField}, ${highField}`;
    const option = {
      tooltip: {
        trigger: "axis",
        // Show the low–high range at each x (the delta series carries the
        // original bounds as `_low` / `_high`; the transparent base
        // series has plain numeric data and is skipped).
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params];
          if (list.length === 0) return "";
          const head = list[0].axisValueLabel ?? list[0].axisValue ?? list[0].name ?? "";
          const lines = [`${xField}: ${head}`];
          for (const p of list) {
            const d = p?.data;
            if (d && typeof d === "object" && d._high != null) {
              const nm = p.seriesName && !String(p.seriesName).startsWith("__base") ? p.seriesName : "Range";
              lines.push(`${nm}: ${fmtNum(d._low)} \u2013 ${fmtNum(d._high)}`);
            }
          }
          return lines.join("<br/>");
        }
      },
      xAxis: {
        type: "category",
        data: displayLabels,
        name: xField,
        nameLocation: "middle",
        nameGap: 30,
        boundaryGap: false,
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: { rotate: isTemporal2 ? 30 : 0 }
      },
      yAxis: {
        type: "value",
        // A ranged area reads its extent, not its distance from zero —
        // fit the band rather than forcing a zero baseline.
        scale: true,
        name: valueTitle,
        nameLocation: "middle",
        nameGap: 45,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      },
      series: []
    };
    const pushBand = (rows, name, idx) => {
      const bounds = alignBounds(rows, xField, lowField, highField, labels);
      const stackId = `band-${idx}`;
      const baseName = `__base-${idx}`;
      option.series.push({
        name: baseName,
        type: "line",
        stack: stackId,
        // Cumulative stacking regardless of sign — otherwise ECharts
        // routes a negative lower bound into a separate negative stack
        // and the band collapses to the zero baseline (see the
        // zero-crossing case).
        stackStrategy: "all",
        data: bounds.map((b) => b.low),
        symbol: "none",
        showSymbol: false,
        lineStyle: { opacity: 0 },
        itemStyle: { color: "transparent" },
        silent: true,
        z: 1
      });
      option.series.push({
        name: name ?? lowField,
        type: "line",
        stack: stackId,
        stackStrategy: "all",
        data: bounds.map(
          (b) => b.low != null && b.high != null ? { value: b.high - b.low, _low: b.low, _high: b.high } : { value: null, _low: null, _high: null }
        ),
        symbol: "none",
        showSymbol: false,
        lineStyle: { width: 1.5, opacity: 0.9 },
        areaStyle: { opacity },
        emphasis: { focus: "series" },
        z: 2
      });
    };
    if (colorField) {
      const groups = groupBy(table, colorField);
      option.legend = { data: [...groups.keys()] };
      let idx = 0;
      for (const [name, rows] of groups) {
        pushBand(rows, name, idx);
        idx++;
      }
    } else {
      pushBand(table, void 0, 0);
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};
function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// src/echarts/templates/pie.ts
var ecPieChartDef = {
  chart: "Pie Chart",
  template: { mark: "arc", encoding: {} },
  channels: ["size", "color", "column", "row"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const colorField = channelSemantics.color?.field;
    const sizeField = channelSemantics.size?.field;
    const pieData = [];
    if (colorField && sizeField) {
      const agg = /* @__PURE__ */ new Map();
      for (const row of table) {
        const cat = String(row[colorField] ?? "");
        const val = Number(row[sizeField]) || 0;
        agg.set(cat, (agg.get(cat) ?? 0) + val);
      }
      const categories = extractCategories(table, colorField, channelSemantics.color?.ordinalSortOrder);
      for (const cat of categories) {
        pieData.push({ name: cat, value: agg.get(cat) ?? 0 });
      }
    } else if (colorField) {
      const counts = /* @__PURE__ */ new Map();
      for (const row of table) {
        const cat = String(row[colorField] ?? "");
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
      const categories = extractCategories(table, colorField, channelSemantics.color?.ordinalSortOrder);
      for (const cat of categories) {
        pieData.push({ name: cat, value: counts.get(cat) ?? 0 });
      }
    } else if (sizeField) {
      for (const row of table) {
        const val = Number(row[sizeField]) || 0;
        pieData.push({ name: String(val), value: val });
      }
    }
    const innerRadius = chartProperties?.innerRadius ?? 0;
    const sortSlices = chartProperties?.sortSlices;
    if (sortSlices === "descending") {
      pieData.sort((a, b) => b.value - a.value);
    } else if (sortSlices === "ascending") {
      pieData.sort((a, b) => a.value - b.value);
    }
    const labelType = chartProperties?.labelType ?? "categoryPercent";
    const labelFormatter = {
      none: void 0,
      category: "{b}",
      value: "{c}",
      percent: "{d}%",
      categoryPercent: "{b}: {d}%"
    };
    const formatter = labelFormatter[labelType] ?? "{b}: {d}%";
    const sliceValues = pieData.map((d) => d.value);
    const effectiveCount = computeEffectiveBarCount(sliceValues);
    const { radius: pressureRadius, canvasW: rawCanvasW, canvasH } = computeCircumferencePressure(effectiveCount, ctx.canvasSize, {
      minArcPx: 45,
      minRadius: 60,
      maxStretch: ctx.assembleOptions?.maxStretch,
      maxStretchX: ctx.assembleOptions?.maxStretchX,
      maxStretchY: ctx.assembleOptions?.maxStretchY,
      // 增大 margin，给外侧标签留出更多画布空间，避免文字被裁切。
      margin: 80
    });
    const canvasW = rawCanvasW;
    const n = pieData.length;
    const labelFontSize = n <= 4 ? 13 : n <= 8 ? 11 : n <= 15 ? 10 : 9;
    const maxLabelChars = pieData.reduce((m, d) => {
      const len = String(d.name ?? "").length;
      return len > m ? len : m;
    }, 0);
    const approxCharWidth = labelFontSize * 0.55;
    const neededLabelWidth = Math.max(40, maxLabelChars * approxCharWidth);
    const baseRadiusFraction = n <= 4 ? 0.72 : n <= 8 ? 0.62 : n <= 15 ? 0.54 : 0.48;
    const halfCanvas = (canvasW - 40) / 2;
    const padding = 16;
    const maxLabelWidthAvailable = Math.max(40, halfCanvas - halfCanvas * baseRadiusFraction - padding);
    const labelBudget = Math.min(neededLabelWidth, maxLabelWidthAvailable);
    const radiusFraction = baseRadiusFraction;
    const labelLineLength = Math.max(10, Math.min(22, 10 + neededLabelWidth * 0.1));
    const labelLineLength2 = Math.max(8, Math.min(26, 8 + neededLabelWidth * 0.15));
    const outerRadiusPx = Math.max(60, Math.round(
      Math.min(
        pressureRadius,
        (canvasW - 40) / 2 * radiusFraction,
        (canvasH - 40) / 2 * radiusFraction
      )
    ));
    const outerRadius = `${outerRadiusPx}px`;
    const categoryLabel = colorField ?? "Category";
    const valueLabel = sizeField ?? "Value";
    const option = {
      tooltip: { trigger: "item" },
      _encodingTooltip: {
        trigger: "item",
        parts: [
          { from: "name", label: categoryLabel },
          { from: "value", label: valueLabel, format: "number" }
        ]
      },
      series: [{
        type: "pie",
        radius: innerRadius > 0 ? [`${Math.round(outerRadiusPx * innerRadius / 100)}px`, outerRadius] : ["0%", outerRadius],
        center: ["50%", "50%"],
        data: pieData,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)"
          }
        },
        label: {
          show: labelType !== "none",
          formatter: formatter ?? "{b}: {d}%",
          fontSize: labelFontSize,
          width: labelBudget,
          overflow: "break"
          // word-wrap long labels
        },
        // 让 ECharts 尝试自动避免标签重叠，并在必要时隐藏重叠标签，
        // 减少标签被挤到画布外的概率。
        avoidLabelOverlap: true,
        labelLayout: {
          hideOverlap: true
        },
        labelLine: {
          show: true,
          length: labelLineLength,
          length2: labelLineLength2
        },
        itemStyle: {
          borderRadius: chartProperties?.cornerRadius ?? 0
        }
      }]
      // 颜色由 ecApplyLayoutToSpec 根据 colorDecisions 设置 option.color
    };
    option._width = canvasW;
    option._height = canvasH;
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "innerRadius", label: "Donut", type: "continuous", min: 0, max: 60, step: 5, defaultValue: 0 },
    { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 10, step: 1, defaultValue: 0 },
    {
      key: "sortSlices",
      label: "Sort slices",
      type: "discrete",
      options: [
        { value: "none", label: "Data order" },
        { value: "descending", label: "Largest first" },
        { value: "ascending", label: "Smallest first" }
      ],
      defaultValue: "none"
    },
    {
      key: "labelType",
      label: "Labels",
      type: "discrete",
      options: [
        { value: "categoryPercent", label: "Name + %" },
        { value: "category", label: "Name" },
        { value: "value", label: "Value" },
        { value: "percent", label: "Percent" },
        { value: "none", label: "None" }
      ],
      defaultValue: "categoryPercent"
    }
  ]
};

// src/echarts/templates/heatmap.ts
function areCategoriesNumeric3(cats) {
  if (cats.length === 0) return true;
  return cats.every((c) => {
    const s = String(c).trim();
    if (s === "") return false;
    const n = Number(s);
    return !isNaN(n) && isFinite(n);
  });
}
var SCHEME_COLORS = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  plasma: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"],
  turbo: ["#30123b", "#4662d7", "#35abed", "#1ae4b6", "#72fe5e", "#c8ef34", "#faba39", "#f66b19", "#d23105", "#7a0403"],
  blues: ["#f7fbff", "#6baed6", "#08519c"],
  reds: ["#fff5f0", "#fb6a4a", "#a50f15"],
  greens: ["#f7fcf5", "#74c476", "#00441b"],
  oranges: ["#fff5eb", "#fd8d3c", "#7f2704"],
  purples: ["#fcfbfd", "#9e9ac8", "#3f007d"],
  greys: ["#ffffff", "#969696", "#252525"],
  blueorange: ["#08519c", "#f7fbff", "#ff7f00"],
  redblue: ["#a50f15", "#ffffff", "#08519c"]
};
var DEFAULT_HEATMAP_SCHEME2 = "blues";
function isDivergingHeatmapScheme2(scheme) {
  return scheme === "blueorange" || scheme === "redblue";
}
var ecHeatmapDef = {
  chart: "Heatmap",
  template: { mark: "rect", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "color",
  declareLayoutMode: () => ({
    axisFlags: { x: { banded: true }, y: { banded: true } }
    // No paramOverrides needed — uses the backend default band size
    // (defaultBandSize=20, minStep=6), matching VL heatmap sizing.
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, colorDecisions, encodings } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const colorCS = channelSemantics.color;
    const xField = xCS?.field;
    const yField = yCS?.field;
    const colorField = colorCS?.field;
    if (!xField || !yField) return;
    const xCategories = extractCategories(table, xField, xCS?.ordinalSortOrder);
    const yCategories = extractCategories(table, yField, yCS?.ordinalSortOrder);
    const xIndexMap = new Map(xCategories.map((c, i) => [c, i]));
    const yIndexMap = new Map(yCategories.map((c, i) => [c, i]));
    const heatData = [];
    let minVal = Infinity;
    let maxVal = -Infinity;
    const cellMap = /* @__PURE__ */ new Map();
    for (const row of table) {
      const xKey = String(row[xField]);
      const yKey = String(row[yField]);
      const val = colorField ? Number(row[colorField]) || 0 : 1;
      const cellKey = `${xKey}|||${yKey}`;
      cellMap.set(cellKey, (cellMap.get(cellKey) ?? 0) + val);
    }
    for (const [cellKey, val] of cellMap) {
      const [xKey, yKey] = cellKey.split("|||");
      const xi = xIndexMap.get(xKey);
      const yi = yIndexMap.get(yKey);
      if (xi !== void 0 && yi !== void 0) {
        heatData.push([xi, yi, val]);
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
    }
    if (minVal === Infinity) minVal = 0;
    if (maxVal === -Infinity) maxVal = 1;
    const encScheme = encodings?.color?.scheme;
    const userScheme = encScheme && encScheme !== "default" ? encScheme : void 0;
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    const semanticIsDiverging = decision?.schemeType === "diverging";
    const schemeName = userScheme || (semanticIsDiverging ? "redblue" : DEFAULT_HEATMAP_SCHEME2);
    const isDivergingScale = semanticIsDiverging || isDivergingHeatmapScheme2(schemeName);
    if (isDivergingScale && minVal < 0 && maxVal > 0) {
      const sym = Math.max(Math.abs(minVal), Math.abs(maxVal));
      minVal = -sym;
      maxVal = sym;
    }
    let schemeColors;
    if (decision) {
      let paletteFromDecision;
      if (decision.schemeId) {
        paletteFromDecision = getPaletteForScheme(decision.schemeId);
      }
      if (!paletteFromDecision || paletteFromDecision.length === 0) {
        if (decision.schemeType === "diverging") {
          paletteFromDecision = getPaletteForScheme("RdBu");
        } else if (decision.schemeType === "sequential") {
          paletteFromDecision = SCHEME_COLORS[DEFAULT_HEATMAP_SCHEME2];
        }
      }
      if (paletteFromDecision && paletteFromDecision.length > 0) {
        schemeColors = paletteFromDecision;
      } else {
        schemeColors = SCHEME_COLORS[schemeName] || SCHEME_COLORS[DEFAULT_HEATMAP_SCHEME2];
      }
    } else {
      schemeColors = SCHEME_COLORS[schemeName] || SCHEME_COLORS[DEFAULT_HEATMAP_SCHEME2];
    }
    const option = {
      tooltip: { position: "top" },
      _encodingTooltip: {
        trigger: "item",
        parts: [
          { from: "data", index: 0, label: xField, format: "category", categoryNames: xCategories },
          { from: "data", index: 1, label: yField, format: "category", categoryNames: yCategories },
          { from: "data", index: 2, label: colorField ?? "Value", format: "number" }
        ]
      },
      xAxis: {
        type: "category",
        data: xCategories,
        name: xField,
        splitArea: { show: true },
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: {
          rotate: areCategoriesNumeric3(xCategories) ? 0 : 90
        }
      },
      yAxis: {
        type: "category",
        data: yCategories,
        name: yField,
        splitArea: { show: true },
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: { rotate: 0 }
      },
      visualMap: {
        min: minVal,
        max: maxVal,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        inRange: {
          color: schemeColors
        }
      },
      series: [{
        type: "heatmap",
        data: heatData,
        label: {
          show: heatData.length <= 100
          // Show labels for small heatmaps
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.5)"
          }
        }
      }]
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  postProcess: (option, ctx) => {
    const heatSeries = option.series?.find((s) => s.type === "heatmap");
    const { layout } = ctx;
    const cellW = layout.xStep || 50;
    const cellH = layout.yStep || 50;
    const minDim = Math.min(cellW, cellH);
    if (heatSeries?.label) {
      if (minDim < 30) {
        heatSeries.label.show = false;
      } else {
        const fontSize = Math.max(8, Math.min(12, Math.round(minDim * 0.2)));
        heatSeries.label.fontSize = fontSize;
        if (cellW < 50) {
          const maxChars = Math.max(2, Math.floor(cellW / (fontSize * 0.6)));
          heatSeries.label.formatter = (params) => {
            const val = params.data[2];
            const s = String(val);
            return s.length > maxChars ? s.slice(0, maxChars) : s;
          };
        }
      }
    }
    if (option.visualMap && option.grid) {
      const vmHeight = 50;
      option.grid.bottom = (option.grid.bottom || 30) + vmHeight;
      option.visualMap.bottom = 5;
      if (option._height) {
        option._height += vmHeight;
      }
    }
  },
  encodingActions: [
    {
      key: "colorScheme",
      label: "Scheme",
      isApplicable: (ctx) => !!ctx.encodings.color?.field,
      dependencies: ["color"],
      control: {
        type: "discrete",
        options: [
          { value: void 0, label: "Default (Blues)" },
          { value: "viridis", label: "Viridis" },
          { value: "inferno", label: "Inferno" },
          { value: "magma", label: "Magma" },
          { value: "plasma", label: "Plasma" },
          { value: "turbo", label: "Turbo" },
          { value: "blues", label: "Blues" },
          { value: "reds", label: "Reds" },
          { value: "greens", label: "Greens" },
          { value: "oranges", label: "Oranges" },
          { value: "purples", label: "Purples" },
          { value: "greys", label: "Greys" },
          { value: "blueorange", label: "Blue-Orange (diverging)" },
          { value: "redblue", label: "Red-Blue (diverging)" }
        ]
      },
      get: (enc) => enc.color?.scheme,
      set: (enc, value) => ({ ...enc, color: { ...enc.color, scheme: value } })
    }
  ],
  pivot: makeCartesianPivot({ transpose: [["x", "y"]] })
};

// src/echarts/templates/histogram.ts
var ecHistogramDef = {
  chart: "Histogram",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "color", "column", "row"],
  markCognitiveChannel: "length",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xField = channelSemantics.x?.field;
    const colorField = channelSemantics.color?.field;
    if (!xField) return;
    const values = table.map((r) => Number(r[xField])).filter((v) => isFinite(v));
    if (values.length === 0) return;
    const binCount = chartProperties?.binCount || 10;
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;
    const binWidth = range > 0 ? range / binCount : 1;
    if (!colorField) {
      const counts = new Array(binCount).fill(0);
      for (const v of values) {
        let idx = Math.floor((v - minVal) / binWidth);
        if (idx >= binCount) idx = binCount - 1;
        counts[idx]++;
      }
      const categories = counts.map((_, i) => {
        const lo = (minVal + i * binWidth).toFixed(1);
        const hi = (minVal + (i + 1) * binWidth).toFixed(1);
        return `${lo}\u2013${hi}`;
      });
      const option = {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" }
        },
        xAxis: {
          type: "category",
          data: categories,
          name: xField,
          nameLocation: "middle",
          nameGap: 25,
          axisTick: { show: true, alignWithLabel: true },
          axisLabel: { rotate: categories.length > 10 ? 45 : 0 }
        },
        yAxis: {
          type: "value",
          name: "Count",
          nameLocation: "middle",
          nameGap: 40,
          axisTick: { show: true }
        },
        series: [{
          type: "bar",
          data: counts,
          barCategoryGap: "0%",
          // contiguous bars
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 0.5
          }
        }]
      };
      option._encodingTooltip = { trigger: "axis", categoryLabel: xField, valueLabel: "Count" };
      Object.assign(spec, option);
    } else {
      const groupValues = /* @__PURE__ */ new Map();
      for (const row of table) {
        const v = Number(row[xField]);
        if (!isFinite(v)) continue;
        const g = String(row[colorField] ?? "");
        if (!groupValues.has(g)) groupValues.set(g, []);
        groupValues.get(g).push(v);
      }
      const categories = Array.from({ length: binCount }, (_, i) => {
        const lo = (minVal + i * binWidth).toFixed(1);
        const hi = (minVal + (i + 1) * binWidth).toFixed(1);
        return `${lo}\u2013${hi}`;
      });
      const series = [];
      const legendData = [];
      for (const [name, vals] of groupValues) {
        const counts = new Array(binCount).fill(0);
        for (const v of vals) {
          let idx = Math.floor((v - minVal) / binWidth);
          if (idx >= binCount) idx = binCount - 1;
          counts[idx]++;
        }
        legendData.push(name);
        series.push({
          name,
          type: "bar",
          data: counts,
          stack: "total",
          barCategoryGap: "0%",
          itemStyle: {
            borderColor: "#fff",
            borderWidth: 0.5
          }
        });
      }
      const option = {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: { data: legendData },
        xAxis: {
          type: "category",
          data: categories,
          name: xField,
          nameLocation: "middle",
          nameGap: 25,
          axisTick: { show: true, alignWithLabel: true },
          axisLabel: { rotate: categories.length > 10 ? 45 : 0 }
        },
        yAxis: {
          type: "value",
          name: "Count",
          nameLocation: "middle",
          nameGap: 40,
          axisTick: { show: true }
        },
        series
      };
      option._encodingTooltip = { trigger: "axis", categoryLabel: xField, valueLabel: "Count" };
      Object.assign(spec, option);
    }
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "binCount", label: "Max Bins", type: "continuous", min: 5, max: 50, step: 1, defaultValue: 0 }
  ]
};

// src/echarts/templates/boxplot.ts
var isDiscrete11 = (type) => type === "nominal" || type === "ordinal";
function areCategoriesNumeric4(cats) {
  if (cats.length === 0) return true;
  return cats.every((c) => {
    const s = String(c).trim();
    if (s === "") return false;
    const n = Number(s);
    return !isNaN(n) && isFinite(n);
  });
}
function fiveNumberSummary(values, whiskerMethod = "iqr") {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return [0, 0, 0, 0, 0];
  if (n === 1) return [sorted[0], sorted[0], sorted[0], sorted[0], sorted[0]];
  const median2 = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  if (whiskerMethod === "minmax") {
    return [sorted[0], q1, median2, q3, sorted[n - 1]];
  }
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const whiskerLow = sorted.find((v) => v >= lowerFence) ?? sorted[0];
  const whiskerHigh = [...sorted].reverse().find((v) => v <= upperFence) ?? sorted[n - 1];
  return [whiskerLow, q1, median2, q3, whiskerHigh];
}
function quantile(sorted, p) {
  const n = sorted.length;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
function findOutliers(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return values.filter((v) => v < lo || v > hi);
}
var ecBoxplotDef = {
  chart: "Boxplot",
  template: { mark: "boxplot", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: (cs, table, chartProperties) => {
    if (!cs.x?.field || !cs.y?.field) return {};
    const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: "x" });
    if (!result) return {};
    const decl = {
      axisFlags: { [result.axis]: { banded: true } },
      resolvedTypes: result.resolvedTypes,
      paramOverrides: { defaultBandSize: 28 }
      // box+whisker needs wider bands
    };
    const colorField = cs.color?.field;
    const axisField = cs[result.axis]?.field;
    if (colorField && axisField && isDiscrete11(cs.color?.type)) {
      const plan = planBandDodge(table, axisField, colorField);
      const { mode } = resolveDodge(plan, chartProperties?.dodge);
      if (mode === "local") decl.groupLaneCount = Math.max(1, plan.maxPerBand);
    }
    return decl;
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const colorField = channelSemantics.color?.field;
    const colorType = channelSemantics.color?.type;
    const colorIsDiscrete = colorField && isDiscrete11(colorType);
    if (!xCS?.field || !yCS?.field) return;
    const whiskerMethod = ctx.chartProperties?.whiskerMethod === "minmax" ? "minmax" : "iqr";
    const showOutliers = whiskerMethod === "iqr" && ctx.chartProperties?.showOutliers !== false;
    const xIsDiscrete = isDiscrete11(xCS.type);
    const yIsDiscrete = isDiscrete11(yCS.type);
    let catAxis = "x";
    let valAxis = "y";
    if (yIsDiscrete && !xIsDiscrete) {
      catAxis = "y";
      valAxis = "x";
    }
    const catField = channelSemantics[catAxis].field;
    const valField = channelSemantics[valAxis].field;
    const catCS = channelSemantics[catAxis];
    const categories = extractCategories(table, catField, catCS?.ordinalSortOrder);
    const dodgePlan = colorIsDiscrete && colorField ? planBandDodge(ctx.fullTable ?? table, catField, colorField, {
      nestedSnapThreshold: ctx.chartProperties?.nestedSnapThreshold
    }) : null;
    const dodgeMode = dodgePlan ? resolveDodge(dodgePlan, ctx.chartProperties?.dodge).mode : "none";
    const dodgeColor = dodgeMode !== "none";
    const isHorizontal = catAxis === "y";
    const catAxisLabel = {
      rotate: isHorizontal ? 0 : areCategoriesNumeric4(categories) ? 0 : 90
    };
    const option = {
      tooltip: { trigger: "item" },
      [isHorizontal ? "yAxis" : "xAxis"]: {
        type: "category",
        data: categories,
        name: catField,
        boundaryGap: true,
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: catAxisLabel
      },
      [isHorizontal ? "xAxis" : "yAxis"]: {
        type: "value",
        name: valField,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      },
      series: []
    };
    if (colorIsDiscrete && colorField && dodgeMode === "local") {
      const globalColors = [...new Set(
        (ctx.fullTable ?? table).map((r) => String(r[colorField] ?? ""))
      )].filter(Boolean).sort();
      const palette = pickEChartsPalette(ctx.colorDecisions?.color);
      const colorFor = (g) => palette[Math.max(0, globalColors.indexOf(g)) % palette.length];
      const perBand = /* @__PURE__ */ new Map();
      for (const cat of categories) perBand.set(cat, []);
      for (const r of table) {
        const cat = String(r[catField] ?? "");
        const g = String(r[colorField] ?? "");
        if (!perBand.has(cat) || !g) continue;
        const arr = perBand.get(cat);
        if (!arr.includes(g)) arr.push(g);
      }
      for (const arr of perBand.values()) arr.sort();
      const maxPerBand = Math.max(1, ...[...perBand.values()].map((a) => a.length));
      const catGroups = groupBy(table, catField);
      for (let lane = 0; lane < maxPerBand; lane++) {
        const boxData = [];
        const outlierData = [];
        for (let i = 0; i < categories.length; i++) {
          const cat = categories[i];
          const g = perBand.get(cat)?.[lane];
          if (g === void 0) {
            boxData.push(null);
            continue;
          }
          const rows = (catGroups.get(cat) || []).filter((r) => String(r[colorField] ?? "") === g);
          const values = rows.map((r) => Number(r[valField])).filter((v) => isFinite(v));
          if (!values.length) {
            boxData.push(null);
            continue;
          }
          const c = colorFor(g);
          boxData.push({ value: fiveNumberSummary(values, whiskerMethod), itemStyle: { color: c, borderColor: c } });
          if (showOutliers) {
            for (const o of findOutliers(values)) outlierData.push({ value: [i, o], itemStyle: { color: c } });
          }
        }
        option.series.push({ name: `__lane${lane}`, type: "boxplot", data: boxData });
        if (outlierData.length > 0) {
          option.series.push({ name: `__lane${lane} (outliers)`, type: "scatter", data: outlierData, symbolSize: 4 });
        }
      }
      option.legend = { data: globalColors.map((g) => ({ name: g, itemStyle: { color: colorFor(g) } })) };
      option._legendTitle = colorField;
    } else if (colorIsDiscrete && colorField && dodgeColor) {
      const colorCategories = extractCategories(table, colorField, getCategoryOrder(ctx, "color"));
      const catGroups = groupBy(table, catField);
      for (let cIdx = 0; cIdx < colorCategories.length; cIdx++) {
        const colorName = colorCategories[cIdx];
        const boxData = [];
        const outlierData = [];
        for (let i = 0; i < categories.length; i++) {
          const cat = categories[i];
          const rows = (catGroups.get(cat) || []).filter(
            (r) => String(r[colorField] ?? "") === colorName
          );
          const values = rows.map((r) => Number(r[valField])).filter((v) => isFinite(v));
          boxData.push(values.length ? fiveNumberSummary(values, whiskerMethod) : null);
          if (showOutliers) {
            for (const o of findOutliers(values)) {
              outlierData.push([i, o]);
            }
          }
        }
        option.series.push({
          name: colorName,
          type: "boxplot",
          data: boxData
          // itemStyle 由 ecApplyLayoutToSpec 按 colorDecisions 填充
        });
        if (outlierData.length > 0) {
          option.series.push({
            name: colorName + " (outliers)",
            type: "scatter",
            data: outlierData,
            symbolSize: 4
            // 颜色由 ecApplyLayoutToSpec 按类别与 box 一致分配
          });
        }
      }
      option.legend = { data: colorCategories };
      option._legendTitle = colorField;
    } else {
      const catGroups = groupBy(table, catField);
      const boxData = [];
      const outlierData = [];
      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        const rows = catGroups.get(cat) || [];
        const values = rows.map((r) => Number(r[valField])).filter((v) => isFinite(v));
        boxData.push(fiveNumberSummary(values, whiskerMethod));
        if (showOutliers) {
          for (const o of findOutliers(values)) {
            outlierData.push([i, o]);
          }
        }
      }
      option.series.push({
        type: "boxplot",
        data: boxData
        // 单系列颜色由 ecApplyLayoutToSpec 使用 cat10[0] 等统一默认
      });
      if (outlierData.length > 0) {
        option.series.push({
          name: "Outliers",
          type: "scatter",
          data: outlierData,
          symbolSize: 4
          // 离群点颜色由 ecApplyLayoutToSpec 分配
        });
      }
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "whiskerMethod",
      label: "Whiskers",
      type: "discrete",
      options: [
        { value: "iqr", label: "Tukey (1.5 \xD7 IQR)" },
        { value: "minmax", label: "Min\u2013Max" }
      ],
      defaultValue: "iqr"
    },
    {
      key: "showOutliers",
      label: "Outliers",
      type: "binary",
      defaultValue: true,
      check: (ctx) => ({ applicable: ctx.chartProperties?.whiskerMethod !== "minmax" })
    },
    {
      key: "dodge",
      label: "Dodge",
      type: "discrete",
      options: [
        { value: "auto", label: "Auto" },
        { value: "local", label: "Local (compact)" },
        { value: "global", label: "Global (aligned)" }
      ],
      defaultValue: "auto",
      check: (ctx) => {
        const colorField = ctx.channelSemantics?.color?.field;
        const colorType = ctx.channelSemantics?.color?.type;
        const axisField = isDiscrete11(ctx.channelSemantics?.x?.type) ? ctx.channelSemantics?.x?.field : ctx.channelSemantics?.y?.field;
        const rows = ctx.data;
        if (!colorField || !axisField || !isDiscrete11(colorType) || !rows) {
          return { applicable: false };
        }
        const plan = planBandDodge(rows, axisField, colorField, {
          nestedSnapThreshold: ctx.chartProperties?.nestedSnapThreshold
        });
        return { applicable: plan.ambiguous, recommendedValue: plan.mode === "none" ? "auto" : plan.mode };
      }
    }
  ]
};

// src/echarts/templates/radar.ts
function niceMax2(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const mantissa = v / pow;
  const nice = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 2.5 ? 2.5 : mantissa <= 5 ? 5 : 10;
  return nice * pow;
}
var ecRadarChartDef = {
  chart: "Radar Chart",
  template: { mark: "point", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const axisField = channelSemantics.x?.field;
    const valueField = channelSemantics.y?.field;
    const groupField = channelSemantics.color?.field;
    if (!axisField || !valueField) return;
    const metrics = extractCategories(table, axisField, channelSemantics.x?.ordinalSortOrder);
    if (metrics.length < 2) return;
    const metricMax = /* @__PURE__ */ new Map();
    for (const m of metrics) {
      const vals = table.filter((r) => String(r[axisField]) === m).map((r) => Number(r[valueField])).filter((v) => isFinite(v));
      metricMax.set(m, niceMax2(vals.length > 0 ? Math.max(...vals) : 1));
    }
    const indicator = metrics.map((m) => ({
      name: m,
      max: metricMax.get(m) || 1
    }));
    const filled = chartProperties?.filled !== false;
    const fillOpacity = chartProperties?.fillOpacity ?? 0.3;
    const seriesData = [];
    const legendData = [];
    if (groupField) {
      const groups = groupBy(table, groupField);
      for (const [name, rows] of groups) {
        legendData.push(name);
        const metricVals = /* @__PURE__ */ new Map();
        for (const row of rows) {
          const m = String(row[axisField]);
          const v = Number(row[valueField]) || 0;
          if (!metricVals.has(m)) metricVals.set(m, { sum: 0, count: 0 });
          const entry = metricVals.get(m);
          entry.sum += v;
          entry.count++;
        }
        const values = metrics.map((m) => {
          const entry = metricVals.get(m);
          return entry ? Math.round(entry.sum / entry.count * 100) / 100 : 0;
        });
        seriesData.push({
          name,
          value: values,
          areaStyle: filled ? { opacity: fillOpacity } : void 0
        });
      }
    } else {
      const metricVals = /* @__PURE__ */ new Map();
      for (const row of table) {
        const m = String(row[axisField]);
        const v = Number(row[valueField]) || 0;
        if (!metricVals.has(m)) metricVals.set(m, { sum: 0, count: 0 });
        const entry = metricVals.get(m);
        entry.sum += v;
        entry.count++;
      }
      const values = metrics.map((m) => {
        const entry = metricVals.get(m);
        return entry ? Math.round(entry.sum / entry.count * 100) / 100 : 0;
      });
      seriesData.push({
        value: values,
        areaStyle: filled ? { opacity: fillOpacity } : void 0
      });
    }
    const hasLegend = legendData.length > 0;
    const { canvasW, canvasH } = computeCircumferencePressure(metrics.length, ctx.canvasSize, {
      minArcPx: 60,
      minRadius: 80,
      maxStretch: ctx.assembleOptions?.maxStretch,
      maxStretchX: ctx.assembleOptions?.maxStretchX,
      maxStretchY: ctx.assembleOptions?.maxStretchY
    });
    const chartH = canvasH + (hasLegend ? 36 : 0);
    const option = {
      tooltip: { trigger: "item" },
      radar: {
        indicator,
        shape: chartProperties?.shape === "circle" ? "circle" : "polygon",
        center: ["50%", "46%"],
        radius: "38%",
        axisName: { fontSize: 11 }
      },
      series: [{
        type: "radar",
        data: seriesData,
        emphasis: {
          lineStyle: { width: 3 }
        }
      }],
      _width: canvasW,
      _height: chartH
    };
    if (hasLegend) {
      option.legend = {
        data: legendData,
        bottom: 12,
        left: "center",
        orient: "horizontal"
      };
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "shape",
      label: "Grid",
      type: "discrete",
      options: [
        { value: void 0, label: "Polygon (default)" },
        { value: "circle", label: "Circle" }
      ]
    },
    {
      key: "filled",
      label: "Fill",
      type: "discrete",
      options: [
        { value: true, label: "Filled (default)" },
        { value: false, label: "Outline only" }
      ]
    },
    { key: "fillOpacity", label: "Opacity", type: "continuous", min: 0.05, max: 0.8, step: 0.05, defaultValue: 0.3 }
  ]
};

// src/echarts/templates/candlestick.ts
var isDiscrete12 = (type) => type === "nominal" || type === "ordinal";
var ecCandlestickDef = {
  chart: "Candlestick Chart",
  template: { mark: "candlestick", encoding: {} },
  channels: ["x", "open", "high", "low", "close", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    axisFlags: { x: { banded: true } }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xCS = channelSemantics.x;
    const openCS = channelSemantics.open;
    const highCS = channelSemantics.high;
    const lowCS = channelSemantics.low;
    const closeCS = channelSemantics.close;
    if (!xCS?.field) return;
    const xField = xCS.field;
    const openField = openCS?.field;
    const highField = highCS?.field;
    const lowField = lowCS?.field;
    const closeField = closeCS?.field;
    if (!openField || !closeField) return;
    const xIsDiscrete = isDiscrete12(xCS.type);
    const xIsTemporal = xCS.type === "temporal";
    const categories = xIsDiscrete ? extractCategories(table, xField, xCS.ordinalSortOrder) : void 0;
    const candleData = [];
    const xValues = [];
    for (const row of table) {
      const o = Number(row[openField]);
      const c = Number(row[closeField]);
      const h = highField ? Number(row[highField]) : Math.max(o, c);
      const l = lowField ? Number(row[lowField]) : Math.min(o, c);
      candleData.push([o, c, l, h]);
      xValues.push(String(row[xField]));
    }
    const option = {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" }
      },
      xAxis: {
        type: xIsDiscrete ? "category" : xIsTemporal ? "category" : "category",
        data: categories || xValues,
        name: xField,
        nameLocation: "middle",
        nameGap: 30,
        boundaryGap: true,
        axisLine: { onZero: false },
        axisTick: { show: true, alignWithLabel: true }
      },
      yAxis: {
        type: "value",
        scale: true,
        // candlestick charts should never start at zero
        name: "Price",
        nameLocation: "middle",
        nameGap: 50,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      },
      series: [{
        type: "candlestick",
        data: candleData,
        itemStyle: {
          color: "#06982d",
          // bullish (close > open) — green
          color0: "#ae1325",
          // bearish (close < open) — red
          borderColor: "#06982d",
          borderColor0: "#ae1325"
        }
      }]
    };
    if (chartProperties?.showMA) {
      const maWindow = chartProperties.maWindow ?? 5;
      const closePrices = table.map((r) => Number(r[closeField]));
      const maData = computeMA(closePrices, maWindow);
      option.series.push({
        name: `MA${maWindow}`,
        type: "line",
        data: maData,
        smooth: true,
        lineStyle: { width: 1.5, opacity: 0.7 },
        symbol: "none"
      });
      option.legend = { data: [`MA${maWindow}`] };
    }
    if (table.length > 60) {
      const startPercent = Math.max(0, 100 - Math.round(60 / table.length * 100));
      option.dataZoom = [
        { type: "inside", start: startPercent, end: 100 },
        { type: "slider", start: startPercent, end: 100, bottom: 5, height: 20 }
      ];
      option._dataZoomExtra = 35;
    }
    const plotWidth = ctx.canvasSize?.width || 400;
    const barWidth = Math.max(2, Math.min(20, Math.round(plotWidth * 0.6 / table.length)));
    option.series[0].barWidth = barWidth;
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  postProcess: (option) => {
    const extra = option._dataZoomExtra ?? 0;
    if (extra > 0) {
      if (!option.grid) option.grid = {};
      const curBottom = typeof option.grid.bottom === "number" ? option.grid.bottom : 45;
      option.grid.bottom = curBottom + extra;
      if (typeof option._height === "number") {
        option._height += extra;
      }
      delete option._dataZoomExtra;
    }
  },
  properties: [
    {
      key: "showMA",
      label: "Show Moving Avg",
      type: "binary",
      defaultValue: false
    },
    {
      key: "maWindow",
      label: "MA Window",
      type: "continuous",
      min: 3,
      max: 30,
      step: 1,
      defaultValue: 5
    }
  ]
};
function computeMA(prices, window) {
  const result = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < window - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - window + 1; j <= i; j++) {
        sum += prices[j];
      }
      result.push(Math.round(sum / window * 100) / 100);
    }
  }
  return result;
}

// src/echarts/templates/streamgraph.ts
var ecStreamgraphDef = {
  chart: "Streamgraph",
  template: { mark: "area", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" } }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const colorField = channelSemantics.color?.field;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    if (!colorField) {
      const option2 = {
        tooltip: { trigger: "axis" },
        xAxis: {
          type: xCS.type === "temporal" ? "time" : "value",
          name: xField,
          nameLocation: "middle",
          nameGap: 30,
          axisTick: { show: true }
        },
        yAxis: { type: "value", show: false, axisTick: { show: true } },
        series: [{
          type: "line",
          data: table.map((r) => [r[xField], r[yField]]),
          areaStyle: { opacity: 0.85 },
          lineStyle: { width: 0.5 },
          symbol: "none"
        }]
      };
      Object.assign(spec, option2);
      delete spec.mark;
      delete spec.encoding;
      return;
    }
    const xValSet = /* @__PURE__ */ new Set();
    const xVals = [];
    for (const row of table) {
      const xv = String(row[xField]);
      if (!xValSet.has(xv)) {
        xValSet.add(xv);
        xVals.push(xv);
      }
    }
    const groups = groupBy(table, colorField);
    const seriesNames = [...groups.keys()];
    const valMap = /* @__PURE__ */ new Map();
    for (const row of table) {
      const key = `${row[xField]}|||${row[colorField]}`;
      const v = row[yField];
      valMap.set(key, v != null && v !== "" ? Number(v) : 0);
    }
    const xIsTemporal = xCS.type === "temporal";
    const riverData = [];
    for (let i = 0; i < xVals.length; i++) {
      const xv = xVals[i];
      for (const sn of seriesNames) {
        const key = `${xv}|||${sn}`;
        const numVal = valMap.get(key);
        const value = numVal != null && Number.isFinite(numVal) ? numVal : 0;
        riverData.push([xIsTemporal ? xv : i, value, sn]);
      }
    }
    const option = {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: "rgba(0,0,0,0.2)", width: 1, type: "solid" } },
        formatter: (params) => {
          if (!params || params.length === 0) return "";
          const xVal = params[0].value[0];
          const displayX = xIsTemporal ? xVal : xVals[xVal] ?? xVal;
          let html = `<b>${displayX}</b><br/>`;
          const sortedParams = [...params].sort((a, b) => (b.value[1] || 0) - (a.value[1] || 0));
          sortedParams.forEach((p) => {
            html += `${p.marker} ${p.value[2]}: <b>${p.value[1]}</b><br/>`;
          });
          return html;
        }
      },
      legend: {
        data: seriesNames
      },
      singleAxis: {
        ...xIsTemporal ? { type: "time" } : {
          type: "value",
          min: 0,
          max: Math.max(1, xVals.length - 1),
          axisLabel: {
            fontSize: 11,
            formatter: (value) => {
              const idx = Math.round(Number(value));
              return xVals[idx] ?? value;
            }
          }
        },
        axisTick: { show: true },
        bottom: 45,
        // enough room for tick labels + axis name below
        name: xField,
        nameLocation: "middle",
        nameGap: 25,
        nameTextStyle: { fontSize: 12 },
        ...xIsTemporal ? { axisLabel: { fontSize: 11 } } : {}
      },
      series: [{
        type: "themeRiver",
        data: riverData,
        label: { show: false },
        emphasis: { focus: "series" },
        itemStyle: {
          borderWidth: 0.5,
          borderColor: "rgba(255,255,255,0.3)"
        }
      }]
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  postProcess: (option) => {
    if (option.singleAxis) {
      const BUFFER = 15;
      const LEGEND_GAP = 12;
      const hasLegend = !!option.legend;
      const legendWidth = option._legendWidth || 140;
      const rightMargin = hasLegend ? legendWidth + LEGEND_GAP + BUFFER : 20;
      const minW = 600 + BUFFER;
      const minH = 350 + BUFFER;
      if (typeof option._width === "number" && option._width < minW) {
        option._width = minW;
      }
      if (typeof option._height === "number" && option._height < minH) {
        option._height = minH;
      }
      if (!option._width) option._width = minW;
      if (!option._height) option._height = minH;
      option.singleAxis.left = option.singleAxis.left || 50;
      option.singleAxis.right = Math.max(option.singleAxis.right || 0, rightMargin);
      if (hasLegend && option.legend) {
        const legendLeft = option._width - rightMargin + BUFFER;
        option.legend.left = legendLeft;
        delete option.legend.right;
        option.legend.top = 20;
        option.legend.orient = option.legend.orient || "vertical";
        option.legend.align = "left";
        if (Array.isArray(option.graphic)) {
          for (const g of option.graphic) {
            if (g.type === "text" && (g.top === 4 || g.top === 20) && g.style && g.style.fontWeight === "bold") {
              g.left = legendLeft;
              delete g.right;
            }
          }
        }
      }
      if (typeof option.singleAxis.bottom === "number") {
        option.singleAxis.bottom += BUFFER;
      }
    }
  },
  properties: []
};

// src/echarts/templates/gauge.ts
var ecGaugeChartDef = {
  chart: "Gauge Chart",
  template: { mark: "point", encoding: {} },
  channels: ["size", "column"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const valueField = channelSemantics.size?.field;
    const columnField = channelSemantics.column?.field;
    if (!valueField) return;
    const allValues = table.map((r) => Number(r[valueField])).filter((v) => isFinite(v));
    const dataMax = allValues.length > 0 ? Math.max(...allValues) : 100;
    const scaleMin = chartProperties?.min ?? 0;
    const scaleMax = chartProperties?.max ?? niceGaugeMax(dataMax);
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    let palette;
    if (decision?.schemeId) {
      const fromRegistry = getPaletteForScheme(decision.schemeId);
      if (fromRegistry && fromRegistry.length > 0) {
        palette = fromRegistry;
      }
    }
    if (!palette || palette.length === 0) {
      const fallbackId = (channelSemantics.column ? Math.max(1, extractCategories(table, channelSemantics.column.field, channelSemantics.column.ordinalSortOrder).length) : 1) > 10 ? "cat20" : "cat10";
      palette = getPaletteForScheme(fallbackId) ?? DEFAULT_COLORS;
    }
    const gaugeItems = [];
    if (columnField) {
      const groups = groupBy(table, columnField);
      const categories = extractCategories(
        table,
        columnField,
        channelSemantics.column?.ordinalSortOrder
      );
      categories.forEach((cat, idx) => {
        const rows = groups.get(cat) || [];
        const vals = rows.map((r) => Number(r[valueField])).filter((v) => isFinite(v));
        const avg = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : 0;
        gaugeItems.push({
          name: cat,
          value: avg,
          color: palette[idx % palette.length]
        });
      });
    } else {
      const avg = allValues.length > 0 ? Math.round(allValues.reduce((a, b) => a + b, 0) / allValues.length * 100) / 100 : 0;
      gaugeItems.push({ name: valueField, value: avg });
    }
    const n = gaugeItems.length;
    const baseW = ctx.canvasSize.width;
    const baseH = ctx.canvasSize.height;
    const minCellDim = 180;
    const maxStretchFactor = ctx.assembleOptions?.maxStretchX ?? ctx.assembleOptions?.maxStretch ?? 2;
    let gridCols, gridRows;
    if (n === 1) {
      gridCols = 1;
      gridRows = 1;
    } else {
      const maxCols = Math.max(
        1,
        Math.floor(baseW * maxStretchFactor / minCellDim)
      );
      if (n <= maxCols) {
        gridCols = n;
        gridRows = 1;
      } else {
        gridRows = Math.ceil(n / maxCols);
        gridCols = Math.ceil(n / gridRows);
      }
    }
    const canvasW = Math.max(baseW, gridCols * minCellDim);
    const canvasH = Math.max(baseH, gridRows * (minCellDim + 20));
    const cellW = canvasW / gridCols;
    const cellH = canvasH / gridRows;
    const gaugeRadius = Math.max(
      40,
      Math.round(Math.min(cellW * 0.38, cellH * 0.38))
    );
    const s = gaugeRadius / 100;
    const progressWidth = Math.max(4, Math.round(12 * s));
    const pointerWidth = Math.max(2, Math.round(5 * s));
    const detailFontSize = Math.max(10, Math.round(20 * s));
    const titleFontSize = Math.max(8, Math.round(14 * s));
    const axisLabelFontSize = Math.max(6, Math.round(9 * s));
    const tickLength = Math.max(3, Math.round(5 * s));
    const tickDistance = -Math.round(16 * s);
    const splitLength = Math.max(5, Math.round(12 * s));
    const splitDistance = -Math.round(20 * s);
    const labelDistance = -Math.round(24 * s);
    const showProgress = chartProperties?.showProgress !== false;
    const series = gaugeItems.map((item, i) => {
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const cx = Math.round((col + 0.5) * cellW);
      const cy = Math.round((row + 0.5) * cellH);
      return {
        type: "gauge",
        min: scaleMin,
        max: scaleMax,
        center: [`${cx}px`, `${cy}px`],
        radius: `${gaugeRadius}px`,
        data: [{
          name: item.name,
          value: item.value,
          ...item.color ? { itemStyle: { color: item.color } } : {}
        }],
        detail: {
          formatter: "{value}",
          fontSize: detailFontSize,
          offsetCenter: [0, "70%"]
        },
        title: {
          fontSize: titleFontSize,
          offsetCenter: [0, "85%"]
        },
        axisLine: {
          lineStyle: { width: progressWidth }
        },
        progress: {
          show: showProgress,
          width: progressWidth,
          ...item.color ? { itemStyle: { color: item.color } } : {}
        },
        pointer: {
          length: "60%",
          width: pointerWidth,
          ...item.color ? { itemStyle: { color: item.color } } : {}
        },
        axisTick: {
          distance: tickDistance,
          length: tickLength,
          lineStyle: { color: "#999", width: 1 }
        },
        splitLine: {
          distance: splitDistance,
          length: splitLength,
          lineStyle: { color: "#999", width: 2 }
        },
        axisLabel: {
          distance: labelDistance,
          fontSize: axisLabelFontSize,
          color: "#666"
        }
      };
    });
    const option = {
      tooltip: { trigger: "item", formatter: "{b}: {c}" },
      series,
      color: DEFAULT_COLORS,
      _width: canvasW,
      _height: canvasH
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "min", label: "Min", type: "continuous", min: 0, max: 1e3, step: 10, defaultValue: 0 },
    { key: "max", label: "Max", type: "continuous", min: 0, max: 1e4, step: 100, defaultValue: 100 },
    {
      key: "showProgress",
      label: "Progress",
      type: "discrete",
      options: [
        { value: true, label: "Show (default)" },
        { value: false, label: "Hide" }
      ]
    }
  ]
};
function niceGaugeMax(v) {
  if (v <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const mantissa = v / pow;
  const nice = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return nice * pow;
}

// src/echarts/templates/funnel.ts
var ecFunnelChartDef = {
  chart: "Funnel Chart",
  template: { mark: "rect", encoding: {} },
  channels: ["y", "size"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    axisFlags: { y: { banded: true } },
    paramOverrides: {
      defaultBandSize: 50
      // taller bands for funnel stages
    }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, layout, colorDecisions } = ctx;
    const stageField = channelSemantics.y?.field;
    const valField = channelSemantics.size?.field;
    if (!stageField) return;
    const stages = extractCategories(
      table,
      stageField,
      channelSemantics.y?.ordinalSortOrder
    );
    if (stages.length === 0) return;
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    let palette;
    if (decision?.schemeId) {
      const fromRegistry = getPaletteForScheme(decision.schemeId);
      if (fromRegistry && fromRegistry.length > 0) {
        palette = fromRegistry;
      }
    }
    if (!palette || palette.length === 0) {
      const catCount = stages.length;
      const fallbackId = catCount > 10 ? "cat20" : "cat10";
      palette = getPaletteForScheme(fallbackId) ?? DEFAULT_COLORS;
    }
    const funnelData = [];
    if (valField) {
      const agg = /* @__PURE__ */ new Map();
      for (const row of table) {
        const stage = String(row[stageField] ?? "");
        const val = Number(row[valField]) || 0;
        agg.set(stage, (agg.get(stage) ?? 0) + val);
      }
      for (const stage of stages) {
        funnelData.push({ name: stage, value: agg.get(stage) ?? 0 });
      }
    } else {
      const counts = /* @__PURE__ */ new Map();
      for (const row of table) {
        const stage = String(row[stageField] ?? "");
        counts.set(stage, (counts.get(stage) ?? 0) + 1);
      }
      for (const stage of stages) {
        funnelData.push({ name: stage, value: counts.get(stage) ?? 0 });
      }
    }
    const sortOrder = chartProperties?.sort ?? "descending";
    if (sortOrder === "descending") {
      funnelData.sort((a, b) => b.value - a.value);
    } else if (sortOrder === "ascending") {
      funnelData.sort((a, b) => a.value - b.value);
    }
    const stageCount = layout.yNominalCount || stages.length;
    const yStep = layout.yStep;
    const funnelBodyH = Math.max(120, yStep * stageCount);
    const topMargin = 30;
    const bottomMargin = 20;
    const canvasH = funnelBodyH + topMargin + bottomMargin;
    const maxLabelLen = Math.max(...funnelData.map((d) => d.name.length), 3);
    const estimatedLegendWidth = Math.min(150, maxLabelLen * 7 + 30);
    const canvasW = Math.max(ctx.canvasSize.width, 300);
    const funnelLeft = 40;
    const funnelRight = estimatedLegendWidth + 30;
    const funnelWidth = `${Math.max(100, canvasW - funnelLeft - funnelRight)}px`;
    const orient = chartProperties?.orient ?? "vertical";
    const option = {
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)"
      },
      legend: {
        data: funnelData.map((d) => d.name),
        type: funnelData.length > 8 ? "scroll" : "plain",
        orient: "vertical",
        right: 10,
        top: "middle",
        textStyle: { fontSize: 11 }
      },
      series: [{
        type: "funnel",
        left: funnelLeft,
        top: topMargin,
        bottom: bottomMargin,
        width: funnelWidth,
        sort: sortOrder,
        orient,
        gap: chartProperties?.gap ?? 2,
        data: funnelData.map((d, idx) => ({
          ...d,
          itemStyle: {
            ...palette ? { color: palette[idx % palette.length] } : {}
          }
        })),
        label: {
          show: true,
          position: "inside",
          formatter: "{b}\n{c}",
          fontSize: 11
        },
        emphasis: {
          label: {
            fontSize: 13
          }
        },
        itemStyle: {
          borderColor: "#fff",
          borderWidth: 1
        }
      }],
      color: palette ?? DEFAULT_COLORS,
      _width: canvasW,
      _height: canvasH
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "sort",
      label: "Sort",
      type: "discrete",
      options: [
        { value: "descending", label: "Descending (default)" },
        { value: "ascending", label: "Ascending" },
        { value: "none", label: "Original order" }
      ]
    },
    {
      key: "orient",
      label: "Orient",
      type: "discrete",
      options: [
        { value: "vertical", label: "Vertical (default)" },
        { value: "horizontal", label: "Horizontal" }
      ]
    },
    { key: "gap", label: "Gap", type: "continuous", min: 0, max: 20, step: 1, defaultValue: 2 }
  ]
};

// src/echarts/templates/treemap.ts
var ecTreemapDef = {
  chart: "Treemap",
  template: { mark: "rect", encoding: {} },
  channels: ["color", "size", "detail"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const catField = channelSemantics.color?.field;
    const valField = channelSemantics.size?.field;
    const subCatField = channelSemantics.detail?.field;
    if (!catField) return;
    const categories = extractCategories(table, catField, channelSemantics.color?.ordinalSortOrder);
    if (categories.length === 0) return;
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    let palette;
    if (decision?.schemeId) {
      const fromRegistry = getPaletteForScheme(decision.schemeId);
      if (fromRegistry && fromRegistry.length > 0) {
        palette = fromRegistry;
      }
    }
    if (!palette || palette.length === 0) {
      const catCount = categories.length;
      const fallbackId = catCount > 10 ? "cat20" : "cat10";
      palette = getPaletteForScheme(fallbackId) ?? DEFAULT_COLORS;
    }
    let treemapData;
    if (subCatField) {
      treemapData = categories.map((cat, catIdx) => {
        const catRows = table.filter((r) => String(r[catField]) === cat);
        const subCats = extractCategories(catRows, subCatField);
        const children = subCats.map((sub) => {
          const subRows = catRows.filter((r) => String(r[subCatField]) === sub);
          let value;
          if (valField) {
            value = subRows.reduce((sum, r) => sum + (Number(r[valField]) || 0), 0);
          } else {
            value = subRows.length;
          }
          return { name: sub, value };
        });
        return {
          name: cat,
          children,
          itemStyle: { color: palette[catIdx % palette.length] }
        };
      });
    } else {
      const agg = /* @__PURE__ */ new Map();
      if (valField) {
        for (const row of table) {
          const cat = String(row[catField] ?? "");
          const val = Number(row[valField]) || 0;
          agg.set(cat, (agg.get(cat) ?? 0) + val);
        }
      } else {
        for (const row of table) {
          const cat = String(row[catField] ?? "");
          agg.set(cat, (agg.get(cat) ?? 0) + 1);
        }
      }
      treemapData = categories.map((cat, i) => ({
        name: cat,
        value: agg.get(cat) ?? 0,
        itemStyle: { color: palette[i % palette.length] }
      }));
    }
    const leafValues = treemapData.flatMap(
      (d) => d.children ? d.children.map((c) => c.value) : [d.value]
    ).filter((v) => v > 0);
    const effectiveCount = leafValues.length > 0 ? computeEffectiveBarCount(leafValues) : categories.length;
    const baseW = ctx.canvasSize.width;
    const baseH = ctx.canvasSize.height;
    const minBarPx = 30;
    const elasticity = 0.5;
    const maxStretch = ctx.assembleOptions?.maxStretch ?? 2;
    const maxStretchX = ctx.assembleOptions?.maxStretchX ?? maxStretch;
    const maxStretchY = ctx.assembleOptions?.maxStretchY ?? maxStretch;
    const xBias = 1.5;
    const pressure = effectiveCount * minBarPx / baseW;
    const areaStretch = pressure <= 1 ? 1 : Math.min(maxStretchX * maxStretchY, Math.pow(pressure, elasticity));
    const stretchX = Math.min(maxStretchX, Math.pow(areaStretch, xBias / (xBias + 1)));
    const stretchY = Math.min(maxStretchY, Math.pow(areaStretch, 1 / (xBias + 1)));
    const canvasW = Math.round(baseW * stretchX);
    const canvasH = Math.round(baseH * stretchY);
    const showBreadcrumb = chartProperties?.breadcrumb !== false;
    const option = {
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          const { name, value, treePathInfo } = params;
          const path = treePathInfo ? treePathInfo.map((n) => n.name).filter(Boolean).join(" \u2192 ") : name;
          return `${path}<br/>Value: ${value}`;
        }
      },
      series: [{
        type: "treemap",
        data: treemapData,
        width: "90%",
        height: showBreadcrumb ? "80%" : "90%",
        top: 10,
        left: "center",
        roam: false,
        leafDepth: subCatField ? 2 : 1,
        breadcrumb: {
          show: showBreadcrumb,
          bottom: 5
        },
        label: {
          show: true,
          formatter: "{b}",
          fontSize: 12
        },
        upperLabel: subCatField ? {
          show: true,
          height: 20,
          fontSize: 11,
          color: "#fff"
        } : void 0,
        levels: subCatField ? [
          {
            // Root level (hidden)
            itemStyle: { borderWidth: 0, gapWidth: 2 }
          },
          {
            // Top-level categories
            itemStyle: {
              borderWidth: 2,
              borderColor: "#fff",
              gapWidth: 2
            },
            upperLabel: { show: true }
          },
          {
            // Leaf level (sub-categories)
            itemStyle: {
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.5)",
              gapWidth: 1
            },
            label: { show: true, fontSize: 10 },
            colorSaturation: [0.3, 0.6],
            colorMappingBy: "value"
          }
        ] : [
          {
            itemStyle: {
              borderWidth: 2,
              borderColor: "#fff",
              gapWidth: 2
            }
          }
        ]
      }],
      color: palette ?? DEFAULT_COLORS,
      _width: canvasW,
      _height: canvasH
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "breadcrumb",
      label: "Breadcrumb",
      type: "discrete",
      options: [
        { value: true, label: "Show (default)" },
        { value: false, label: "Hide" }
      ]
    }
  ]
};

// src/echarts/templates/sunburst.ts
function collectSunburstLeafValues(nodes) {
  return nodes.flatMap((d) => {
    if (d.children?.length) {
      return collectSunburstLeafValues(d.children);
    }
    return [Number(d.value) || 0];
  });
}
var SUNBURST_OPACITY_L1 = 1;
var SUNBURST_OPACITY_L2 = 0.8;
var SUNBURST_OPACITY_L3 = 0.6;
var SUNBURST_OUTER_LABEL_MIN_ANGLE_DEG = 3;
var SUNBURST_CANVAS_SIZE_MULTIPLIER = 1.55;
function hexToRgb2(hex) {
  const s = hex.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const intVal = parseInt(m[1], 16);
    return { r: intVal >> 16 & 255, g: intVal >> 8 & 255, b: intVal & 255 };
  }
  m = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const x = m[1];
    const full = x.split("").map((c) => c + c).join("");
    const intVal = parseInt(full, 16);
    return { r: intVal >> 16 & 255, g: intVal >> 8 & 255, b: intVal & 255 };
  }
  return null;
}
function sunburstColorWithOpacity(baseColor, alpha) {
  const rgb = hexToRgb2(baseColor);
  if (rgb) {
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
  }
  const rgbaM = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(baseColor.trim());
  if (rgbaM) {
    return `rgba(${rgbaM[1]},${rgbaM[2]},${rgbaM[3]},${alpha})`;
  }
  return baseColor;
}
var ecSunburstDef = {
  chart: "Sunburst Chart",
  template: { mark: "arc", encoding: {} },
  channels: ["color", "size", "detail", "group"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const catField = channelSemantics.color?.field;
    const valField = channelSemantics.size?.field;
    const middleField = channelSemantics.group?.field;
    const leafField = channelSemantics.detail?.field;
    if (!catField) return;
    const categories = extractCategories(table, catField, channelSemantics.color?.ordinalSortOrder);
    if (categories.length === 0) return;
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    let palette;
    if (decision?.schemeId) {
      const fromRegistry = getPaletteForScheme(decision.schemeId);
      if (fromRegistry && fromRegistry.length > 0) {
        palette = fromRegistry;
      }
    }
    if (!palette || palette.length === 0) {
      const catCount = categories.length;
      const fallbackId = catCount > 10 ? "cat20" : "cat10";
      palette = getPaletteForScheme(fallbackId) ?? DEFAULT_COLORS;
    }
    let sunburstData;
    if (middleField && leafField) {
      sunburstData = categories.map((cat, catIdx) => {
        const base = palette[catIdx % palette.length];
        const catRows = table.filter((r) => String(r[catField]) === cat);
        const subCats = extractCategories(catRows, middleField);
        const children = subCats.map((sub) => {
          const subRows = catRows.filter((r) => String(r[middleField]) === sub);
          const leaves = extractCategories(subRows, leafField);
          const grandchildren = leaves.map((leaf) => {
            const leafRows = subRows.filter((r) => String(r[leafField]) === leaf);
            let value;
            if (valField) {
              value = leafRows.reduce((sum, r) => sum + (Number(r[valField]) || 0), 0);
            } else {
              value = leafRows.length;
            }
            return {
              name: leaf,
              value,
              itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L3) }
            };
          });
          return {
            name: sub,
            children: grandchildren,
            itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L2) }
          };
        });
        return {
          name: cat,
          children,
          itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L1) }
        };
      });
    } else if (middleField) {
      sunburstData = categories.map((cat, catIdx) => {
        const base = palette[catIdx % palette.length];
        const catRows = table.filter((r) => String(r[catField]) === cat);
        const subCats = extractCategories(catRows, middleField);
        const children = subCats.map((sub) => {
          const subRows = catRows.filter((r) => String(r[middleField]) === sub);
          let value;
          if (valField) {
            value = subRows.reduce((sum, r) => sum + (Number(r[valField]) || 0), 0);
          } else {
            value = subRows.length;
          }
          return {
            name: sub,
            value,
            itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L2) }
          };
        });
        return {
          name: cat,
          children,
          itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L1) }
        };
      });
    } else if (leafField) {
      sunburstData = categories.map((cat, catIdx) => {
        const base = palette[catIdx % palette.length];
        const catRows = table.filter((r) => String(r[catField]) === cat);
        const subCats = extractCategories(catRows, leafField);
        const children = subCats.map((sub) => {
          const subRows = catRows.filter((r) => String(r[leafField]) === sub);
          let value;
          if (valField) {
            value = subRows.reduce((sum, r) => sum + (Number(r[valField]) || 0), 0);
          } else {
            value = subRows.length;
          }
          return {
            name: sub,
            value,
            itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L2) }
          };
        });
        return {
          name: cat,
          children,
          itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L1) }
        };
      });
    } else {
      const agg = /* @__PURE__ */ new Map();
      if (valField) {
        for (const row of table) {
          const cat = String(row[catField] ?? "");
          const val = Number(row[valField]) || 0;
          agg.set(cat, (agg.get(cat) ?? 0) + val);
        }
      } else {
        for (const row of table) {
          const cat = String(row[catField] ?? "");
          agg.set(cat, (agg.get(cat) ?? 0) + 1);
        }
      }
      sunburstData = categories.map((cat, i) => ({
        name: cat,
        value: agg.get(cat) ?? 0,
        itemStyle: { color: palette[i % palette.length] }
      }));
    }
    let outerValues;
    if (middleField || leafField) {
      outerValues = collectSunburstLeafValues(sunburstData);
    } else {
      outerValues = sunburstData.map((d) => d.value);
    }
    const effectiveCount = computeEffectiveBarCount(outerValues);
    const sunburstCanvas = {
      width: Math.round(ctx.canvasSize.width * SUNBURST_CANVAS_SIZE_MULTIPLIER),
      height: Math.round(ctx.canvasSize.height * SUNBURST_CANVAS_SIZE_MULTIPLIER)
    };
    const { radius: pressureRadius, canvasW, canvasH } = computeCircumferencePressure(effectiveCount, sunburstCanvas, {
      minArcPx: 45,
      minRadius: Math.round(80 * SUNBURST_CANVAS_SIZE_MULTIPLIER),
      maxRadius: Math.round(400 * SUNBURST_CANVAS_SIZE_MULTIPLIER),
      maxStretch: ctx.assembleOptions?.maxStretch,
      maxStretchX: ctx.assembleOptions?.maxStretchX,
      maxStretchY: ctx.assembleOptions?.maxStretchY
    });
    const minOuterR = Math.round(80 * SUNBURST_CANVAS_SIZE_MULTIPLIER);
    const outerRadius = Math.max(
      minOuterR,
      Math.round(Math.min(pressureRadius, Math.min(canvasW, canvasH) / 2 - 20))
    );
    const innerRadius = chartProperties?.innerRadius ?? Math.round(outerRadius * 0.15);
    const span = outerRadius - innerRadius;
    const ringThird1 = innerRadius + Math.round(span / 3);
    const ringThird2 = innerRadius + Math.round(2 * span / 3);
    const ringHalf = Math.round(innerRadius + span * 0.5);
    const option = {
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          const { name, value, treePathInfo } = params;
          const path = treePathInfo ? treePathInfo.map((n) => n.name).filter(Boolean).join(" \u2192 ") : name;
          return `${path}<br/>Value: ${value}`;
        }
      },
      series: [{
        type: "sunburst",
        data: sunburstData,
        radius: [`${innerRadius}px`, `${outerRadius}px`],
        center: ["50%", "50%"],
        label: {
          show: true,
          rotate: chartProperties?.labelRotate ?? "radial",
          fontSize: 11,
          color: "#000000"
        },
        emphasis: {
          focus: "ancestor",
          label: { color: "#000000" }
        },
        levels: middleField && leafField ? [
          {},
          {
            r0: `${innerRadius}px`,
            r: `${ringThird1}px`,
            label: { fontSize: 11, fontWeight: "bold", color: "#000000" },
            itemStyle: { borderWidth: 2, borderColor: "#fff" }
          },
          {
            r0: `${ringThird1}px`,
            r: `${ringThird2}px`,
            label: { fontSize: 10, color: "#000000" },
            itemStyle: { borderWidth: 1, borderColor: "rgba(255,255,255,0.55)" }
          },
          {
            r0: `${ringThird2}px`,
            r: `${outerRadius}px`,
            label: {
              fontSize: 9,
              color: "#000000",
              minAngle: SUNBURST_OUTER_LABEL_MIN_ANGLE_DEG
            },
            itemStyle: { borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" }
          }
        ] : middleField || leafField ? [
          {},
          // root
          {
            // Inner ring (top-level categories)
            r0: `${innerRadius}px`,
            r: `${ringHalf}px`,
            label: { fontSize: 12, fontWeight: "bold", color: "#000000" },
            itemStyle: { borderWidth: 2, borderColor: "#fff" }
          },
          {
            // Outer ring (sub-categories)
            r0: `${ringHalf}px`,
            r: `${outerRadius}px`,
            label: {
              fontSize: 10,
              color: "#000000",
              minAngle: SUNBURST_OUTER_LABEL_MIN_ANGLE_DEG
            },
            itemStyle: { borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" }
          }
        ] : [
          {},
          // root
          {
            label: {
              fontSize: 12,
              color: "#000000",
              minAngle: SUNBURST_OUTER_LABEL_MIN_ANGLE_DEG
            },
            itemStyle: { borderWidth: 2, borderColor: "#fff" }
          }
        ]
      }],
      color: palette ?? DEFAULT_COLORS,
      _width: canvasW,
      _height: canvasH
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "innerRadius", label: "Inner R", type: "continuous", min: 0, max: 80, step: 5, defaultValue: 0 },
    {
      key: "labelRotate",
      label: "Labels",
      type: "discrete",
      options: [
        { value: "radial", label: "Radial (default)" },
        { value: "tangential", label: "Tangential" },
        { value: 0, label: "Horizontal" }
      ]
    }
  ]
};

// src/echarts/templates/sankey.ts
var ecSankeyDef = {
  chart: "Sankey Diagram",
  template: { mark: "rect", encoding: {} },
  channels: ["x", "y", "size"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    axisFlags: {
      x: { banded: true },
      y: { banded: true }
    },
    paramOverrides: {
      // Each node block needs generous space:
      // x-step covers node width (~20px) + edge routing gap (~60px)
      // y-step covers node height + nodeGap
      defaultBandSize: 60
    }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, layout, colorDecisions } = ctx;
    const sourceField = channelSemantics.x?.field;
    const targetField = channelSemantics.y?.field;
    const valueField = channelSemantics.size?.field;
    if (!sourceField || !targetField) return;
    const linkAgg = /* @__PURE__ */ new Map();
    for (const row of table) {
      const src = String(row[sourceField] ?? "");
      const tgt = String(row[targetField] ?? "");
      if (!src || !tgt || src === tgt) continue;
      const key = `${src}\0${tgt}`;
      const val = valueField ? Number(row[valueField]) || 0 : 1;
      linkAgg.set(key, (linkAgg.get(key) ?? 0) + val);
    }
    const nodeSet = /* @__PURE__ */ new Set();
    const links = [];
    for (const [key, value] of linkAgg) {
      const [source, target] = key.split("\0");
      nodeSet.add(source);
      nodeSet.add(target);
      links.push({ source, target, value });
    }
    if (links.length === 0) return;
    const nodeArr = [...nodeSet];
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    let palette;
    if (decision?.schemeId) {
      const fromRegistry = getPaletteForScheme(decision.schemeId);
      if (fromRegistry && fromRegistry.length > 0) {
        palette = fromRegistry;
      }
    }
    if (!palette || palette.length === 0) {
      const catCount = nodeArr.length;
      const fallbackId = catCount > 10 ? "cat20" : "cat10";
      palette = getPaletteForScheme(fallbackId) ?? DEFAULT_COLORS;
    }
    const nodes = nodeArr.map((name, i) => ({
      name,
      itemStyle: { color: palette[i % palette.length] }
    }));
    const sourceCount = layout.xNominalCount || new Set(table.map((r) => String(r[sourceField]))).size;
    const targetCount = layout.yNominalCount || new Set(table.map((r) => String(r[targetField]))).size;
    const nodeGap = chartProperties?.nodeGap ?? 10;
    const nodeWidth = chartProperties?.nodeWidth ?? 20;
    const layerEstimate = 2;
    const canvasW = Math.max(
      300,
      layout.xStep * Math.max(sourceCount, layerEstimate) + 60
    );
    const maxNodesPerColumn = Math.max(sourceCount, targetCount);
    const canvasH = Math.max(
      250,
      layout.yStep * maxNodesPerColumn
    );
    const orient = chartProperties?.orient ?? "horizontal";
    const margin = 60;
    const option = {
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        formatter: (params) => {
          if (params.dataType === "edge") {
            return `${params.data.source} \u2192 ${params.data.target}<br/>Value: ${params.data.value}`;
          }
          return params.name;
        }
      },
      series: [{
        type: "sankey",
        data: nodes,
        links,
        orient,
        emphasis: {
          focus: "adjacency"
        },
        lineStyle: {
          color: "gradient",
          curveness: 0.5
        },
        nodeWidth,
        nodeGap,
        label: {
          show: true,
          fontSize: 11
        },
        left: margin,
        right: margin,
        top: 20,
        bottom: 20
      }],
      color: palette ?? DEFAULT_COLORS,
      _width: canvasW,
      _height: canvasH
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "orient",
      label: "Orient",
      type: "discrete",
      options: [
        { value: "horizontal", label: "Horizontal (default)" },
        { value: "vertical", label: "Vertical" }
      ]
    },
    { key: "nodeWidth", label: "Node Width", type: "continuous", min: 5, max: 40, step: 5, defaultValue: 20 },
    { key: "nodeGap", label: "Node Gap", type: "continuous", min: 2, max: 30, step: 2, defaultValue: 10 }
  ]
};

// src/echarts/templates/lollipop.ts
var STEM_COLOR = "#000000";
var STEM_WIDTH_PX = 1.5;
var DOT_SIZE_BASE = 10;
function areCategoriesNumeric5(cats) {
  if (cats.length === 0) return true;
  return cats.every((c) => {
    const s = String(c).trim();
    if (s === "") return false;
    const n = Number(s);
    return !isNaN(n) && isFinite(n);
  });
}
var ecLollipopChartDef = {
  chart: "Lollipop Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes
    };
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
    const catField = channelSemantics[categoryAxis]?.field;
    const valField = channelSemantics[valueAxis]?.field;
    if (!catField || !valField) return;
    const catCS = channelSemantics[categoryAxis];
    const colorField = channelSemantics.color?.field;
    const categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis) ?? catCS?.ordinalSortOrder);
    const valueMap = /* @__PURE__ */ new Map();
    for (const row of table) {
      const cat = String(row[catField] ?? "");
      const val = row[valField];
      if (val != null && !isNaN(val)) {
        valueMap.set(cat, (valueMap.get(cat) ?? 0) + Number(val));
      }
    }
    const values = categories.map((cat) => valueMap.get(cat) ?? null);
    const isHorizontal = categoryAxis === "y";
    const dotSizeConfig = chartProperties?.dotSize ?? 80;
    const symbolSizePx = Math.max(6, Math.min(DOT_SIZE_BASE + (dotSizeConfig - 80) / 40, 16));
    const option = {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: isHorizontal ? {
        type: "value",
        name: valField,
        nameLocation: "middle",
        nameGap: 30,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      } : {
        type: "category",
        data: categories,
        name: catField,
        nameLocation: "middle",
        nameGap: 30,
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: { rotate: areCategoriesNumeric5(categories) ? 0 : 90 }
      },
      yAxis: isHorizontal ? {
        type: "category",
        data: categories,
        name: catField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: { rotate: 0 }
      } : {
        type: "value",
        name: valField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true },
        axisLabel: { rotate: 0 }
      },
      series: [
        {
          type: "bar",
          data: values,
          barWidth: STEM_WIDTH_PX,
          itemStyle: { color: STEM_COLOR }
        }
      ]
    };
    option.tooltip = option.tooltip ?? {};
    option._encodingTooltip = {
      trigger: "axis",
      categoryLabel: catField,
      valueLabel: valField,
      // 由 buildEncodingTooltipFormatter 只保留 seriesType === 'scatter' 的条目
      filterScatterOnly: true
    };
    if (colorField) {
      const groups = groupBy(table, colorField);
      const colorOrder = getCategoryOrder(ctx, "color");
      const legendKeys = colorOrder && colorOrder.length > 0 ? colorOrder.filter((k) => groups.has(k)) : [...groups.keys()];
      if (legendKeys.length > 0) {
        option.legend = { data: legendKeys };
        option._legendTitle = colorField;
      }
      for (const name of legendKeys) {
        const rows = groups.get(name) ?? [];
        const scatterData = rows.filter((r) => {
          const v = r[valField];
          return v != null && !isNaN(Number(v));
        }).map((r) => {
          const cat = String(r[catField] ?? "");
          const v = Number(r[valField]);
          return isHorizontal ? [v, cat] : [cat, v];
        });
        option.series.push({
          name,
          type: "scatter",
          data: scatterData,
          symbolSize: symbolSizePx,
          itemStyle: { borderColor: "#fff", borderWidth: 1 },
          z: 2
        });
      }
    } else {
      option.series.push({
        type: "scatter",
        data: categories.map((cat, i) => {
          const v = values[i];
          return isHorizontal ? [v, cat] : [cat, v];
        }),
        symbolSize: symbolSizePx,
        itemStyle: { color: DEFAULT_COLORS[0], borderColor: "#fff", borderWidth: 1 },
        z: 2
      });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "dotSize", label: "Dot Size", type: "continuous", min: 20, max: 300, step: 10, defaultValue: 80 }
  ]
};

// src/echarts/templates/jitter.ts
var isDiscrete13 = (type) => type === "nominal" || type === "ordinal";
function areCategoriesNumeric6(cats) {
  if (cats.length === 0) return true;
  return cats.every((c) => {
    const s = String(c).trim();
    if (s === "") return false;
    const n = Number(s);
    return !isNaN(n) && isFinite(n);
  });
}
function jitter(seed) {
  let s = seed;
  return () => {
    s = s * 1103515245 + 12345 & 2147483647;
    return s / 2147483647 * 2 - 1;
  };
}
var ecStripPlotDef = {
  chart: "Strip Plot",
  template: { mark: "circle", encoding: {} },
  channels: ["x", "y", "color", "size", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: { defaultBandSize: 50, minStep: 16 }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const xField = xCS?.field;
    const yField = yCS?.field;
    const colorField = channelSemantics.color?.field;
    const colorType = channelSemantics.color?.type;
    const isContinuousColor2 = !!colorField && (colorType === "quantitative" || colorType === "temporal");
    const isTemporalColor = colorType === "temporal";
    if (!xField || !yField) return;
    const xIsDiscrete = isDiscrete13(xCS?.type);
    const yIsDiscrete = isDiscrete13(yCS?.type);
    const catAxis = xIsDiscrete ? "x" : yIsDiscrete ? "y" : "x";
    const contAxis = catAxis === "x" ? "y" : "x";
    const catField = catAxis === "x" ? xField : yField;
    const contField = contAxis === "x" ? xField : yField;
    const categories = extractCategories(table, catField, (catAxis === "x" ? xCS : yCS)?.ordinalSortOrder);
    const catToIndex = new Map(categories.map((c, i) => [c, i]));
    const jitterHalfWidth = 0.3;
    const rand = jitter(42);
    const nCat = categories.length;
    const isHorizontal = catAxis === "y";
    const catAxisLabel = {
      rotate: isHorizontal ? 0 : areCategoriesNumeric6(categories) ? 0 : 45
    };
    const valueAxisCommon = (name) => ({
      type: "value",
      name,
      axisTick: { show: true },
      axisLabel: { rotate: 0 },
      axisLine: { onZero: false }
    });
    const catAxisIdx = isHorizontal ? "yAxis" : "xAxis";
    const valAxisIdx = isHorizontal ? "xAxis" : "yAxis";
    const option = {
      tooltip: { trigger: "item" },
      [catAxisIdx]: [
        {
          type: "category",
          data: categories,
          name: catField,
          boundaryGap: true,
          axisTick: { show: true, alignWithLabel: true },
          axisLabel: catAxisLabel
        },
        {
          // Hidden value axis aligned with the category axis for scatter jitter.
          type: "value",
          min: -0.5,
          max: nCat - 0.5,
          show: false
        }
      ],
      [valAxisIdx]: valueAxisCommon(contField),
      series: []
    };
    const catScatterAxisIndex = 1;
    const toColorVal = (value) => {
      if (value == null) return NaN;
      return isTemporalColor ? new Date(value).getTime() : Number(value);
    };
    const buildPoint = (row) => {
      const cat = String(row[catField] ?? "");
      const idx = catToIndex.get(cat) ?? 0;
      const offset = rand() * jitterHalfWidth;
      const catVal = idx + offset;
      const contVal = row[contField];
      const point = catAxis === "x" ? [catVal, contVal] : [contVal, catVal];
      if (isContinuousColor2 && colorField) {
        point.push(toColorVal(row[colorField]));
      }
      return point;
    };
    const scatterAxisRef = isHorizontal ? { yAxisIndex: catScatterAxisIndex } : { xAxisIndex: catScatterAxisIndex };
    if (isContinuousColor2 && colorField) {
      const colorVals = table.map((row) => toColorVal(row[colorField])).filter((value) => Number.isFinite(value));
      const colorMin = colorVals.length ? Math.min(...colorVals) : 0;
      const colorMax = colorVals.length ? Math.max(...colorVals) : 1;
      const palette = pickEChartsPalette(colorDecisions?.color ?? colorDecisions?.group);
      option.visualMap = {
        type: "continuous",
        min: colorMin,
        max: colorMax,
        dimension: 2,
        inRange: { color: palette },
        orient: "vertical",
        right: 10,
        top: "12%",
        bottom: "12%",
        name: colorField
      };
      option._visualMapWidth = 70;
      option.graphic = [{
        type: "text",
        right: 10,
        top: 4,
        z: 100,
        style: {
          text: colorField,
          fontSize: 11,
          fontWeight: "bold",
          fill: "#333",
          textAlign: "right"
        }
      }];
      option.series.push({
        name: colorField,
        type: "scatter",
        ...scatterAxisRef,
        data: table.map(buildPoint),
        itemStyle: { opacity: 0.7 },
        symbolSize: 8
      });
    } else if (colorField && isDiscrete13(colorType)) {
      const groups = groupBy(table, colorField);
      option.legend = { data: [...groups.keys()] };
      for (const [name, rows] of groups) {
        option.series.push({
          name,
          type: "scatter",
          ...scatterAxisRef,
          data: rows.map(buildPoint),
          itemStyle: { opacity: 0.7 },
          symbolSize: 8
        });
      }
    } else {
      option.series.push({
        type: "scatter",
        ...scatterAxisRef,
        data: table.map(buildPoint),
        itemStyle: { opacity: 0.7 },
        symbolSize: 8
      });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  pivot: makeCartesianPivot({
    transitions: [
      {
        to: "Scatter Plot",
        label: "Scatter",
        route: { from: "color", to: "x", mode: "swap", spill: "color" }
      }
    ]
  })
};

// src/echarts/templates/waterfall.ts
function areCategoriesNumeric7(cats) {
  if (cats.length === 0) return true;
  return cats.every((c) => {
    const s = String(c).trim();
    if (s === "") return false;
    const n = Number(s);
    return !isNaN(n) && isFinite(n);
  });
}
var ecWaterfallChartDef = {
  chart: "Waterfall Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: () => ({ axisFlags: { x: { banded: true } } }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xField = channelSemantics.x?.field || "Category";
    const yField = channelSemantics.y?.field || "Amount";
    const colorField = channelSemantics.color?.field;
    const categories = extractCategories(table, xField, void 0);
    const rows = categories.map((cat) => table.find((r) => String(r[xField]) === cat)).filter(Boolean);
    const values = rows.map((r) => Number(r[yField]) || 0);
    const hasTypeCol = !!colorField;
    const totalsMode = resolveTotalsMode(values, ctx.chartProperties?.totals);
    const wantFirst = totalsMode === "first" || totalsMode === "both";
    const wantLast = totalsMode === "last" || totalsMode === "both";
    const types = hasTypeCol ? rows.map((r) => String(r[colorField] ?? "delta")) : values.map((_, i) => wantFirst && i === 0 ? "start" : wantLast && i === values.length - 1 ? "end" : "delta");
    const cumulative = [];
    let acc = 0;
    for (const v of values) {
      acc += v;
      cumulative.push(acc);
    }
    const COLOR2 = { startEnd: "#5470c6", increase: "#91cc75", decrease: "#ee6666" };
    const fmt = (n) => {
      const a = Math.abs(n);
      if (a >= 1e3) {
        const v = n / 1e3;
        return `${Number(v.toFixed(v % 1 === 0 ? 0 : 1)).toLocaleString("en-US")}k`;
      }
      return Number(n.toFixed(2)).toLocaleString("en-US");
    };
    const barData = [];
    const tops = [];
    const outerText = [];
    const innerText = [];
    const tipVals = [];
    const prevVals = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const t = types[i];
      const top = t === "end" ? cumulative[i] - v : cumulative[i];
      const prev = t === "start" || t === "end" ? 0 : cumulative[i] - v;
      const lo = Math.min(prev, top);
      const hi = Math.max(prev, top);
      const color = t === "start" || t === "end" ? COLOR2.startEnd : top >= prev ? COLOR2.increase : COLOR2.decrease;
      barData.push({ value: [i, lo, hi, v], itemStyle: { color } });
      tops.push(top);
      outerText.push(fmt(top));
      innerText.push((t === "delta" && v > 0 ? "+" : "") + fmt(v));
      tipVals.push(top);
      prevVals.push(prev);
    }
    const showLabels = !!ctx.chartProperties?.showTextLabels;
    const BAR_WIDTH_FRAC = 0.58;
    const connectorData = tops.slice(0, -1).map((y, i) => [i, y]);
    const legendItems = ["Start/End", "Increase", "Decrease"];
    const legendColors = [COLOR2.startEnd, COLOR2.increase, COLOR2.decrease];
    const option = {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          const head = params[0]?.axisValueLabel ?? params[0]?.name ?? "";
          const bar = params.find((p) => p.seriesName === "Delta" && Array.isArray(p.value));
          if (!bar) return String(head);
          return `${head}<br/>${bar.marker ?? ""} ${yField}: ${bar.value[3]}`;
        }
      },
      legend: {
        data: legendItems
      },
      xAxis: {
        type: "category",
        data: categories,
        name: xField,
        nameLocation: "middle",
        nameGap: 30,
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: {
          rotate: areCategoriesNumeric7(categories) ? 0 : 90,
          formatter: (value) => value
        }
      },
      yAxis: { type: "value", name: yField, axisTick: { show: true } },
      series: [
        // Bars as floating rectangles. A custom series gives full [lo, hi]
        // control so bars crossing zero render correctly (a transparent-base +
        // delta stack would snap them back to the zero baseline, because
        // ECharts splits positive/negative values onto separate stacks).
        {
          type: "custom",
          name: "Delta",
          data: barData,
          encode: { x: 0, y: [1, 2] },
          renderItem: (params, api) => {
            const i = api.value(0);
            const lo = api.value(1);
            const hi = api.value(2);
            const pLo = api.coord([i, lo]);
            const pHi = api.coord([i, hi]);
            const band = api.size([1, 0])[0];
            const w = band * BAR_WIDTH_FRAC;
            const cx = pLo[0];
            const yTop = Math.min(pLo[1], pHi[1]);
            const h = Math.abs(pLo[1] - pHi[1]);
            const rect = {
              type: "rect",
              shape: { x: cx - w / 2, y: yTop, width: w, height: h },
              style: api.style()
            };
            if (!showLabels || band < 18) return rect;
            const idx = params.dataIndex;
            const fontSize = band >= 40 ? 10 : band >= 26 ? 9 : 8;
            const up = tipVals[idx] >= prevVals[idx];
            const pTip = api.coord([i, tipVals[idx]]);
            const children = [rect];
            children.push({
              type: "text",
              style: {
                text: outerText[idx],
                x: cx,
                y: pTip[1] + (up ? -4 : 4),
                textAlign: "center",
                textVerticalAlign: up ? "bottom" : "top",
                fill: "#374151",
                fontSize
              }
            });
            if (h >= fontSize + 4) {
              children.push({
                type: "text",
                style: {
                  text: innerText[idx],
                  x: cx,
                  y: (pLo[1] + pHi[1]) / 2,
                  textAlign: "center",
                  textVerticalAlign: "middle",
                  fill: "#ffffff",
                  fontSize
                }
              });
            }
            return { type: "group", children };
          }
        },
        // Legend-only series: no data, only for the legend colour swatches.
        ...legendItems.map((name, i) => ({
          type: "bar",
          name,
          data: [],
          barWidth: "58%",
          itemStyle: { color: legendColors[i] }
        })),
        // Connector lines: gap-only horizontal segments between adjacent bars.
        {
          type: "custom",
          name: "__connectors",
          silent: true,
          z: 5,
          data: connectorData,
          renderItem: (_params, api) => {
            const i = api.value(0);
            const y = api.value(1);
            const pThis = api.coord([i, y]);
            const pNext = api.coord([i + 1, y]);
            const half = (pNext[0] - pThis[0]) * (BAR_WIDTH_FRAC / 2);
            return {
              type: "line",
              shape: {
                x1: pThis[0] - half,
                y1: pThis[1],
                x2: pNext[0] + half,
                y2: pNext[1]
              },
              style: { stroke: "#6b7280", lineWidth: 1, opacity: 0.7 }
            };
          }
        }
      ]
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/pyramid.ts
function rowMatchesColorGroup(row, colorField, groupVal) {
  const raw = row[colorField];
  if (raw === groupVal) return true;
  if (raw == null || groupVal == null) return false;
  return String(raw) === String(groupVal);
}
var ecPyramidChartDef = {
  chart: "Pyramid Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color"],
  markCognitiveChannel: "length",
  declareLayoutMode: () => ({ axisFlags: { y: { banded: true } } }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const xField = xCS?.field;
    const yField = yCS?.field;
    if (!xField || !yField) return;
    const yDiscrete = yCS?.type === "nominal" || yCS?.type === "ordinal";
    const catField = yDiscrete ? yField : xField;
    const valField = yDiscrete ? xField : yField;
    const colorField = channelSemantics.color?.field ?? channelSemantics.group?.field;
    const catChannel = yDiscrete ? "y" : "x";
    const ordinalSort = getCategoryOrder(ctx, catChannel) ?? (yDiscrete ? yCS?.ordinalSortOrder : xCS?.ordinalSortOrder);
    const categories = extractCategories(table, catField, ordinalSort);
    const sumPerCategory = (predicate) => {
      const valueMap = /* @__PURE__ */ new Map();
      for (const row of table) {
        if (predicate && !predicate(row)) continue;
        const cat = String(row[catField] ?? "");
        const v = row[valField];
        if (v != null && !isNaN(Number(v))) {
          valueMap.set(cat, (valueMap.get(cat) ?? 0) + Number(v));
        }
      }
      return categories.map((cat) => valueMap.get(cat) ?? 0);
    };
    let leftPos;
    let rightPos;
    let leftName;
    let rightName;
    if (colorField && table.length > 0) {
      const groups = [...new Set(table.map((r) => r[colorField]))];
      const leftGroup = groups[0];
      const rightGroup = groups.length > 1 ? groups[1] : groups[0];
      leftPos = sumPerCategory((row) => rowMatchesColorGroup(row, colorField, leftGroup));
      rightPos = sumPerCategory((row) => rowMatchesColorGroup(row, colorField, rightGroup));
      leftName = String(leftGroup);
      rightName = String(rightGroup);
      if (groups.length > 2) {
        if (!spec._warnings) spec._warnings = [];
        spec._warnings.push({
          severity: "warning",
          code: "too-many-groups-pyramid",
          message: `Pyramid chart works best with exactly 2 groups, but found ${groups.length} (${groups.map((g) => `'${g}'`).join(", ")}). Only the first two are shown.`,
          channel: "color",
          field: colorField
        });
      }
    } else {
      const values = sumPerCategory();
      leftPos = values;
      rightPos = values;
    }
    const leftData = leftPos.map((v) => -v);
    const rightData = rightPos;
    const maxAbs = Math.max(0, ...leftData.map(Math.abs), ...rightData.map(Math.abs));
    const axisLineStyle = { color: "#333", width: 1 };
    const tickLineStyle = { color: "#333", width: 1 };
    const labelFont = { fontSize: 11, color: "#333" };
    const yAxisStyle = {
      type: "category",
      data: categories,
      name: catField,
      nameLocation: "middle",
      nameGap: 40,
      nameTextStyle: { fontSize: 12, color: "#333" },
      boundaryGap: true,
      axisLine: { show: true, onZero: false, lineStyle: axisLineStyle },
      axisTick: {
        show: true,
        alignWithLabel: true,
        interval: 0,
        length: 6,
        lineStyle: tickLineStyle
      },
      axisLabel: { ...labelFont },
      splitLine: { show: false }
    };
    const option = {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "value",
        name: valField,
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { fontSize: 12, color: "#333" },
        axisLine: { show: true, lineStyle: axisLineStyle },
        axisTick: { show: true, length: 6, lineStyle: tickLineStyle },
        axisLabel: {
          ...labelFont,
          formatter: (v) => Math.abs(v).toString()
        },
        splitLine: { show: false },
        ...maxAbs > 0 ? { min: -maxAbs, max: maxAbs } : {}
      },
      yAxis: yAxisStyle,
      series: [
        {
          type: "bar",
          name: leftName,
          data: leftData,
          barGap: "-100%"
        },
        {
          type: "bar",
          name: rightName,
          data: rightData,
          barGap: "-100%"
        }
      ]
    };
    if (leftName != null && rightName != null) {
      option._pyramidChannelHeader = leftName === rightName ? { mode: "single", text: leftName } : { mode: "pair", left: leftName, right: rightName };
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/ranged-dot.ts
var isDiscrete14 = (type) => type === "nominal" || type === "ordinal";
var ecRangedDotPlotDef = {
  chart: "Ranged Dot Plot",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "color"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xField = channelSemantics.x?.field;
    const yField = channelSemantics.y?.field;
    const colorField = channelSemantics.color?.field;
    if (!xField || !yField) return;
    const xIsDiscrete = isDiscrete14(channelSemantics.x?.type);
    const yIsDiscrete = isDiscrete14(channelSemantics.y?.type);
    const xCategories = xIsDiscrete ? extractCategories(table, xField, channelSemantics.x?.ordinalSortOrder) : void 0;
    const yCategories = yIsDiscrete ? extractCategories(table, yField, getCategoryOrder(ctx, "y")) : void 0;
    const yIndexMap = yCategories ? new Map(yCategories.map((c, i) => [c, i])) : null;
    const option = {
      tooltip: { trigger: "item" },
      xAxis: {
        type: xIsDiscrete ? "category" : "value",
        name: xField,
        nameLocation: "middle",
        nameGap: 30,
        axisTick: xIsDiscrete ? { show: true, alignWithLabel: true } : { show: true },
        ...xCategories ? { data: xCategories } : {}
      },
      yAxis: yIsDiscrete && yCategories ? {
        type: "category",
        data: yCategories,
        name: yField,
        nameLocation: "middle",
        nameGap: 40,
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: { rotate: 0 }
      } : { type: "value", name: yField, nameLocation: "middle", nameGap: 40, axisTick: { show: true } },
      series: []
    };
    const pointForRow = (r) => {
      if (yIndexMap != null) {
        const yi = yIndexMap.get(String(r[yField] ?? ""));
        if (yi === void 0) return [Number(r[xField]), 0];
        return [Number(r[xField]), yi];
      }
      return [r[xField], r[yField]];
    };
    if (colorField) {
      const groups = groupBy(table, colorField);
      const colorCategories = [...groups.keys()];
      option.legend = { data: colorCategories };
      option._legendTitle = colorField;
      if (yCategories && yIndexMap) {
        const segmentData = [];
        for (let i = 0; i < yCategories.length; i++) {
          const yCat = yCategories[i];
          const rows = table.filter((r) => String(r[yField] ?? "") === yCat);
          if (xIsDiscrete && xCategories) {
            const indices = rows.map((r) => xCategories.indexOf(String(r[xField] ?? ""))).filter((idx) => idx >= 0);
            if (indices.length >= 1) {
              const minXi = Math.min(...indices);
              const maxXi = Math.max(...indices);
              segmentData.push([minXi, i], [maxXi, i], null);
            }
          } else {
            const vals = rows.map((r) => Number(r[xField])).filter((v) => isFinite(v));
            if (vals.length >= 1) {
              const minX = Math.min(...vals);
              const maxX = Math.max(...vals);
              segmentData.push([minX, i], [maxX, i], null);
            }
          }
        }
        if (segmentData.length > 0) {
          segmentData.pop();
          option.series.push({
            name: "",
            // no legend entry for connector line
            type: "line",
            data: segmentData,
            showSymbol: false,
            itemStyle: { color: "#999" },
            lineStyle: { color: "#999" }
          });
        }
      }
      for (const [name, rows] of groups) {
        const scatterData = xIsDiscrete ? xCategories.map((cat, xi) => {
          const row = rows.find((r) => String(r[xField]) === cat);
          if (!row) return null;
          return yIndexMap ? [xi, yIndexMap.get(String(row[yField] ?? "")) ?? 0] : [xi, row[yField]];
        }).filter(Boolean) : yCategories && yIndexMap ? [...rows].sort((a, b) => (yIndexMap.get(String(a[yField])) ?? 0) - (yIndexMap.get(String(b[yField])) ?? 0)).map((r) => pointForRow(r)) : rows.map((r) => [r[xField], r[yField]]);
        option.series.push({
          name,
          type: "scatter",
          data: scatterData,
          symbolSize: 8
          // 颜色由 ecApplyLayoutToSpec 根据 colorDecisions 统一分配
        });
      }
    } else {
      const lineData = xIsDiscrete ? xCategories.map((cat, xi) => {
        const row = table.find((r) => String(r[xField]) === cat);
        if (!row) return null;
        return yIndexMap ? [xi, yIndexMap.get(String(row[yField] ?? "")) ?? 0] : [xi, row[yField]];
      }) : yCategories ? [...table].sort((a, b) => (yIndexMap.get(String(a[yField])) ?? 0) - (yIndexMap.get(String(b[yField])) ?? 0)).map((r) => pointForRow(r)) : table.map((r) => [r[xField], r[yField]]);
      const scatterData = xIsDiscrete ? yIndexMap ? lineData : xCategories.map((cat, i) => [cat, lineData[i]]) : lineData;
      option.series.push({ type: "line", data: lineData, showSymbol: false });
      option.series.push({ type: "scatter", data: scatterData, symbolSize: 8 });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/density.ts
function estimateBandwidth2(values) {
  const n = values.length;
  if (n < 2) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mean2 = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v2) => s + (v2 - mean2) ** 2, 0) / n;
  const d = Math.sqrt(variance);
  const q1 = sorted[Math.floor((n - 1) * 0.25)];
  const q3 = sorted[Math.floor((n - 1) * 0.75)];
  const iqr = q3 != null && q1 != null ? q3 - q1 : 0;
  const h = iqr / 1.34;
  const v = Math.min(d, h || d) || d || 1;
  return 1.06 * v * Math.pow(n, -0.2);
}
function kde(values, steps, bandwidthMultiplier, extent) {
  if (values.length === 0) return { x: [], y: [] };
  const min = extent ? extent.min : Math.min(...values);
  const max = extent ? extent.max : Math.max(...values);
  const range = max - min || 1;
  const lo = min;
  const hi = max;
  const h = estimateBandwidth2(values) * bandwidthMultiplier;
  const n = values.length;
  const x = [];
  const y = [];
  for (let i = 0; i <= steps; i++) {
    const t = lo + i / steps * (hi - lo || range);
    let sum = 0;
    for (const v of values) {
      const z = (t - v) / h;
      sum += Math.exp(-0.5 * z * z);
    }
    const density = sum / (n * h * Math.sqrt(2 * Math.PI));
    x.push(t);
    y.push(density);
  }
  return { x, y };
}
var ecDensityPlotDef = {
  chart: "Density Plot",
  template: { mark: "area", encoding: {} },
  channels: ["x", "color", "column", "row"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xField = channelSemantics.x?.field;
    const colorField = channelSemantics.color?.field;
    if (!xField) return;
    const steps = 200;
    const bandwidthMultiplier = chartProperties?.bandwidth != null && chartProperties.bandwidth > 0 ? chartProperties.bandwidth : 1;
    const option = {
      tooltip: { trigger: "axis" },
      xAxis: { type: "value", name: xField, nameLocation: "middle", nameGap: 30, axisTick: { show: true } },
      yAxis: { type: "value", name: "Density", nameLocation: "middle", nameGap: 40, axisTick: { show: true } },
      series: []
    };
    option._encodingTooltip = { trigger: "axis", categoryLabel: xField, valueLabel: "Density" };
    if (colorField) {
      const groups = groupBy(table, colorField);
      option.legend = { data: [...groups.keys()] };
      option._legendTitle = colorField;
      const allValues = table.map((r) => Number(r[xField])).filter((v) => !isNaN(v));
      const sharedExtent = allValues.length > 0 ? { min: Math.min(...allValues), max: Math.max(...allValues) } : void 0;
      for (const [name, rows] of groups) {
        const values = rows.map((r) => Number(r[xField])).filter((v) => !isNaN(v));
        const { x, y } = kde(values, steps, bandwidthMultiplier, sharedExtent);
        const data = x.map((xi, i) => [xi, y[i]]);
        option.series.push({
          name,
          type: "line",
          data,
          symbol: "none",
          // 颜色由 color-decisions / option.color 驱动；这里只设置透明度。
          areaStyle: { opacity: 0.5 }
        });
      }
    } else {
      const values = table.map((r) => Number(r[xField])).filter((v) => !isNaN(v));
      const { x, y } = kde(values, steps, bandwidthMultiplier);
      const data = x.map((xi, i) => [xi, y[i]]);
      option.series.push({
        type: "line",
        data,
        symbol: "none",
        areaStyle: { opacity: 0.5 }
      });
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "bandwidth", label: "Bandwidth", type: "continuous", min: 0.05, max: 2, step: 0.05, defaultValue: 0 }
  ]
};

// src/echarts/templates/ecdf.ts
function ecdfPairs(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  const pairs = [];
  if (n === 0) return pairs;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    pairs.push([sorted[i], (j + 1) / n]);
    i = j + 1;
  }
  return pairs;
}
var ecEcdfPlotDef = {
  chart: "ECDF Plot",
  template: { mark: "line", encoding: {} },
  channels: ["x", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xField = channelSemantics.x?.field;
    const groupField = channelSemantics.color?.field ?? channelSemantics.detail?.field;
    if (!xField) return;
    const showPoints = !!chartProperties?.showPoints;
    const option = {
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      xAxis: {
        type: "value",
        name: xField,
        nameLocation: "middle",
        nameGap: 30,
        // Fit the measure range (an ECDF reads the value of the rise, not
        // distance from zero).
        scale: true,
        axisTick: { show: true }
      },
      yAxis: {
        type: "value",
        name: "Cumulative proportion",
        nameLocation: "middle",
        nameGap: 45,
        min: 0,
        max: 1,
        axisTick: { show: true }
      },
      series: []
    };
    option._encodingTooltip = { trigger: "axis", categoryLabel: xField, valueLabel: "Cumulative proportion" };
    const makeSeries = (name, values) => ({
      ...name != null ? { name } : {},
      type: "line",
      // step-after: hold the proportion until the next value, then jump.
      step: "end",
      data: ecdfPairs(values),
      showSymbol: showPoints,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" }
    });
    if (groupField) {
      const groups = groupBy(table, groupField);
      option.legend = { data: [...groups.keys()] };
      option._legendTitle = groupField;
      for (const [name, rows] of groups) {
        const values = rows.map((r) => Number(r[xField])).filter((v) => !isNaN(v));
        option.series.push(makeSeries(name, values));
      }
    } else {
      const values = table.map((r) => Number(r[xField])).filter((v) => !isNaN(v));
      option.series.push(makeSeries(void 0, values));
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "showPoints", label: "Show points", type: "binary", defaultValue: false }
  ]
};

// src/echarts/templates/calendar.ts
var SCHEME_COLORS2 = {
  viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  blues: ["#f7fbff", "#6baed6", "#08519c"],
  greens: ["#f7fcf5", "#74c476", "#00441b"],
  reds: ["#fff5f0", "#fb6a4a", "#a50f15"],
  oranges: ["#fff5eb", "#fd8d3c", "#7f2704"],
  purples: ["#fcfbfd", "#9e9ac8", "#3f007d"],
  github: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
};
function toDateString(raw) {
  if (raw == null) return null;
  let d;
  if (raw instanceof Date) {
    d = raw;
  } else if (typeof raw === "number" && isFinite(raw)) {
    d = new Date(raw < 1e12 ? raw * 1e3 : raw);
  } else {
    const s = String(raw).trim();
    d = new Date(s);
    if (isNaN(d.getTime())) return null;
  }
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
var ecCalendarHeatmapDef = {
  chart: "Calendar Heatmap",
  template: { mark: "rect", encoding: {} },
  channels: ["x", "color"],
  markCognitiveChannel: "color",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, colorDecisions, encodings } = ctx;
    const dateField = channelSemantics.x?.field;
    const valueField = channelSemantics.color?.field;
    if (!dateField) return;
    const cellMap = /* @__PURE__ */ new Map();
    for (const row of table) {
      const dateStr = toDateString(row[dateField]);
      if (!dateStr) continue;
      const val = valueField ? Number(row[valueField]) || 0 : 1;
      cellMap.set(dateStr, (cellMap.get(dateStr) ?? 0) + val);
    }
    const calData = [];
    let minVal = Infinity;
    let maxVal = -Infinity;
    let minDate = "9999-12-31";
    let maxDate = "0000-01-01";
    for (const [dateStr, val] of cellMap) {
      calData.push([dateStr, val]);
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
      if (dateStr < minDate) minDate = dateStr;
      if (dateStr > maxDate) maxDate = dateStr;
    }
    if (calData.length === 0) return;
    if (minVal === Infinity) minVal = 0;
    if (maxVal === -Infinity) maxVal = 1;
    if (minVal === maxVal) maxVal = minVal + 1;
    const dayMs = 864e5;
    const spanDays = (Date.parse(maxDate) - Date.parse(minDate)) / dayMs;
    const weeks = Math.max(1, Math.ceil((spanDays + 8) / 7));
    const cell = weeks > 60 ? 12 : weeks > 30 ? 15 : 18;
    const calLeft = 44;
    const calRight = 16;
    const calTop = 34;
    const vmHeight = 70;
    const gridH = 7 * cell;
    const canvasW = calLeft + weeks * cell + calRight;
    const canvasH = calTop + gridH + vmHeight;
    const encScheme = encodings?.color?.scheme;
    const userScheme = encScheme && encScheme !== "default" ? encScheme : void 0;
    const schemeName = userScheme || "viridis";
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    let schemeColors = SCHEME_COLORS2[schemeName] || SCHEME_COLORS2.viridis;
    if (decision?.schemeId) {
      const fromDecision = getPaletteForScheme(decision.schemeId);
      if (fromDecision && fromDecision.length > 0) schemeColors = fromDecision;
    }
    const option = {
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          const [date, val] = params.value;
          return `${date}<br/>${valueField ?? "Count"}: ${val}`;
        }
      },
      visualMap: {
        type: "continuous",
        min: minVal,
        max: maxVal,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 6,
        itemWidth: 12,
        itemHeight: 100,
        text: ["high", "low"],
        inRange: { color: schemeColors }
      },
      calendar: {
        top: calTop,
        left: calLeft,
        right: calRight,
        cellSize: [cell, cell],
        range: minDate === maxDate ? minDate : [minDate, maxDate],
        orient: "horizontal",
        splitLine: { show: true, lineStyle: { color: "#ccc", width: 1 } },
        itemStyle: { borderWidth: 1, borderColor: "#fff", color: "#f4f4f4" },
        yearLabel: { show: false },
        dayLabel: { firstDay: 1, fontSize: 10, color: "#666" },
        monthLabel: { fontSize: 11, color: "#333" }
      },
      series: [{
        type: "heatmap",
        coordinateSystem: "calendar",
        data: calData
      }],
      _width: canvasW,
      _height: canvasH
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  encodingActions: [
    {
      key: "colorScheme",
      label: "Scheme",
      isApplicable: (ctx) => !!ctx.encodings.color?.field,
      dependencies: ["color"],
      control: {
        type: "discrete",
        options: [
          { value: void 0, label: "Default (Viridis)" },
          { value: "viridis", label: "Viridis" },
          { value: "github", label: "GitHub" },
          { value: "blues", label: "Blues" },
          { value: "greens", label: "Greens" },
          { value: "reds", label: "Reds" },
          { value: "oranges", label: "Oranges" },
          { value: "purples", label: "Purples" }
        ]
      },
      get: (enc) => enc.color?.scheme,
      set: (enc, value) => ({ ...enc, color: { ...enc.color, scheme: value } })
    }
  ]
};

// src/chartjs/colormap.ts
var CHARTJS_COLOR_MAPS = [
  {
    id: "cat10",
    type: "categorical",
    supportsDiscrete: true,
    supportsContinuous: false,
    background: "any",
    maxCategories: 10,
    colorblindSafe: false,
    colors: [
      "#36a2eb",
      // blue
      "#ff6384",
      // red
      "#ffcd56",
      // yellow
      "#4bc0c0",
      // teal
      "#9966ff",
      // purple
      "#ff9f40",
      // orange
      "#2ecc71",
      // green
      "#34495e",
      // dark blue-grey
      "#e74c3c",
      // red-orange
      "#95a5a6"
      // grey
    ]
  },
  {
    id: "cat20",
    type: "categorical",
    supportsDiscrete: true,
    supportsContinuous: false,
    background: "any",
    maxCategories: 20,
    colorblindSafe: false,
    colors: [
      "#36a2eb",
      "#9ad0f5",
      "#ff6384",
      "#ff99aa",
      "#ffcd56",
      "#ffe39f",
      "#4bc0c0",
      "#8fdede",
      "#9966ff",
      "#c3a3ff",
      "#ff9f40",
      "#ffc078",
      "#2ecc71",
      "#7ee2a8",
      "#34495e",
      "#5d6d7e",
      "#e74c3c",
      "#f1948a",
      "#95a5a6",
      "#cfd4d6"
    ]
  },
  {
    id: "viridis",
    type: "sequential",
    supportsDiscrete: true,
    supportsContinuous: true,
    background: "any",
    colorblindSafe: true,
    colors: [
      "#440154",
      "#46327e",
      "#365c8d",
      "#277f8e",
      "#1fa187",
      "#4ac16d",
      "#a0da39",
      "#fde725"
    ]
  },
  {
    id: "RdBu",
    type: "diverging",
    supportsDiscrete: true,
    supportsContinuous: true,
    background: "any",
    diverging: true,
    preferredMidpoint: 0,
    colors: [
      "#b2182b",
      "#d6604d",
      "#f4a582",
      "#fddbc7",
      "#f7f7f7",
      "#d1e5f0",
      "#92c5de",
      "#4393c3",
      "#2166ac"
    ]
  }
];
function getMapById2(id) {
  if (!id) return void 0;
  const key = String(id).toLowerCase();
  return CHARTJS_COLOR_MAPS.find((m) => m.id.toLowerCase() === key);
}
function getPaletteForScheme2(id) {
  const entry = getMapById2(id);
  return entry?.colors;
}
function pickChartJsPalette(decision) {
  if (!decision) {
    const fallback2 = getPaletteForScheme2("cat10");
    return fallback2 && fallback2.length ? fallback2 : [];
  }
  const { schemeType, schemeId, categoryCount } = decision;
  if (schemeId) {
    const fromId = getPaletteForScheme2(schemeId);
    if (fromId && fromId.length > 0) {
      return fromId;
    }
  }
  const mapsOfType = CHARTJS_COLOR_MAPS.filter((m) => m.type === schemeType);
  if (schemeType === "categorical") {
    const k = categoryCount ?? 0;
    if (mapsOfType.length) {
      const candidates = mapsOfType.filter((m) => m.supportsDiscrete);
      if (candidates.length) {
        const byCapacity = candidates.filter((m) => m.maxCategories == null || m.maxCategories >= k).sort((a, b) => (a.maxCategories ?? Infinity) - (b.maxCategories ?? Infinity));
        const picked = byCapacity[0] ?? candidates[0];
        if (picked.colors.length) {
          return picked.colors;
        }
      }
    }
    const fallback2 = getPaletteForScheme2("cat10");
    if (fallback2 && fallback2.length) {
      return fallback2;
    }
  } else if (schemeType === "sequential") {
    const seq = mapsOfType.find((m) => m.supportsContinuous) ?? getMapById2("viridis");
    if (seq && seq.colors.length) {
      return seq.colors;
    }
  } else if (schemeType === "diverging") {
    const divergingFirst = mapsOfType.find((m) => m.diverging) ?? getMapById2("RdBu");
    if (divergingFirst && divergingFirst.colors.length) {
      return divergingFirst.colors;
    }
  }
  const fallback = getPaletteForScheme2("cat10");
  return fallback && fallback.length ? fallback : [];
}

// src/chartjs/templates/utils.ts
var isDiscrete15 = (type) => type === "nominal" || type === "ordinal";
function extractCategories2(data, field, ordinalSortOrder) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const row of data) {
    const val = row[field];
    if (val != null) {
      const key = String(val);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
  }
  if (ordinalSortOrder && ordinalSortOrder.length > 0) {
    const orderMap = new Map(ordinalSortOrder.map((v, i) => [v, i]));
    result.sort((a, b) => {
      const ia = orderMap.get(a);
      const ib = orderMap.get(b);
      if (ia !== void 0 && ib !== void 0) return ia - ib;
      if (ia !== void 0) return -1;
      if (ib !== void 0) return 1;
      return 0;
    });
  }
  return result;
}
function groupBy2(data, field) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of data) {
    const key = String(row[field] ?? "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}
function coerceUnixMsForChartJs(raw) {
  if (raw == null) return NaN;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1e12 ? Math.round(raw * 1e3) : raw;
  }
  if (raw instanceof Date) {
    const t2 = raw.getTime();
    return Number.isFinite(t2) ? t2 : NaN;
  }
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : NaN;
}
var DEFAULT_COLORS2 = [
  "rgba(54, 162, 235, 1)",
  // blue
  "rgba(255, 99, 132, 1)",
  // red
  "rgba(255, 206, 86, 1)",
  // yellow
  "rgba(75, 192, 192, 1)",
  // teal
  "rgba(153, 102, 255, 1)",
  // purple
  "rgba(255, 159, 64, 1)",
  // orange
  "rgba(46, 204, 113, 1)",
  // green
  "rgba(52, 73, 94, 1)",
  // dark blue-grey
  "rgba(231, 76, 60, 1)",
  // red-orange
  "rgba(149, 165, 166, 1)"
  // grey
];
var DEFAULT_BG_COLORS = [
  "rgba(54, 162, 235, 0.6)",
  "rgba(255, 99, 132, 0.6)",
  "rgba(255, 206, 86, 0.6)",
  "rgba(75, 192, 192, 0.6)",
  "rgba(153, 102, 255, 0.6)",
  "rgba(255, 159, 64, 0.6)",
  "rgba(46, 204, 113, 0.6)",
  "rgba(52, 73, 94, 0.6)",
  "rgba(231, 76, 60, 0.6)",
  "rgba(149, 165, 166, 0.6)"
];
function hexToRgb3(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const intVal = parseInt(m[1], 16);
  return {
    r: intVal >> 16 & 255,
    g: intVal >> 8 & 255,
    b: intVal & 255
  };
}
function rgbaFromHex(hex, alpha) {
  const rgb = hexToRgb3(hex);
  if (!rgb) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}
function applyAlphaToColor(color, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith("#")) {
    return rgbaFromHex(color, a);
  }
  if (color.startsWith("rgba")) {
    return color.replace(
      /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
      (_m, r, g, b) => `rgba(${r}, ${g}, ${b}, ${a})`
    );
  }
  if (color.startsWith("rgb(")) {
    return color.replace(
      /rgb\((\d+),\s*(\d+),\s*(\d+)\)/,
      (_m, r, g, b) => `rgba(${r}, ${g}, ${b}, ${a})`
    );
  }
  return color;
}
function getChartJsPalette(ctx, preferred = "color") {
  const decisions = ctx.colorDecisions;
  const decision = preferred === "color" ? decisions?.color ?? decisions?.group : decisions?.group ?? decisions?.color;
  const palette = pickChartJsPalette(decision);
  if (palette.length > 0) {
    return palette;
  }
  return DEFAULT_COLORS2;
}
function getSeriesBorderColor(palette, index) {
  if (!palette.length) {
    return DEFAULT_COLORS2[index % DEFAULT_COLORS2.length];
  }
  return palette[index % palette.length];
}
function getSeriesBackgroundColor(palette, index, alpha = 0.6) {
  const border = getSeriesBorderColor(palette, index);
  return applyAlphaToColor(border, alpha);
}
function detectAxes2(channelSemantics) {
  const xCS = channelSemantics.x;
  const yCS = channelSemantics.y;
  if (xCS && isDiscrete15(xCS.type)) {
    return { categoryAxis: "x", valueAxis: "y" };
  }
  if (yCS && isDiscrete15(yCS.type)) {
    return { categoryAxis: "y", valueAxis: "x" };
  }
  return { categoryAxis: "x", valueAxis: "y" };
}
function buildCategoryAlignedData3(rows, xField, yField, categories) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = String(row[xField] ?? "");
    const val = row[yField];
    if (val != null && !isNaN(val)) {
      map.set(key, (map.get(key) ?? 0) + Number(val));
    }
  }
  return categories.map((cat) => map.get(cat) ?? null);
}

// src/echarts/templates/parallel.ts
var DEFAULT_COLORS3 = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#ea7ccc",
  "#c0504d"
];
function isNumericField(table, field) {
  let total = 0;
  let numeric = 0;
  for (const row of table) {
    const v = row[field];
    if (v == null || v === "") continue;
    total++;
    if (typeof v === "number" ? isFinite(v) : !isNaN(Number(v))) numeric++;
  }
  return total > 0 && numeric / total >= 0.9;
}
function niceBounds(min, max) {
  if (!isFinite(min) || !isFinite(max)) return null;
  if (min === max) {
    const pad = Math.abs(min) > 1e-9 ? Math.abs(min) * 0.1 : 1;
    return [min - pad, max + pad];
  }
  const rawStep = (max - min) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm2 = rawStep / mag;
  const step = (norm2 < 1.5 ? 1 : norm2 < 3 ? 2 : norm2 < 7 ? 5 : 10) * mag;
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}
var ecParallelCoordinatesDef = {
  chart: "Parallel Coordinates",
  template: { mark: "line", encoding: {} },
  channels: ["color", "detail"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    if (table.length === 0) return;
    const colorField = channelSemantics.color?.field;
    let dims = Array.isArray(chartProperties?.dimensions) ? chartProperties.dimensions.filter((d) => d in table[0]) : [];
    if (dims.length === 0) {
      dims = Object.keys(table[0]).filter(
        (k) => k !== colorField && isNumericField(table, k)
      );
    }
    if (dims.length < 2) return;
    const palette = colorField ? getChartJsPalette(ctx, "color") : DEFAULT_COLORS3;
    const colors = palette.length > 0 ? palette : DEFAULT_COLORS3;
    const parallelAxis = dims.map((name, i) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const row of table) {
        const v = Number(row[name]);
        if (isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const bounds = niceBounds(lo, hi);
      return {
        dim: i,
        name,
        nameTextStyle: { fontSize: 11 },
        nameGap: 8,
        axisLabel: { fontSize: 10 },
        ...bounds ? { min: bounds[0], max: bounds[1] } : {}
      };
    });
    const toLine = (row) => dims.map((d) => {
      const v = Number(row[d]);
      return isFinite(v) ? v : null;
    });
    const series = [];
    const legendData = [];
    const lineOpacity = table.length > 200 ? 0.22 : table.length > 100 ? 0.3 : table.length > 60 ? 0.45 : 0.6;
    if (colorField) {
      const groups = /* @__PURE__ */ new Map();
      for (const row of table) {
        const key = String(row[colorField] ?? "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(toLine(row));
      }
      let i = 0;
      for (const [name, data] of groups) {
        legendData.push(name);
        series.push({
          name,
          type: "parallel",
          data,
          lineStyle: { width: 1.5, opacity: lineOpacity, color: colors[i % colors.length] },
          emphasis: { lineStyle: { width: 3, opacity: 0.9 } }
        });
        i++;
      }
    } else {
      series.push({
        type: "parallel",
        data: table.map(toLine),
        lineStyle: { width: 1.5, opacity: lineOpacity, color: colors[0] },
        emphasis: { lineStyle: { width: 3, opacity: 0.9 } }
      });
    }
    const hasLegend = legendData.length > 1;
    const parTop = hasLegend ? 56 : 28;
    const parBottom = 36;
    const parLeft = 56;
    const parRight = 56;
    const perDim = 96;
    const canvasW = Math.max(ctx.canvasSize.width, parLeft + parRight + (dims.length - 1) * perDim);
    const canvasH = Math.max(ctx.canvasSize.height, parTop + parBottom + 200);
    const option = {
      tooltip: {},
      parallelAxis,
      parallel: {
        top: parTop,
        bottom: parBottom,
        left: parLeft,
        right: parRight,
        parallelAxisDefault: {
          nameLocation: "end",
          nameGap: 14,
          axisLine: { lineStyle: { color: "#888" } },
          axisLabel: { color: "#555" }
        }
      },
      series,
      _width: canvasW,
      _height: canvasH
    };
    if (hasLegend) {
      option.legend = {
        data: legendData,
        top: 8,
        left: "center",
        orient: "horizontal",
        itemWidth: 18,
        textStyle: { fontSize: 11 },
        ...legendData.length > 10 ? { type: "scroll" } : {}
      };
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/graph.ts
var ecGraphDef = {
  chart: "Network Graph",
  template: { mark: "point", encoding: {} },
  channels: ["x", "y", "size"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const sourceField = channelSemantics.x?.field;
    const targetField = channelSemantics.y?.field;
    const weightField = channelSemantics.size?.field;
    if (!sourceField || !targetField) return;
    const linkAgg = /* @__PURE__ */ new Map();
    const degree = /* @__PURE__ */ new Map();
    for (const row of table) {
      const src = String(row[sourceField] ?? "");
      const tgt = String(row[targetField] ?? "");
      if (!src || !tgt || src === tgt) continue;
      const w = weightField ? Number(row[weightField]) || 0 : 1;
      const key = `${src}\0${tgt}`;
      linkAgg.set(key, (linkAgg.get(key) ?? 0) + w);
      degree.set(src, (degree.get(src) ?? 0) + w);
      degree.set(tgt, (degree.get(tgt) ?? 0) + w);
    }
    const links = [];
    const nodeSet = /* @__PURE__ */ new Set();
    for (const [key, value] of linkAgg) {
      const [source, target] = key.split("\0");
      nodeSet.add(source);
      nodeSet.add(target);
      links.push({ source, target, value });
    }
    if (links.length === 0) return;
    const nodeArr = [...nodeSet];
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    let palette;
    if (decision?.schemeId) {
      const fromRegistry = getPaletteForScheme(decision.schemeId);
      if (fromRegistry && fromRegistry.length > 0) palette = fromRegistry;
    }
    if (!palette || palette.length === 0) {
      palette = getPaletteForScheme(nodeArr.length > 10 ? "cat20" : "cat10") ?? DEFAULT_COLORS;
    }
    const degVals = nodeArr.map((n) => degree.get(n) ?? 0);
    const dMin = Math.min(...degVals);
    const dMax = Math.max(...degVals);
    const rMin = 12, rMax = 46;
    const sizeFor = (d) => {
      if (dMax === dMin) return (rMin + rMax) / 2;
      const t = (d - dMin) / (dMax - dMin);
      const area = rMin * rMin + t * (rMax * rMax - rMin * rMin);
      return Math.sqrt(area);
    };
    const nodes = nodeArr.map((name, i) => ({
      name,
      value: degree.get(name) ?? 0,
      symbolSize: sizeFor(degree.get(name) ?? 0),
      itemStyle: { color: palette[i % palette.length] }
    }));
    const wVals = links.map((l) => l.value);
    const wMin = Math.min(...wVals);
    const wMax = Math.max(...wVals);
    const widthFor = (v) => {
      if (wMax === wMin) return 1.4;
      return 0.8 + (v - wMin) / (wMax - wMin) * 3.2;
    };
    const layout = chartProperties?.layout === "force" ? "force" : "circular";
    const side = Math.max(420, Math.min(860, Math.round(Math.sqrt(nodeArr.length) * 155) + 40));
    const pad = 64;
    const option = {
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          if (params.dataType === "edge") {
            return `${params.data.source} \u2192 ${params.data.target}<br/>Weight: ${params.data.value}`;
          }
          return `${params.name}<br/>Degree: ${params.value}`;
        }
      },
      series: [{
        type: "graph",
        layout,
        data: nodes,
        links: links.map((l) => ({ ...l, lineStyle: { width: widthFor(l.value) } })),
        roam: false,
        label: {
          show: true,
          position: "right",
          fontSize: 11,
          color: "#333"
        },
        lineStyle: {
          color: "source",
          opacity: 0.5,
          curveness: layout === "circular" ? 0.3 : 0
        },
        emphasis: {
          focus: "adjacency",
          lineStyle: { width: 4 }
        },
        circular: { rotateLabel: true },
        force: { repulsion: 180, edgeLength: [50, 130], gravity: 0.08 },
        left: pad,
        right: pad,
        top: pad,
        bottom: pad
      }],
      color: palette ?? DEFAULT_COLORS,
      _width: side,
      _height: side
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "layout",
      label: "Layout",
      type: "discrete",
      options: [
        { value: "circular", label: "Circular (default)" },
        { value: "force", label: "Force-directed" }
      ]
    }
  ]
};

// src/echarts/templates/tree.ts
var ecTreeDef = {
  chart: "Tree",
  template: { mark: "point", encoding: {} },
  channels: ["color", "detail", "size"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
    const catField = channelSemantics.color?.field;
    const subCatField = channelSemantics.detail?.field;
    const valField = channelSemantics.size?.field;
    if (!catField) return;
    const categories = extractCategories(table, catField, channelSemantics.color?.ordinalSortOrder);
    if (categories.length === 0) return;
    const decision = colorDecisions?.color ?? colorDecisions?.group;
    let palette;
    if (decision?.schemeId) {
      const fromRegistry = getPaletteForScheme(decision.schemeId);
      if (fromRegistry && fromRegistry.length > 0) palette = fromRegistry;
    }
    if (!palette || palette.length === 0) {
      palette = getPaletteForScheme(categories.length > 10 ? "cat20" : "cat10") ?? DEFAULT_COLORS;
    }
    let leafCount = 0;
    const children = categories.map((cat, catIdx) => {
      const catRows = table.filter((r) => String(r[catField]) === cat);
      const color = palette[catIdx % palette.length];
      if (subCatField) {
        const subCats = extractCategories(catRows, subCatField);
        const subChildren = subCats.map((sub) => {
          const subRows = catRows.filter((r) => String(r[subCatField]) === sub);
          const value2 = valField ? subRows.reduce((s, r) => s + (Number(r[valField]) || 0), 0) : subRows.length;
          leafCount++;
          return { name: sub, value: value2, lineStyle: { color }, itemStyle: { color } };
        });
        return { name: cat, children: subChildren, lineStyle: { color }, itemStyle: { color } };
      }
      const value = valField ? catRows.reduce((s, r) => s + (Number(r[valField]) || 0), 0) : catRows.length;
      leafCount++;
      return { name: cat, value, lineStyle: { color }, itemStyle: { color } };
    });
    const rootName = chartProperties?.rootLabel ?? "All";
    const treeData = [{ name: rootName, children }];
    const depth = subCatField ? 3 : 2;
    const orient = chartProperties?.orient === "TB" ? "TB" : "LR";
    const canvasW = Math.max(ctx.canvasSize.width, 340 + (depth - 1) * 210);
    const canvasH = Math.max(ctx.canvasSize.height, Math.min(1400, Math.max(300, leafCount * 26)));
    const option = {
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        formatter: (params) => {
          const v = params.value;
          return v != null && v !== "" ? `${params.name}<br/>Value: ${v}` : params.name;
        }
      },
      series: [{
        type: "tree",
        data: treeData,
        layout: "orthogonal",
        orient,
        top: 24,
        bottom: 24,
        left: orient === "LR" ? 40 : 24,
        right: orient === "LR" ? 140 : 24,
        symbol: "circle",
        symbolSize: 8,
        initialTreeDepth: -1,
        expandAndCollapse: false,
        roam: false,
        lineStyle: { width: 1.2, curveness: 0.5, color: "#bbb" },
        label: {
          show: true,
          position: orient === "LR" ? "left" : "top",
          verticalAlign: "middle",
          align: orient === "LR" ? "right" : "center",
          fontSize: 11,
          color: "#333"
        },
        leaves: {
          label: {
            position: orient === "LR" ? "right" : "bottom",
            verticalAlign: "middle",
            align: orient === "LR" ? "left" : "center"
          }
        },
        emphasis: { focus: "descendant" }
      }],
      color: palette ?? DEFAULT_COLORS,
      _width: canvasW,
      _height: canvasH
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "orient",
      label: "Orient",
      type: "discrete",
      options: [
        { value: "LR", label: "Left \u2192 Right (default)" },
        { value: "TB", label: "Top \u2192 Bottom" }
      ]
    }
  ]
};

// src/echarts/templates/gantt.ts
function toNumber(value, temporal) {
  if (value == null) return NaN;
  if (temporal) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    return Date.parse(String(value));
  }
  return Number(value);
}
function fmtDate(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}
var ecGanttChartDef = {
  chart: "Gantt Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["y", "x", "x2", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({ axisFlags: { y: { banded: true } } }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const taskField = channelSemantics.y?.field;
    const startField = channelSemantics.x?.field;
    const endField = channelSemantics.x2?.field;
    const colorField = channelSemantics.color?.field;
    if (!taskField || !startField || !endField || table.length === 0) return;
    const temporal = channelSemantics.x?.type === "temporal";
    const rows = table.map((r) => ({
      task: String(r[taskField] ?? ""),
      start: toNumber(r[startField], temporal),
      end: toNumber(r[endField], temporal),
      group: colorField != null ? String(r[colorField] ?? "") : void 0
    })).filter((r) => r.task && Number.isFinite(r.start) && Number.isFinite(r.end)).sort((a, b) => a.start - b.start);
    const tasks = rows.map((r) => r.task);
    const groups = colorField ? Array.from(new Set(rows.map((r) => r.group ?? ""))) : [];
    const groupColor = /* @__PURE__ */ new Map();
    groups.forEach((g, i) => groupColor.set(g, DEFAULT_COLORS[i % DEFAULT_COLORS.length]));
    const BAR_COLOR = DEFAULT_COLORS[0];
    const baseData = rows.map((r) => r.start);
    const durationData = rows.map((r) => ({
      value: r.end - r.start,
      itemStyle: { color: colorField ? groupColor.get(r.group ?? "") ?? BAR_COLOR : BAR_COLOR }
    }));
    const option = {
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          if (p.seriesName === "_base") return "";
          const r = rows[p.dataIndex];
          if (!r) return "";
          const s = temporal ? fmtDate(r.start) : r.start;
          const e = temporal ? fmtDate(r.end) : r.end;
          const grp = r.group != null ? `<br/>${colorField}: ${r.group}` : "";
          return `${r.task}<br/>${startField}: ${s}<br/>${endField}: ${e}${grp}`;
        }
      },
      grid: { containLabel: true },
      xAxis: {
        type: "value",
        scale: true,
        name: temporal ? "" : startField,
        nameLocation: "middle",
        nameGap: 30,
        axisLabel: temporal ? { formatter: (v) => fmtDate(v), hideOverlap: true } : {}
      },
      yAxis: {
        type: "category",
        data: tasks,
        inverse: true,
        axisTick: { show: false },
        axisLabel: { interval: 0 }
      },
      series: [
        {
          type: "bar",
          name: "_base",
          stack: "gantt",
          data: baseData,
          itemStyle: { color: "transparent" },
          silent: true,
          emphasis: { disabled: true },
          barWidth: "62%"
        },
        {
          type: "bar",
          name: "Task",
          stack: "gantt",
          data: durationData,
          barWidth: "62%",
          itemStyle: { borderRadius: 2 }
        }
      ]
    };
    if (colorField && groups.length > 1) {
      option.legend = { data: groups, top: 0 };
      option._legendTitle = colorField;
      for (const g of groups) {
        option.series.push({
          type: "bar",
          name: g,
          stack: "gantt",
          data: [],
          barWidth: "62%",
          itemStyle: { color: groupColor.get(g) }
        });
      }
      option.grid.top = 40;
    }
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/bullet.ts
var ZONE_GRAYS2 = ["#e2e2e2", "#ececec", "#f5f5f5"];
var STATUS_COLORS2 = { below: "#c44e52", met: "#2f855a" };
var STATUS_BELOW2 = "Below target";
var STATUS_MET2 = "Meets target";
var ecBulletChartDef = {
  chart: "Bullet Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["y", "x", "goal", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: () => ({ axisFlags: { y: { banded: true } } }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const labelField = channelSemantics.y?.field;
    const valueField = channelSemantics.x?.field;
    const goalField = channelSemantics.goal?.field;
    if (!labelField || !valueField || table.length === 0) return;
    const categories = extractCategories(
      table,
      labelField,
      getCategoryOrder(ctx, "y") ?? channelSemantics.y?.ordinalSortOrder
    );
    const byCat = /* @__PURE__ */ new Map();
    for (const r of table) byCat.set(String(r[labelField] ?? ""), r);
    const valueOf = (cat) => Number(byCat.get(cat)?.[valueField]);
    const goalOf = (cat) => goalField != null ? Number(byCat.get(cat)?.[goalField]) : NaN;
    const band1 = [];
    const band2 = [];
    const band3 = [];
    for (const cat of categories) {
      const g = goalOf(cat);
      const q = Number.isFinite(g) && g > 0 ? g / 4 : 0;
      band1.push(q);
      band2.push(q);
      band3.push(q);
    }
    const valueData = categories.map((cat) => {
      const v = valueOf(cat);
      const g = goalOf(cat);
      const met = Number.isFinite(g) ? v >= g : true;
      return {
        value: Number.isFinite(v) ? v : 0,
        itemStyle: { color: met ? STATUS_COLORS2.met : STATUS_COLORS2.below }
      };
    });
    const band = ctx.layout?.yStep;
    const tickH = band && band > 0 ? Math.min(band, Math.max(8, Math.round(band * 0.72))) : 18;
    const goalData = goalField ? categories.map((cat) => ({ value: [goalOf(cat), cat] })).filter((d) => Number.isFinite(d.value[0])) : [];
    const bandSeries = [band1, band2, band3].map((data, i) => ({
      type: "bar",
      name: `_band${i}`,
      stack: "bullet-bands",
      data,
      barWidth: "62%",
      itemStyle: { color: ZONE_GRAYS2[i] },
      silent: true,
      emphasis: { disabled: true },
      z: 1
    }));
    const option = {
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          if (typeof p.seriesName === "string" && p.seriesName.startsWith("_")) return "";
          const cat = categories[p.dataIndex] ?? "";
          const v = valueOf(cat);
          const g = goalOf(cat);
          const goalLine = Number.isFinite(g) ? `<br/>${goalField}: ${g}` : "";
          return `${cat}<br/>${valueField}: ${v}${goalLine}`;
        }
      },
      legend: goalField ? { data: [STATUS_BELOW2, STATUS_MET2], top: 0 } : void 0,
      grid: { containLabel: true, top: goalField ? 40 : 20 },
      xAxis: {
        type: "value",
        min: 0,
        name: valueField,
        nameLocation: "middle",
        nameGap: 30
      },
      yAxis: {
        type: "category",
        data: categories,
        inverse: true,
        axisTick: { show: false },
        axisLabel: { interval: 0 }
      },
      series: [
        ...bandSeries,
        {
          type: "bar",
          name: "value",
          data: valueData,
          barWidth: "34%",
          barGap: "-100%",
          z: 2
        },
        {
          type: "scatter",
          name: "target",
          data: goalData,
          symbol: "rect",
          symbolSize: [4, tickH],
          itemStyle: { color: "#1a1a1a" },
          z: 4,
          silent: true
        },
        // Legend-only series for the status colors (no bar slots).
        ...goalField ? [
          { type: "scatter", name: STATUS_BELOW2, data: [], itemStyle: { color: STATUS_COLORS2.below } },
          { type: "scatter", name: STATUS_MET2, data: [], itemStyle: { color: STATUS_COLORS2.met } }
        ] : []
      ]
    };
    Object.assign(spec, option);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/echarts/templates/index.ts
var ecTemplateDefs = {
  "Scatter & Point": [ecScatterPlotDef, ecRegressionDef, ecConnectedScatterDef, ecRangedDotPlotDef, ecBoxplotDef, ecStripPlotDef],
  "Bar": [ecBarChartDef, ecGroupedBarChartDef, ecStackedBarChartDef, ecLollipopChartDef, ecPyramidChartDef, ecHeatmapDef, ecCalendarHeatmapDef],
  "Line & Area": [ecLineChartDef, ecBumpChartDef, ecSlopeChartDef, ecAreaChartDef, ecStreamgraphDef, ecRangeAreaChartDef],
  "Part-to-Whole": [ecPieChartDef, ecFunnelChartDef, ecTreemapDef, ecSunburstDef, ecTreeDef],
  "Statistical": [ecHistogramDef, ecDensityPlotDef, ecEcdfPlotDef, ecParallelCoordinatesDef],
  "Financial": [ecCandlestickDef],
  "Other": [ecWaterfallChartDef, ecGanttChartDef, ecBulletChartDef],
  "Polar": [ecRadarChartDef, ecRoseChartDef],
  "Indicator": [ecGaugeChartDef],
  "Flow": [ecSankeyDef, ecGraphDef]
};
var ecAllTemplateDefs = Object.values(ecTemplateDefs).flat();
function ecGetTemplateDef(chartType) {
  return ecAllTemplateDefs.find((t) => t.chart === chartType);
}
function ecGetTemplateChannels(chartType) {
  return ecGetTemplateDef(chartType)?.channels || [];
}

// src/echarts/facet.ts
function isRadarFacet(ref) {
  return !!(ref?.radar && Array.isArray(ref.series) && ref.series.length > 0 && ref.series[0]?.type === "radar");
}
function isPolarFacet(ref) {
  return !!(ref?.polar && ref?.angleAxis && Array.isArray(ref.series) && ref.series.length > 0 && ref.series[0]?.coordinateSystem === "polar");
}
function combineRadarFacetPanels(panels, config) {
  const nRows = panels.length;
  const nCols = Math.max(1, ...panels.map((r) => r.length));
  const ref = panels[0]?.[0];
  if (!ref?.radar) return {};
  const plotW = ref._plotWidth || ref._width || 400;
  const plotH = ref._plotHeight || ref._height || 300;
  const GAP = 6;
  const COL_HEADER_H = config.colField ? 18 : 0;
  const ROW_HEADER_W = config.rowField ? 18 : 0;
  const colHeaderPerRow = config.colHeaderPerRow ?? false;
  const PAD = 4;
  const baseLeft = ROW_HEADER_W;
  const col0W = PAD + plotW + PAD;
  const colInnerW = PAD + plotW + PAD;
  const rowInnerH = PAD + plotH + PAD;
  const totalW = baseLeft + col0W + (nCols > 1 ? (nCols - 1) * (colInnerW + GAP) : 0);
  const totalH = (colHeaderPerRow ? 0 : COL_HEADER_H) + (nRows > 1 ? (nRows - 1) * (rowInnerH + GAP) : 0) + rowInnerH;
  const combined = {
    radar: [],
    series: [],
    _width: totalW,
    _height: totalH
  };
  if (ref.tooltip) combined.tooltip = { ...ref.tooltip };
  if (ref.color) combined.color = ref.color;
  if (ref.legend) combined.legend = { ...ref.legend };
  const radarRadiusRatio = 0.38;
  const headerFontSize = 11;
  const hStyle = {
    fontSize: headerFontSize,
    fontWeight: "bold",
    fill: "#555",
    textAlign: "center",
    textVerticalAlign: "middle"
  };
  const graphics = [];
  let radarIdx = 0;
  for (let ri = 0; ri < nRows; ri++) {
    for (let ci = 0; ci < nCols; ci++) {
      const panel = panels[ri]?.[ci];
      if (!panel) continue;
      const cx = baseLeft + (ci === 0 ? 0 : col0W + GAP + (ci - 1) * (colInnerW + GAP));
      const cy = colHeaderPerRow ? ri * (rowInnerH + GAP) + COL_HEADER_H : COL_HEADER_H + ri * (rowInnerH + GAP);
      const left = cx + PAD;
      const top = cy + PAD;
      const width = plotW;
      const height = plotH;
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      const radius = Math.min(width, height) * radarRadiusRatio;
      combined.radar.push({
        ...ref.radar,
        indicator: ref.radar.indicator,
        shape: ref.radar.shape,
        center: [centerX, centerY],
        radius,
        axisName: ref.radar.axisName ?? { fontSize: 11 }
      });
      if (Array.isArray(panel.series)) {
        for (const s of panel.series) {
          combined.series.push({ ...s, radarIndex: radarIdx });
        }
      }
      if (config.colField && panel._colHeader && (colHeaderPerRow || ri === 0)) {
        graphics.push({
          type: "text",
          left: centerX,
          top: top - COL_HEADER_H / 2,
          style: { ...hStyle, text: String(panel._colHeader) }
        });
      }
      if (config.rowField && ci === 0 && panel._rowHeader) {
        graphics.push({
          type: "text",
          left: ROW_HEADER_W / 2,
          top: centerY,
          style: { ...hStyle, text: String(panel._rowHeader) },
          rotation: Math.PI / 2
        });
      }
      radarIdx++;
    }
  }
  if (graphics.length > 0) combined.graphic = graphics;
  return combined;
}
var POLAR_RADIUS_RATIO = 0.38;
function combinePolarFacetPanels(panels, config) {
  const nRows = panels.length;
  const nCols = Math.max(1, ...panels.map((r) => r.length));
  const ref = panels[0]?.[0];
  if (!ref?.polar || !ref?.angleAxis) return {};
  const plotW = ref._plotWidth || ref._width || 400;
  const plotH = ref._plotHeight || ref._height || 300;
  const GAP = 14;
  const COL_HEADER_H = config.colField ? 18 : 0;
  const ROW_HEADER_W = config.rowField ? 18 : 0;
  const colHeaderPerRow = config.colHeaderPerRow ?? false;
  const PAD = 4;
  const baseLeft = ROW_HEADER_W;
  const col0W = PAD + plotW + PAD;
  const colInnerW = PAD + plotW + PAD;
  const rowInnerH = PAD + plotH + PAD;
  const totalW = baseLeft + col0W + (nCols > 1 ? (nCols - 1) * (colInnerW + GAP) : 0);
  const totalH = (colHeaderPerRow ? 0 : COL_HEADER_H) + (nRows > 1 ? (nRows - 1) * (rowInnerH + GAP) : 0) + rowInnerH;
  const combined = {
    polar: [],
    angleAxis: [],
    radiusAxis: [],
    series: [],
    _width: totalW,
    _height: totalH
  };
  if (ref.tooltip) combined.tooltip = { ...ref.tooltip };
  if (ref.color) combined.color = ref.color;
  if (ref.legend) combined.legend = { ...ref.legend };
  const headerFontSize = 11;
  const hStyle = {
    fontSize: headerFontSize,
    fontWeight: "bold",
    fill: "#555",
    textAlign: "center",
    textVerticalAlign: "middle"
  };
  const graphics = [];
  let polarIdx = 0;
  for (let ri = 0; ri < nRows; ri++) {
    for (let ci = 0; ci < nCols; ci++) {
      const panel = panels[ri]?.[ci];
      if (!panel) continue;
      const cx = baseLeft + (ci === 0 ? 0 : col0W + GAP + (ci - 1) * (colInnerW + GAP));
      const cy = colHeaderPerRow ? ri * (rowInnerH + GAP) + COL_HEADER_H : COL_HEADER_H + ri * (rowInnerH + GAP);
      const left = cx + PAD;
      const top = cy + PAD;
      const width = plotW;
      const height = plotH;
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      const radius = Math.min(width, height) * POLAR_RADIUS_RATIO;
      combined.polar.push({
        center: [centerX, centerY],
        radius
      });
      combined.angleAxis.push({
        ...ref.angleAxis,
        polarIndex: polarIdx
      });
      combined.radiusAxis.push({
        ...ref.radiusAxis || {},
        polarIndex: polarIdx
      });
      if (Array.isArray(panel.series)) {
        for (const s of panel.series) {
          if (s && s.coordinateSystem === "polar") {
            combined.series.push({ ...s, polarIndex: polarIdx });
          } else {
            combined.series.push({ ...s });
          }
        }
      }
      if (config.colField && panel._colHeader && (colHeaderPerRow || ri === 0)) {
        graphics.push({
          type: "text",
          left: centerX,
          top: top - COL_HEADER_H / 2,
          style: { ...hStyle, text: String(panel._colHeader) }
        });
      }
      if (config.rowField && ci === 0 && panel._rowHeader) {
        graphics.push({
          type: "text",
          left: ROW_HEADER_W / 2,
          top: centerY,
          style: { ...hStyle, text: String(panel._rowHeader) },
          rotation: Math.PI / 2
        });
      }
      polarIdx++;
    }
  }
  if (graphics.length > 0) combined.graphic = graphics;
  repositionFacetedPolarLegend(combined);
  return combined;
}
function ecCombineFacetPanels(panels, config) {
  const nRows = panels.length;
  const nCols = Math.max(1, ...panels.map((r) => r.length));
  const ref = panels[0]?.[0];
  if (!ref) return {};
  if (isRadarFacet(ref)) {
    return combineRadarFacetPanels(panels, config);
  }
  if (isPolarFacet(ref)) {
    return combinePolarFacetPanels(panels, config);
  }
  const plotW = ref._plotWidth || ref._width || 200;
  const plotH = ref._plotHeight || ref._height || 150;
  const GAP = 6;
  const COL_HEADER_H = config.colField ? 18 : 0;
  const ROW_HEADER_W = config.rowField ? 18 : 0;
  const colHeaderPerRow = config.colHeaderPerRow ?? false;
  const refX = ref.xAxis || {};
  const refY = ref.yAxis || {};
  const hasYTitle = !!refY.name;
  const sharedXTitle = refX.name || "";
  const sharedYTitle = config.rowField && hasYTitle ? refY.name || "" : "";
  const SHARED_X_H = sharedXTitle ? 18 : 0;
  const SHARED_Y_W = sharedYTitle ? 18 : 0;
  const mLeft = hasYTitle && !sharedYTitle ? 55 : 35;
  const mBottom = 22;
  const PAD = 4;
  const col0W = mLeft + plotW + PAD;
  const colInnerW = PAD + plotW + PAD;
  const rowInnerH = PAD + plotH + PAD;
  const rowBottomH = PAD + plotH + mBottom;
  const baseLeft = SHARED_Y_W + ROW_HEADER_W;
  const innerRowBlock = colHeaderPerRow ? COL_HEADER_H + rowInnerH : rowInnerH;
  const bottomRowBlock = colHeaderPerRow ? COL_HEADER_H + rowBottomH : rowBottomH;
  const totalW = baseLeft + col0W + (nCols > 1 ? (nCols - 1) * (colInnerW + GAP) : 0);
  const totalH = (colHeaderPerRow ? 0 : COL_HEADER_H) + (nRows > 1 ? (nRows - 1) * (innerRowBlock + GAP) : 0) + bottomRowBlock + SHARED_X_H;
  const combined = {
    grid: [],
    xAxis: [],
    yAxis: [],
    series: [],
    _width: totalW,
    _height: totalH
  };
  if (ref.tooltip) combined.tooltip = { ...ref.tooltip };
  if (ref.color) combined.color = ref.color;
  if (ref.legend) combined.legend = { ...ref.legend };
  const fontSize = Math.max(8, Math.round(10 * Math.min(1, plotW / 200)));
  const headerFontSize = Math.max(9, Math.round(11 * Math.min(1, plotW / 200)));
  const gridMap = [];
  let gridIdx = 0;
  for (let ri = 0; ri < nRows; ri++) {
    gridMap[ri] = [];
    for (let ci = 0; ci < nCols; ci++) {
      const panel = panels[ri]?.[ci];
      if (!panel) {
        gridMap[ri][ci] = -1;
        continue;
      }
      gridMap[ri][ci] = gridIdx;
      const isLeft = ci === 0;
      const isBottom = ri === nRows - 1;
      const cx = baseLeft + (ci === 0 ? 0 : col0W + GAP + (ci - 1) * (colInnerW + GAP));
      let cy;
      if (colHeaderPerRow) {
        const rowOff = ri * (innerRowBlock + GAP);
        cy = rowOff + COL_HEADER_H;
      } else {
        const rowOff = COL_HEADER_H + ri * (innerRowBlock + GAP);
        cy = rowOff;
      }
      const pLeft = ci === 0 ? mLeft : PAD;
      combined.grid.push({
        left: cx + pLeft,
        top: cy + PAD,
        width: plotW,
        height: plotH
      });
      const srcX = panel.xAxis ? { ...panel.xAxis } : { type: "category" };
      combined.xAxis.push({
        ...srcX,
        gridIndex: gridIdx,
        name: void 0,
        nameGap: 0,
        axisLabel: { ...srcX.axisLabel || {}, show: isBottom, fontSize },
        axisTick: { ...srcX.axisTick || {}, show: isBottom },
        axisLine: { show: true }
      });
      const srcY = panel.yAxis ? { ...panel.yAxis } : { type: "value" };
      const showYName = isLeft && !sharedYTitle;
      combined.yAxis.push({
        ...srcY,
        gridIndex: gridIdx,
        name: showYName ? srcY.name : void 0,
        nameGap: showYName ? srcY.nameGap ?? 4 : 0,
        axisLabel: { ...srcY.axisLabel || {}, show: isLeft, fontSize },
        axisTick: { ...srcY.axisTick || {}, show: isLeft },
        axisLine: { show: true }
      });
      if (Array.isArray(panel.series)) {
        for (const s of panel.series) {
          combined.series.push({ ...s, xAxisIndex: gridIdx, yAxisIndex: gridIdx });
        }
      }
      gridIdx++;
    }
  }
  const gridOf = (ri, ci) => {
    const gi = gridMap[ri]?.[ci];
    return gi != null && gi >= 0 ? combined.grid[gi] : null;
  };
  const gCX = (g) => g.left + g.width / 2;
  const gCY = (g) => g.top + g.height / 2;
  const graphics = [];
  const hStyle = {
    fontSize: headerFontSize,
    fontWeight: "bold",
    fill: "#555",
    textAlign: "center",
    textVerticalAlign: "middle"
  };
  if (config.colField) {
    const hRows = colHeaderPerRow ? nRows : 1;
    for (let ri = 0; ri < hRows; ri++) {
      for (let ci = 0; ci < nCols; ci++) {
        const p = panels[ri]?.[ci], g = gridOf(ri, ci);
        if (!p?._colHeader || !g) continue;
        graphics.push({
          type: "text",
          left: gCX(g),
          top: g.top - COL_HEADER_H / 2,
          style: { ...hStyle, text: String(p._colHeader) }
        });
      }
    }
  }
  if (config.rowField) {
    for (let ri = 0; ri < nRows; ri++) {
      const p = panels[ri]?.[0], g = gridOf(ri, 0);
      if (!p?._rowHeader || !g) continue;
      graphics.push({
        type: "text",
        left: SHARED_Y_W + ROW_HEADER_W / 2,
        top: gCY(g),
        style: { ...hStyle, text: String(p._rowHeader) },
        rotation: Math.PI / 2
      });
    }
  }
  if (sharedYTitle) {
    const first = gridOf(0, 0), last = gridOf(nRows - 1, 0);
    if (first && last) {
      graphics.push({
        type: "text",
        left: SHARED_Y_W / 2,
        top: (gCY(first) + gCY(last)) / 2,
        style: {
          text: sharedYTitle,
          fontSize: headerFontSize,
          fill: "#333",
          textAlign: "center",
          textVerticalAlign: "middle"
        },
        rotation: Math.PI / 2
      });
    }
  }
  if (sharedXTitle) {
    graphics.push({
      type: "text",
      left: totalW / 2,
      top: totalH - SHARED_X_H + 4,
      style: { text: sharedXTitle, fontSize: headerFontSize, fill: "#333", textAlign: "center" }
    });
  }
  if (graphics.length > 0) combined.graphic = graphics;
  repositionFacetedLegendBesideGrids(combined);
  return combined;
}
function repositionFacetedLegendBesideGrids(combined) {
  const grids = combined.grid;
  if (!combined.legend || !Array.isArray(grids) || grids.length <= 1) return;
  const rawData = combined.legend.data || [];
  const legendLabels = rawData.map((d) => typeof d === "string" ? d : d?.name ?? "");
  if (legendLabels.length === 0) return;
  const maxLabelLen = Math.max(...legendLabels.map((l) => l.length), 3);
  const highCardinality = legendLabels.length >= 16;
  const legendSymbolWidth = highCardinality ? 12 : 14;
  const legendItemGap = 5;
  const estimatedTextWidth = Math.min(120, maxLabelLen * 7 + 30);
  const legendW = legendSymbolWidth + legendItemGap + estimatedTextWidth;
  const GAP = 12;
  const BUFFER = 16;
  const rightMost = Math.max(...grids.map((g) => (g.left ?? 0) + (g.width ?? 0)));
  combined.legend = {
    ...combined.legend,
    left: rightMost + GAP,
    top: combined.legend.top ?? 20,
    orient: combined.legend.orient || "vertical",
    align: "left",
    right: void 0,
    textStyle: {
      fontSize: highCardinality ? 8 : 11,
      ...combined.legend.textStyle || {}
    },
    ...legendLabels.length > 10 ? { type: "scroll" } : {},
    ...highCardinality ? { itemWidth: 12, itemHeight: 12 } : {}
  };
  combined._width = Math.max(combined._width || 0, rightMost + GAP + legendW + BUFFER);
}
function repositionFacetedPolarLegend(combined) {
  const polars = combined.polar;
  if (!combined.legend || !Array.isArray(polars) || polars.length <= 1) return;
  const rawData = combined.legend.data || [];
  const legendLabels = rawData.map((d) => typeof d === "string" ? d : d?.name ?? "");
  if (legendLabels.length === 0) return;
  const maxLabelLen = Math.max(...legendLabels.map((l) => l.length), 3);
  const highCardinality = legendLabels.length >= 16;
  const legendSymbolWidth = highCardinality ? 12 : 14;
  const legendItemGap = 5;
  const estimatedTextWidth = Math.min(120, maxLabelLen * 7 + 30);
  const legendW = legendSymbolWidth + legendItemGap + estimatedTextWidth;
  const GAP = 15;
  const BUFFER = 16;
  const rightMost = Math.max(...polars.map((p) => {
    const cx = Array.isArray(p?.center) ? Number(p.center[0]) : 0;
    const r = Number(p?.radius) || 0;
    return cx + r;
  }));
  combined.legend = {
    ...combined.legend,
    left: rightMost + GAP,
    top: combined.legend.top ?? 20,
    orient: combined.legend.orient || "vertical",
    align: "left",
    right: void 0,
    textStyle: {
      fontSize: highCardinality ? 8 : 11,
      ...combined.legend.textStyle || {}
    },
    ...legendLabels.length > 10 ? { type: "scroll" } : {},
    ...highCardinality ? { itemWidth: 12, itemHeight: 12 } : {}
  };
  combined._width = Math.max(combined._width || 0, rightMost + GAP + legendW + BUFFER);
}

// src/core/color-decisions.ts
function inferColorChannelPrimary(channel, chartType) {
  if (channel === "color" || channel === "group") return true;
  return false;
}
function decideSchemeTypeFromChannel(channel, cs) {
  const hint = cs?.colorScheme;
  if (hint) {
    if (hint.type === "diverging") {
      return {
        schemeType: "diverging",
        // resolve-semantics 里用 domainMid 表示 diverging 中点
        divergingMidpoint: hint.domainMid
      };
    }
    if (hint.type === "sequential") {
      return { schemeType: "sequential" };
    }
    if (hint.type === "categorical") {
      const semType2 = cs?.semanticAnnotation?.semanticType;
      const isRankLike = semType2 === "Rank";
      if (isRankLike) {
        return { schemeType: "sequential" };
      }
      if (cs?.type === "temporal" && channel === "color") {
        return { schemeType: "sequential" };
      }
      return { schemeType: "categorical" };
    }
  }
  const encType = cs?.type;
  const semType = cs?.semanticAnnotation?.semanticType;
  if (semType === "Correlation") {
    return { schemeType: "diverging", divergingMidpoint: 0 };
  }
  if (encType === "quantitative" || encType === "temporal") {
    return { schemeType: "sequential" };
  }
  return { schemeType: "categorical" };
}
function countDistinctValues(table, field) {
  if (!field) return void 0;
  const set = /* @__PURE__ */ new Set();
  for (const row of table) {
    if (row == null) continue;
    set.add(row[field]);
  }
  return set.size;
}
function decideColorForChannel(channel, ctx) {
  const encoding = ctx.encodings[channel];
  const cs = ctx.channelSemantics[channel];
  if (!encoding || !cs?.field) return void 0;
  const dataDriven = true;
  const primary = inferColorChannelPrimary(channel, ctx.chartType);
  if (encoding.scheme && encoding.scheme !== "default") {
    const distinct2 = countDistinctValues(ctx.table, cs.field);
    const { schemeType: schemeType2 } = decideSchemeTypeFromChannel(channel, cs);
    return {
      channel,
      schemeType: schemeType2,
      schemeId: encoding.scheme,
      categoryCount: distinct2,
      primary,
      dataDriven
    };
  }
  const { schemeType, divergingMidpoint } = decideSchemeTypeFromChannel(channel, cs);
  const distinct = countDistinctValues(ctx.table, cs.field);
  return {
    channel,
    schemeType,
    divergingMidpoint,
    categoryCount: distinct,
    primary,
    dataDriven
  };
}
function decideColorMaps(ctx) {
  const result = {
    color: void 0,
    group: void 0,
    fill: void 0,
    stroke: void 0
  };
  const channels2 = ["color", "group"];
  for (const ch of channels2) {
    const decision = decideColorForChannel(ch, ctx);
    if (decision) {
      result[ch] = decision;
    }
  }
  return result;
}

// src/echarts/assemble.ts
function assembleECharts(input) {
  const chartType = input.chart_spec.chartType;
  const semanticTypes = input.semantic_types ?? {};
  const sizeCeiling = input.chart_spec.canvasSize;
  const baseSize = resolveBaseSize(input.chart_spec.baseSize, sizeCeiling);
  const canvasSize = baseSize;
  const options = input.options ?? {};
  let chartTemplate = ecGetTemplateDef(chartType);
  if (!chartTemplate) {
    throw new Error(`Unknown ECharts chart type: ${chartType}. Use ecAllTemplateDefs to see available types.`);
  }
  const warnings = [];
  const normalizedProps = normalizeChartProperties(
    chartTemplate.properties,
    input.chart_spec.chartProperties
  );
  const chartProperties = normalizedProps.chartProperties;
  warnings.push(...normalizedProps.warnings);
  const rawData = input.data.values ?? [];
  const normalized = normalizeStaticSeries(
    input.chart_spec.encodings,
    rawData,
    semanticTypes
  );
  let data = normalized.data;
  const staticSeries = normalized.staticSeries;
  const prelimConvertedData = convertTemporalData(data, semanticTypes);
  const prelimSemantics = resolveChannelSemantics(
    normalized.encodings,
    data,
    semanticTypes,
    prelimConvertedData
  );
  const typedRawEncodings = {};
  for (const [ch, enc] of Object.entries(normalized.encodings)) {
    typedRawEncodings[ch] = enc.type ? enc : { ...enc, type: prelimSemantics[ch]?.type };
  }
  const pivoted = applyPivot(chartTemplate, typedRawEncodings, data, chartProperties, ecGetTemplateDef);
  if (pivoted.chartType && pivoted.chartType !== chartType) {
    const swapped = ecGetTemplateDef(pivoted.chartType);
    if (swapped) chartTemplate = swapped;
  }
  const encodings = applyEncodingOverrides(chartTemplate, pivoted.encodings, chartProperties);
  data = applyAggregation(encodings, data);
  const tplMark = chartTemplate.template?.mark;
  const templateMarkType = typeof tplMark === "string" ? tplMark : tplMark?.type;
  const convertedData = convertTemporalData(data, semanticTypes);
  const channelSemantics = resolveChannelSemantics(
    encodings,
    data,
    semanticTypes,
    convertedData
  );
  const effectiveMarkType = templateMarkType || "point";
  for (const [channel, cs] of Object.entries(channelSemantics)) {
    if ((channel === "x" || channel === "y") && cs.type === "quantitative") {
      const numericValues = data.map((r) => r[cs.field]).filter((v) => v != null && typeof v === "number" && !isNaN(v));
      cs.zero = computeZeroDecision(
        cs.semanticAnnotation.semanticType,
        channel,
        effectiveMarkType,
        numericValues
      );
    }
  }
  const declaration = chartTemplate.declareLayoutMode ? chartTemplate.declareLayoutMode(channelSemantics, data, chartProperties) : {};
  const effectiveOptions = {
    // ECharts uses step × itemCount for discrete canvas sizing (like VL),
    // but adds ~120-160px grid margins on top.  A 24px base band gives
    // bars close to ECharts's native auto-sizing at typical category counts.
    defaultBandSize: 24,
    ...options,
    ...declaration.paramOverrides || {}
  };
  if (effectiveOptions.facetFixedPadding == null) {
    effectiveOptions.facetFixedPadding = { width: 55, height: 22 };
  }
  if (effectiveOptions.facetGap == null) {
    effectiveOptions.facetGap = 14;
  }
  Object.assign(effectiveOptions, deriveStretchCaps(baseSize, sizeCeiling, effectiveOptions));
  const {
    addTooltips: addTooltipsOpt = true
  } = effectiveOptions;
  const allMarkTypes = /* @__PURE__ */ new Set();
  if (templateMarkType) allMarkTypes.add(templateMarkType);
  const budgets = computeChannelBudgets(
    channelSemantics,
    declaration,
    convertedData,
    canvasSize,
    effectiveOptions
  );
  const facetGridResult = budgets.facetGrid;
  const overflowResult = filterOverflow(
    channelSemantics,
    declaration,
    encodings,
    convertedData,
    budgets,
    allMarkTypes
  );
  let values = overflowResult.filteredData;
  warnings.push(...overflowResult.warnings);
  const layoutResult = computeLayout(
    channelSemantics,
    declaration,
    values,
    canvasSize,
    effectiveOptions,
    facetGridResult
  );
  layoutResult.truncations = overflowResult.truncations;
  const resolvedEncodings = buildECEncodings(
    encodings,
    channelSemantics,
    declaration,
    values,
    canvasSize,
    semanticTypes,
    templateMarkType,
    chartTemplate
  );
  const colorDecisions = decideColorMaps({
    chartType,
    encodings,
    channelSemantics,
    table: values});
  const instantiateContext = {
    channelSemantics,
    layout: layoutResult,
    table: values,
    fullTable: convertedData,
    resolvedEncodings,
    encodings,
    chartProperties,
    staticSeries,
    canvasSize,
    semanticTypes,
    chartType,
    assembleOptions: effectiveOptions,
    colorDecisions
  };
  const colField = channelSemantics.column?.field;
  const rowField = channelSemantics.row?.field;
  const hasFacet = !!(colField || rowField);
  const hasAxes = chartTemplate.channels.includes("x") || chartTemplate.channels.includes("y");
  let ecOption;
  if (hasFacet && hasAxes) {
    const maxFacetCols = facetGridResult?.columns ?? 1;
    const maxFacetRows = facetGridResult?.rows ?? 1;
    const maxFacetNominalValues = maxFacetCols * maxFacetRows;
    let colValues;
    let rowValues;
    if (colField && channelSemantics.column?.type === "quantitative") {
      const raw = values.map((r) => r[colField]).filter((v) => v != null && typeof v === "number" && !isNaN(v));
      const uniques = new Set(raw);
      if (uniques.size > maxFacetNominalValues) {
        const numBins = Math.min(maxFacetNominalValues, 20);
        const minVal = Math.min(...raw);
        const maxVal = Math.max(...raw);
        const step = (maxVal - minVal) / numBins || 1;
        const getColBin = (v) => Math.min(numBins - 1, Math.floor((v - minVal) / step));
        values = values.map((r) => {
          const v = r[colField];
          const bin = v != null && typeof v === "number" && !isNaN(v) ? getColBin(v) : 0;
          return { ...r, _ecColumnBin: bin };
        });
        colValues = Array.from({ length: numBins }, (_, i) => String(i));
      } else {
        colValues = [...new Set(values.map((r) => String(r[colField])))];
      }
    } else {
      colValues = colField ? [...new Set(values.map((r) => String(r[colField])))] : [];
    }
    if (rowField && channelSemantics.row?.type === "quantitative") {
      const raw = values.map((r) => r[rowField]).filter((v) => v != null && typeof v === "number" && !isNaN(v));
      const uniques = new Set(raw);
      if (uniques.size > maxFacetNominalValues) {
        const numBins = Math.min(maxFacetNominalValues, 20);
        const minVal = Math.min(...raw);
        const maxVal = Math.max(...raw);
        const step = (maxVal - minVal) / numBins || 1;
        const getRowBin = (v) => Math.min(numBins - 1, Math.floor((v - minVal) / step));
        values = values.map((r) => {
          const v = r[rowField];
          const bin = v != null && typeof v === "number" && !isNaN(v) ? getRowBin(v) : 0;
          return { ...r, _ecRowBin: bin };
        });
        rowValues = Array.from({ length: numBins }, (_, i) => String(i));
      } else {
        rowValues = [...new Set(values.map((r) => String(r[rowField])))];
      }
    } else {
      rowValues = rowField ? [...new Set(values.map((r) => String(r[rowField])))] : [];
    }
    const facetLayout = computeLayout(
      channelSemantics,
      declaration,
      values,
      canvasSize,
      effectiveOptions,
      facetGridResult
    );
    facetLayout.truncations = overflowResult.truncations;
    const nRows = rowValues.length || 1;
    const nCols = colValues.length || 1;
    const maxColsPerRow = facetGridResult?.columns ?? nCols;
    const panels = [];
    const colBinned = colField && values.length > 0 && values[0]._ecColumnBin !== void 0;
    const rowBinned = rowField && values.length > 0 && values[0]._ecRowBin !== void 0;
    for (let ri = 0; ri < nRows; ri++) {
      const row = [];
      for (let ci = 0; ci < nCols; ci++) {
        const cv = colValues[ci];
        const rv = rowValues[ri];
        const panelData = values.filter((r) => {
          if (colField) {
            if (colBinned) {
              if (r._ecColumnBin !== ci) return false;
            } else if (String(r[colField]) !== cv) return false;
          }
          if (rowField) {
            if (rowBinned) {
              if (r._ecRowBin !== ri) return false;
            } else if (String(r[rowField]) !== rv) return false;
          }
          return true;
        });
        const panelOption = structuredClone(chartTemplate.template);
        const panelCtx = {
          ...instantiateContext,
          table: panelData,
          layout: facetLayout,
          canvasSize
        };
        chartTemplate.instantiate(panelOption, panelCtx);
        ecApplyLayoutToSpec(panelOption, panelCtx, []);
        if (addTooltipsOpt) ecApplyTooltips(panelOption);
        if (chartTemplate.postProcess) chartTemplate.postProcess(panelOption, panelCtx);
        const g = panelOption.grid || {};
        panelOption._plotWidth = Math.max(
          20,
          facetLayout.subplotWidth || (panelOption._width || 200) - (g.left || 0) - (g.right || 0)
        );
        panelOption._plotHeight = Math.max(
          20,
          facetLayout.subplotHeight || (panelOption._height || 150) - (g.top || 0) - (g.bottom || 0)
        );
        if (colField) panelOption._colHeader = cv;
        if (rowField) panelOption._rowHeader = rv;
        row.push(panelOption);
      }
      panels.push(row);
    }
    let finalPanels = panels;
    let colHeaderPerRow = false;
    if (colField && !rowField && maxColsPerRow < nCols) {
      const displayCols = maxColsPerRow;
      const wrapRows = Math.ceil(nCols / displayCols);
      finalPanels = [];
      for (let wr = 0; wr < wrapRows; wr++) {
        const wrapRow = [];
        for (let vc = 0; vc < displayCols; vc++) {
          const origCi = wr * displayCols + vc;
          if (origCi < nCols) {
            wrapRow.push(panels[0][origCi]);
          }
        }
        if (wrapRow.length > 0) finalPanels.push(wrapRow);
      }
      colHeaderPerRow = true;
    }
    ecOption = ecCombineFacetPanels(finalPanels, {
      colField,
      rowField,
      colHeaderPerRow
    });
  } else {
    ecOption = structuredClone(chartTemplate.template);
    chartTemplate.instantiate(ecOption, instantiateContext);
    ecApplyLayoutToSpec(ecOption, instantiateContext, warnings);
    if (addTooltipsOpt) {
      ecApplyTooltips(ecOption);
    }
    if (chartTemplate.postProcess) {
      chartTemplate.postProcess(ecOption, instantiateContext);
    }
  }
  if (warnings.length > 0) {
    ecOption._warnings = warnings;
  }
  ecOption._dataLength = values.length;
  if (pivoted.surface) {
    ecOption._pivot = pivoted.surface;
  }
  delete ecOption._legendWidth;
  return ecOption;
}
function getEChartsPivot(input) {
  const spec = assembleECharts(input);
  return spec && spec._pivot ? spec._pivot : void 0;
}
function buildECEncodings(encodings, channelSemantics, declaration, data, canvasSize, semanticTypes, templateMarkType, chartTemplate) {
  const resolved = {};
  const encodingsEntries = Object.entries(encodings);
  for (const [channel, encoding] of encodingsEntries) {
    const entry = {};
    const fieldName = encoding.field;
    const cs = channelSemantics[channel];
    if (channel === "radius") {
      entry.radiusScale = { type: "sqrt", zero: true };
    }
    if (!fieldName && encoding.aggregate === "count") {
      entry.field = "_count";
      entry.type = "quantitative";
    }
    if (fieldName) {
      entry.field = fieldName;
      entry.type = cs?.type ?? "nominal";
      if (encoding.type) {
        entry.type = encoding.type;
      } else if (channel === "column" || channel === "row") {
        if (entry.type !== "nominal" && entry.type !== "ordinal") {
          entry.type = "nominal";
        }
      }
      if (encoding.aggregate) {
        if (encoding.aggregate === "count") {
          entry.field = "_count";
          entry.type = "quantitative";
        } else {
          entry.field = `${fieldName}_${encoding.aggregate}`;
          entry.type = "quantitative";
        }
      }
      if (entry.type === "quantitative" && channel === "x") {
        if (templateMarkType === "line" || templateMarkType === "area" || templateMarkType === "trail" || templateMarkType === "point") {
          entry.scaleNice = false;
        }
      }
      if (entry.type === "nominal" && (channel === "color" || channel === "group")) {
        const actualDomain = [...new Set(data.map((r) => r[fieldName]))];
        if (actualDomain.length >= 16) {
          entry.legendSymbolSize = 12;
          entry.legendLabelFontSize = 8;
        }
      }
    }
    if (channel === "size") {
      const EC_SIZE_MIN_PX = 10;
      const EC_SIZE_MAX_PX = 50;
      const plotArea = canvasSize.width * canvasSize.height;
      const n = Math.max(data.length, 1);
      const fairShare = plotArea / n;
      const targetPct = 0.05;
      const idealDiameterPx = Math.sqrt(fairShare * targetPct);
      const isQuant = entry.type === "quantitative" || entry.type === "temporal";
      const maxSize = Math.round(Math.max(EC_SIZE_MIN_PX, Math.min(EC_SIZE_MAX_PX, idealDiameterPx)));
      const minSize = isQuant ? Math.max(EC_SIZE_MIN_PX, Math.round(maxSize / 3)) : Math.round(maxSize / 4);
      entry.sizeRange = [Math.max(EC_SIZE_MIN_PX, minSize), Math.max(minSize, maxSize)];
    }
    if (encoding.sortBy || encoding.sortOrder) {
      entry.sortOrder = encoding.sortOrder;
      entry.sortBy = encoding.sortBy;
      if (encoding.sortBy) {
        if (encoding.sortBy === "x" || encoding.sortBy === "y" || encoding.sortBy === "color") ; else {
          try {
            if (fieldName) {
              const fieldSemType = toTypeString(semanticTypes[fieldName]);
              const fieldVisCat = inferVisCategory(data.map((r) => r[fieldName]));
              let sortedValues = JSON.parse(encoding.sortBy);
              if (fieldVisCat === "temporal" || fieldSemType === "Year" || fieldSemType === "Decade") {
                sortedValues = sortedValues.map((v) => String(v));
              }
              entry.sortValues = encoding.sortOrder === "descending" ? [...sortedValues].reverse() : sortedValues;
            }
          } catch {
          }
        }
      }
    } else {
      const isDiscrete21 = entry.type === "nominal" || entry.type === "ordinal";
      if (isDiscrete21) {
        if (cs?.ordinalSortOrder?.length) {
          entry.ordinalSortOrder = cs.ordinalSortOrder;
        } else {
          entry.preserveDataOrder = true;
        }
      }
    }
    if (Object.keys(entry).length > 0) {
      resolved[channel] = entry;
    }
  }
  if (declaration.resolvedTypes) {
    for (const [ch, type] of Object.entries(declaration.resolvedTypes)) {
      if (resolved[ch]) {
        resolved[ch].type = type;
      }
    }
  }
  const groupCS = channelSemantics.group;
  if (groupCS?.field && resolved.group) {
    const xType = resolved.x?.type;
    const yType = resolved.y?.type;
    const isDiscrete21 = (t) => t === "nominal" || t === "ordinal";
    const groupAxis = isDiscrete21(xType) ? "x" : isDiscrete21(yType) ? "y" : "x";
    const offsetChannel = groupAxis === "x" ? "xOffset" : "yOffset";
    resolved.group.groupAxis = groupAxis;
    resolved.group.offsetChannel = offsetChannel;
    if (!resolved.color) {
      const palette = groupCS.colorScheme?.scheme ? getPaletteForScheme(groupCS.colorScheme.scheme) ?? DEFAULT_COLORS : DEFAULT_COLORS;
      resolved.color = {
        field: groupCS.field,
        type: groupCS.type ?? "nominal",
        colorPalette: palette,
        colorDomainMid: resolved.group.colorDomainMid,
        ordinalSortOrder: resolved.group.ordinalSortOrder,
        sortOrder: resolved.group.sortOrder,
        sortBy: resolved.group.sortBy,
        sortValues: resolved.group.sortValues,
        preserveDataOrder: resolved.group.preserveDataOrder,
        legendSymbolSize: resolved.group.legendSymbolSize,
        legendLabelFontSize: resolved.group.legendLabelFontSize
      };
    } else if (!resolved.color.colorPalette && groupCS.colorScheme?.scheme) {
      resolved.color.colorPalette = getPaletteForScheme(groupCS.colorScheme.scheme) ?? DEFAULT_COLORS;
    }
  }
  const templateEncoding = chartTemplate.template?.encoding;
  if (templateEncoding && typeof templateEncoding === "object") {
    for (const [ch, enc] of Object.entries(templateEncoding)) {
      if (enc && typeof enc === "object" && Object.keys(enc).length > 0 && resolved[ch]) {
        resolved[ch] = { ...enc, ...resolved[ch] };
      }
    }
  }
  return resolved;
}

// src/echarts/recommendation.ts
function ecGetRecommendation(chartType, tv) {
  const used = /* @__PURE__ */ new Set();
  const rec = {};
  const assign = (channel, fieldName) => {
    if (fieldName) rec[channel] = fieldName;
  };
  switch (chartType) {
    case "Gauge Chart": {
      const valueField = pickQuantitative(tv, used);
      if (!valueField) return {};
      assign("size", valueField);
      assign("column", pickLowCardDiscrete(tv, used, 10));
      return rec;
    }
    case "Funnel Chart": {
      const valueField = pickQuantitative(tv, used);
      const stageField = pickLowCardDiscrete(tv, used, 15);
      if (!valueField || !stageField) return {};
      assign("y", stageField);
      assign("size", valueField);
      return rec;
    }
    case "Treemap":
    case "Sunburst Chart": {
      const sizeField = pickQuantitative(tv, used);
      const colorField = pickLowCardDiscrete(tv, used, 20);
      if (!sizeField || !colorField) return {};
      assign("size", sizeField);
      assign("color", colorField);
      return rec;
    }
    case "Sankey Diagram": {
      const sourceField = pickDiscrete(tv, used);
      const targetField = pickDiscrete(tv, used);
      const valueField = pickQuantitative(tv, used);
      if (!sourceField || !targetField || !valueField) return {};
      assign("x", sourceField);
      assign("y", targetField);
      assign("size", valueField);
      return rec;
    }
    default:
      return getRecommendation(chartType, tv);
  }
}
function ecAdaptChart(sourceType, targetType, encodings, data, semanticTypes) {
  const targetChannels = ecGetTemplateChannels(targetType);
  return adaptChannels(sourceType, targetType, targetChannels, encodings, data, semanticTypes);
}
function ecRecommendEncodings(chartType, data, semanticTypes) {
  const rec = recommendChannels(chartType, data, semanticTypes, ecGetRecommendation);
  const validChannels = ecGetTemplateChannels(chartType);
  const result = {};
  for (const [ch, field] of Object.entries(rec)) {
    if (validChannels.includes(ch)) result[ch] = field;
  }
  return result;
}

// src/chartjs/templates/scatter.ts
function computePointRadius(width, height, pointCount) {
  const canvasArea = width * height;
  const areaPerPoint = canvasArea / Math.max(1, pointCount);
  const idealRadius = Math.sqrt(areaPerPoint * 0.05) / 2;
  return Math.max(2, Math.min(6, Math.round(idealRadius)));
}
var cjsScatterPlotDef = {
  chart: "Scatter Plot",
  template: { mark: "circle", encoding: {} },
  channels: ["x", "y", "color", "size", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xField = channelSemantics.x?.field;
    const yField = channelSemantics.y?.field;
    const colorField = channelSemantics.color?.field;
    if (!xField || !yField) return;
    const opacity = chartProperties?.opacity ?? 1;
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "scatter",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: xField }
          },
          y: {
            type: "linear",
            title: { display: true, text: yField }
          }
        },
        plugins: {
          tooltip: { enabled: true }
        }
      }
    };
    if (channelSemantics.x?.zero) {
      config.options.scales.x.beginAtZero = channelSemantics.x.zero.zero !== false;
    }
    if (channelSemantics.y?.zero) {
      config.options.scales.y.beginAtZero = channelSemantics.y.zero.zero !== false;
    }
    if (colorField) {
      const groups = /* @__PURE__ */ new Map();
      for (const row of table) {
        const key = String(row[colorField] ?? "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ x: row[xField], y: row[yField] });
      }
      let colorIdx = 0;
      for (const [name, data] of groups) {
        config.data.datasets.push({
          label: name,
          data,
          backgroundColor: getSeriesBackgroundColor(palette, colorIdx, opacity),
          borderColor: getSeriesBorderColor(palette, colorIdx),
          borderWidth: 1,
          pointRadius: 4
        });
        colorIdx++;
      }
      config.options.plugins.legend = { display: true };
    } else {
      const data = table.map((row) => ({ x: row[xField], y: row[yField] }));
      config.data.datasets.push({
        data,
        backgroundColor: getSeriesBackgroundColor(palette, 0, opacity),
        borderColor: getSeriesBorderColor(palette, 0),
        borderWidth: 1,
        pointRadius: 4
      });
      config.options.plugins.legend = { display: false };
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 1 }
  ],
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color", "size"]],
    shift: ["color", "group", "column", "row"],
    transitions: [
      {
        to: "Strip Plot",
        label: "Jitter",
        route: { from: "series", to: "x", mode: "swap", spill: "color" }
      }
    ]
  }),
  postProcess: (option, ctx) => {
    if (!option.data?.datasets) return;
    const w = option._width || ctx.canvasSize.width;
    const h = option._height || ctx.canvasSize.height;
    const pointCount = ctx.table.length;
    const radius = computePointRadius(w, h, pointCount);
    for (const ds of option.data.datasets) {
      if (ds.pointRadius == null || ds.pointRadius === 4) {
        ds.pointRadius = radius;
      }
    }
  }
};

// src/chartjs/templates/connected-scatter.ts
function sortByOrder2(rows, field) {
  if (!field) return rows;
  const tagged = rows.map((row, idx) => ({ row, idx, key: row[field] }));
  const present = tagged.filter((t) => t.key != null && t.key !== "");
  const allNumeric = present.length > 0 && present.every((t) => typeof t.key === "number" || typeof t.key === "string" && t.key.trim() !== "" && !isNaN(Number(t.key)));
  const allDates = !allNumeric && present.length > 0 && present.every((t) => !isNaN(Date.parse(String(t.key))));
  const rank = (k) => {
    if (allNumeric) return Number(k);
    if (allDates) return Date.parse(String(k));
    return String(k);
  };
  return [...tagged].sort((a, b) => {
    const ra = rank(a.key);
    const rb = rank(b.key);
    if (ra < rb) return -1;
    if (ra > rb) return 1;
    return a.idx - b.idx;
  }).map((t) => t.row);
}
function toPoints2(rows, xField, yField) {
  return rows.map((r) => ({ x: Number(r[xField]), y: Number(r[yField]) }));
}
var cjsConnectedScatterDef = {
  chart: "Connected Scatter Plot",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "order", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const orderField = channelSemantics.order?.field;
    const groupField = channelSemantics.color?.field ?? channelSemantics.detail?.field;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "scatter",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: xField },
            ticks: { font: { size: 10 } }
          },
          y: {
            type: "linear",
            title: { display: true, text: yField },
            ticks: { font: { size: 10 } }
          }
        },
        plugins: {
          tooltip: { enabled: true },
          legend: { display: false }
        }
      }
    };
    if (channelSemantics.x?.zero) {
      config.options.scales.x.beginAtZero = channelSemantics.x.zero.zero !== false;
    }
    if (channelSemantics.y?.zero) {
      config.options.scales.y.beginAtZero = channelSemantics.y.zero.zero !== false;
    }
    const baseDataset = {
      // Straight segments + visible points connecting the trajectory.
      showLine: true,
      tension: 0,
      borderWidth: 2,
      pointRadius: 4,
      fill: false,
      // Don't clip points at the chart-area edge: a point that lands
      // exactly on an axis bound would otherwise have its marker cut off.
      clip: false
    };
    if (groupField) {
      const groups = groupBy2(table, groupField);
      config.options.plugins.legend = { display: true };
      let colorIdx = 0;
      for (const [name, rows] of groups) {
        const sorted = sortByOrder2(rows, orderField);
        config.data.datasets.push({
          label: name,
          data: toPoints2(sorted, xField, yField),
          borderColor: getSeriesBorderColor(palette, colorIdx),
          backgroundColor: getSeriesBackgroundColor(palette, colorIdx, 1),
          ...baseDataset
        });
        colorIdx++;
      }
    } else {
      const sorted = sortByOrder2(table, orderField);
      config.data.datasets.push({
        label: yField,
        data: toPoints2(sorted, xField, yField),
        borderColor: getSeriesBorderColor(palette, 0),
        backgroundColor: getSeriesBackgroundColor(palette, 0, 1),
        ...baseDataset
      });
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/chartjs/templates/bubble.ts
function makeRadiusScale(values, rMin, rMax) {
  const finite = values.filter((v) => typeof v === "number" && isFinite(v));
  if (finite.length === 0) {
    const mid = Math.round((rMin + rMax) / 2);
    return () => mid;
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    const mid = Math.round((rMin + rMax) / 2);
    return () => mid;
  }
  const aMin = rMin * rMin;
  const aMax = rMax * rMax;
  return (v) => {
    if (typeof v !== "number" || !isFinite(v)) return rMin;
    const t = (v - min) / (max - min);
    const area = aMin + t * (aMax - aMin);
    return Math.max(rMin, Math.sqrt(area));
  };
}
var cjsBubbleChartDef = {
  chart: "Bubble Chart",
  template: { mark: "circle", encoding: {} },
  channels: ["x", "y", "size", "color", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xField = channelSemantics.x?.field;
    const yField = channelSemantics.y?.field;
    const sizeField = channelSemantics.size?.field;
    const colorField = channelSemantics.color?.field;
    if (!xField || !yField) return;
    const opacity = chartProperties?.opacity ?? 0.6;
    const palette = getChartJsPalette(ctx, "color");
    const sizeValues = sizeField ? table.map((row) => Number(row[sizeField])) : [];
    const radiusScale = makeRadiusScale(sizeValues, 5, 24);
    const toPoint = (row) => {
      const v = sizeField ? Number(row[sizeField]) : NaN;
      return {
        x: Number(row[xField]),
        y: Number(row[yField]),
        r: sizeField ? radiusScale(v) : 8,
        // Raw size value retained so postProcess can rescale to canvas.
        _v: v
      };
    };
    const config = {
      type: "bubble",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          // Bubble charts scale to the data extent (not a zero
          // baseline) and pad both ends with `grace` so large bubbles
          // sitting at the min/max aren't clipped by the plot edge.
          x: { type: "linear", grace: "10%", title: { display: true, text: xField } },
          y: { type: "linear", grace: "10%", title: { display: true, text: yField } }
        },
        plugins: {
          tooltip: { enabled: true }
        }
      }
    };
    if (colorField) {
      const groups = /* @__PURE__ */ new Map();
      for (const row of table) {
        const key = String(row[colorField] ?? "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(toPoint(row));
      }
      let colorIdx = 0;
      for (const [name, data] of groups) {
        config.data.datasets.push({
          label: name,
          data,
          backgroundColor: getSeriesBackgroundColor(palette, colorIdx, opacity),
          borderColor: getSeriesBorderColor(palette, colorIdx),
          borderWidth: 1
        });
        colorIdx++;
      }
      config.options.plugins.legend = { display: true };
    } else {
      config.data.datasets.push({
        data: table.map(toPoint),
        backgroundColor: getSeriesBackgroundColor(palette, 0, opacity),
        borderColor: getSeriesBorderColor(palette, 0),
        borderWidth: 1
      });
      config.options.plugins.legend = { display: false };
    }
    config._sizeField = sizeField ?? null;
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 0.6 }
  ],
  postProcess: (option, ctx) => {
    if (!option.data?.datasets) return;
    const sizeField = option._sizeField ?? null;
    delete option._sizeField;
    if (!sizeField) {
      for (const ds of option.data.datasets) for (const pt of ds.data) delete pt._v;
      return;
    }
    const allValues = [];
    for (const ds of option.data.datasets) {
      for (const pt of ds.data) allValues.push(pt._v);
    }
    const w = option._width || ctx.canvasSize.width;
    const h = option._height || ctx.canvasSize.height;
    const minDim = Math.min(w, h);
    const count = Math.max(1, allValues.length);
    const rMaxByDensity = Math.sqrt(w * h / count * 0.08);
    const rMax = Math.max(8, Math.min(34, Math.round(Math.min(minDim * 0.09, rMaxByDensity))));
    const rMin = Math.max(3, Math.round(rMax * 0.22));
    const radiusScale = makeRadiusScale(allValues, rMin, rMax);
    for (const ds of option.data.datasets) {
      for (const pt of ds.data) {
        const v = pt._v;
        if (typeof v === "number" && isFinite(v)) pt.r = radiusScale(v);
        delete pt._v;
      }
    }
  }
};

// src/chartjs/templates/jitter.ts
var isDiscrete16 = (type) => type === "nominal" || type === "ordinal";
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
function hexToRgb4(color) {
  const hex = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return void 0;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16)
  ];
}
function continuousColor(palette, value, min, max, alpha) {
  const colors = palette.length > 0 ? palette : ["#440154", "#fde725"];
  const span = max > min ? max - min : 1;
  const scaled = clamp01((value - min) / span) * (colors.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(colors.length - 1, Math.ceil(scaled));
  const t = scaled - lo;
  const left = hexToRgb4(colors[lo]);
  const right = hexToRgb4(colors[hi]);
  if (!left || !right) return colors[lo];
  const mix = (a, b) => Math.round(a + (b - a) * t);
  return `rgba(${mix(left[0], right[0])}, ${mix(left[1], right[1])}, ${mix(left[2], right[2])}, ${alpha})`;
}
function jitter2(seed) {
  let state = seed;
  return () => {
    state = state * 1103515245 + 12345 & 2147483647;
    return state / 2147483647 * 2 - 1;
  };
}
var cjsStripPlotDef = {
  chart: "Strip Plot",
  template: { mark: "circle", encoding: {} },
  channels: ["x", "y", "color", "size", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: { defaultBandSize: 50, minStep: 16 }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const xField = xCS?.field;
    const yField = yCS?.field;
    const colorField = channelSemantics.color?.field;
    const colorType = channelSemantics.color?.type;
    const isContinuousColor2 = !!colorField && (colorType === "quantitative" || colorType === "temporal");
    const isTemporalColor = colorType === "temporal";
    if (!xField || !yField) return;
    const xIsDiscrete = isDiscrete16(xCS?.type);
    const yIsDiscrete = isDiscrete16(yCS?.type);
    const catAxis = xIsDiscrete ? "x" : yIsDiscrete ? "y" : "x";
    const contAxis = catAxis === "x" ? "y" : "x";
    const catField = catAxis === "x" ? xField : yField;
    const contField = contAxis === "x" ? xField : yField;
    const catSemantics = catAxis === "x" ? xCS : yCS;
    const categories = extractCategories2(table, catField, catSemantics?.ordinalSortOrder);
    const categoryIndex = new Map(categories.map((category, index) => [String(category), index]));
    const nextJitter = jitter2(42);
    const jitterHalfWidth = 0.3;
    const palette = getChartJsPalette(ctx, isDiscrete16(colorType) ? "color" : "group");
    const opacity = chartProperties?.opacity ?? 0.7;
    const explicitPointSize = Number(chartProperties?.pointSize ?? 0);
    const pointRadius = explicitPointSize > 0 ? Math.max(1, Math.min(10, Math.round(explicitPointSize / 12))) : 3;
    const toColorValue = (value) => {
      if (value == null) return NaN;
      return isTemporalColor ? new Date(value).getTime() : Number(value);
    };
    const continuousColorValues = isContinuousColor2 && colorField ? table.map((row) => toColorValue(row[colorField])).filter((value) => Number.isFinite(value)) : [];
    const colorMin = continuousColorValues.length ? Math.min(...continuousColorValues) : 0;
    const colorMax = continuousColorValues.length ? Math.max(...continuousColorValues) : 1;
    const pointColors = isContinuousColor2 && colorField ? table.map((row) => continuousColor(palette, toColorValue(row[colorField]), colorMin, colorMax, opacity)) : void 0;
    const buildPoint = (row) => {
      const category = String(row[catField] ?? "");
      const index = categoryIndex.get(category) ?? 0;
      const categoryValue = index + nextJitter() * jitterHalfWidth;
      const continuousValue = row[contField];
      return catAxis === "x" ? { x: categoryValue, y: continuousValue } : { x: continuousValue, y: categoryValue };
    };
    const categoryScale = {
      type: "linear",
      min: -0.5,
      max: Math.max(0.5, categories.length - 0.5),
      title: { display: true, text: catField },
      ticks: {
        stepSize: 1,
        callback(value) {
          const index = Math.round(Number(value));
          return categories[index] ?? "";
        }
      }
    };
    const continuousScale = {
      type: "linear",
      title: { display: true, text: contField },
      ticks: { font: { size: 10 } }
    };
    const config = {
      type: "scatter",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: catAxis === "x" ? { x: categoryScale, y: continuousScale } : { x: continuousScale, y: categoryScale },
        plugins: {
          tooltip: { enabled: true },
          legend: { display: !!colorField && isDiscrete16(colorType) }
        }
      }
    };
    if (colorField && isDiscrete16(colorType)) {
      let colorIndex = 0;
      for (const [name, rows] of groupBy2(table, colorField)) {
        config.data.datasets.push({
          label: name,
          data: rows.map(buildPoint),
          backgroundColor: getSeriesBackgroundColor(palette, colorIndex, opacity),
          borderColor: getSeriesBorderColor(palette, colorIndex),
          borderWidth: 1,
          pointRadius
        });
        colorIndex++;
      }
    } else {
      config.data.datasets.push({
        data: table.map(buildPoint),
        backgroundColor: pointColors ?? getSeriesBackgroundColor(palette, 0, opacity),
        borderColor: pointColors ?? getSeriesBorderColor(palette, 0),
        borderWidth: 1,
        pointRadius
      });
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "stepWidth", label: "Jitter", type: "continuous", min: 10, max: 100, step: 5, defaultValue: 20 },
    { key: "pointSize", label: "Size", type: "continuous", min: 0, max: 150, step: 5, defaultValue: 0 },
    { key: "opacity", label: "Opacity", type: "continuous", min: 0, max: 1, step: 0.05, defaultValue: 0 }
  ],
  pivot: makeCartesianPivot({
    transitions: [
      {
        to: "Scatter Plot",
        label: "Scatter",
        route: { from: "color", to: "x", mode: "swap", spill: "color" }
      }
    ]
  })
};

// src/chartjs/templates/bar.ts
var isDiscrete17 = (type) => type === "nominal" || type === "ordinal";
var cjsBarChartDef = {
  chart: "Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes
    };
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const { categoryAxis, valueAxis } = detectAxes2(channelSemantics);
    const catField = channelSemantics[categoryAxis]?.field;
    const valField = channelSemantics[valueAxis]?.field;
    if (!catField || !valField) return;
    const catCS = channelSemantics[categoryAxis];
    const categories = extractCategories2(table, catField, catCS?.ordinalSortOrder);
    const values = buildCategoryAlignedData3(table, catField, valField, categories);
    const isHorizontal = categoryAxis === "y";
    const palette = getChartJsPalette(ctx);
    const config = {
      type: "bar",
      data: {
        labels: categories,
        datasets: [{
          label: valField,
          data: values,
          backgroundColor: getSeriesBackgroundColor(palette, 0),
          borderColor: getSeriesBorderColor(palette, 0),
          borderWidth: 1,
          borderRadius: chartProperties?.cornerRadius ?? 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: isHorizontal ? "y" : "x",
        scales: {
          x: {
            title: { display: true, text: isHorizontal ? valField : catField },
            ...isHorizontal ? {} : {}
          },
          y: {
            title: { display: true, text: isHorizontal ? catField : valField }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true }
        }
      }
    };
    const valScale = isHorizontal ? "x" : "y";
    const valCS = channelSemantics[valueAxis];
    if (valCS?.zero) {
      config.options.scales[valScale].beginAtZero = valCS.zero.zero !== false;
    } else {
      config.options.scales[valScale].beginAtZero = true;
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 15, step: 1, defaultValue: 0 }
  ],
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"]
  })
};
var cjsStackedBarChartDef = {
  chart: "Stacked Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes,
      paramOverrides: { continuousMarkCrossSection: { x: 20, y: 20, seriesCountAxis: "auto" } }
    };
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const { categoryAxis, valueAxis } = detectAxes2(channelSemantics);
    const colorField = channelSemantics.color?.field;
    const hasStackSeries = !!colorField;
    const catField = channelSemantics[categoryAxis]?.field;
    const valField = channelSemantics[valueAxis]?.field;
    if (!catField || !valField) return;
    const catCS = channelSemantics[categoryAxis];
    const categories = extractCategories2(table, catField, catCS?.ordinalSortOrder);
    const isHorizontal = categoryAxis === "y";
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "bar",
      data: {
        labels: categories,
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: isHorizontal ? "y" : "x",
        scales: {
          x: {
            stacked: hasStackSeries,
            title: { display: true, text: isHorizontal ? valField : catField }
          },
          y: {
            stacked: hasStackSeries,
            title: { display: true, text: isHorizontal ? catField : valField }
          }
        },
        plugins: {
          legend: { display: !!colorField },
          tooltip: { enabled: true }
        }
      }
    };
    if (colorField) {
      const groups = groupBy2(table, colorField);
      let colorIdx = 0;
      for (const [name, rows] of groups) {
        const values = buildCategoryAlignedData3(rows, catField, valField, categories);
        config.data.datasets.push({
          label: name,
          data: values,
          backgroundColor: getSeriesBackgroundColor(palette, colorIdx),
          borderColor: getSeriesBorderColor(palette, colorIdx),
          borderWidth: 1
        });
        colorIdx++;
      }
    } else {
      const values = buildCategoryAlignedData3(table, catField, valField, categories);
      config.data.datasets.push({
        label: valField,
        data: values,
        backgroundColor: getSeriesBackgroundColor(palette, 0),
        borderColor: getSeriesBorderColor(palette, 0),
        borderWidth: 1
      });
    }
    const valScaleS = isHorizontal ? "x" : "y";
    const valCSs = channelSemantics[valueAxis];
    if (valCSs?.zero) {
      config.options.scales[valScaleS].beginAtZero = valCSs.zero.zero !== false;
    } else {
      config.options.scales[valScaleS].beginAtZero = true;
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"],
    transitions: [
      {
        to: "Grouped Bar Chart",
        label: "Grouped",
        route: { from: "color", to: "group", mode: "move" },
        requireDiscreteSource: true,
        maxSourceCardinality: 12
      }
    ]
  })
};
var cjsGroupedBarChartDef = {
  chart: "Grouped Bar Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "group", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table, chartProperties) => {
    const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: "x" });
    const decl = {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes,
      paramOverrides: { continuousMarkCrossSection: { x: 20, y: 20, seriesCountAxis: "auto" } }
    };
    const groupField = cs.group?.field || cs.color?.field;
    const axisField = result?.axis ? cs[result.axis]?.field : isDiscrete17(cs.x?.type) ? cs.x?.field : cs.y?.field;
    if (groupField && axisField) {
      const plan = planBandDodge(table, axisField, groupField);
      const { mode } = resolveDodge(plan, chartProperties?.dodge);
      if (mode === "local") decl.groupLaneCount = Math.max(1, plan.maxPerBand);
    }
    return decl;
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const { categoryAxis, valueAxis } = detectAxes2(channelSemantics);
    const groupField = channelSemantics.group?.field || channelSemantics.color?.field;
    const catField = channelSemantics[categoryAxis]?.field;
    const valField = channelSemantics[valueAxis]?.field;
    if (!catField || !valField) return;
    const catCS = channelSemantics[categoryAxis];
    const categories = extractCategories2(table, catField, catCS?.ordinalSortOrder);
    const isHorizontal = categoryAxis === "y";
    const palette = getChartJsPalette(ctx, "group");
    const dodgePlan = groupField ? planBandDodge(table, catField, groupField) : null;
    const dodgeMode = dodgePlan ? resolveDodge(dodgePlan, chartProperties?.dodge).mode : "none";
    const config = {
      type: "bar",
      data: {
        labels: categories,
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: isHorizontal ? "y" : "x",
        scales: {
          x: {
            title: { display: true, text: isHorizontal ? valField : catField }
          },
          y: {
            title: { display: true, text: isHorizontal ? catField : valField }
          }
        },
        plugins: {
          legend: { display: !!groupField },
          tooltip: { enabled: true }
        }
      }
    };
    if (groupField && dodgeMode === "local") {
      const globalGroups = [...new Set(table.map((r) => String(r[groupField] ?? "")))].filter(Boolean).sort();
      const colorFor = (g) => getSeriesBackgroundColor(palette, Math.max(0, globalGroups.indexOf(g)));
      const borderFor = (g) => getSeriesBorderColor(palette, Math.max(0, globalGroups.indexOf(g)));
      const perBand = /* @__PURE__ */ new Map();
      for (const cat of categories) perBand.set(cat, []);
      for (const r of table) {
        const cat = String(r[catField] ?? "");
        const g = String(r[groupField] ?? "");
        if (!perBand.has(cat) || !g) continue;
        const arr = perBand.get(cat);
        if (!arr.includes(g)) arr.push(g);
      }
      for (const arr of perBand.values()) arr.sort();
      const maxPerBand = Math.max(1, ...[...perBand.values()].map((a) => a.length));
      const valAt = /* @__PURE__ */ new Map();
      for (const r of table) {
        const v = Number(r[valField]);
        if (isFinite(v)) valAt.set(`${r[catField]}\0${r[groupField]}`, v);
      }
      for (let lane = 0; lane < maxPerBand; lane++) {
        const data = [];
        const bg = [];
        const bd = [];
        for (const cat of categories) {
          const g = perBand.get(cat)?.[lane];
          if (g === void 0) {
            data.push(null);
            bg.push("transparent");
            bd.push("transparent");
            continue;
          }
          const v = valAt.get(`${cat}\0${g}`);
          data.push(v === void 0 ? null : v);
          bg.push(colorFor(g));
          bd.push(borderFor(g));
        }
        config.data.datasets.push({
          label: `__lane${lane}`,
          data,
          backgroundColor: bg,
          borderColor: bd,
          borderWidth: 1
        });
      }
      config.options.plugins.legend = {
        display: true,
        labels: {
          generateLabels: () => globalGroups.map((g) => ({
            text: g,
            fillStyle: colorFor(g),
            strokeStyle: borderFor(g),
            lineWidth: 1
          }))
        }
      };
    } else if (groupField) {
      const groups = groupBy2(table, groupField);
      let colorIdx = 0;
      for (const [name, rows] of groups) {
        const values = buildCategoryAlignedData3(rows, catField, valField, categories);
        config.data.datasets.push({
          label: name,
          data: values,
          backgroundColor: getSeriesBackgroundColor(palette, colorIdx),
          borderColor: getSeriesBorderColor(palette, colorIdx),
          borderWidth: 1
        });
        colorIdx++;
      }
    } else {
      const values = buildCategoryAlignedData3(table, catField, valField, categories);
      config.data.datasets.push({
        label: valField,
        data: values,
        backgroundColor: getSeriesBackgroundColor(palette, 0),
        borderColor: getSeriesBorderColor(palette, 0),
        borderWidth: 1
      });
    }
    const valScaleG = isHorizontal ? "x" : "y";
    const valCSg = channelSemantics[valueAxis];
    if (valCSg?.zero) {
      config.options.scales[valScaleG].beginAtZero = valCSg.zero.zero !== false;
    } else {
      config.options.scales[valScaleG].beginAtZero = true;
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "dodge",
      label: "Dodge",
      type: "discrete",
      options: [
        { value: "auto", label: "Auto" },
        { value: "local", label: "Local (compact)" },
        { value: "global", label: "Global (aligned)" }
      ],
      defaultValue: "auto",
      check: (ctx) => {
        const isDisc = (t) => t === "nominal" || t === "ordinal";
        const groupField = ctx.channelSemantics?.group?.field ?? ctx.channelSemantics?.color?.field ?? ctx.encodings?.group?.field ?? ctx.encodings?.color?.field;
        const axisField = isDisc(ctx.channelSemantics?.x?.type) ? ctx.channelSemantics?.x?.field : ctx.channelSemantics?.y?.field;
        const rows = ctx.data;
        if (!groupField || !axisField || !rows) return { applicable: false };
        const plan = planBandDodge(rows, axisField, groupField);
        return { applicable: plan.ambiguous, recommendedValue: plan.mode === "none" ? "auto" : plan.mode };
      }
    }
  ],
  pivot: makeCartesianPivot({
    transpose: [["x", "y"]],
    permute: [["x", "y", "color"]],
    shift: ["color", "group", "column", "row"],
    transitions: [
      {
        to: "Stacked Bar Chart",
        label: "Stacked",
        route: { from: "group", to: "color", mode: "move" },
        requireDiscreteSource: true
      }
    ]
  })
};

// src/chartjs/templates/combo.ts
function isNumericField2(table, field) {
  let total = 0;
  let numeric = 0;
  for (const row of table) {
    const v = row[field];
    if (v == null || v === "") continue;
    total++;
    if (typeof v === "number" ? isFinite(v) : !isNaN(Number(v))) numeric++;
  }
  return total > 0 && numeric / total >= 0.9;
}
var cjsComboChartDef = {
  chart: "Combo Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: (cs, table) => {
    const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: "x" });
    return {
      axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
      resolvedTypes: result?.resolvedTypes
    };
  },
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const catField = channelSemantics.x?.field;
    const barField = channelSemantics.y?.field;
    if (!catField || !barField || table.length === 0) return;
    const lineField = chartProperties?.lineField && chartProperties.lineField in table[0] ? chartProperties.lineField : Object.keys(table[0]).find(
      (k) => k !== catField && k !== barField && isNumericField2(table, k)
    );
    const categories = extractCategories2(table, catField, channelSemantics.x?.ordinalSortOrder);
    const barData = buildCategoryAlignedData3(table, catField, barField, categories);
    const palette = getChartJsPalette(ctx, "color");
    const datasets = [{
      type: "bar",
      label: barField,
      data: barData,
      yAxisID: "y",
      order: 2,
      backgroundColor: getSeriesBackgroundColor(palette, 0),
      borderColor: getSeriesBorderColor(palette, 0),
      borderWidth: 1,
      borderRadius: chartProperties?.cornerRadius ?? 0
    }];
    if (lineField) {
      const lineData = buildCategoryAlignedData3(table, catField, lineField, categories);
      datasets.push({
        type: "line",
        label: lineField,
        data: lineData,
        yAxisID: "y1",
        order: 1,
        borderColor: getSeriesBorderColor(palette, 1),
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.3,
        fill: false
      });
    }
    const config = {
      type: "bar",
      data: { labels: categories, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: catField }
          },
          y: {
            type: "linear",
            position: "left",
            beginAtZero: channelSemantics.y?.zero ? channelSemantics.y.zero.zero !== false : true,
            title: { display: true, text: barField }
          },
          ...lineField ? {
            y1: {
              type: "linear",
              position: "right",
              title: { display: true, text: lineField },
              // Don't draw the right axis grid over the bars.
              grid: { drawOnChartArea: false }
            }
          } : {}
        },
        plugins: {
          legend: { display: true },
          tooltip: { enabled: true }
        }
      }
    };
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 15, step: 1, defaultValue: 0 }
  ]
};

// src/chartjs/templates/line.ts
var isDiscrete18 = (type) => type === "nominal" || type === "ordinal";
var cjsLineChartDef = {
  chart: "Line Chart",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" }, facetAspectRatioResistance: 0.5 }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, fullTable, chartProperties } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const colorField = channelSemantics.color?.field;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const xIsDiscrete = isDiscrete18(xCS.type);
    const xIsTemporal = xCS.type === "temporal";
    const mapContinuousX = (raw) => xIsTemporal ? coerceUnixMsForChartJs(raw) : raw;
    let continuousXExtent;
    if (!xIsDiscrete) {
      const xNums = (fullTable ?? table).map((r) => mapContinuousX(r[xField])).filter((v) => typeof v === "number" && Number.isFinite(v));
      if (xNums.length > 0) {
        continuousXExtent = { min: Math.min(...xNums), max: Math.max(...xNums) };
      }
    }
    const categories = xIsDiscrete ? extractCategories2(table, xField, xCS.ordinalSortOrder) : void 0;
    const interpolate = chartProperties?.interpolate;
    const tension = interpolate === "monotone" || interpolate === "basis" || interpolate === "cardinal" || interpolate === "catmull-rom" ? 0.4 : 0;
    const stepped = interpolate === "step" ? "middle" : interpolate === "step-before" ? "before" : interpolate === "step-after" ? "after" : false;
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "line",
      data: {
        labels: categories || [],
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: xIsDiscrete ? "category" : "linear",
            title: { display: true, text: xField },
            ...continuousXExtent ? { min: continuousXExtent.min, max: continuousXExtent.max } : {},
            ticks: {
              font: { size: 10 },
              ...xIsTemporal ? {
                maxTicksLimit: 4,
                autoSkip: true,
                maxRotation: 0,
                callback(v) {
                  const n = typeof v === "number" ? v : Number(v);
                  if (!Number.isFinite(n)) return String(v);
                  const spanDays = continuousXExtent ? (continuousXExtent.max - continuousXExtent.min) / 864e5 : 0;
                  const opts = spanDays > 60 ? { month: "short", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
                  return new Date(n).toLocaleDateString(void 0, opts);
                }
              } : {}
            }
          },
          y: {
            type: "linear",
            title: { display: true, text: yField },
            ticks: { font: { size: 10 } }
          }
        },
        plugins: {
          tooltip: { enabled: true }
        }
      }
    };
    if (channelSemantics.y?.zero) {
      config.options.scales.y.beginAtZero = channelSemantics.y.zero.zero !== false;
    }
    if (colorField) {
      const groups = groupBy2(table, colorField);
      config.options.plugins.legend = { display: true };
      let colorIdx = 0;
      for (const [name, rows] of groups) {
        const data = xIsDiscrete ? buildCategoryAlignedData3(rows, xField, yField, categories) : rows.map((r) => ({ x: mapContinuousX(r[xField]), y: r[yField] })).filter((p) => p.y != null && (xIsTemporal ? Number.isFinite(p.x) : true));
        config.data.datasets.push({
          label: name,
          data,
          borderColor: getSeriesBorderColor(palette, colorIdx),
          backgroundColor: "transparent",
          tension,
          stepped,
          pointRadius: 3,
          fill: false
        });
        colorIdx++;
      }
    } else {
      const data = xIsDiscrete ? categories.map((cat) => {
        const row = table.find((r) => String(r[xField]) === cat);
        return row ? row[yField] : null;
      }) : table.map((r) => ({ x: mapContinuousX(r[xField]), y: r[yField] })).filter((p) => p.y != null && (xIsTemporal ? Number.isFinite(p.x) : true));
      config.data.datasets.push({
        label: yField,
        data,
        borderColor: getSeriesBorderColor(palette, 0),
        backgroundColor: "transparent",
        tension,
        stepped,
        pointRadius: 3,
        fill: false
      });
      config.options.plugins.legend = { display: false };
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "interpolate",
      label: "Curve",
      type: "discrete",
      options: [
        { value: void 0, label: "Default (linear)" },
        { value: "linear", label: "Linear" },
        { value: "monotone", label: "Monotone (smooth)" },
        { value: "step", label: "Step" },
        { value: "step-before", label: "Step Before" },
        { value: "step-after", label: "Step After" }
      ]
    }
  ],
  pivot: makeCartesianPivot({
    permute: [["y", "color"]],
    shift: ["color", "group", "column", "row"]
  })
};

// src/chartjs/templates/slope.ts
function orderPeriods2(categories) {
  if (categories.length <= 1) return categories;
  const allNumeric = categories.every((c) => c.trim() !== "" && !isNaN(Number(c)));
  if (allNumeric) return [...categories].sort((a, b) => Number(a) - Number(b));
  const allDates = categories.every((c) => !isNaN(Date.parse(c)));
  if (allDates) return [...categories].sort((a, b) => Date.parse(a) - Date.parse(b));
  return categories;
}
var cjsSlopeChartDef = {
  chart: "Slope Chart",
  template: { mark: "line", encoding: {} },
  channels: ["x", "y", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({
    axisFlags: { x: { banded: true } },
    paramOverrides: {
      defaultBandSize: 120,
      continuousMarkCrossSection: { x: 0, y: 0, seriesCountAxis: "auto" }
    }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const groupField = channelSemantics.color?.field ?? channelSemantics.detail?.field;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const categories = orderPeriods2(
      extractCategories2(table, xField, xCS.ordinalSortOrder)
    );
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "line",
      data: { labels: categories, datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "category",
            // Inset the two period bands so the end points/labels
            // are not clipped against the plot edges.
            offset: true,
            title: { display: true, text: xField },
            ticks: { font: { size: 10 } }
          },
          y: {
            type: "linear",
            title: { display: true, text: yField },
            ticks: { font: { size: 10 } }
          }
        },
        plugins: {
          tooltip: { enabled: true },
          legend: { display: false }
        }
      }
    };
    if (channelSemantics.y?.zero) {
      config.options.scales.y.beginAtZero = channelSemantics.y.zero.zero !== false;
    }
    const baseDataset = {
      // Straight segments + visible end points.
      tension: 0,
      pointRadius: 4,
      backgroundColor: "transparent",
      fill: false
    };
    if (groupField) {
      const groups = groupBy2(table, groupField);
      config.options.plugins.legend = { display: true };
      let colorIdx = 0;
      for (const [name, rows] of groups) {
        config.data.datasets.push({
          label: name,
          data: buildCategoryAlignedData3(rows, xField, yField, categories),
          borderColor: getSeriesBorderColor(palette, colorIdx),
          ...baseDataset
        });
        colorIdx++;
      }
    } else {
      config.data.datasets.push({
        label: yField,
        data: buildCategoryAlignedData3(table, xField, yField, categories),
        borderColor: getSeriesBorderColor(palette, 0),
        ...baseDataset
      });
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/chartjs/templates/area.ts
var isDiscrete19 = (type) => type === "nominal" || type === "ordinal";
var cjsAreaChartDef = {
  chart: "Area Chart",
  template: { mark: "area", encoding: {} },
  channels: ["x", "y", "color", "opacity", "column", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" }, facetAspectRatioResistance: 0.5 }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const colorField = channelSemantics.color?.field;
    if (!xCS?.field || !yCS?.field) return;
    const xField = xCS.field;
    const yField = yCS.field;
    const xIsDiscrete = isDiscrete19(xCS.type);
    const xIsTemporal = xCS.type === "temporal";
    const mapContinuousX = (raw) => xIsTemporal ? coerceUnixMsForChartJs(raw) : raw;
    const categories = xIsDiscrete ? extractCategories2(table, xField, xCS.ordinalSortOrder) : void 0;
    const opacity = chartProperties?.opacity ?? 0.4;
    const stackMode = chartProperties?.stackMode;
    const stacked = stackMode !== "layered";
    const interpolate = chartProperties?.interpolate;
    const tension = interpolate === "monotone" || interpolate === "basis" || interpolate === "cardinal" || interpolate === "catmull-rom" ? 0.4 : 0;
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "line",
      data: {
        labels: categories || [],
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: xIsDiscrete ? "category" : "linear",
            title: { display: true, text: xField },
            ticks: {
              font: { size: 10 },
              ...xIsTemporal ? {
                maxTicksLimit: 8,
                callback(v) {
                  const n = typeof v === "number" ? v : Number(v);
                  if (!Number.isFinite(n)) return String(v);
                  return new Date(n).toLocaleDateString(void 0, {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                  });
                }
              } : {}
            }
          },
          y: {
            type: "linear",
            title: { display: true, text: yField },
            stacked,
            ticks: { font: { size: 10 } }
          }
        },
        plugins: {
          tooltip: { enabled: true },
          filler: { propagate: true }
        }
      }
    };
    if (channelSemantics.y?.zero) {
      config.options.scales.y.beginAtZero = channelSemantics.y.zero.zero !== false;
    }
    if (colorField) {
      const groups = groupBy2(table, colorField);
      config.options.plugins.legend = { display: true };
      let colorIdx = 0;
      for (const [name, rows] of groups) {
        const data = xIsDiscrete ? buildCategoryAlignedData3(rows, xField, yField, categories) : rows.map((r) => ({ x: mapContinuousX(r[xField]), y: r[yField] })).filter((p) => p.y != null && (xIsTemporal ? Number.isFinite(p.x) : true));
        const borderColor = getSeriesBorderColor(palette, colorIdx);
        const bgColor = getSeriesBackgroundColor(palette, colorIdx, opacity);
        config.data.datasets.push({
          label: name,
          data,
          borderColor,
          backgroundColor: bgColor,
          tension,
          fill: stacked ? "stack" : "origin",
          pointRadius: 2
        });
        colorIdx++;
      }
    } else {
      const data = xIsDiscrete ? categories.map((cat) => {
        const row = table.find((r) => String(r[xField]) === cat);
        return row ? row[yField] : null;
      }) : table.map((r) => ({ x: mapContinuousX(r[xField]), y: r[yField] })).filter((p) => p.y != null && (xIsTemporal ? Number.isFinite(p.x) : true));
      config.data.datasets.push({
        label: yField,
        data,
        borderColor: getSeriesBorderColor(palette, 0),
        backgroundColor: getSeriesBackgroundColor(palette, 0, opacity),
        tension,
        fill: "origin",
        pointRadius: 2
      });
      config.options.plugins.legend = { display: false };
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "interpolate",
      label: "Curve",
      type: "discrete",
      options: [
        { value: void 0, label: "Default (linear)" },
        { value: "linear", label: "Linear" },
        { value: "monotone", label: "Monotone (smooth)" }
      ]
    },
    { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 0.4 },
    {
      key: "stackMode",
      label: "Stack",
      type: "discrete",
      options: [
        { value: void 0, label: "Stacked (default)" },
        { value: "layered", label: "Layered (overlap)" }
      ]
    }
  ]
};

// src/chartjs/templates/range-area.ts
var isDiscrete20 = (type) => type === "nominal" || type === "ordinal";
var cjsRangeAreaChartDef = {
  chart: "Range Area Chart",
  template: { mark: "area", encoding: {} },
  channels: ["x", "y", "y2", "color", "column", "row"],
  markCognitiveChannel: "area",
  declareLayoutMode: () => ({
    paramOverrides: {
      continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: "auto" },
      facetAspectRatioResistance: 0.5
    }
  }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;
    const y2CS = channelSemantics.y2;
    const colorField = channelSemantics.color?.field;
    if (!xCS?.field || !yCS?.field || !y2CS?.field) return;
    const xField = xCS.field;
    const lowField = yCS.field;
    const highField = y2CS.field;
    const xIsDiscrete = isDiscrete20(xCS.type);
    const xIsTemporal = xCS.type === "temporal";
    const mapContinuousX = (raw) => xIsTemporal ? coerceUnixMsForChartJs(raw) : Number(raw);
    const valueTitle = lowField === highField ? lowField : `${lowField}, ${highField}`;
    const categories = xIsDiscrete ? extractCategories2(table, xField, xCS.ordinalSortOrder) : void 0;
    const opacity = chartProperties?.opacity ?? 0.3;
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "line",
      data: { labels: categories ?? [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: xIsDiscrete ? "category" : "linear",
            title: { display: true, text: xField },
            ticks: {
              font: { size: 10 },
              ...xIsTemporal ? {
                maxTicksLimit: 8,
                callback(v) {
                  const n = typeof v === "number" ? v : Number(v);
                  if (!Number.isFinite(n)) return String(v);
                  return new Date(n).toLocaleDateString(void 0, {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                  });
                }
              } : {}
            }
          },
          y: {
            type: "linear",
            // A ranged area reads its extent, not its distance from
            // zero — fit the band rather than forcing a zero baseline.
            title: { display: true, text: valueTitle },
            ticks: { font: { size: 10 } }
          }
        },
        plugins: {
          tooltip: { enabled: true },
          legend: { display: false }
        }
      }
    };
    const buildBoundData = (rows, field) => {
      if (xIsDiscrete) return buildCategoryAlignedData3(rows, xField, field, categories);
      return rows.map((r) => ({ x: mapContinuousX(r[xField]), y: Number(r[field]) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
    };
    const pushBand = (rows, name, colorIdx) => {
      const lowerData = buildBoundData(rows, lowField);
      const upperData = buildBoundData(rows, highField);
      const border = getSeriesBorderColor(palette, colorIdx);
      const lowerIndex = config.data.datasets.length;
      config.data.datasets.push({
        label: name,
        data: lowerData,
        borderColor: border,
        backgroundColor: "transparent",
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0,
        _rangeBound: "lower"
      });
      config.data.datasets.push({
        label: name,
        data: upperData,
        borderColor: border,
        backgroundColor: getSeriesBackgroundColor(palette, colorIdx, opacity),
        borderWidth: 1,
        pointRadius: 0,
        fill: { target: lowerIndex },
        tension: 0,
        _rangeBound: "upper"
      });
    };
    if (colorField) {
      const groups = groupBy2(table, colorField);
      let idx = 0;
      for (const [name, rows] of groups) {
        pushBand(rows, String(name), idx);
        idx++;
      }
      config.options.plugins.legend = {
        display: true,
        labels: {
          filter: (item, data) => data.datasets[item.datasetIndex]?._rangeBound !== "lower"
        }
      };
    } else {
      pushBand(table, lowField, 0);
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/chartjs/templates/pie.ts
function sortSlicesInPlace(labels, values, sortSlices) {
  if (sortSlices !== "descending" && sortSlices !== "ascending") return;
  const idx = values.map((_, i) => i);
  idx.sort((a, b) => sortSlices === "descending" ? values[b] - values[a] : values[a] - values[b]);
  const sortedLabels = idx.map((i) => labels[i]);
  const sortedValues = idx.map((i) => values[i]);
  labels.splice(0, labels.length, ...sortedLabels);
  values.splice(0, values.length, ...sortedValues);
}
var SORT_SLICES_PROPERTY = {
  key: "sortSlices",
  label: "Sort slices",
  type: "discrete",
  options: [
    { value: "none", label: "Data order" },
    { value: "descending", label: "Largest first" },
    { value: "ascending", label: "Smallest first" }
  ],
  defaultValue: "none"
};
var cjsPieChartDef = {
  chart: "Pie Chart",
  template: { mark: "arc", encoding: {} },
  channels: ["size", "color", "column", "row"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const colorField = channelSemantics.color?.field;
    const sizeField = channelSemantics.size?.field;
    const labels = [];
    const values = [];
    const palette = getChartJsPalette(ctx, "color");
    if (colorField && sizeField) {
      const agg = /* @__PURE__ */ new Map();
      for (const row of table) {
        const cat = String(row[colorField] ?? "");
        const val = Number(row[sizeField]) || 0;
        agg.set(cat, (agg.get(cat) ?? 0) + val);
      }
      const categories = extractCategories2(table, colorField, channelSemantics.color?.ordinalSortOrder);
      for (const cat of categories) {
        labels.push(cat);
        values.push(agg.get(cat) ?? 0);
      }
    } else if (colorField) {
      const counts = /* @__PURE__ */ new Map();
      for (const row of table) {
        const cat = String(row[colorField] ?? "");
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
      const categories = extractCategories2(table, colorField, channelSemantics.color?.ordinalSortOrder);
      for (const cat of categories) {
        labels.push(cat);
        values.push(counts.get(cat) ?? 0);
      }
    } else if (sizeField) {
      for (const row of table) {
        const val = Number(row[sizeField]) || 0;
        labels.push(String(val));
        values.push(val);
      }
    }
    const innerRadius = chartProperties?.innerRadius ?? 0;
    const isDoughnut = innerRadius > 0;
    sortSlicesInPlace(labels, values, chartProperties?.sortSlices);
    const config = {
      type: isDoughnut ? "doughnut" : "pie",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map((_, i) => getSeriesBackgroundColor(palette, i, 0.6)),
          borderColor: labels.map((_, i) => getSeriesBorderColor(palette, i)),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "right" },
          tooltip: { enabled: true }
        },
        ...isDoughnut ? { cutout: `${innerRadius}%` } : {}
      },
      // Canvas size from context (no axes)
      _width: Math.max(ctx.canvasSize.width, 300),
      _height: Math.max(ctx.canvasSize.height, 250)
    };
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "innerRadius", label: "Donut", type: "continuous", min: 0, max: 60, step: 5, defaultValue: 0 },
    SORT_SLICES_PROPERTY
  ]
};

// src/chartjs/templates/doughnut.ts
var cjsDoughnutChartDef = {
  chart: "Doughnut Chart",
  template: { mark: "arc", encoding: {} },
  channels: ["size", "color", "column", "row"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const colorField = channelSemantics.color?.field;
    const sizeField = channelSemantics.size?.field;
    const labels = [];
    const values = [];
    const palette = getChartJsPalette(ctx, "color");
    if (colorField && sizeField) {
      const agg = /* @__PURE__ */ new Map();
      for (const row of table) {
        const cat = String(row[colorField] ?? "");
        const val = Number(row[sizeField]) || 0;
        agg.set(cat, (agg.get(cat) ?? 0) + val);
      }
      const categories = extractCategories2(table, colorField, channelSemantics.color?.ordinalSortOrder);
      for (const cat of categories) {
        labels.push(cat);
        values.push(agg.get(cat) ?? 0);
      }
    } else if (colorField) {
      const counts = /* @__PURE__ */ new Map();
      for (const row of table) {
        const cat = String(row[colorField] ?? "");
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
      const categories = extractCategories2(table, colorField, channelSemantics.color?.ordinalSortOrder);
      for (const cat of categories) {
        labels.push(cat);
        values.push(counts.get(cat) ?? 0);
      }
    } else if (sizeField) {
      for (const row of table) {
        const val = Number(row[sizeField]) || 0;
        labels.push(String(val));
        values.push(val);
      }
    }
    const cutout = chartProperties?.innerRadius ?? 55;
    sortSlicesInPlace(labels, values, chartProperties?.sortSlices);
    const config = {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map((_, i) => getSeriesBackgroundColor(palette, i, 0.6)),
          borderColor: labels.map((_, i) => getSeriesBorderColor(palette, i)),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: `${cutout}%`,
        plugins: {
          legend: { display: true, position: "right" },
          tooltip: { enabled: true }
        }
      },
      _width: Math.max(ctx.canvasSize.width, 300),
      _height: Math.max(ctx.canvasSize.height, 250)
    };
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "innerRadius", label: "Hole", type: "continuous", min: 20, max: 80, step: 5, defaultValue: 55 },
    {
      key: "sortSlices",
      label: "Sort slices",
      type: "discrete",
      options: [
        { value: "none", label: "Data order" },
        { value: "descending", label: "Largest first" },
        { value: "ascending", label: "Smallest first" }
      ],
      defaultValue: "none"
    }
  ]
};

// src/chartjs/templates/histogram.ts
var cjsHistogramDef = {
  chart: "Histogram",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "color", "column", "row"],
  markCognitiveChannel: "length",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xField = channelSemantics.x?.field;
    const colorField = channelSemantics.color?.field;
    if (!xField) return;
    const palette = getChartJsPalette(ctx, "color");
    const numValues = table.map((r) => Number(r[xField])).filter((v) => isFinite(v));
    if (numValues.length === 0) return;
    const binCount = chartProperties?.binCount || 10;
    const minVal = Math.min(...numValues);
    const maxVal = Math.max(...numValues);
    const range = maxVal - minVal;
    const binWidth = range > 0 ? range / binCount : 1;
    const categories = Array.from({ length: binCount }, (_, i) => {
      const lo = (minVal + i * binWidth).toFixed(1);
      const hi = (minVal + (i + 1) * binWidth).toFixed(1);
      return `${lo}\u2013${hi}`;
    });
    const config = {
      type: "bar",
      data: {
        labels: categories,
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: xField }
          },
          y: {
            title: { display: true, text: "Count" },
            beginAtZero: true
          }
        },
        plugins: {
          tooltip: { enabled: true }
        }
      }
    };
    if (!colorField) {
      const counts = new Array(binCount).fill(0);
      for (const v of numValues) {
        let idx = Math.floor((v - minVal) / binWidth);
        if (idx >= binCount) idx = binCount - 1;
        counts[idx]++;
      }
      config.data.datasets.push({
        label: "Count",
        data: counts,
        backgroundColor: getSeriesBackgroundColor(palette, 0),
        borderColor: getSeriesBorderColor(palette, 0),
        borderWidth: 1,
        barPercentage: 1,
        categoryPercentage: 1
      });
      config.options.plugins.legend = { display: false };
    } else {
      const groupValues = /* @__PURE__ */ new Map();
      for (const row of table) {
        const v = Number(row[xField]);
        if (!isFinite(v)) continue;
        const g = String(row[colorField] ?? "");
        if (!groupValues.has(g)) groupValues.set(g, []);
        groupValues.get(g).push(v);
      }
      config.options.scales.x.stacked = true;
      config.options.scales.y.stacked = true;
      let colorIdx = 0;
      for (const [name, vals] of groupValues) {
        const counts = new Array(binCount).fill(0);
        for (const v of vals) {
          let idx = Math.floor((v - minVal) / binWidth);
          if (idx >= binCount) idx = binCount - 1;
          counts[idx]++;
        }
        config.data.datasets.push({
          label: name,
          data: counts,
          backgroundColor: getSeriesBackgroundColor(palette, colorIdx),
          borderColor: getSeriesBorderColor(palette, colorIdx),
          borderWidth: 1,
          barPercentage: 1,
          categoryPercentage: 1
        });
        colorIdx++;
      }
      config.options.plugins.legend = { display: true };
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "binCount", label: "Max Bins", type: "continuous", min: 5, max: 50, step: 1, defaultValue: 0 }
  ]
};

// src/chartjs/templates/ecdf.ts
function ecdfPoints(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  const out = [];
  if (n === 0) return out;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    out.push({ x: sorted[i], y: (j + 1) / n });
    i = j + 1;
  }
  return out;
}
var cjsEcdfPlotDef = {
  chart: "ECDF Plot",
  template: { mark: "line", encoding: {} },
  channels: ["x", "color", "detail", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const xField = channelSemantics.x?.field;
    const groupField = channelSemantics.color?.field ?? channelSemantics.detail?.field;
    if (!xField) return;
    const showPoints = !!chartProperties?.showPoints;
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "line",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: xField },
            ticks: { font: { size: 10 } }
          },
          y: {
            type: "linear",
            min: 0,
            max: 1,
            title: { display: true, text: "Cumulative proportion" },
            ticks: { font: { size: 10 } }
          }
        },
        plugins: {
          tooltip: { enabled: true },
          legend: { display: false }
        }
      }
    };
    const pushDataset = (name, values, idx) => {
      config.data.datasets.push({
        label: name,
        data: ecdfPoints(values),
        borderColor: getSeriesBorderColor(palette, idx),
        backgroundColor: "transparent",
        // step-after: hold the proportion until the next value, then jump.
        stepped: "after",
        pointRadius: showPoints ? 3 : 0,
        borderWidth: 2,
        fill: false,
        tension: 0
      });
    };
    if (groupField) {
      const groups = groupBy2(table, groupField);
      config.options.plugins.legend = { display: true };
      let idx = 0;
      for (const [name, rows] of groups) {
        const values = rows.map((r) => Number(r[xField])).filter((v) => !isNaN(v));
        pushDataset(String(name), values, idx);
        idx++;
      }
    } else {
      const values = table.map((r) => Number(r[xField])).filter((v) => !isNaN(v));
      pushDataset(xField, values, 0);
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    { key: "showPoints", label: "Show points", type: "binary", defaultValue: false }
  ]
};

// src/chartjs/templates/radar.ts
var cjsRadarChartDef = {
  chart: "Radar Chart",
  template: { mark: "point", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "position",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table, chartProperties } = ctx;
    const axisField = channelSemantics.x?.field;
    const valueField = channelSemantics.y?.field;
    const groupField = channelSemantics.color?.field;
    if (!axisField || !valueField) return;
    const metrics = extractCategories2(table, axisField, channelSemantics.x?.ordinalSortOrder);
    if (metrics.length < 2) return;
    const filled = chartProperties?.filled !== false;
    const fillOpacity = chartProperties?.fillOpacity ?? 0.3;
    const palette = getChartJsPalette(ctx, "color");
    const config = {
      type: "radar",
      data: {
        labels: metrics,
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            ticks: { display: true },
            pointLabels: { display: true }
          }
        },
        plugins: {
          tooltip: { enabled: true }
        }
      },
      // Canvas size from context (no axes)
      _width: Math.max(ctx.canvasSize.width, 350),
      _height: Math.max(ctx.canvasSize.height, 300)
    };
    if (groupField) {
      const groups = groupBy2(table, groupField);
      config.options.plugins.legend = { display: true };
      let colorIdx = 0;
      for (const [name, rows] of groups) {
        const metricVals = /* @__PURE__ */ new Map();
        for (const row of rows) {
          const m = String(row[axisField]);
          const v = Number(row[valueField]) || 0;
          if (!metricVals.has(m)) metricVals.set(m, { sum: 0, count: 0 });
          const entry = metricVals.get(m);
          entry.sum += v;
          entry.count++;
        }
        const values = metrics.map((m) => {
          const entry = metricVals.get(m);
          return entry ? Math.round(entry.sum / entry.count * 100) / 100 : 0;
        });
        const borderColor = getSeriesBorderColor(palette, colorIdx);
        const bgColor = getSeriesBackgroundColor(palette, colorIdx, fillOpacity);
        config.data.datasets.push({
          label: name,
          data: values,
          borderColor,
          backgroundColor: filled ? bgColor : "transparent",
          pointBackgroundColor: borderColor,
          fill: filled
        });
        colorIdx++;
      }
    } else {
      const metricVals = /* @__PURE__ */ new Map();
      for (const row of table) {
        const m = String(row[axisField]);
        const v = Number(row[valueField]) || 0;
        if (!metricVals.has(m)) metricVals.set(m, { sum: 0, count: 0 });
        const entry = metricVals.get(m);
        entry.sum += v;
        entry.count++;
      }
      const values = metrics.map((m) => {
        const entry = metricVals.get(m);
        return entry ? Math.round(entry.sum / entry.count * 100) / 100 : 0;
      });
      config.data.datasets.push({
        label: valueField,
        data: values,
        borderColor: getSeriesBorderColor(palette, 0),
        backgroundColor: filled ? getSeriesBackgroundColor(palette, 0, fillOpacity) : "transparent",
        pointBackgroundColor: getSeriesBorderColor(palette, 0),
        fill: filled
      });
      config.options.plugins.legend = { display: false };
    }
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "filled",
      label: "Fill",
      type: "discrete",
      options: [
        { value: true, label: "Filled (default)" },
        { value: false, label: "Outline only" }
      ]
    },
    { key: "fillOpacity", label: "Opacity", type: "continuous", min: 0.05, max: 0.8, step: 0.05, defaultValue: 0.3 }
  ]
};

// src/chartjs/templates/rose.ts
var cjsRoseChartDef = {
  chart: "Rose Chart",
  template: { mark: "arc", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "area",
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const catField = channelSemantics.x?.field;
    const valField = channelSemantics.y?.field;
    const colorField = channelSemantics.color?.field;
    if (!catField || !valField) return;
    const palette = getChartJsPalette(ctx, "color");
    const categories = extractCategories2(table, catField, channelSemantics.x?.ordinalSortOrder);
    if (categories.length === 0) return;
    let labels;
    let values;
    let bgColors;
    let borderColors;
    if (colorField) {
      const groups = groupBy2(table, colorField);
      [...groups.keys()];
      const catTotals = /* @__PURE__ */ new Map();
      for (const cat of categories) catTotals.set(cat, 0);
      for (const [, rows] of groups) {
        for (const row of rows) {
          const cat = String(row[catField] ?? "");
          const val = Number(row[valField]) || 0;
          if (catTotals.has(cat)) {
            catTotals.set(cat, catTotals.get(cat) + val);
          }
        }
      }
      labels = categories;
      values = categories.map((c) => catTotals.get(c) ?? 0);
      bgColors = categories.map((_, i) => getSeriesBackgroundColor(palette, i, 0.6));
      borderColors = categories.map((_, i) => getSeriesBorderColor(palette, i));
    } else {
      const catAgg = /* @__PURE__ */ new Map();
      for (const row of table) {
        const cat = String(row[catField] ?? "");
        const val = Number(row[valField]) || 0;
        catAgg.set(cat, (catAgg.get(cat) ?? 0) + val);
      }
      labels = categories;
      values = categories.map((c) => catAgg.get(c) ?? 0);
      bgColors = categories.map((_, i) => getSeriesBackgroundColor(palette, i, 0.6));
      borderColors = categories.map((_, i) => getSeriesBorderColor(palette, i));
    }
    sortSlicesInPlace(labels, values, ctx.chartProperties?.sortSlices);
    const rawValues = values.slice();
    const radii = values.map((v) => Math.sqrt(Math.max(0, v)));
    const alignment = ctx.chartProperties?.alignment ?? "left";
    const n = categories.length;
    const startAngle = alignment === "center" && n > 0 ? -(180 / n) : 0;
    const config = {
      type: "polarArea",
      data: {
        labels,
        datasets: [{
          data: radii,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            startAngle,
            // Radii are sqrt(value); the raw tick numbers would
            // misrepresent the scale, so hide them (true values are
            // surfaced in the tooltip).
            ticks: { display: false }
          }
        },
        plugins: {
          legend: { display: true, position: "right" },
          tooltip: {
            enabled: true,
            callbacks: {
              // Radius is sqrt-transformed; report the true value.
              label: (item) => {
                const raw = rawValues[item.dataIndex];
                const shown = raw != null ? raw : item.raw;
                const name = item.label != null ? item.label : "";
                return `${name}: ${shown}`;
              }
            }
          }
        }
      },
      _width: Math.max(ctx.canvasSize.width, 350),
      _height: Math.max(ctx.canvasSize.height, 300)
    };
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  },
  properties: [
    {
      key: "alignment",
      label: "Alignment",
      type: "discrete",
      options: [
        { value: "left", label: "Left (default)" },
        { value: "center", label: "Center" }
      ]
    },
    {
      key: "sortSlices",
      label: "Sort slices",
      type: "discrete",
      options: [
        { value: "none", label: "Data order" },
        { value: "descending", label: "Largest first" },
        { value: "ascending", label: "Smallest first" }
      ],
      defaultValue: "none"
    }
  ]
};

// src/chartjs/templates/gantt.ts
function fmtDate2(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}
var cjsGanttChartDef = {
  chart: "Gantt Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["y", "x", "x2", "color", "column", "row"],
  markCognitiveChannel: "position",
  declareLayoutMode: () => ({ axisFlags: { y: { banded: true } } }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const taskField = channelSemantics.y?.field;
    const startField = channelSemantics.x?.field;
    const endField = channelSemantics.x2?.field;
    const colorField = channelSemantics.color?.field;
    if (!taskField || !startField || !endField || table.length === 0) return;
    const temporal = channelSemantics.x?.type === "temporal";
    const num = (v) => temporal ? coerceUnixMsForChartJs(v) : Number(v);
    const rows = table.map((r) => ({
      task: String(r[taskField] ?? ""),
      start: num(r[startField]),
      end: num(r[endField]),
      group: colorField != null ? String(r[colorField] ?? "") : void 0
    })).filter((r) => r.task && Number.isFinite(r.start) && Number.isFinite(r.end)).sort((a, b) => a.start - b.start);
    const groups = colorField ? Array.from(new Set(rows.map((r) => r.group ?? ""))) : [];
    const groupIndex = /* @__PURE__ */ new Map();
    groups.forEach((g, i) => groupIndex.set(g, i));
    const colorFor = (group) => {
      const i = group != null ? groupIndex.get(group) ?? 0 : 0;
      return {
        bg: DEFAULT_BG_COLORS[i % DEFAULT_BG_COLORS.length],
        border: DEFAULT_COLORS2[i % DEFAULT_COLORS2.length]
      };
    };
    const labels = rows.map((r) => r.task);
    const data = rows.map((r) => [r.start, r.end]);
    const bg = rows.map((r) => colorFor(r.group).bg);
    const border = rows.map((r) => colorFor(r.group).border);
    const config = {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: taskField,
          data,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: 1,
          borderRadius: 2,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            beginAtZero: false,
            title: { display: !temporal, text: startField },
            ...temporal ? { ticks: { callback: (v) => fmtDate2(Number(v)) } } : {}
          },
          y: { title: { display: false } }
        },
        plugins: {
          legend: colorField && groups.length > 1 ? {
            display: true,
            labels: {
              generateLabels: () => groups.map((g) => {
                const c = colorFor(g);
                return {
                  text: g,
                  fillStyle: c.bg,
                  strokeStyle: c.border,
                  lineWidth: 1
                };
              })
            }
          } : { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const [s, e] = item.raw;
                const fs = temporal ? fmtDate2(s) : s;
                const fe = temporal ? fmtDate2(e) : e;
                return `${fs} \u2192 ${fe}`;
              }
            }
          }
        }
      }
    };
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/chartjs/templates/waterfall.ts
var COLOR = {
  startEnd: { bg: "rgba(84, 112, 198, 0.65)", border: "rgba(84, 112, 198, 1)" },
  increase: { bg: "rgba(145, 204, 117, 0.65)", border: "rgba(145, 204, 117, 1)" },
  decrease: { bg: "rgba(238, 102, 102, 0.65)", border: "rgba(238, 102, 102, 1)" }
};
var cjsWaterfallChartDef = {
  chart: "Waterfall Chart",
  template: { mark: "bar", encoding: {} },
  channels: ["x", "y", "color", "column", "row"],
  markCognitiveChannel: "length",
  declareLayoutMode: () => ({ axisFlags: { x: { banded: true } } }),
  instantiate: (spec, ctx) => {
    const { channelSemantics, table } = ctx;
    const catField = channelSemantics.x?.field;
    const valField = channelSemantics.y?.field;
    const colorField = channelSemantics.color?.field;
    if (!catField || !valField || table.length === 0) return;
    const categories = extractCategories2(table, catField, channelSemantics.x?.ordinalSortOrder);
    const rows = categories.map((cat) => table.find((r) => String(r[catField]) === cat)).filter(Boolean);
    const values = rows.map((r) => Number(r[valField]) || 0);
    const totalsMode = resolveTotalsMode(values, ctx.chartProperties?.totals);
    const wantFirst = totalsMode === "first" || totalsMode === "both";
    const wantLast = totalsMode === "last" || totalsMode === "both";
    const types = colorField ? rows.map((r) => String(r[colorField] ?? "delta")) : values.map((_, i) => wantFirst && i === 0 ? "start" : wantLast && i === values.length - 1 ? "end" : "delta");
    const cumulative = [];
    let acc = 0;
    for (const v of values) {
      acc += v;
      cumulative.push(acc);
    }
    const data = [];
    const bg = [];
    const border = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const t = types[i];
      const isTotal = t === "start" || t === "end";
      const top = t === "end" ? cumulative[i] - v : cumulative[i];
      const prev = isTotal ? 0 : cumulative[i] - v;
      const lo = Math.min(prev, top);
      const hi = Math.max(prev, top);
      data.push([lo, hi]);
      const c = isTotal ? COLOR.startEnd : top >= prev ? COLOR.increase : COLOR.decrease;
      bg.push(c.bg);
      border.push(c.border);
    }
    const legendItems = [
      { text: "Start/End", color: COLOR.startEnd },
      { text: "Increase", color: COLOR.increase },
      { text: "Decrease", color: COLOR.decrease }
    ];
    const config = {
      type: "bar",
      data: {
        labels: categories,
        datasets: [{
          label: valField,
          data,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: 1,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { title: { display: true, text: catField } },
          y: { beginAtZero: true, title: { display: true, text: valField } }
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              generateLabels: () => legendItems.map((it) => ({
                text: it.text,
                fillStyle: it.color.bg,
                strokeStyle: it.color.border,
                lineWidth: 1
              }))
            }
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const [lo, hi] = item.raw;
                return `${valField}: ${Math.round((hi - lo) * 100) / 100}`;
              }
            }
          }
        }
      }
    };
    Object.assign(spec, config);
    delete spec.mark;
    delete spec.encoding;
  }
};

// src/chartjs/templates/index.ts
var cjsTemplateDefs = {
  "Scatter & Point": [cjsScatterPlotDef, cjsConnectedScatterDef, cjsBubbleChartDef, cjsStripPlotDef],
  "Bar": [cjsBarChartDef, cjsGroupedBarChartDef, cjsStackedBarChartDef, cjsComboChartDef, cjsHistogramDef, cjsWaterfallChartDef, cjsGanttChartDef],
  "Line & Area": [cjsLineChartDef, cjsSlopeChartDef, cjsAreaChartDef, cjsRangeAreaChartDef, cjsEcdfPlotDef],
  "Part-to-Whole": [cjsPieChartDef, cjsDoughnutChartDef],
  "Polar": [cjsRadarChartDef, cjsRoseChartDef]
};
var cjsAllTemplateDefs = Object.values(cjsTemplateDefs).flat();
function cjsGetTemplateDef(chartType) {
  return cjsAllTemplateDefs.find((t) => t.chart === chartType);
}
function cjsGetTemplateChannels(chartType) {
  return cjsGetTemplateDef(chartType)?.channels || [];
}

// src/chartjs/instantiate-spec.ts
function cjsApplyLayoutToSpec(config, context, warnings) {
  const { channelSemantics, layout, canvasSize } = context;
  const hasAxes = !!(config.options?.scales?.x || config.options?.scales?.y);
  config.type === "radar";
  if (hasAxes && !config._width) {
    const PADDING = 80;
    const xIsDiscrete = layout.xNominalCount > 0 || layout.xContinuousAsDiscrete > 0;
    const yIsDiscrete = layout.yNominalCount > 0 || layout.yContinuousAsDiscrete > 0;
    let plotWidth;
    let plotHeight;
    if (xIsDiscrete && layout.xStepUnit !== "group") {
      const xItemCount = layout.xNominalCount || layout.xContinuousAsDiscrete || 0;
      plotWidth = xItemCount > 0 ? layout.xStep * xItemCount : layout.subplotWidth || canvasSize.width;
    } else {
      plotWidth = layout.subplotWidth || canvasSize.width;
    }
    if (yIsDiscrete && layout.yStepUnit !== "group") {
      const yItemCount = layout.yNominalCount || layout.yContinuousAsDiscrete || 0;
      plotHeight = yItemCount > 0 ? layout.yStep * yItemCount : layout.subplotHeight || canvasSize.height;
    } else {
      plotHeight = layout.subplotHeight || canvasSize.height;
    }
    const legendGutter = cjsLegendLikelyVisible(config) ? 96 : 0;
    config._width = plotWidth + PADDING + legendGutter;
    config._height = plotHeight + PADDING;
  }
  if (config.data?.datasets) {
    const barDatasets = config.data.datasets.filter(
      (ds) => config.type === "bar" || ds.type === "bar"
    );
    if (barDatasets.length > 0 && hasAxes) {
      const bandPadding = layout.stepPadding;
      const categoryPct = 1 - bandPadding;
      for (const ds of barDatasets) {
        if (ds.categoryPercentage == null) {
          ds.categoryPercentage = categoryPct;
        }
      }
    }
  }
  if (hasAxes && config.options?.scales?.x && layout.xLabel) {
    if (!config.options.scales.x.ticks) config.options.scales.x.ticks = {};
    if (layout.xLabel.labelAngle && layout.xLabel.labelAngle !== 0) {
      config.options.scales.x.ticks.maxRotation = Math.abs(layout.xLabel.labelAngle);
      config.options.scales.x.ticks.minRotation = Math.abs(layout.xLabel.labelAngle);
    }
    if (layout.xLabel.fontSize) {
      config.options.scales.x.ticks.font = {
        ...config.options.scales.x.ticks.font || {},
        size: layout.xLabel.fontSize
      };
    }
  }
  if (hasAxes && config.options?.scales?.y && layout.yLabel) {
    if (!config.options.scales.y.ticks) config.options.scales.y.ticks = {};
    if (layout.yLabel.fontSize) {
      config.options.scales.y.ticks.font = {
        ...config.options.scales.y.ticks.font || {},
        size: layout.yLabel.fontSize
      };
    }
  }
  if (layout.truncations && layout.truncations.length > 0) {
    for (const trunc of layout.truncations) {
      warnings.push({
        severity: "warning",
        code: "overflow",
        message: trunc.message,
        channel: trunc.channel,
        field: trunc.field
      });
      if (config.data?.labels && Array.isArray(config.data.labels)) {
        config.data.labels.push(trunc.placeholder);
      }
    }
  }
  cjsApplyLegendRightColumn(config);
}
function cjsLegendLikelyVisible(config) {
  const legend = config.options?.plugins?.legend;
  if (legend?.display === false) return false;
  if (legend?.display === true) return true;
  const n = config.data?.datasets?.length ?? 0;
  return n > 1;
}
function cjsLegendEntryCount(config) {
  const t = config.type;
  if (t === "pie" || t === "doughnut") {
    return config.data?.labels?.length ?? 0;
  }
  return config.data?.datasets?.length ?? 0;
}
function cjsApplyLegendRightColumn(config) {
  if (!cjsLegendLikelyVisible(config)) return;
  if (!config.options) config.options = {};
  if (!config.options.plugins) config.options.plugins = {};
  const prev = config.options.plugins.legend ?? {};
  const prevLabels = prev.labels ?? {};
  const prevFont = prevLabels.font ?? {};
  const entryCount = cjsLegendEntryCount(config);
  const highCardinality = entryCount >= 16;
  const fontSize = prevFont.size ?? (highCardinality ? 8 : 10);
  const boxW = prevLabels.boxWidth ?? (highCardinality ? 8 : 10);
  const boxH = prevLabels.boxHeight ?? (highCardinality ? 8 : 10);
  config.options.plugins.legend = {
    ...prev,
    position: "right",
    labels: {
      ...prevLabels,
      font: {
        ...prevFont,
        size: fontSize
      },
      boxWidth: boxW,
      boxHeight: boxH
    }
  };
}
function cjsApplyTooltips(config) {
  if (!config.options) config.options = {};
  if (!config.options.plugins) config.options.plugins = {};
  if (!config.options.plugins.tooltip) {
    config.options.plugins.tooltip = { enabled: true };
  }
}

// src/chartjs/assemble.ts
function assembleChartjs(input) {
  const chartType = input.chart_spec.chartType;
  const semanticTypes = input.semantic_types ?? {};
  const sizeCeiling = input.chart_spec.canvasSize;
  const baseSize = resolveBaseSize(input.chart_spec.baseSize, sizeCeiling);
  const canvasSize = baseSize;
  const options = input.options ?? {};
  let chartTemplate = cjsGetTemplateDef(chartType);
  if (!chartTemplate) {
    throw new Error(`Unknown Chart.js chart type: ${chartType}. Use cjsAllTemplateDefs to see available types.`);
  }
  const warnings = [];
  const normalizedProps = normalizeChartProperties(
    chartTemplate.properties,
    input.chart_spec.chartProperties
  );
  const chartProperties = normalizedProps.chartProperties;
  warnings.push(...normalizedProps.warnings);
  const rawData = input.data.values ?? [];
  const normalized = normalizeStaticSeries(
    input.chart_spec.encodings,
    rawData,
    semanticTypes
  );
  let data = normalized.data;
  const staticSeries = normalized.staticSeries;
  const prelimConvertedData = convertTemporalData(data, semanticTypes);
  const prelimSemantics = resolveChannelSemantics(
    normalized.encodings,
    data,
    semanticTypes,
    prelimConvertedData
  );
  const typedRawEncodings = {};
  for (const [ch, enc] of Object.entries(normalized.encodings)) {
    typedRawEncodings[ch] = enc.type ? enc : { ...enc, type: prelimSemantics[ch]?.type };
  }
  const pivoted = applyPivot(chartTemplate, typedRawEncodings, data, chartProperties, cjsGetTemplateDef);
  if (pivoted.chartType && pivoted.chartType !== chartType) {
    const swapped = cjsGetTemplateDef(pivoted.chartType);
    if (swapped) chartTemplate = swapped;
  }
  const encodings = applyEncodingOverrides(chartTemplate, pivoted.encodings, chartProperties);
  data = applyAggregation(encodings, data);
  const tplMark = chartTemplate.template?.mark;
  const templateMarkType = typeof tplMark === "string" ? tplMark : tplMark?.type;
  const convertedData = convertTemporalData(data, semanticTypes);
  const channelSemantics = resolveChannelSemantics(
    encodings,
    data,
    semanticTypes,
    convertedData
  );
  const effectiveMarkType = templateMarkType || "point";
  for (const [channel, cs] of Object.entries(channelSemantics)) {
    if ((channel === "x" || channel === "y") && cs.type === "quantitative") {
      const numericValues = data.map((r) => r[cs.field]).filter((v) => v != null && typeof v === "number" && !isNaN(v));
      cs.zero = computeZeroDecision(
        cs.semanticAnnotation.semanticType,
        channel,
        effectiveMarkType,
        numericValues
      );
    }
  }
  const declaration = chartTemplate.declareLayoutMode ? chartTemplate.declareLayoutMode(channelSemantics, data, chartProperties) : {};
  const effectiveOptions = {
    // Chart.js fills its canvas natively — a wider default band size
    // matches its generous category spacing behavior.
    defaultBandSize: 30,
    ...options,
    ...declaration.paramOverrides || {}
  };
  Object.assign(effectiveOptions, deriveStretchCaps(baseSize, sizeCeiling, effectiveOptions));
  const {
    addTooltips: addTooltipsOpt = false
  } = effectiveOptions;
  const allMarkTypes = /* @__PURE__ */ new Set();
  if (templateMarkType) allMarkTypes.add(templateMarkType);
  const budgets = computeChannelBudgets(
    channelSemantics,
    declaration,
    convertedData,
    canvasSize,
    effectiveOptions
  );
  const facetGridResult = budgets.facetGrid;
  const overflowResult = filterOverflow(
    channelSemantics,
    declaration,
    encodings,
    convertedData,
    budgets,
    allMarkTypes
  );
  const values = overflowResult.filteredData;
  warnings.push(...overflowResult.warnings);
  const layoutResult = computeLayout(
    channelSemantics,
    declaration,
    values,
    canvasSize,
    effectiveOptions,
    facetGridResult
  );
  layoutResult.truncations = overflowResult.truncations;
  const resolvedEncodings = {};
  for (const [channel, encoding] of Object.entries(encodings)) {
    const cs = channelSemantics[channel];
    if (cs) {
      resolvedEncodings[channel] = {
        field: cs.field,
        type: cs.type,
        aggregate: encoding.aggregate
      };
    }
  }
  const instantiateContext = {
    channelSemantics,
    layout: layoutResult,
    table: values,
    fullTable: convertedData,
    resolvedEncodings,
    encodings,
    chartProperties,
    staticSeries,
    canvasSize,
    semanticTypes,
    chartType,
    assembleOptions: effectiveOptions,
    colorDecisions: decideColorMaps({
      chartType,
      encodings,
      channelSemantics,
      table: values})
  };
  const colField = channelSemantics.column?.field;
  const rowField = channelSemantics.row?.field;
  const hasFacet = !!(colField || rowField);
  const hasAxes = chartTemplate.channels.includes("x") || chartTemplate.channels.includes("y");
  let cjsConfig;
  if (hasFacet && hasAxes) {
    const colValues = colField ? [...new Set(values.map((r) => String(r[colField])))] : [""];
    const rowValues = rowField ? [...new Set(values.map((r) => String(r[rowField])))] : [""];
    const facetLegend = [];
    const yField = channelSemantics.y?.field;
    const colorField = channelSemantics.color?.field;
    let sharedYDomain;
    if (yField) {
      const nums = values.map((r) => r[yField]).filter((v) => typeof v === "number" && Number.isFinite(v));
      if (nums.length > 0) {
        const rawMin = Math.min(...nums);
        const rawMax = Math.max(...nums);
        const forceZero = !!channelSemantics.y?.zero?.zero;
        const min = forceZero ? Math.min(0, rawMin) : rawMin;
        const max = forceZero ? Math.max(0, rawMax) : rawMax;
        sharedYDomain = niceBounds2(min, max);
      }
    }
    const axisGutter = sharedYDomain ? estimateYAxisGutter(sharedYDomain) : 0;
    const maxColsPerRow = colField && !rowField ? facetGridResult?.columns ?? colValues.length : colValues.length;
    const wrapColumnOnly = !!colField && !rowField && maxColsPerRow < colValues.length;
    const gridRows = [];
    if (wrapColumnOnly) {
      for (let i = 0; i < colValues.length; i += maxColsPerRow) {
        gridRows.push(
          colValues.slice(i, i + maxColsPerRow).map((cv) => ({ colVal: cv, rowVal: "" }))
        );
      }
    } else {
      for (let ri = 0; ri < rowValues.length; ri++) {
        gridRows.push(colValues.map((cv) => ({ colVal: cv, rowVal: rowValues[ri] })));
      }
    }
    const panelRows = [];
    for (let ri = 0; ri < gridRows.length; ri++) {
      const rowPanels = [];
      const cells = gridRows[ri];
      for (let ci = 0; ci < cells.length; ci++) {
        const { colVal, rowVal } = cells[ci];
        const panelData = values.filter((r) => {
          if (colField && String(r[colField]) !== colVal) return false;
          if (rowField && String(r[rowField]) !== rowVal) return false;
          return true;
        });
        const panelConfig = structuredClone(chartTemplate.template);
        const panelContext = {
          ...instantiateContext,
          table: panelData,
          layout: layoutResult
        };
        chartTemplate.instantiate(panelConfig, panelContext);
        if (!panelConfig.options) panelConfig.options = {};
        if (!panelConfig.options.plugins) panelConfig.options.plugins = {};
        panelConfig.options.plugins.legend = {
          ...panelConfig.options.plugins.legend || {},
          display: false,
          position: "right"
        };
        cjsApplyLayoutToSpec(panelConfig, panelContext, []);
        if (addTooltipsOpt) cjsApplyTooltips(panelConfig);
        if (chartTemplate.postProcess) chartTemplate.postProcess(panelConfig, panelContext);
        if (ci > 0 && panelConfig.options?.scales?.y) {
          const yScale = panelConfig.options.scales.y;
          yScale.ticks = { ...yScale.ticks || {}, display: false };
          yScale.title = { ...yScale.title || {}, display: false };
          yScale.border = { ...yScale.border || {}, display: false };
          if (typeof panelConfig._width === "number") {
            panelConfig._width = Math.max(40, panelConfig._width - axisGutter);
          }
        }
        const xScale = panelConfig.options?.scales?.x;
        if (xScale && typeof xScale.ticks?.callback === "function") {
          xScale.ticks = { ...xScale.ticks || {}, align: "inner" };
        }
        if (facetLegend.length === 0 && colorField && Array.isArray(panelConfig.data?.datasets)) {
          for (const ds of panelConfig.data.datasets) {
            const label = String(ds?.label ?? "").trim();
            if (!label) continue;
            const color = String(ds?.borderColor ?? ds?.backgroundColor ?? "#666");
            facetLegend.push({ label, color });
          }
        }
        rowPanels.push({
          key: `${ri}:${ci}`,
          rowIndex: ri,
          colIndex: ci,
          rowHeader: rowField ? rowVal : void 0,
          colHeader: colField ? colVal : void 0,
          config: panelConfig
        });
      }
      panelRows.push(rowPanels);
    }
    cjsConfig = cjsCombineFacetPanels(
      panelRows,
      !!colField,
      !!rowField,
      sharedYDomain,
      axisGutter,
      wrapColumnOnly
    );
    cjsConfig._facetLegend = facetLegend;
  } else {
    cjsConfig = structuredClone(chartTemplate.template);
    chartTemplate.instantiate(cjsConfig, instantiateContext);
    cjsApplyLayoutToSpec(cjsConfig, instantiateContext, warnings);
    if (addTooltipsOpt) cjsApplyTooltips(cjsConfig);
    if (chartTemplate.postProcess) chartTemplate.postProcess(cjsConfig, instantiateContext);
  }
  if (warnings.length > 0) {
    cjsConfig._warnings = warnings;
  }
  cjsConfig._dataLength = values.length;
  if (pivoted.surface) {
    cjsConfig._pivot = pivoted.surface;
  }
  return cjsConfig;
}
function getChartjsPivot(input) {
  const spec = assembleChartjs(input);
  return spec && spec._pivot ? spec._pivot : void 0;
}
function niceBounds2(min, max, targetTicks = 5) {
  if (!(Number.isFinite(min) && Number.isFinite(max)) || max <= min) {
    return { min, max };
  }
  const niceNum = (range, round) => {
    const exp = Math.floor(Math.log10(range));
    const frac = range / 10 ** exp;
    let niceFrac;
    if (round) {
      niceFrac = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
    } else {
      niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
    }
    return niceFrac * 10 ** exp;
  };
  const step = niceNum(niceNum(max - min, false) / Math.max(1, targetTicks - 1), true);
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step
  };
}
function estimateYAxisGutter(domain) {
  const fmt = (v) => {
    const r = Math.round(v);
    return Math.abs(r) >= 1e3 ? r.toLocaleString() : String(r);
  };
  const chars = Math.max(fmt(domain.min).length, fmt(domain.max).length);
  return Math.ceil(chars * 6.5) + 30;
}
function cjsCombineFacetPanels(panelRows, hasColHeader, hasRowHeader, sharedYDomain, axisGutter = 0, colHeaderPerRow = false) {
  const rows = panelRows.length;
  const cols = Math.max(1, ...panelRows.map((r) => r.length));
  const ref = panelRows[0]?.[0]?.config;
  const panelH = ref?._height || 300;
  const gap = 16;
  const colHeaderH = hasColHeader ? 22 : 0;
  const rowHeaderW = hasRowHeader ? 28 : 0;
  const colWidths = Array.from(
    { length: cols },
    (_, ci) => panelRows[0]?.[ci]?.config?._width || ref?._width || 400
  );
  const totalPanelsW = colWidths.reduce((a, b) => a + b, 0);
  const headerBands = colHeaderPerRow ? rows : hasColHeader ? 1 : 0;
  return {
    _facet: true,
    _facetPanels: panelRows,
    _facetRows: rows,
    _facetCols: cols,
    _facetSharedYDomain: sharedYDomain,
    _facetAxisGutter: axisGutter,
    _facetColHeaderPerRow: colHeaderPerRow,
    _width: rowHeaderW + totalPanelsW + (cols - 1) * gap,
    _height: headerBands * colHeaderH + rows * panelH + (rows - 1) * gap
  };
}

// src/chartjs/recommendation.ts
function cjsAdaptChart(sourceType, targetType, encodings, data, semanticTypes) {
  const targetChannels = cjsGetTemplateChannels(targetType);
  return adaptChannels(sourceType, targetType, targetChannels, encodings, data, semanticTypes);
}
function cjsRecommendEncodings(chartType, data, semanticTypes) {
  const rec = recommendChannels(chartType, data, semanticTypes);
  const validChannels = cjsGetTemplateChannels(chartType);
  const result = {};
  for (const [ch, field] of Object.entries(rec)) {
    if (validChannels.includes(ch)) result[ch] = field;
  }
  return result;
}

exports.DEFAULT_GAS_PRESSURE_PARAMS = DEFAULT_GAS_PRESSURE_PARAMS;
exports.DEFAULT_NESTED_SNAP_THRESHOLD = DEFAULT_NESTED_SNAP_THRESHOLD;
exports.STATIC_SERIES_KEY_COLUMN = STATIC_SERIES_KEY_COLUMN;
exports.STATIC_SERIES_VALUE_COLUMN = STATIC_SERIES_VALUE_COLUMN;
exports.SemanticTypes = SemanticTypes;
exports.adaptChannels = adaptChannels;
exports.applyEncodingOverrides = applyEncodingOverrides;
exports.applyPivot = applyPivot;
exports.assembleChartjs = assembleChartjs;
exports.assembleECharts = assembleECharts;
exports.assembleVegaLite = assembleVegaLite;
exports.channelGroups = channelGroups;
exports.channels = channels;
exports.cjsAdaptChart = cjsAdaptChart;
exports.cjsAllTemplateDefs = cjsAllTemplateDefs;
exports.cjsApplyLayoutToSpec = cjsApplyLayoutToSpec;
exports.cjsApplyTooltips = cjsApplyTooltips;
exports.cjsGetTemplateChannels = cjsGetTemplateChannels;
exports.cjsGetTemplateDef = cjsGetTemplateDef;
exports.cjsRecommendEncodings = cjsRecommendEncodings;
exports.cjsTemplateDefs = cjsTemplateDefs;
exports.coerceEncodingValue = coerceEncodingValue;
exports.computeAxisStep = computeAxisStep;
exports.computeChannelBudgets = computeChannelBudgets;
exports.computeElasticBudget = computeElasticBudget;
exports.computeFacetLayout = computeFacetLayout;
exports.computeGasPressure = computeGasPressure;
exports.computeLabelSizing = computeLabelSizing;
exports.computeLayout = computeLayout;
exports.computeOverflow = computeOverflow;
exports.computePaddedDomain = computePaddedDomain;
exports.computePivot = computePivot;
exports.computeZeroDecision = computeZeroDecision;
exports.convertTemporalData = convertTemporalData;
exports.detectBandedAxisForceDiscrete = detectBandedAxisForceDiscrete;
exports.detectBandedAxisFromSemantics = detectBandedAxisFromSemantics;
exports.ecAdaptChart = ecAdaptChart;
exports.ecAllTemplateDefs = ecAllTemplateDefs;
exports.ecApplyLayoutToSpec = ecApplyLayoutToSpec;
exports.ecApplyTooltips = ecApplyTooltips;
exports.ecGetTemplateChannels = ecGetTemplateChannels;
exports.ecGetTemplateDef = ecGetTemplateDef;
exports.ecRecommendEncodings = ecRecommendEncodings;
exports.ecTemplateDefs = ecTemplateDefs;
exports.filterOverflow = filterOverflow;
exports.getChartOptions = getChartOptions;
exports.getChartPivot = getChartPivot;
exports.getChartjsPivot = getChartjsPivot;
exports.getEChartsPivot = getEChartsPivot;
exports.getRecommendedColorScheme = getRecommendedColorScheme;
exports.getRegistryEntry = getRegistryEntry;
exports.getVisCategory = getVisCategory;
exports.getZeroClass = getZeroClass;
exports.inferOrdinalSortOrder = inferOrdinalSortOrder;
exports.inferVisCategory = inferVisCategory;
exports.isCategoricalType = isCategoricalType;
exports.isGeoType = isGeoType;
exports.isMeasureType = isMeasureType;
exports.isOrdinalType = isOrdinalType;
exports.isTimeSeriesType = isTimeSeriesType;
exports.laneCountForMode = laneCountForMode;
exports.makeCartesianPivot = makeCartesianPivot;
exports.makeSortAction = makeSortAction;
exports.normalizeAnnotation = normalizeAnnotation;
exports.normalizeEncodingShorthand = normalizeEncodingShorthand;
exports.normalizeStaticSeries = normalizeStaticSeries;
exports.planBandDodge = planBandDodge;
exports.recommendChannels = recommendChannels;
exports.resolveAggregationDefault = resolveAggregationDefault;
exports.resolveBandDodge = resolveBandDodge;
exports.resolveBinningSuggested = resolveBinningSuggested;
exports.resolveCanonicalOrder = resolveCanonicalOrder;
exports.resolveChannelSemantics = resolveChannelSemantics;
exports.resolveColorSchemeHint = resolveColorSchemeHint;
exports.resolveCyclic = resolveCyclic;
exports.resolveDefaultVisType = resolveDefaultVisType;
exports.resolveDivergingInfo = resolveDivergingInfo;
exports.resolveDodge = resolveDodge;
exports.resolveDomainConstraint = resolveDomainConstraint;
exports.resolveEncodingType = resolveEncodingType;
exports.resolveFieldSemantics = resolveFieldSemantics;
exports.resolveFormat = resolveFormat;
exports.resolveNice = resolveNice;
exports.resolveReversed = resolveReversed;
exports.resolveScaleType = resolveScaleType;
exports.resolveSortDirection = resolveSortDirection;
exports.resolveStackable = resolveStackable;
exports.resolveTickConstraint = resolveTickConstraint;
exports.resolveZeroClassFromAnnotation = resolveZeroClassFromAnnotation;
exports.toTypeString = toTypeString;
exports.vlAdaptChart = vlAdaptChart;
exports.vlAllTemplateDefs = vlAllTemplateDefs;
exports.vlApplyLayoutToSpec = vlApplyLayoutToSpec;
exports.vlApplyTooltips = vlApplyTooltips;
exports.vlGetTemplateChannels = vlGetTemplateChannels;
exports.vlGetTemplateDef = vlGetTemplateDef;
exports.vlRecommendEncodings = vlRecommendEncodings;
exports.vlTemplateDefs = vlTemplateDefs;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map