import { g as ChartTemplateDef, d as ChartEncoding, m as EncodingActionDef, b as ChannelSemantics, S as SemanticAnnotation, z as SemanticResult, t as LayoutDeclaration, C as ChannelBudgets, w as OverflowResult, A as AssembleOptions, u as LayoutResult, J as StaticSeriesMetadata, R as RawEncodingValue, p as EncodingValue } from '../types-uaTmx_F9.js';
export { a as AxisStepDecision, c as ChartAssemblyInput, e as ChartOption, f as ChartPropertyDef, h as ChartWarning, i as ColorSchemeHint, D as DEFAULT_GAS_PRESSURE_PARAMS, j as DivergingInfo, k as DomainConstraint, E as ElasticBudget, l as ElasticStretchParams, n as EncodingShorthand, o as EncodingTypeDecision, F as FacetLayoutDecision, q as FieldSemantics, r as FormatSpec, G as GasPressureDecision, s as GasPressureParams, I as InstantiateContext, L as LabelSizingDecision, M as MarkCognitiveChannel, O as OptionEvalContext, v as OverflowDecision, x as OverflowStrategy, y as OverflowStrategyContext, P as PivotDef, B as SemanticType, H as SemanticTypes, T as TickConstraint, K as TruncationWarning, V as VisCategory, Z as ZeroClass, N as ZeroDecision, Q as channelGroups, U as channels, W as computeAxisStep, X as computeElasticBudget, Y as computeFacetLayout, _ as computeGasPressure, $ as computeLabelSizing, a0 as computeOverflow, a1 as computePaddedDomain, a2 as computeZeroDecision, a3 as getRecommendedColorScheme, a4 as getRegistryEntry, a5 as getVisCategory, a6 as getZeroClass, a7 as inferOrdinalSortOrder, a8 as inferVisCategory, a9 as isCategoricalType, aa as isGeoType, ab as isMeasureType, ac as isOrdinalType, ad as isTimeSeriesType, ae as normalizeAnnotation, af as resolveAggregationDefault, ag as resolveBinningSuggested, ah as resolveCanonicalOrder, ai as resolveColorSchemeHint, aj as resolveCyclic, ak as resolveDefaultVisType, al as resolveDivergingInfo, am as resolveDomainConstraint, an as resolveEncodingType, ao as resolveFieldSemantics, ap as resolveFormat, aq as resolveNice, ar as resolveReversed, as as resolveScaleType, at as resolveSortDirection, au as resolveStackable, av as resolveTickConstraint, aw as resolveZeroClassFromAnnotation, ax as toTypeString } from '../types-uaTmx_F9.js';
export { P as PivotComputation, a as PivotSurface, b as applyPivot, c as computePivot, m as makeCartesianPivot } from '../pivot-Bb3EKbLC.js';

/**
 * Compose a template's encoding-action overrides onto the base encodings.
 *
 * Category-B quick options (sort, color scheme, aggregate, orientation, …) are
 * stored by the host as *configuration overrides* keyed by the action's `key`
 * inside `chartProperties` — exactly like a chart property. They are NOT written
 * into the encoding map. This function is where the compiler composes them:
 * for each `encodingAction` whose override is present, it applies the action's
 * `set(encodings, value)` to produce the transformed encodings that feed the
 * rest of assembly.
 *
 * Backends call this once, at the very top of `assemble`, so every downstream
 * phase (semantic resolution → overflow → layout → instantiate) — and the
 * `InstantiateContext.encodings` handed to templates — sees the transformed
 * encodings. The base `encodings` argument is never mutated.
 *
 * An absent override (`undefined`) means "no override" and is skipped, so the
 * base encoding value (whatever the encoding shelf set, if anything) stands.
 * Because the override key matches the action key, charts saved before this
 * mechanism — which stored e.g. `chartProperties.colorScheme` directly — are
 * picked up automatically with no separate legacy fallback.
 */
declare function applyEncodingOverrides(template: ChartTemplateDef, encodings: Record<string, ChartEncoding>, chartProperties?: Record<string, any>): Record<string, ChartEncoding>;

/**
 * Reusable factories for Category-B encoding actions (see EncodingActionDef).
 *
 * These are authored once and attached to many templates, so the per-chart
 * knowledge (which channel is the category axis, which carries the measure)
 * lives in one place instead of being re-implemented per template.
 */
