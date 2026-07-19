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
  const isDiscreteType = (t) => t === "nominal" || t === "ordinal";
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
    if (!isDiscreteType(type)) {
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
var DEFAULT_MAX_STRETCH = 1.5;
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
  const isDiscreteType = (t) => t === "nominal" || t === "ordinal";
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
    if (!isDiscreteType(effectiveType)) continue;
    const uniqueValues = [...new Set(table.map((r) => r[cs.field]))];
    nominalCount[channel] = uniqueValues.length;
  }
  let groupField = channelSemantics.group?.field;
  if (!groupField && declaration.colorActsAsGroup) {
    const colorCS = channelSemantics.color;
    const colorType = effectiveTypes.color ?? colorCS?.type;
    const axisField = isDiscreteType(effectiveTypes.x ?? channelSemantics.x?.type) ? channelSemantics.x?.field : channelSemantics.y?.field;
    if (colorCS?.field && isDiscreteType(colorType) && colorCS.field !== axisField) {
      groupField = colorCS.field;
    }
  }
  if (groupField) {
    const groupAxisField = isDiscreteType(effectiveTypes.x ?? channelSemantics.x?.type) ? channelSemantics.x?.field : channelSemantics.y?.field;
    if (groupAxisField === groupField) {
      groupField = void 0;
    } else if (groupAxisField && planBandDodge(table, groupAxisField, groupField).maxPerBand <= 1) {
      groupField = void 0;
    }
  }
  let groupAxis;
  if (groupField) {
    nominalCount.group = declaration.groupLaneCount ?? new Set(table.map((r) => r[groupField])).size;
    if (isDiscreteType(effectiveTypes.x ?? channelSemantics.x?.type)) groupAxis = "x";
    else if (isDiscreteType(effectiveTypes.y ?? channelSemantics.y?.type)) groupAxis = "y";
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
    if (isDiscreteType(effectiveType)) continue;
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
    const median = absSlopes.length % 2 === 1 ? absSlopes[mid] : (absSlopes[mid - 1] + absSlopes[mid]) / 2;
    if (median > 0) {
      scaleMedians.push(median);
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
  const isDiscreteType = (t) => t === "nominal" || t === "ordinal";
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
    if (isDiscreteType(effectiveType("x"))) groupAxis = "x";
    else if (isDiscreteType(effectiveType("y"))) groupAxis = "y";
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
  const isDiscreteType = (t) => t === "nominal" || t === "ordinal";
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
    if (isDiscreteType(xType)) groupAxis = "x";
    else if (isDiscreteType(yType)) groupAxis = "y";
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
    if (!isDiscreteType(effectiveType) && !isBanded) continue;
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
    return !isDiscreteType(t) && !(declaration.axisFlags?.x?.banded === true);
  })();
  const yIsCont = (() => {
    const cs = channelSemantics.y;
    if (!cs?.field) return false;
    const t = declaration.resolvedTypes?.y ?? cs.type;
    return !isDiscreteType(t) && !(declaration.axisFlags?.y?.banded === true);
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

export { DEFAULT_GAS_PRESSURE_PARAMS, DEFAULT_NESTED_SNAP_THRESHOLD, STATIC_SERIES_KEY_COLUMN, STATIC_SERIES_VALUE_COLUMN, SemanticTypes, adaptChannels, applyEncodingOverrides, applyPivot, channelGroups, channels, coerceEncodingValue, computeAxisStep, computeChannelBudgets, computeElasticBudget, computeFacetLayout, computeGasPressure, computeLabelSizing, computeLayout, computeOverflow, computePaddedDomain, computePivot, computeZeroDecision, convertTemporalData, detectBandedAxisForceDiscrete, detectBandedAxisFromSemantics, filterOverflow, getRecommendedColorScheme, getRegistryEntry, getVisCategory, getZeroClass, inferOrdinalSortOrder, inferVisCategory, isCategoricalType, isGeoType, isMeasureType, isOrdinalType, isTimeSeriesType, laneCountForMode, makeCartesianPivot, makeSortAction, normalizeAnnotation, normalizeEncodingShorthand, normalizeStaticSeries, planBandDodge, recommendChannels, resolveAggregationDefault, resolveBandDodge, resolveBinningSuggested, resolveCanonicalOrder, resolveChannelSemantics, resolveColorSchemeHint, resolveCyclic, resolveDefaultVisType, resolveDivergingInfo, resolveDodge, resolveDomainConstraint, resolveEncodingType, resolveFieldSemantics, resolveFormat, resolveNice, resolveReversed, resolveScaleType, resolveSortDirection, resolveStackable, resolveTickConstraint, resolveZeroClassFromAnnotation, toTypeString };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map