/** The semantic sort choices the Sort control exposes. */
type SortChoice = 'value-asc' | 'value-desc';
/**
 * Sort the category axis of a bar-like chart by the measure value.
 *
 * Encoding model: a value sort writes `sortBy = <measure channel>` (one of
 * 'x' | 'y', which the assembler understands) on the category channel.
 * "Default" clears the sort so the field's canonical ordering wins — the
 * natural order for ordinal/temporal-like categories, or alphabetic otherwise,
 * as decided by semantic resolution. The action is only applicable — and only
 * visible — when one position channel is a discrete category and the other is
 * a measure.
 *
 * @param channels Position-channel pair (default ['x', 'y']); the orientation
 *                 (which one is the category) is resolved per-encoding at runtime.
 */
declare function makeSortAction(options?: {
    key?: string;
    label?: string;
    channels?: [string, string];
}): EncodingActionDef;

type EncodingType = 'nominal' | 'ordinal' | 'quantitative' | 'temporal';
type BandedAxisResult = {
    axis: 'x' | 'y';
    resolvedTypes?: Record<string, EncodingType>;
};
/** Choose the position axis that should use banded layout. */
declare function detectBandedAxisFromSemantics(channelSemantics: Record<string, ChannelSemantics>, table: any[], options?: {
    preferAxis?: 'x' | 'y';
}): BandedAxisResult | null;
/** Choose a banded axis and force its encoding type to be discrete. */
declare function detectBandedAxisForceDiscrete(channelSemantics: Record<string, ChannelSemantics>, table: any[], options?: {
    preferAxis?: 'x' | 'y';
}): BandedAxisResult | null;

/**
 * Band-dodge decision: does a secondary discrete channel (`color`, or an explicit
 * `group` field) subdivide a categorical axis band into side-by-side sub-lanes
 * ("dodge"), or is it redundant/nested with the axis (render one full-width glyph
 * per band, "nested")?
 *
 * This is the single source of truth shared by the layout engine
 * (`compute-layout.ts`) and every backend template that dodges by color/group
 * (VL boxplot/violin/grouped-bar, ECharts, Chart.js). Keeping the decision here
 * prevents the layout and the templates from drifting apart (the class of bug
 * where the band is budgeted for a different lane count than the glyph is sized
 * for). See `design-docs/boxplot-color-dodge-heuristic.md`.
 *
 * Two independent quantities, deliberately NOT the same number:
 *   - the **gate** (`dodge`): keyed off the max per-band sub-cardinality — "does
 *     any single band actually contain more than one sub-value?"
 *   - the **lane count** (`laneCount`): the *global* distinct sub-value count,
 *     because that is what a global band-offset scale (VL `xOffset`, an ECharts
 *     series-per-group, a Chart.js dataset-per-group) physically reserves per
 *     band. Sizing a glyph by the max-per-band instead would overlap in sparse
 *     cross-products.
 */
/** Default fraction of single-valued bands above which `auto` snaps to `none`
 *  (mostly-1:1 / dirty near-1:1 data). Tunable via `planBandDodge` options. */
declare const DEFAULT_NESTED_SNAP_THRESHOLD = 0.9;
/** Resolved dodge mode (what actually renders). */
type DodgeMode = 'none' | 'local' | 'global';
/** User-facing `dodge` chart-property values (`auto` defers to the compiler). */
type DodgeOption = 'auto' | DodgeMode;
interface BandDodgePlan {
    /** Compiler's recommended default mode. */
    mode: DodgeMode;
    /** Back-compat: does the recommendation subdivide the band? (`mode !== 'none'`). */
    dodge: boolean;
    /** Lanes a *global* offset scale reserves per band = global distinct
     *  sub-values (the `global` mode lane count). */
    laneCount: number;
    /** True when a user override is worth surfacing (any real dodge choice,
     *  i.e. `maxPerBand > 1`). */
    ambiguous: boolean;
    /** Most distinct sub-values co-occurring within any single band. */
    maxPerBand: number;
    /** Global distinct sub-values. */
    global: number;
    /** Number of distinct axis bands. */
    bandCount: number;
}
interface PlanBandDodgeOptions {
    /** Fraction of single-valued bands above which `auto` snaps to `none`.
     *  Defaults to {@link DEFAULT_NESTED_SNAP_THRESHOLD}. */
    nestedSnapThreshold?: number;
}
/**
 * Decide whether `subField` dodges `axisField` for the given data.
 *
 * Confident zones (never ambiguous):
 *   - `maxPerBand <= 1`  → nested (redundant/nested with the axis; `color == x`
 *     or a 1:1 different-field pair).
 *   - `maxPerBand === global` → dodge (clean full cross-product).
 * Ambiguous zone (`1 < maxPerBand < global`, e.g. sparse cross-products or dirty
 * near-1:1 data): the `auto` lean is resolved by a configurable threshold on the
 * fraction of single-valued bands, and `ambiguous` is set so a host can surface
 * the toggle.
 */
declare function planBandDodge(table: ReadonlyArray<Record<string, unknown>>, axisField: string, subField: string, options?: PlanBandDodgeOptions): BandDodgePlan;
/** Number of sub-lanes a resolved mode reserves per band. */
declare function laneCountForMode(plan: BandDodgePlan, mode: DodgeMode): number;
/**
 * Apply a user `dodge` override on top of a plan. `none`/`local`/`global` are
 * hard overrides; `auto` (or unset) follows the compiler recommendation. A dodge
 * mode is downgraded to `none` when nothing actually subdivides a band
 * (`maxPerBand <= 1`), so forcing dodge on redundant color can't collapse it.
 */
declare function resolveDodge(plan: BandDodgePlan, override?: string): {
    mode: DodgeMode;
    laneCount: number;
};
/** @deprecated user-facing values; prefer {@link DodgeOption}. */
type ColorLayoutMode = DodgeOption;
/** @deprecated prefer {@link resolveDodge}. Maps the mode to a dodge boolean and
 *  the global lane count (the only lane count the current renderers support). */
declare function resolveBandDodge(plan: BandDodgePlan, override?: string): {
    dodge: boolean;
    laneCount: number;
};

/**
 * =============================================================================
 * CHANNEL SEMANTICS RESOLVER
 * =============================================================================
 *
 * Stage 2 of the semantic pipeline:
 *   SemanticAnnotation + data → FieldSemantics → **ChannelSemantics**
 *
 * Takes each channel’s field, builds FieldSemantics (stage 1), then adds
 * channel-specific visualization decisions: encoding type, color scheme,
 * temporal format, ordinal sort, tick constraints, axis reversal, nice
 * rounding, interpolation, and stacking.
 *
 * Zero-baseline is NOT resolved here — it requires template mark knowledge
 * and is finalized by the assembler after this function returns.
 *
 * VL dependency: **None**
 * =============================================================================
 */

/**
 * Convert temporal field values in the data table to canonical string
 * representations for Vega-Lite consumption.
 *
 * This is a data-level concern (not VL-specific) — it ensures consistent
 * date parsing across backends.
 */
declare function convertTemporalData(data: any[], semanticTypes: Record<string, string | SemanticAnnotation>): any[];
/**
 * Resolve all channel-level semantic decisions.
 *
 * For each channel, builds FieldSemantics (data identity) then layers on
 * channel-specific visualization decisions (color scheme, temporal format,
 * tick constraints, axis reversal, interpolation, etc.).
 *
 * Zero-baseline (cs.zero) is NOT resolved here -- it requires template
 * mark knowledge (bar vs point) that belongs to the assembler.
 * The assembler finalizes zero after calling this function.
 *
 * @param encodings       Channel -> ChartEncoding from user / AI agent
 * @param data            Array of data rows (original, unconverted)
 * @param semanticTypes   Field name -> semantic type string
 * @param convertedData   Pre-converted temporal data (from convertTemporalData).
 *                        If omitted, falls back to data for temporal format detection.
 */
declare function resolveChannelSemantics(encodings: Record<string, ChartEncoding>, data: any[], semanticTypes: Record<string, string | SemanticAnnotation>, convertedData?: any[]): SemanticResult;

/**
 * =============================================================================
 * OVERFLOW FILTERING
 * =============================================================================
 *
 * Decides *which* discrete values to keep when there are too many for
 * the available canvas space, then filters the data accordingly.
 *
 * This module does **no layout math**.  Per-channel capacity budgets
 * are computed upstream by `computeChannelBudgets` and passed in as
 * a `ChannelBudgets` object.  This module focuses on:
 *   1. Iterating each discrete channel
 *   2. Applying the overflow strategy (which values to keep)
 *   3. Filtering data rows
 *   4. Producing truncation warnings
 *
 * Runs AFTER computeChannelBudgets and BEFORE computeLayout.
 *
 * VL dependency: **None**
 * =============================================================================
 */

/**
 * Filter data to keep only the values that fit within the canvas.
 *
 * @param channelSemantics  Phase 0 output (field, type per channel)
 * @param declaration       Template layout declaration (resolvedTypes, overflowStrategy)
 * @param encodings         Original user-level encodings (for sort info)
 * @param data              Full data table
 * @param budgets           Per-channel capacity budgets from computeChannelBudgets
 * @param allMarkTypes      Set of all mark types in the template (for connected-mark detection)
 * @returns                 OverflowResult with filtered data, nominal counts, truncations, and warnings
 */
declare function filterOverflow(channelSemantics: Record<string, ChannelSemantics>, declaration: LayoutDeclaration, encodings: Record<string, ChartEncoding>, data: any[], budgets: ChannelBudgets, allMarkTypes: Set<string>): OverflowResult;

/**
 * Phase 1: Compute layout decisions.
 *
 * Takes channel semantics, template layout declaration, data, canvas size,
 * and assembly options to produce a LayoutResult with step sizes, subplot
 * dimensions, label sizing, and truncation warnings.
 *
 * VL dependency: **None**
 *
 * @param channelSemantics   Phase 0 output
 * @param declaration        Template's layout declaration (axisFlags, resolvedTypes,
 *                           grouping, binnedAxes)
 * @param table              Data rows (post-overflow filtered)
 * @param canvasSize         Target canvas dimensions
 * @param options            Assembly options (merged with template overrides)
 * @param facetGrid          Optional pre-decided facet grid from computeFacetGrid.
 *                           When provided, computeLayout uses these column/row
 *                           counts instead of counting from data — this
 *                           eliminates the circularity between wrapping and
 *                           banded axis sizing.
 */
declare function computeLayout(channelSemantics: Record<string, ChannelSemantics>, declaration: LayoutDeclaration, table: any[], canvasSize: {
    width: number;
    height: number;
}, options?: AssembleOptions, facetGrid?: {
    columns: number;
    rows: number;
}): LayoutResult;
/**
 * Compute per-channel maximum values that can fit on the canvas.
 *
 * Uses the **most conservative** assumptions:
 *   - minStep  (smallest px per discrete item)
 *   - minSubplotSize (smallest subplot for continuous axes)
 *   - maxStretch (maximum canvas stretching)
 *
 * This is Step 0c-a in the pipeline — it runs before filterOverflow
 * and produces the budgets that filterOverflow consumes.
 *
 * Pipeline:  computeChannelBudgets → filterOverflow → computeLayout
 *
 * @param channelSemantics  Phase 0 output (field, type per channel)
 * @param declaration       Template layout declaration
 * @param data              Full data table (pre-overflow)
 * @param canvasSize        Target canvas dimensions
 * @param options           Assembly options
 * @returns                 ChannelBudgets with per-channel max-to-keep
 */
declare function computeChannelBudgets(channelSemantics: Record<string, ChannelSemantics>, declaration: LayoutDeclaration, data: any[], canvasSize: {
    width: number;
    height: number;
}, options: AssembleOptions): ChannelBudgets;

/**
 * Static Series Normalization
 *
 * Detects array-valued encodings (static series) in the input spec,
 * validates them, and folds (unpivots) the data into long form so
 * the rest of the pipeline can process it as a standard single-field
 * encoding with a color discriminator.
 *
 * This runs BEFORE Phase 0 (resolveChannelSemantics).
 */

/** Synthetic column names injected by the fold transform */
declare const STATIC_SERIES_KEY_COLUMN = "__flint_series_key";
declare const STATIC_SERIES_VALUE_COLUMN = "__flint_series_value";
/**
 * Expand the bare-string channel shorthand into a full encoding object.
 *
 * `"weight"` → `{ field: "weight" }`. Array entries (static series) are
 * expanded element-by-element, so `["a", "b"]` → `[{ field: "a" }, { field: "b" }]`.
 * Non-string values pass through unchanged.
 */
declare function coerceEncodingValue(value: RawEncodingValue): EncodingValue;
/** Normalize a raw channel→value map, expanding any bare-string shorthands. */
declare function normalizeEncodingShorthand(encodings: Record<string, RawEncodingValue>): Record<string, EncodingValue>;
/**
 * Result of normalizing static series from the input spec.
 */
interface NormalizeStaticSeriesResult {
    /** Normalized encodings (all single-valued) */
    encodings: Record<string, ChartEncoding>;
    /** Folded data (or original if no static series detected) */
    data: any[];
    /** Static series metadata (present only when fold was applied) */
    staticSeries?: StaticSeriesMetadata;
}
/**
 * Detect, validate, and normalize static series (array-valued encodings).
 *
 * If no array-valued encodings are present, returns the input unchanged.
 * If one is found, validates constraints and returns folded data +
 * rewritten encodings.
 *
 * @throws Error if validation fails (non-quantitative field, conflicting
 *         color binding, multiple array channels, etc.)
 */
declare function normalizeStaticSeries(rawEncodings: Record<string, RawEncodingValue>, data: any[], semanticTypes: Record<string, string | SemanticAnnotation>): NormalizeStaticSeriesResult;

/**
 * Semantic role of a channel within a specific chart type.
 */
type SemanticRole = 'category' | 'measure' | 'measure2' | 'series' | 'facetCol' | 'facetRow' | 'auxiliary' | 'geo' | 'price';
/**
 * Adapt encoding channels from one chart type to another.
 *
 * When `data` is provided, uses **recommendation-based adaptation**: re-runs
 * the recommendation engine with a strong preference for the currently-assigned
 * fields, letting the target chart's field-type preferences take effect
 * (e.g. Line Chart prefers temporal on x).  Remaining empty channels are
 * optionally filled from all available fields.
 *
 * When no data is provided, falls back to **structural role-based** adaptation
 * (pure channel remapping by semantic role).
 *
 * @param sourceType      The current chart type name (e.g. "Bar Chart")
 * @param targetType      The target chart type name (e.g. "Pie Chart")
 * @param targetChannels  Available channels on the target template
 * @param encodings       Current channel→fieldName map (only filled channels)
 * @param data            (optional) Array of data row objects
 * @param semanticTypes   (optional) Field→semantic-type map
 * @returns               New channel→fieldName map for the target
 */
declare function adaptChannels(sourceType: string, targetType: string, targetChannels: string[], encodings: Record<string, string>, data?: any[], semanticTypes?: Record<string, string>, recommendFn?: RecommendFn): Record<string, string>;
interface InternalTableView {
    names: string[];
    fieldType: Record<string, string>;
    fieldSemanticType: Record<string, string>;
    fieldLevels: Record<string, any[]>;
    rows: any[];
    /** Fields the user has already assigned — preferred during pick(). */
    preferredFields?: Set<string>;
}
/**
 * Recommendation function signature — used to inject backend-specific
 * chart type handlers into adaptViaRecommendation.
 */
type RecommendFn = (chartType: string, tv: InternalTableView) => Record<string, string>;
/**
 * Recommend channel→fieldName assignments for a given chart type.
 *
 * Pure logic: takes raw data rows + semantic type annotations, returns
 * a channel→fieldName map.  Backend wrappers filter to valid channels.
 *
 * @param chartType      Chart template name (e.g. "Bar Chart")
 * @param data           Array of row objects
 * @param semanticTypes  Field→semantic-type map (e.g. { weight: "Quantity" })
 * @returns              channel→fieldName map
 */
declare function recommendChannels(chartType: string, data: any[], semanticTypes: Record<string, string>, recommendFn?: RecommendFn): Record<string, string>;

export { AssembleOptions, type BandDodgePlan, ChannelBudgets, ChannelSemantics, ChartEncoding, ChartTemplateDef, type ColorLayoutMode, DEFAULT_NESTED_SNAP_THRESHOLD, type DodgeMode, type DodgeOption, EncodingActionDef, EncodingValue, LayoutDeclaration, LayoutResult, type NormalizeStaticSeriesResult, OverflowResult, type PlanBandDodgeOptions, RawEncodingValue, STATIC_SERIES_KEY_COLUMN, STATIC_SERIES_VALUE_COLUMN, SemanticAnnotation, SemanticResult, type SemanticRole, type SortChoice, StaticSeriesMetadata, adaptChannels, applyEncodingOverrides, coerceEncodingValue, computeChannelBudgets, computeLayout, convertTemporalData, detectBandedAxisForceDiscrete, detectBandedAxisFromSemantics, filterOverflow, laneCountForMode, makeSortAction, normalizeEncodingShorthand, normalizeStaticSeries, planBandDodge, recommendChannels, resolveBandDodge, resolveChannelSemantics, resolveDodge };
