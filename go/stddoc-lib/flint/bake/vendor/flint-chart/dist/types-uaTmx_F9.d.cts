/**
 * =============================================================================
 * TYPE REGISTRY — Single Source of Truth
 * =============================================================================
 *
 * Every recognized semantic type is registered here with its orthogonal
 * compilation dimensions. This is the ONLY place where per-type properties
 * are defined. All other files (field-semantics.ts, semantic-types.ts)
 * derive helper functions by querying this registry.
 *
 * To add a new semantic type: add an entry here.
 * To query a type's properties: use `getRegistryEntry()`.
 * =============================================================================
 */
type VisCategory = 'quantitative' | 'ordinal' | 'nominal' | 'temporal' | 'geographic';
/** Top-level type family */
type T0Family = 'Temporal' | 'Measure' | 'Discrete' | 'Geographic' | 'Categorical' | 'Identifier';
/** Mid-level category within a family */
type T1Category = 'DateTime' | 'DateGranule' | 'Duration' | 'Amount' | 'Physical' | 'Proportion' | 'SignedMeasure' | 'GenericMeasure' | 'Rank' | 'Score' | 'GeoCoordinate' | 'GeoPlace' | 'Entity' | 'Coded' | 'Binned' | 'ID';
type DomainShape = 'open' | 'bounded' | 'fixed' | 'cyclic';
type AggRole = 'additive' | 'intensive' | 'signed-additive' | 'dimension' | 'identifier';
type DivergingClass = 'none' | 'inherent' | 'conditional';
type FormatClass = 'currency' | 'percent' | 'unit-suffix' | 'integer' | 'decimal' | 'plain';
/**
 * Zero-baseline classification for quantitative axes.
 *
 * - `meaningful`: 0 = absence of the measured thing; axis should include 0 (Count, Revenue).
 * - `arbitrary`:  0 is arbitrary or nonexistent; data-fit the axis (Temperature, Year, Rank).
 * - `contextual`: 0 is meaningful but data-fitting may be better when data is far from 0 (Percentage, Score).
 * - `none`:       Not a quantitative type; zero question is irrelevant (all categorical/temporal types).
 */
type ZeroBaseline = 'meaningful' | 'arbitrary' | 'contextual' | 'none';
interface TypeRegistryEntry {
    t0: T0Family;
    t1: T1Category;
    visEncodings: VisCategory[];
    aggRole: AggRole;
    domainShape: DomainShape;
    diverging: DivergingClass;
    formatClass: FormatClass;
    /** Zero-baseline classification for quantitative axes */
    zeroBaseline: ZeroBaseline;
    /** Domain padding fraction for non-zero axes (0 = no padding) */
    zeroPad: number;
}
/** Look up a semantic type in the registry. Falls back to UNKNOWN_ENTRY. */
declare function getRegistryEntry(semanticType: string): TypeRegistryEntry;

/**
 * =============================================================================
 * SEMANTIC TYPE SYSTEM
 * =============================================================================
 *
 * Semantic types classify data fields for intelligent chart recommendations.
 * Uses strings for flexibility and easy JSON serialization.
 *
 * DESIGN GOALS:
 * 1. Comprehensive: Cover common data types seen in real-world datasets
 * 2. Visualization-aware: Map to Vega-Lite encoding types (Q, O, N, T)
 * 3. Hierarchical: Support generalization via lattice structure
 * 4. Simple: Use strings with helper functions, no complex enums
 *
 * =============================================================================
 * SEMANTIC TYPE LATTICE
 * =============================================================================
 *
 *                           ┌─────────────┐
 *                           │   AnyType   │
 *                           └──────┬──────┘
 *            ┌────────────────────┼────────────────────┐
 *            ▼                    ▼                    ▼
 *     ┌──────────┐         ┌──────────┐         ┌───────-───┐
 *     │ Temporal │         │ Numeric  │         │Categorical│
 *     └────┬─────┘         └────┬─────┘         └─────┬────┘
 *          │                    │                     │
 *    ┌─────┴─────┐        ┌─────┴─────┐         ┌─────┴─────┐
 *    │           │        │           │         │           │
 *  DateTime     Granule    Measure   Discrete    Entity     Coded
 *    │           │        │           │         │           │
 * DateTime    Year     Quantity    Rank      Category   Status
 * Date        Month    Count       Score     Name       Boolean
 * Time        Day      Price       ID                   Direction
 *             Quarter  Percentage
 *             Decade   Amount
 *                      Temperature
 *
 * =============================================================================
 */
/**
 * All recognized semantic types.
 * Use these constants when comparing or assigning types.
 */
declare const SemanticTypes: {
    readonly DateTime: "DateTime";
    readonly Date: "Date";
    readonly Time: "Time";
    readonly Timestamp: "Timestamp";
    readonly Year: "Year";
    readonly Quarter: "Quarter";
    readonly Month: "Month";
    readonly Week: "Week";
    readonly Day: "Day";
    readonly Hour: "Hour";
    readonly YearMonth: "YearMonth";
    readonly YearQuarter: "YearQuarter";
    readonly YearWeek: "YearWeek";
    readonly Decade: "Decade";
    readonly Duration: "Duration";
    readonly Quantity: "Quantity";
    readonly Count: "Count";
    readonly Amount: "Amount";
    readonly Price: "Price";
    readonly Percentage: "Percentage";
    readonly Temperature: "Temperature";
    readonly Profit: "Profit";
    readonly PercentageChange: "PercentageChange";
    readonly Sentiment: "Sentiment";
    readonly Correlation: "Correlation";
    readonly Rank: "Rank";
    readonly ID: "ID";
    readonly Score: "Score";
    readonly Latitude: "Latitude";
    readonly Longitude: "Longitude";
    readonly Country: "Country";
    readonly State: "State";
    readonly City: "City";
    readonly Region: "Region";
    readonly Address: "Address";
    readonly ZipCode: "ZipCode";
    readonly Category: "Category";
    readonly Name: "Name";
    readonly Status: "Status";
    readonly Boolean: "Boolean";
    readonly Direction: "Direction";
    readonly Range: "Range";
    readonly Number: "Number";
    readonly Unknown: "Unknown";
};
type SemanticType = typeof SemanticTypes[keyof typeof SemanticTypes];
/**
 * Get the Vega-Lite visualization category for a semantic type.
 * Derived from the registry's visEncodings[0] (primary encoding).
 * Returns null for unrecognised types so callers can fall back
 * to data-driven inference.
 */
declare function getVisCategory(semanticType: string): VisCategory | null;
/**
 * Infer a VisCategory from raw data values when no semantic type is available.
 * Mirrors the DataType → VL encoding type mapping:
 *   number/integer → quantitative, boolean → nominal, date → temporal, string → nominal.
 */
declare function inferVisCategory(values: any[]): VisCategory;
/**
 * Check if a semantic type is a true measure (suitable for quantitative encoding).
 */
declare function isMeasureType(semanticType: string): boolean;
/**
 * Check if a semantic type is suitable for time-series X axis.
 * Derived from type-registry: t0 === 'Temporal' but not Duration.
 */
declare function isTimeSeriesType(semanticType: string): boolean;
/**
 * Check if a semantic type is categorical (suitable for color/grouping).
 */
declare function isCategoricalType(semanticType: string): boolean;
/**
 * Check if a semantic type is ordinal (has inherent order).
 */
declare function isOrdinalType(semanticType: string): boolean;
/**
 * Check if a semantic type is geographic.
 * Derived from type-registry: t0 === 'Geographic'.
 */
declare function isGeoType(semanticType: string): boolean;
/**
 * Classification of whether zero is a meaningful baseline for a semantic type.
 *
 * - `meaningful`: 0 has a real-world interpretation (absence of the measured thing).
 *   Comparisons to zero and ratios between values are meaningful.
 *   Examples: Count, Revenue, Distance, Weight.
 *
 * - `arbitrary`: 0 is either meaningless, doesn't exist, or is an arbitrary
 *   reference point. The data's range is what matters.
 *   Examples: Temperature (0°F is arbitrary), Year (year 0 doesn't exist),
 *   Rank (0th place doesn't exist).
 *
 * - `contextual`: 0 is meaningful but data-fitting may be better when data
 *   is concentrated far from zero and the mark is not bar/area.
 *   Examples: Percentage (0–100% natural, but 48–52% benefits from zoom),
 *   Score (1–5 scale, but 4.2–4.8 benefits from zoom).
 */
type ZeroClass = 'meaningful' | 'arbitrary' | 'contextual';
/**
 * Result of the zero-baseline decision.
 * Encapsulates both the boolean decision and domain padding for non-zero axes.
 */
interface ZeroDecision {
    /** Whether the axis should include zero */
    zero: boolean;
    /**
     * For non-zero axes: fraction of data range to pad on each side
     * so edge values aren't crushed against the axis boundary.
     * e.g. 0.05 = 5% padding on each side.
     */
    domainPadFraction: number;
    /** The zero class that drove this decision */
    zeroClass: ZeroClass | 'unknown';
    /**
     * Whether this is a *forced* (non-debatable) decision:
     *   - `true`  → mandatory: a length/area mark, data that crosses zero, or a
     *     zero-meaningful type on a length mark. Including zero is structural.
     *   - `false` → the engine still has a recommended `zero`, but anchoring at
     *     zero is at least conceptually a choice.
     * `forced` records the structural side of the decision; it is NOT the gate
     * for the UI toggle — see `uncertain` below.
     */
    forced: boolean;
    /**
     * Whether the zero-vs-fit choice is a *genuine toss-up worth surfacing* to
     * the user. Hosts read this (via the property `check`) to decide whether to
     * show the "Zero X/Y" toggle at all.
     *
     * We deliberately keep this narrow to avoid UI clutter: it is `true` ONLY
     * for a zero-meaningful field on a position mark whose data sits far enough
     * from zero that anchoring at zero would noticeably compress the view (a
     * real zoom-in-vs-anchor tradeoff). Every other case — arbitrary types
     * (zero is meaningless, just fit the data), contextual types (the engine's
     * data-range call is confident enough), meaningful types whose data already
     * spans most of the way to zero (the choice barely changes anything), and
     * all forced/unknown cases — is `false`, so no toggle is shown and the
     * engine's `zero` value simply applies. The engine's `zero` remains the
     * recommended default when the toggle is shown.
     */
    uncertain: boolean;
}
/**
 * Classify a semantic type's relationship to zero.
 * Derived from the registry's zeroBaseline dimension.
 */
declare function getZeroClass(semanticType: string): ZeroClass | 'unknown';
declare function computeZeroDecision(semanticType: string, channel: string, markType: string, values?: number[]): ZeroDecision;
/**
 * Compute padded domain bounds for a non-zero axis.
 * Pure computation — returns [paddedMin, paddedMax] without modifying any spec.
 *
 * @param values         Numeric data values
 * @param padFraction    Fraction of data range to pad on each side
 * @returns              [paddedMin, paddedMax] or null if padding is not applicable
 */
declare function computePaddedDomain(values: number[], padFraction: number): [number, number] | null;
type ColorSchemeType = 'categorical' | 'sequential' | 'diverging';
interface ColorSchemeRecommendation {
    scheme: string;
    type: ColorSchemeType;
    reason: string;
    /** For diverging schemes, the recommended midpoint value */
    domainMid?: number;
}
/**
 * Get recommended color scheme based on semantic type and encoding context.
 *
 * @param semanticType - The semantic type of the field
 * @param encodingType - The Vega-Lite encoding type ('nominal', 'ordinal', 'quantitative')
 * @param uniqueValueCount - Number of unique values (for categorical sizing)
 * @param fieldName - Field name (for consistent hashing)
 * @param values - Optional actual data values (for inspecting data range)
 * @param colorHint - Optional classification from resolveColorSchemeHint().
 *        When provided, the hint's type ('diverging'|'sequential'|'categorical')
 *        overrides inline detection, avoiding duplicate diverging logic.
 */
declare function getRecommendedColorScheme(semanticType: string | undefined, encodingType: 'nominal' | 'ordinal' | 'quantitative' | 'temporal', uniqueValueCount?: number, fieldName?: string, values?: any[], colorHint?: {
    type: 'categorical' | 'sequential' | 'diverging';
}): ColorSchemeRecommendation;
/**
 * Infer a canonical ordinal sort order for a field based on its semantic type
 * and data values.
 *
 * Works for:
 * - Month names (full/abbreviated/numeric): Jan, Feb, ... or January, February, ...
 * - Day-of-week names (full/abbreviated): Mon, Tue, ... or Monday, Tuesday, ...
 * - Quarter labels: Q1, Q2, Q3, Q4
 *
 * Falls back to `undefined` if no known sequence is detected, letting the
 * caller use its own default sort logic.
 *
 * @param semanticType  The semantic type of the field (e.g. 'Month', 'Day')
 * @param values        The data values on this channel
 * @returns Sorted unique values in canonical order, or undefined
 */
declare function inferOrdinalSortOrder(semanticType: string, values: any[]): string[] | undefined;

/**
 * =============================================================================
 * REUSABLE DECISION LOGIC
 * =============================================================================
 *
 * Pure decision functions that determine chart layout behavior.
 * These functions take data/config inputs and return decision objects —
 * NO Vega-Lite spec mutation happens here.
 *
 * The separation ensures:
 * 1. Decision logic is testable in isolation
 * 2. Same decisions can drive different output formats (VL, SVG, etc.)
 * 3. Templates can call decision functions without coupling to VL
 *
 * Naming conventions:
 *   - `compute*()` — returns a decision/value from inputs
 *   - `resolve*()` — picks from alternatives (type resolution, etc.)
 *   - `classify*()` — categorizes an input
 * =============================================================================
 */

/**
 * Result of encoding type resolution.
 * Separates the decision from what gets written into VL.
 */
interface EncodingTypeDecision {
    /** The resolved VL encoding type */
    vlType: 'quantitative' | 'ordinal' | 'nominal' | 'temporal';
    /** The VisCategory that drove the decision */
    visCategory: VisCategory;
    /** Whether the type was overridden by channel rules */
    channelOverride: boolean;
    /** Whether the type was overridden by cardinality/fraction guard */
    cardinalityGuard: boolean;
}
/**
 * Resolve the VL encoding type for a field.
 *
 * Two-stage pipeline:
 *
 * **Stage 1 — Registry-driven** (when semanticType is registered):
 *   - Single visEncoding  → use it directly (with channel adjustments)
 *   - Multiple visEncodings → `disambiguateMultiEncoding()` selects best
 *     option using channel context + data characteristics
 *
 * **Stage 2 — Data-inferred fallback** (no registered semantic type):
 *   - `inferVisCategory()` inspects raw values → VisCategory
 *   - Heuristic guards catch common mis-classifications (e.g., dense
 *     fractional data inferred as ordinal)
 *
 * This is a pure decision — it does NOT mutate any spec.
 *
 * @param semanticType   Semantic type string (e.g. 'Quantity', 'Country')
 * @param fieldValues    Sampled values from the field
 * @param channel        VL channel name (e.g. 'x', 'y', 'color')
 * @param data           Full data table (for computing unique value counts)
 * @param fieldName      Field name (for data lookups)
 */
declare function resolveEncodingType(semanticType: string, fieldValues: any[], channel: string, data: any[], fieldName: string): EncodingTypeDecision;
/**
 * Parameters for the per-axis stretch model (docs/design-stretch-model.md §2).
 *
 * Each axis is stretched independently based on how many distinguishable
 * positions (or series) compete for pixel space along that axis.
 */
interface GasPressureParams {
    /** Mark cross-section in px² — used as default σ for both axes (default: 30) */
    markCrossSection: number;
    /** Per-axis cross-section overrides. When set, the per-axis stretch
     *  uses these instead of `markCrossSection`.
     *  Useful for line charts where X needs more stretch than Y. */
    markCrossSectionX?: number;
    markCrossSectionY?: number;
    /** Override X item count for stretch.
     *  When set, X stretch uses this count (e.g. number of series)
     *  instead of counting unique X pixel positions. */
    xItemCountOverride?: number;
    /** Override Y item count for stretch.
     *  When set, Y stretch uses this count (e.g. number of series)
     *  instead of counting unique Y pixel positions. */
    yItemCountOverride?: number;
    /** Power-law exponent for continuous stretch (default: 0.3) */
    elasticity: number;
    /** Maximum stretch multiplier cap (default: 1.5) */
    maxStretch: number;
}
/** Default gas pressure parameters (§2 recommendations). */
declare const DEFAULT_GAS_PRESSURE_PARAMS: GasPressureParams;
/**
 * Result of the per-axis stretch decision.
 */
interface GasPressureDecision {
    /** Per-axis stretch: X axis (1 = no stretch, capped by maxStretch) */
    stretchX: number;
    /** Per-axis stretch: Y axis (1 = no stretch, capped by maxStretch) */
    stretchY: number;
    /** Uncapped stretch for X (raw pressure^elasticity, not clipped to maxStretch).
     *  Used by the layout engine to compute ideal aspect ratio before squeezing. */
    rawStretchX: number;
    /** Uncapped stretch for Y (raw pressure^elasticity, not clipped to maxStretch). */
    rawStretchY: number;
}
/**
 * Compute per-axis stretch for a continuous 2D axis region.
 *
 * Implements docs/design-stretch-model.md §2: each axis is stretched independently based
 * on how many distinguishable positions (or series) compete for pixel
 * space along that axis.
 *
 * Two modes per axis:
 *   - Positional: count unique pixel positions, σ_1d = √σ.
 *   - Series-count: when xItemCountOverride / yItemCountOverride is set,
 *     use that count directly with σ (not sqrt'd) since it's already 1D.
 *
 * @param xValues      Numeric x-coordinates of data points
 * @param yValues      Numeric y-coordinates of data points
 * @param xDomain      Scale domain [min, max] for x-axis
 * @param yDomain      Scale domain [min, max] for y-axis
 * @param canvasWidth  Base canvas width W₀
 * @param canvasHeight Base canvas height H₀
 * @param params       Gas pressure parameters (optional, uses defaults)
 */
declare function computeGasPressure(xValues: number[], yValues: number[], xDomain: [number, number], yDomain: [number, number], canvasWidth: number, canvasHeight: number, params?: GasPressureParams): GasPressureDecision;
/**
 * Parameters for elastic axis stretch computation.
 * These control the spring-model behavior from docs/design-stretch-model.md §1.
 */
interface ElasticStretchParams {
    /** Power-law exponent for stretch (default: 0.5) */
    elasticity: number;
    /** Maximum stretch multiplier cap (default: 2) */
    maxStretch: number;
    /** Default step size in px per discrete item */
    defaultStepSize: number;
    /** Minimum pixels per discrete item (default: 6) */
    minStep: number;
}
/**
 * Result of elastic budget computation for a single axis.
 */
interface ElasticBudget {
    /** Elastic-stretched canvas budget in px */
    budget: number;
    /** Stretch multiplier applied (1 = no stretch) */
    stretchFactor: number;
}
/**
 * Compute the elastic canvas budget for an axis with N discrete items.
 *
 * When N items at defaultStepSize exceed the base dimension, the axis
 * stretches using a power-law: stretch = min(maxStretch, pressure^elasticity).
 *
 * @param itemCount       Number of discrete items on the axis
 * @param baseDimension   Base canvas size (width or height) in px
 * @param params          Elastic stretch parameters
 */
declare function computeElasticBudget(itemCount: number, baseDimension: number, params: ElasticStretchParams): ElasticBudget;
/**
 * Result of per-axis step computation.
 */
interface AxisStepDecision {
    /** Computed step size in px per item */
    step: number;
    /** Total canvas budget in px */
    budget: number;
    /** Number of items this step was computed for */
    itemCount: number;
}
/**
 * Compute the step size for a single axis, covering both discrete
 * and continuous-as-discrete (banded) cases.
 *
 * @param nominalCount       Number of discrete (nominal/ordinal) items
 * @param continuousCount    Number of continuous-as-discrete items (banded Q/T)
 * @param baseDimension      Base canvas size (width or height) in px
 * @param params             Elastic stretch parameters
 */
declare function computeAxisStep(nominalCount: number, continuousCount: number, baseDimension: number, params: ElasticStretchParams): AxisStepDecision;
/**
 * Result of facet layout computation.
 */
interface FacetLayoutDecision {
    /** Number of facet columns */
    columns: number;
    /** Number of facet rows */
    rows: number;
    /** Per-subplot width in px */
    subplotWidth: number;
    /** Per-subplot height in px */
    subplotHeight: number;
}
/**
 * Parameters for facet layout computation.
 */
interface FacetLayoutParams {
    /** Power-law exponent for facet stretch (default: 0.3) */
    facetElasticity: number;
    /** Maximum total stretch multiplier cap (default: 2) */
    maxStretch: number;
    /** Minimum subplot size in px (default: 60) */
    minSubplotSize: number;
}
/**
 * Compute facet subplot dimensions.
 *
 * @param facetCols       Number of facet columns
 * @param facetRows       Number of facet rows
 * @param baseWidth       Base canvas width in px
 * @param baseHeight      Base canvas height in px
 * @param params          Facet layout parameters
 */
declare function computeFacetLayout(facetCols: number, facetRows: number, baseWidth: number, baseHeight: number, params: FacetLayoutParams): FacetLayoutDecision;
/**
 * Result of label sizing computation for a discrete axis.
 */
interface LabelSizingDecision {
    /** Font size in px */
    fontSize: number;
    /** Max label width in px */
    labelLimit: number;
    /** Label rotation angle (undefined = no rotation) */
    labelAngle?: number;
    /** Label alignment (for rotated labels) */
    labelAlign?: string;
    /** Label baseline (for rotated labels) */
    labelBaseline?: string;
}
/**
 * Compute label sizing for a discrete axis based on the effective step size.
 * Pure decision — returns sizing params without modifying any spec.
 *
 * @param effectiveStep      Pixels per discrete item
 * @param hasDiscreteItems   Whether the axis has discrete items
 */
declare function computeLabelSizing(effectiveStep: number, hasDiscreteItems: boolean): LabelSizingDecision;
/**
 * Result of overflow analysis for a discrete axis.
 */
interface OverflowDecision {
    /** Whether overflow occurred (more items than can fit) */
    overflowed: boolean;
    /** Maximum items to keep */
    maxToKeep: number;
    /** Number of items omitted */
    omittedCount: number;
}
/**
 * Compute whether a discrete axis overflows and how many items to keep.
 *
 * @param uniqueCount    Number of unique values on the axis
 * @param maxDimension   Maximum canvas dimension (with stretch) in px
 * @param minStepSize    Minimum px per item
 */
declare function computeOverflow(uniqueCount: number, maxDimension: number, minStepSize: number): OverflowDecision;

/**
 * =============================================================================
 * FIELD SEMANTICS
 * =============================================================================
 *
 * Resolves what a data field *is* by combining its semantic annotation
 * (from LLM or user) with the actual data values. This resolves the
 * one-to-many ambiguities in the type registry (e.g., Score can be
 * quantitative or ordinal depending on cardinality).
 *
 * The entry point is `resolveFieldSemantics()`. It produces a
 * `FieldSemantics` object that captures the field's identity, format,
 * aggregation role, domain, scale hint, and ordering — everything
 * about *what the data represents*, independent of how it will be
 * visualized on any particular channel.
 *
 * Design doc: docs/design-compilation-context.md
 *
 * VL dependency: **None** — pure TypeScript, no rendering library imports.
 * =============================================================================
 */

/**
 * Enriched semantic annotation from LLM or user.
 */
interface SemanticAnnotation {
    /** The T2 semantic type string (e.g., "Amount", "Score", "Month") */
    semanticType: string;
    /**
     * Intrinsic domain (value range) of this field's scale.
     * Only for bounded/scaled types — NOT for open-ended measures.
     * E.g., [1, 5] for 5-star rating, [0, 100] for score, [-90, 90] for latitude.
     */
    intrinsicDomain?: [number, number];
    /** Unit or currency code. E.g., "USD", "°C", "kg" */
    unit?: string;
    /** Explicit ordinal ordering. E.g., ["Low", "Medium", "High"] */
    sortOrder?: string[];
}
/** d3-compatible format specification */
interface FormatSpec {
    /** d3-format pattern: ",.2f", ".1%", "+.2f", etc. */
    pattern?: string;
    /** Prefix before the number: "$", "€", "£" */
    prefix?: string;
    /** Suffix after the number: "°C", "%", " kg" */
    suffix?: string;
    /** Whether large values should be abbreviated (1K, 1M, 1B) */
    abbreviate?: boolean;
}
/** Domain bounds constraint */
interface DomainConstraint {
    min?: number;
    max?: number;
    /** Whether to hard-clamp values outside the domain */
    clamp?: boolean;
}
/** Tick mark constraint */
interface TickConstraint {
    /** Only show integer tick values */
    integersOnly?: boolean;
    /** Exact tick values to show (for small domains like 1–5 rating) */
    exactTicks?: number[];
    /** Minimum step between ticks */
    minStep?: number;
}
/** Color scheme recommendation from semantic analysis */
interface ColorSchemeHint {
    /** Whether the field is best shown with sequential, diverging, or categorical colors */
    type: 'sequential' | 'diverging' | 'categorical';
    /** For diverging: the midpoint value */
    divergingMidpoint?: number;
    /** Whether the field is inherently diverging (always show diverging) vs conditional */
    inherentlyDiverging?: boolean;
}
/** Result of diverging midpoint analysis */
interface DivergingInfo {
    /** The midpoint value where the diverging center sits */
    midpoint: number;
    /** Whether this type is always diverging or only when data spans both sides */
    inherent: boolean;
    /** Source of the midpoint determination */
    source: 'unit' | 'type-intrinsic' | 'domain' | 'data';
}
/**
 * Resolved field semantics — what the data field *is*.
 *
 * Derived from a `SemanticAnnotation` (semantic type + optional metadata)
 * plus actual data values. Resolves the one-to-many ambiguities in the
 * type registry by inspecting the concrete data representation.
 *
 * This is purely about the field’s identity and intrinsic properties —
 * NOT about how it will be visualized on a particular channel.
 * Channel-specific decisions (color scheme, axis reversal, interpolation,
 * tick strategy, stacking, etc.) belong in `ChannelSemantics`.
 *
 * Built once per field per dataset by `resolveFieldSemantics()`.
 */
interface FieldSemantics {
    /** The semantic annotation (normalized from string or object input) */
    semanticAnnotation: SemanticAnnotation;
    /** Preferred encoding type, disambiguated from registry using data */
    defaultVisType: VisCategory;
    /** Number format derived from data type and unit (only set when confident) */
    format?: FormatSpec;
    /** Tooltip format (typically higher precision than axis format) */
    tooltipFormat?: FormatSpec;
    /** Default aggregate function — intrinsic to the field (additive vs intensive) */
    aggregationDefault?: 'sum' | 'average';
    /** Zero-baseline classification (meaningful / arbitrary / bipolar) */
    zeroClass: ZeroClass | 'unknown';
    /** Recommended scale type based on data distribution */
    scaleType?: 'linear' | 'log' | 'sqrt' | 'symlog';
    /** Intrinsic domain bounds (from annotation, type-intrinsic, or data-inferred) */
    domainConstraint?: DomainConstraint;
    /** Canonical ordinal sort order (months, days, etc.) */
    canonicalOrder?: string[];
    /** Whether the canonical order is cyclic (wraps around) */
    cyclic: boolean;
    /** Default sort direction */
    sortDirection: 'ascending' | 'descending';
    /** Whether this field’s data distribution benefits from binning */
    binningSuggested: boolean;
}
/**
 * Extract the semantic type string from a bare string or annotation object.
 * Used when downstream code only needs the type string, not the full annotation.
 */
declare function toTypeString(input: string | SemanticAnnotation | undefined): string;
/**
 * Normalize a bare string or enriched annotation object into a
 * consistent SemanticAnnotation.
 *
 * Accepts:
 *   "Amount"                                          → { semanticType: "Amount" }
 *   { semanticType: "Score", intrinsicDomain: [1,5] }  → as-is
 *   undefined / ""                                     → { semanticType: "Unknown" }
 */
declare function normalizeAnnotation(input: string | SemanticAnnotation | undefined): SemanticAnnotation;
/**
 * Resolve the format specification for a field based on its semantic type,
 * annotation metadata, and data values.
 *
 * Priority: annotation.unit > type-specific defaults
 */
declare function resolveFormat(semanticType: string, annotation: SemanticAnnotation, values: any[]): {
    format?: FormatSpec;
    tooltipFormat?: FormatSpec;
};
/**
 * Resolve the default Vega-Lite encoding type for a field.
 *
 * When the registry lists multiple candidates (e.g., Score → ['quantitative', 'ordinal']),
 * disambiguate using data statistics (distinct value count).
 */
declare function resolveDefaultVisType(semanticType: string, values: any[]): VisCategory;
/**
 * Resolve the default aggregation function based on the field's role.
 *
 * - Additive measures → sum (parts sum to a meaningful total)
 * - Intensive measures → average (rates/averages shouldn't be summed)
 * - Signed-additive    → sum (preserves sign semantics)
 * - Dimensions/IDs     → undefined (aggregation not meaningful)
 */
declare function resolveAggregationDefault(semanticType: string): 'sum' | 'average' | undefined;
/**
 * Resolve zero-baseline class, enhanced with annotation domain.
 *
 * If annotation provides a domain starting above 0 (e.g., Rating [1, 5]),
 * zero is arbitrary regardless of what the base type says.
 */
declare function resolveZeroClassFromAnnotation(semanticType: string, domain?: [number, number]): ZeroClass | 'unknown';
/**
 * Recommend a scale type based on semantic type and data distribution.
 *
 * Conservative policy — only triggers when ALL of these hold:
 *   1. The semantic type is an additive measure with an open domain and is
 *      not a generic fallback (i.e. Amount, Quantity, Duration — types whose
 *      magnitude is meaningful and can legitimately span many decades).
 *   2. Data spans ≥ 6 orders of magnitude (1,000,000×).
 *   3. At least 10 data points, all non-negative.
 *
 * This intentionally almost never fires on everyday data; it only helps with
 * genuinely wide-range additive measures. When it does not fire the axis stays
 * linear, and the user can still opt into log via the per-axis quick control.
 */
declare function resolveScaleType(semanticType: string, values: number[]): 'linear' | 'log' | 'sqrt' | 'symlog' | undefined;
/**
 * Resolve domain constraints from annotation, type-intrinsic rules, or data.
 *
 * Only truly fixed physical domains (Latitude, Longitude, Correlation)
 * use hard clamping. Bounded types like Percentage use a snap-to-bound
 * heuristic: the axis extends to the theoretical endpoint (e.g., 100%)
 * only when data is close to it, avoiding wasted space when data is
 * concentrated in a small region.
 *
 * Priority: annotation.intrinsicDomain > type-intrinsic > data-inferred
 */
declare function resolveDomainConstraint(semanticType: string, annotation: SemanticAnnotation, values: any[]): DomainConstraint | undefined;
/**
 * Resolve tick constraints based on semantic type and domain.
 *
 * For bounded integer domains (e.g., Rating [1, 5]), generates exact ticks.
 * For integer types (Count, Rank, Year), enforces integer-only ticks.
 */
declare function resolveTickConstraint(semanticType: string, domain?: [number, number]): TickConstraint | undefined;
/**
 * Resolve the canonical sort order for a field.
 *
 * Priority: annotation.sortOrder > well-known type sequence > auto-detect from data
 */
declare function resolveCanonicalOrder(semanticType: string, annotation: SemanticAnnotation, values: any[]): string[] | undefined;
/**
 * Determine whether a field's values form a cyclic (wrap-around) sequence.
 *
 * Derived purely from semantic type — NOT an LLM annotation.
 * Types with domainShape='cyclic' in the registry are cyclic.
 */
declare function resolveCyclic(semanticType: string): boolean;
/**
 * Whether the axis should be reversed for this field.
 *
 * Rank is the primary case: 1st place should appear at the top of the
 * y-axis.  On the x-axis, rank 1 should stay on the left (no reversal).
 */
declare function resolveReversed(semanticType: string, channel?: string): boolean;
/**
 * Whether to apply "nice" rounding to scale domain endpoints.
 *
 * Nice is false when:
 * - There's a fixed domain constraint (Rating [1, 5] → axis should show exactly 1–5)
 * - The type has a fixed domain shape (Latitude, Correlation)
 */
declare function resolveNice(semanticType: string, domainConstraint?: DomainConstraint): boolean;
/**
 * Resolve diverging midpoint information for a field.
 *
 * Priority chain:
 *   1. annotation.unit → type lookup (°C → 0, °F → 32)
 *   2. type-intrinsic midpoint (Sentiment → 0, Correlation → 0)
 *   3. annotation.intrinsicDomain midpoint (Rating [1,5] → 3)
 *   4. data-driven: data spans 0 → midpoint 0
 *
 * Returns undefined if no diverging treatment applies.
 */
declare function resolveDivergingInfo(semanticType: string, annotation: SemanticAnnotation, values: number[]): DivergingInfo | undefined;
/**
 * Resolve color scheme hint based on semantic type, diverging analysis,
 * and data values.
 */
declare function resolveColorSchemeHint(semanticType: string, annotation: SemanticAnnotation, values: any[]): ColorSchemeHint;
/**
 * Whether this field benefits from histogram-style binning.
 *
 * False for small bounded domains (Rating 1–5), non-numeric types,
 * and identifiers.
 */
declare function resolveBinningSuggested(semanticType: string, domain?: [number, number]): boolean;
/**
 * Whether values of this type can be stacked in a bar/area chart, and how.
 *
 * - 'sum':       Additive measures (parts sum to whole)
 * - 'normalize': Proportions (show 100% breakdown)
 * - false:       Stacking is meaningless (rates, scores, identifiers)
 */
declare function resolveStackable(semanticType: string): 'sum' | 'normalize' | false;
/**
 * Default sort direction for this field when used on an axis.
 */
declare function resolveSortDirection(semanticType: string): 'ascending' | 'descending';
/**
 * Resolve field semantics from annotation + data.
 *
 * This is the sole entry point for data-identity decisions. It resolves
 * the one-to-many ambiguities in the type registry by inspecting the
 * concrete data representation.
 *
 * Visualization-specific decisions (color scheme, axis reversal,
 * interpolation, tick strategy, nice rounding, stacking) are NOT
 * computed here — those belong in `resolveChannelSemantics()`.
 *
 * @param input       The semantic type annotation (string or enriched object)
 * @param fieldName   Column name (used for unit detection heuristics)
 * @param values      Sampled data values from this field
 * @returns           Resolved field semantics
 */
declare function resolveFieldSemantics(input: string | SemanticAnnotation | undefined, fieldName: string, values: any[]): FieldSemantics;

/**
+ * =============================================================================
+ * COLOR DECISIONS (backend-agnostic)
+ * =============================================================================
+ *
+ * Pure decision layer for choosing colormaps based on:
+ *   - Field semantics (FieldSemantics / ColorSchemeHint)
+ *   - Channel semantics (ChannelSemantics)
+ *   - Chart type & encodings
+ *   - Data statistics (distinct count, numeric range)
+ *
+ * This module does NOT know about Vega-Lite / ECharts syntax.
+ * It only returns abstract colormap identifiers and palette needs.
+ * Backends translate these decisions into concrete scale/option config.
+ * =============================================================================
+ */

type ColorMapType = 'categorical' | 'sequential' | 'diverging';
type ColorChannel = 'color' | 'group' | 'fill' | 'stroke';
interface ColorDecision {
    channel: ColorChannel;
    schemeType: ColorMapType;
    /**
     * 具体 colormap 标识：
     *   - 当用户在 encoding.scheme 中显式指定时，这里会带上该 id（如 'viridis'）。
     *   - 自动决策路径下，core 不再选择具体 id，schemeId 留空，由各后端的 colormap
     *     模块根据 schemeType / categoryCount / backend 主题自行挑选合适的 palette。
     */
    schemeId?: string;
    divergingMidpoint?: number;
    categoryCount?: number;
    /** 是否是主编码（影响后续主题/对比度策略） */
    primary: boolean;
    /** 是否是数据驱动的颜色（而非常量色） */
    dataDriven: boolean;
}
/**
 * 一个后端无关的颜色决策结果：按 channel 存一份。
 */
interface ColorDecisionResult {
    color?: ColorDecision;
    group?: ColorDecision;
    fill?: ColorDecision;
    stroke?: ColorDecision;
}

/**
 * Core types for the chart engine library.
 * No React or UI framework dependencies — pure TypeScript.
 */
declare const channels: readonly ["x", "y", "x2", "y2", "id", "color", "opacity", "size", "shape", "strokeDash", "column", "row", "latitude", "longitude", "radius", "detail", "group", "open", "high", "low", "close", "angle", "order", "metric", "value", "goal"];
declare const channelGroups: Record<string, string[]>;
/**
 * Encoding definition for a single channel, using field names directly.
 * This is the library-level encoding — no fieldID indirection.
 */
interface ChartEncoding {
    field?: string;
    type?: "quantitative" | "nominal" | "ordinal" | "temporal";
    aggregate?: 'count' | 'sum' | 'average' | 'mean';
    sortOrder?: "ascending" | "descending";
    sortBy?: string;
    scheme?: string;
}
/**
 * An encoding value that allows either a single encoding or an array of
 * encodings (static series). Array form is only valid on measure channels
 * (y, x-as-measure) where all fields resolve to quantitative.
 *
 * When an array is provided, the assembler folds (unpivots) the specified
 * fields into a long-form representation with a synthesized key column
 * (for color/legend) and value column (for the measure axis).
 */
type EncodingValue = ChartEncoding | ChartEncoding[];
/**
 * Shorthand for a channel encoding: a bare field-name string is treated as
 * `{ field: <string> }`. This lets callers write `{ x: "weight" }` instead of
 * `{ x: { field: "weight" } }` to keep simple specs terse (e.g. for demos).
 *
 * Shorthands are also accepted inside static-series arrays, so
 * `{ y: ["sales", "profit"] }` expands to `[{ field: "sales" }, { field: "profit" }]`.
 */
type EncodingShorthand = string;
/**
 * Channel value as accepted in raw user input, before shorthand normalization.
 * Normalized to {@link EncodingValue} by `normalizeEncodingShorthand`.
 */
type RawEncodingValue = ChartEncoding | EncodingShorthand | (ChartEncoding | EncodingShorthand)[];
/**
 * Metadata produced by static series normalization.
 * Captures the original multi-field intent so backends can emit
 * appropriate legend labels and the pipeline can short-circuit
 * series counting.
 */
interface StaticSeriesMetadata {
    /** Which channel had the array encoding ('y' or 'x') */
    channel: string;
    /** Original field names from the array entries */
    fields: string[];
    /** Synthetic column name for the series discriminator */
    keyColumn: string;
    /** Synthetic column name for the measure values */
    valueColumn: string;
}
/**
 * Everything Phase 0 decides for a single channel.
 *
 * Combines the original ChartEncoding (user intent) with resolved
 * decisions derived from semantic type, data values, and channel context.
 * All downstream phases (layout, assembly, instantiation) read this —
 * no nested FieldSemantics reference needed.
 */
interface ChannelSemantics {
    /** Field name bound to this channel */
    field: string;
    /** The semantic annotation for this field */
    semanticAnnotation: SemanticAnnotation;
    /**
     * Final encoding type for this channel.
     * Resolved from semantic type + data characteristics + channel rules.
     */
    type: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
    /** Axis/legend number format */
    format?: FormatSpec;
    /** Tooltip format (typically higher precision) */
    tooltipFormat?: FormatSpec;
    /**
     * Temporal format string (temporal fields on any channel).
     * E.g., "%Y", "%b %d", "%H:%M".
     */
    temporalFormat?: string;
    /** Default aggregate function when used as a measure */
    aggregationDefault?: 'sum' | 'average';
    /**
     * Zero-baseline decision (positional quantitative channels only).
     * Present only on 'x' and 'y' channels with type 'quantitative'.
     */
    zero?: ZeroDecision;
    /** Recommended scale type */
    scaleType?: 'linear' | 'log' | 'sqrt' | 'symlog';
    /** Whether to apply "nice" rounding to domain endpoints */
    nice?: boolean;
    /** Domain bounds constraint */
    domainConstraint?: DomainConstraint;
    /** Tick mark constraints */
    tickConstraint?: TickConstraint;
    /**
     * Canonical ordinal sort order for this field's values.
     * E.g., month names, day-of-week, quarters.
     */
    ordinalSortOrder?: string[];
    /** Whether the canonical order is cyclic (wraps around) */
    cyclic?: boolean;
    /** Whether the axis should be reversed (e.g., Rank: 1 at top) */
    reversed?: boolean;
    /** Default sort direction */
    sortDirection?: 'ascending' | 'descending';
    /** Color scheme recommendation (color channel only) */
    colorScheme?: ColorSchemeRecommendation;
    /** Whether this field benefits from binning */
    binningSuggested?: boolean;
    /** Whether values can be stacked, and how */
    stackable?: 'sum' | 'normalize' | false;
}
/** Phase 0 output: one entry per channel. */
type SemanticResult = Record<string, ChannelSemantics>;
/**
 * How the template's primary mark encodes its quantitative value
 * on the positional (value) axis.
 *
 * Grounded in perceptual accuracy ranking:
 *   1. Position along a common scale — most accurate
 *   2. Length from a shared baseline
 *   3. Area
 *   4. Color saturation / luminance
 *
 * Drives zero-baseline, scale tightness, and compression behavior.
 */
type MarkCognitiveChannel = 'position' | 'length' | 'area' | 'color';
/**
 * Template's layout intent — returned by declareLayoutMode().
 */
interface LayoutDeclaration {
    /**
     * Which axes allocate fixed bands per data position.
     * Banded axes use the spring model; non-banded use gas pressure.
     */
    axisFlags?: {
        x?: {
            banded: boolean;
        };
        y?: {
            banded: boolean;
        };
    };
    /**
     * Resolved encoding types after any template-driven type conversion.
     * E.g., detectBandedAxis may convert Q→O for a bar chart axis.
     * These override the Phase 0 decisions for layout purposes.
     */
    resolvedTypes?: Record<string, 'nominal' | 'ordinal' | 'quantitative' | 'temporal'>;
    /**
     * Template-specific overrides to layout parameters.
     */
    paramOverrides?: Partial<AssembleOptions>;
    /**
     * Which axes use binned encoding (e.g. histogram).
     * The assembler auto-detects this from template.encoding if not set.
     */
    binnedAxes?: Record<string, boolean | {
        maxbins?: number;
    }>;
    /**
     * Treat a discrete `color` field as an axis-grouping field for sizing,
     * even though the template uses the `color` channel rather than `group`.
     * When set, computeLayout sizes the discrete axis per-band (xStepUnit
     * 'group') and budgets the band step across categories, so the chart does
     * not balloon and each sub-lane shrinks as the subgroup count grows.
     * Used by charts (e.g. boxplot) that dodge by color via an explicit offset.
     */
    colorActsAsGroup?: boolean;
    /**
     * Override the number of sub-lanes the grouping field reserves per band.
     * When unset, computeLayout uses the global distinct count of the group
     * field. Templates that render `local` (compact) dodge set this to the
     * per-band max cardinality (`maxPerBand`) so the band is budgeted for only
     * as many lanes as the busiest band actually uses.
     */
    groupLaneCount?: number;
    /**
     * Custom overflow strategy for deciding which discrete values to keep
     * when a channel overflows. If not provided, the default strategy is used.
     *
     * @param channel       The overflowing channel ('x', 'y', 'color', etc.)
     * @param fieldName     The field on that channel
     * @param uniqueValues  All unique values in the data for that field
     * @param maxToKeep     Maximum number of values that fit
     * @param context       Abstract context with data and channel info
     * @returns             The values to keep (in display order)
     */
    overflowStrategy?: OverflowStrategy;
}
/**
 * Custom overflow strategy function type.
 * Returns the values to keep when a channel has too many discrete values.
 */
type OverflowStrategy = (channel: string, fieldName: string, uniqueValues: any[], maxToKeep: number, context: OverflowStrategyContext) => any[];
/** Context passed to overflow strategy functions. */
interface OverflowStrategyContext {
    /** Full data table */
    data: any[];
    /** Per-channel semantic info */
    channelSemantics: Record<string, ChannelSemantics>;
    /** Original user encodings (for sort info) */
    encodings: Record<string, ChartEncoding>;
    /** Mark types present in the template */
    allMarkTypes: Set<string>;
}
/**
 * Per-channel maximum values that can fit on the canvas.
 *
 * Computed once by `computeChannelBudgets` using the most conservative
 * assumptions (minStep, minSubplotSize, maxStretch).  Passed to
 * `filterOverflow` so it only needs to decide *which* values to keep
 * and filter rows — no layout math.
 *
 * Pipeline:  computeChannelBudgets → filterOverflow → computeLayout
 */
interface ChannelBudgets {
    /** Maximum discrete values to keep per channel.
     *  Channels not present here are uncapped (`Infinity`). */
    maxValues: Record<string, number>;
    /** Facet grid decision (if facet channels exist) */
    facetGrid?: FacetGridResult;
}
/** Result of overflow filtering. */
interface OverflowResult {
    /** Data after removing overflow rows */
    filteredData: any[];
    /** Nominal value counts per channel (post-overflow) */
    nominalCounts: Record<string, number>;
    /** Detailed truncation info for overflow styling */
    truncations: TruncationWarning[];
    /** Warning messages for the UI */
    warnings: ChartWarning[];
}
/**
 * Result of facet grid computation (from computeFacetGrid).
 *
 * Decides the visual grid layout (including column-only wrapping)
 * and the maximum number of unique values to keep per facet channel.
 *
 * Pipeline:  computeFacetGrid → filterOverflow (uses caps) → computeLayout (uses grid)
 */
interface FacetGridResult {
    /** Visual columns per row (after wrapping for column-only) */
    columns: number;
    /** Visual rows (after wrapping for column-only) */
    rows: number;
    /** Max unique values to keep for the column channel */
    maxColumnValues: number;
    /** Max unique values to keep for the row channel */
    maxRowValues: number;
}
/**
 * Describes one axis that was truncated due to overflow.
 */
interface TruncationWarning {
    /** Severity level for UI display */
    severity: 'warning';
    /** Machine-readable code */
    code: 'overflow';
    /** Human-readable message */
    message: string;
    /** Which channel overflowed ('x', 'y', 'color', etc.) */
    channel: string;
    /** Field name on the overflowing axis */
    field: string;
    /** Values retained (in display order) */
    keptValues: any[];
    /** Number of items omitted */
    omittedCount: number;
    /** Placeholder string to append to the axis domain */
    placeholder: string;
}
/**
 * Phase 1 output: all layout decisions.
 *
 * LayoutResult is **target-agnostic** — it describes abstract dimensions
 * and step sizes that any rendering backend can consume.  It is the
 * backend's responsibility to translate these values into its own
 * coordinate system:
 *
 *   subplotWidth / subplotHeight
 *     The intended data-area (plot area) size in pixels.  This does NOT
 *     include axis labels, titles, legends, or margins.  Each backend
 *     must add its own margins/padding around this area.
 *
 *   xStep / yStep
 *     Pixel distance per discrete position on each axis.  A backend
 *     rendering bars should derive bar width from step and stepPadding.
 *     VL uses `width: {step: N}` natively; ECharts must compute
 *     explicit barWidth / barCategoryGap.
 *
 *   stepPadding
 *     Fraction of each step reserved for inter-category spacing (0–1).
 *     Usable bar width = step × (1 − stepPadding).
 *
 *   facet (columns / rows / subplot sizes)
 *     When faceting is active, the subplot dimensions are already
 *     divided for the facet grid.  Each backend is responsible for
 *     facet wrapping (e.g. column-only → wrapped rows), panel
 *     positioning, header labels, and shared/per-panel axis titles.
 *
 * Backends should NOT modify LayoutResult.  They read it and translate
 * to their native format (VL encoding props, ECharts grid/axis config, etc.).
 */
interface LayoutResult {
    /** Final subplot width in px (after stretch) */
    subplotWidth: number;
    /** Final subplot height in px (after stretch) */
    subplotHeight: number;
    /** Computed step size for X axis (px per discrete position) */
    xStep: number;
    /** Computed step size for Y axis (px per discrete position) */
    yStep: number;
    /** Whether the step size is per-item or per-group. */
    xStepUnit?: 'item' | 'group';
    yStepUnit?: 'item' | 'group';
    /** Number of banded continuous items on each axis (0 if not banded-continuous) */
    xContinuousAsDiscrete: number;
    yContinuousAsDiscrete: number;
    /** Number of nominal/ordinal items on each axis */
    xNominalCount: number;
    yNominalCount: number;
    /** Label sizing decisions per axis */
    xLabel: LabelSizingDecision;
    yLabel: LabelSizingDecision;
    /** Facet layout (if applicable) */
    facet?: {
        columns: number;
        rows: number;
        subplotWidth: number;
        subplotHeight: number;
    };
    /**
     * Gap between facet panels in px, as set by the backend.
     * Backends use this to configure their own spacing
     * (VL config.facet.spacing, ECharts GAP, etc.).
     */
    effectiveFacetGap: number;
    /**
     * Inter-category padding fraction (0–1) used by the layout engine.
     * Renderers (especially ECharts) should use this to size bars:
     *   barWidth = step × (1 − stepPadding)
     */
    stepPadding: number;
    /** Items truncated due to overflow */
    truncations: TruncationWarning[];
}
/**
 * Context passed to template instantiate() and to the shared assembler's
 * Phase 2 logic. Combines semantic decisions, layout results, and original
 * inputs.
 */
interface InstantiateContext {
    /** Per-channel semantic decisions (Phase 0) */
    channelSemantics: Record<string, ChannelSemantics>;
    /** Layout decisions (Phase 1) */
    layout: LayoutResult;
    /** The data table (array of row objects, post-overflow filtering) */
    table: any[];
    /**
     * The full data table (array of row objects, BEFORE overflow filtering).
     *
     * `table` may have categories silently dropped by `filterOverflow` to
     * fit the canvas. Templates that need an honest view of the raw data
     * — e.g. a "top-N + Others" rollup, an annotation that summarizes
     * what wasn't shown, or a sparkline reference — should read from
     * `fullTable` instead.
     *
     * Optional for backwards-compatibility; backends that don't set it
     * fall back to `table`.
     */
    fullTable?: any[];
    /** Resolved VL encoding objects (built by assembler from Phase 0 decisions) */
    resolvedEncodings: Record<string, any>;
    /** Original user-level encodings */
    encodings: Record<string, ChartEncoding>;
    /** User-configured chart properties */
    chartProperties?: Record<string, any>;
    /** Static series metadata (present when input used array-valued encoding) */
    staticSeries?: StaticSeriesMetadata;
    /**
     * Base (target) chart dimensions — the size layout aims for before
     * pressure-driven stretch. This is the resolved `chart_spec.baseSize`
     * (NOT the hard ceiling). The ceiling is `baseSize × maxStretchX/Y`,
     * available via `assembleOptions.maxStretchX` / `maxStretchY`.
     */
    canvasSize: {
        width: number;
        height: number;
    };
    /** Field name → semantic type (string or enriched annotation) */
    semanticTypes: Record<string, string | SemanticAnnotation>;
    /** Chart type name */
    chartType: string;
    /** Assembly options (layout tuning parameters from the caller) */
    assembleOptions?: AssembleOptions;
    /**
     * Backend-agnostic color decisions.
     * Computed once per chart from semantic + layout context and reused
     * by all backends to map into their native color configuration.
     */
    colorDecisions?: ColorDecisionResult;
}
/**
 * The minimal, render-time context an option's applicability check reads.
 *
 * Shared by both option families so they use one predicate convention:
 *   - `ChartPropertyDef.check` (Category A, data-aware properties)
 *   - `EncodingActionDef.isApplicable` (Category B, encoding actions)
 *
 * `encodings` is always present (it's all a host needs to gate an encoding
 * action). The remaining fields are populated by the compiler during assembly
 * and let data-aware *properties* inspect the actual values + resolved
 * semantics; a predicate that only reads `encodings` (e.g. "is color bound?")
 * works with the bare `{ encodings }` a host can build on its own.
 */
interface OptionEvalContext {
    /** User-level encodings (channel → field binding). Always present. */
    encodings: Record<string, ChartEncoding>;
    /** Per-channel semantic decisions (Phase 0). Present during assembly. */
    channelSemantics?: Record<string, ChannelSemantics>;
    /** Full (pre-overflow) data rows, for data-aware preconditions. */
    data?: any[];
    /** Current user-set chart property overrides. */
    chartProperties?: Record<string, any>;
}
/**
 * Defines a configurable property for a chart template.
 * Describes the value domain; the app decides how to render it.
 */
/** The value-domain variants a property can take (the discriminated arm). */
type ChartPropertyVariant = {
    type: 'continuous';
    min: number;
    max: number;
    step?: number;
    defaultValue?: number;
} | {
    type: 'discrete';
    options: {
        value: any;
        label: string;
    }[];
    defaultValue?: any;
} | {
    type: 'binary';
    defaultValue?: boolean;
};
/**
 * The renderable descriptor of a property: its identity, label, and value
 * domain. This is the part a host needs to draw a control, and it is shared
 * verbatim by both sides of the Flint↔host boundary:
 *
 *   - `ChartPropertyDef`  = `ChartProperty` + the applicability *rule* (`check`)
 *   - `ChartOption`       = `ChartProperty` + the resolved *answer* (`applicable`/`value`)
 *
 * Keeping the descriptor common means the template definition and the resolved
 * option never drift in shape; they differ only by rule-vs-answer.
 */
type ChartProperty = {
    key: string;
    label: string;
} & ChartPropertyVariant;
type ChartPropertyDef = ChartProperty & {
    /**
     * The single applicability check for this property, co-located with it so a
     * reader sees *why* an option is offered without digging into the compiler.
     * Pure — reads only `OptionEvalContext` — and returns:
     *   - `applicable`: is this property worth offering for the current spec +
     *     data? It subsumes both structural gates (a channel is bound, e.g.
     *     `!!ctx.encodings.color?.field`) and data-aware ones (a wide-range axis,
     *     an additive single-sign measure, …). A property with no `check`
     *     is always offered.
     *   - `recommendedValue` (optional): the engine's suggested default, used to
     *     seed the control when the host hasn't set an explicit value.
     *
     * Because it requires no live data to answer a structural check, a static
     * host (the encoding-shelf popover) can call it with just `{ encodings }`;
     * a data-aware property then reports `applicable: false` there — surfacing
     * only in the data-aware quick-config bar — without needing a separate flag.
     */
    check?: (ctx: OptionEvalContext) => {
        applicable: boolean;
        recommendedValue?: any;
    };
};
/**
 * A chart property descriptor annotated with its applicability and resolved
 * value for a *specific* spec + dataset. Produced by `getChartOptions` (and
 * carried on the assembled spec under `_options`).
 *
 * This is the contract between Flint and any host (Data Formulator, an AI agent,
 * another renderer):
 *
 *   - `applicable` — did this property pass its precondition for this render?
 *     Each property answers via its own `check`: structural ones (e.g. stack
 *     mode) are applicable when their channel is bound; data-aware ones (e.g.
 *     per-axis log scale, faceted independent y) only when the data warrants it
 *     (wide-range continuous axis, faceted quantitative y, …). A host should
 *     surface a control only when it is applicable; passing a non-applicable
 *     property to the compiler is accepted but silently ignored.
 *   - `value` — the value Flint will actually use: the host's explicit choice
 *     (from `chart_spec.chartProperties[key]`) when set, otherwise the engine's
 *     recommended default. Hosts seed their control from this so an "auto"
 *     recommendation (e.g. log on a 10⁶× axis) is reflected without the host
 *     having to recompute it.
 *
 * A `ChartOption` shares the renderable `ChartProperty` descriptor with the
 * template def but carries the *answer* (`applicable`/`value`) instead of the
 * *rule* (`check`). That keeps it a resolved, serializable view a host consumes
 * across the spec/JSON boundary (Python path included), where the rule function
 * wouldn't survive anyway.
 */
type ChartOption = ChartProperty & {
    /** Did this property pass its precondition for the current spec + data? */
    applicable: boolean;
    /** Explicit host choice if set, otherwise the engine's recommended default. */
    value: any;
};
/**
 * Defines a "quick action" whose effect is an **encoding transform** (Category B):
 * sort, color scheme, aggregate, type, orientation (x↔y swap), etc.
 *
 * These operate at a different pipeline stage than ChartPropertyDef:
 *
 *   Category B (this type):  (encoding + override) ──► transformed encoding ──► assemble ──► spec
 *                                         └──── set() ────┘
 *   Category A (properties): encoding ──► assemble ──► spec ──► (props tweak spec in instantiate)
 *
 * An encoding action transforms the *input* to assembly, so the full pipeline
 * (semantic resolution → overflow → layout → assembly) re-runs on the result.
 * That is exactly why structural options must live here: sort changes which
 * categories survive overflow, aggregate changes the data values, orientation
 * changes which axis is banded — none of which can be faked by patching the
 * assembled spec afterwards. ChartPropertyDef, by contrast, only overrides the
 * already-assembled spec and is limited to visual decoration (cornerRadius,
 * opacity, curve, donut hole).
 *
 * Storage = override, not encoding state. The action's value is stored by the
 * host as a *configuration override* (exactly like a chart property), keyed by
 * `key` inside `chart_spec.chartProperties`. The encoding map (the encoding
 * shelf's state) is left untouched. The compiler — not the host — applies the
 * override at assemble time:
 *
 *   transformedEncodings = set(currentEncodings, chartProperties[key])
 *
 * So Flint always sees just "override value + current encoding" and composes
 * them; it never mutates persistent encoding state. (See applyEncodingOverrides.)
 *
 *   get(encodings)        → derive the control's displayed value from the base
 *                           encodings when no override is set
 *   set(encodings, value) → compose: return the encodings with the override applied
 *
 * `set` is declarative: it returns what the encodings should be after the
 * override, not a list of imperative operations. Any transform — changing one
 * property, swapping two channels, clearing a channel — is just "produce a new
 * map", so there is no operation taxonomy to grow.
 *
 * `dependencies` declares which encoding channels the override is computed
 * against. It is a pure declaration consumed by the *host*: when the user edits
 * one of these channels in the encoding shelf, the host clears (resets) the
 * override so a stale value can't linger. Flint never resets — reset is host
 * logic; Flint only ever composes override + current encoding.
 *
 * The control shape mirrors ChartPropertyDef so the host can reuse the same
 * renderers; only the pipeline stage differs (encoding transform vs spec tweak).
 */
type EncodingActionDef = {
    key: string;
    label: string;
    /**
     * Channels this override is computed against. When the host detects an edit
     * to any of these channels in the encoding shelf, it resets this override to
     * default. Pure declaration — Flint itself never reads this for composition.
     */
    dependencies?: string[];
    /** How to render the control (same value domains as ChartPropertyDef). */
    control: {
        type: 'continuous';
        min: number;
        max: number;
        step?: number;
    } | {
        type: 'discrete';
        options: {
            value: any;
            label: string;
        }[];
    } | {
        type: 'binary';
    };
    /**
     * Optional applicability predicate — the single gate for whether this action
     * is offered. It reads the shared `OptionEvalContext`; in practice an action
     * only needs `ctx.encodings`, so it subsumes both channel-assignment checks
     * (is a channel bound? e.g. `!!ctx.encodings.color?.field`) and type checks
     * (e.g. Sort needs a discrete category axis, so it must not appear on a
     * purely temporal/quantitative chart). Pure. Defaults to always-applicable.
     */
    isApplicable?: (ctx: OptionEvalContext) => boolean;
    /** Derive the displayed control value from the base encodings map (pure). */
    get: (encodings: Record<string, ChartEncoding>) => any;
    /** Compose: return the encodings with this override value applied (pure). */
    set: (encodings: Record<string, ChartEncoding>, value: any) => Record<string, ChartEncoding>;
};
/**
 * A chart-type transition: a pivot state that re-views the same data as a
 * *sibling* chart type. Unlike orientation/role/series moves (which stay within
 * one template), a transition changes `chartType` and, optionally, re-routes one
 * field across channels. It is the "chart type as another group coordinate"
 * generator (see design doc §4.6). Examples: Grouped Bar ↔ Stacked Bar (the
 * dodge series moves between `group` and `color`), Scatter ↔ Strip/Jitter (a
 * discrete `color` swaps onto the `x` category axis).
 */
interface PivotTransition {
    /** Target chart type to render as. Must be a registered sibling template. */
    to: string;
    /** State label shown in the pivot control (e.g. 'Stacked', 'Grouped', 'Jitter'). */
    label: string;
    /**
     * Optional channel re-route applied before switching templates.
     * - `move`: source field → target channel; source channel cleared (target must be empty).
     * - `swap`: exchange the fields on the two channels (or spill the displaced
     *   field to a third channel — see `spill`).
     *
     * `from` may be a literal channel name or the sentinel `'series'`, which
     * resolves at runtime to whichever grouping channel (`color`/`column`/`row`/
     * `group`) currently holds the discrete series field.
     */
    route?: {
        from: string;
        to: string;
        mode?: 'move' | 'swap';
        spill?: string;
    };
    /** Only offer when the routed source field is discrete (nominal/ordinal). */
    requireDiscreteSource?: boolean;
    /** Only offer when the routed source field's distinct count is within this budget. */
    maxSourceCardinality?: number;
}
/**
 * Declarative pivot configuration carried by a chart template. Each generator
 * declares its *permissible transformation domain* compactly — the candidate
 * swap pairs, the shiftable channels, the sibling chart types — and the compiler
 * filters those candidates lazily against the actual encodings + data (type
 * compatibility, channel availability, cardinality budgets) when assembling. See
 * core/pivot.ts for the enumeration/composition semantics.
 */
interface PivotDef {
    /** Override key the host stores the chosen state id under. Default `'pivot'`. */
    key?: string;
    /** Human label for the control. Default `'View'`. */
    label?: string;
    /**
     * τ (transpose): axis-slot pairs that may be exchanged *wholesale* — the
     * orientation/flip generator. Each pair (typically `['x','y']`) swaps the two
     * channels' full encodings, so it is profile-agnostic (a bar's category↔measure
     * flip, a scatter's measure↔measure flip, a heatmap's dimension↔dimension flip
     * all read the same). It is suppressed only when a continuous-temporal position
     * axis must stay horizontal (line/area). Because both slots stay occupied, a
     * transpose can never violate a must-present constraint. A template that should
     * never flip (e.g. a line, to avoid a vertical line chart) simply omits this.
     * Ids/labels: `flip:x-y` / `τ_x↔y`. Default none.
     */
    transpose?: string[][];
    /**
     * σ (permute): permutable *blocks* of channels whose *fields* may be reordered
     * among themselves — distinct from {@link transpose}, this reassigns a field to
     * a compatible channel rather than flipping two slots. The compiler enumerates
     * the within-block pairings and admits an *axis ↔ auxiliary* swap only when the
     * two ends share a profile (the Young-block rule of the design doc §3.6.1):
     *   - measure ↔ measure, on position marks only — a quantitative field trades a
     *     precise position axis for a demoted `color`/`size` channel (scatter);
     *   - category ↔ discrete `color` — a banded axis dimension trades places with
     *     the legend series (bars).
     * `x↔y` is NOT a permute (it is a {@link transpose}); pure auxiliary↔auxiliary
     * pairs (e.g. `color↔size`) are not offered. Order within a block is irrelevant;
     * ids/labels canonicalize each pair (`swap:x-color` / `σ_x↔color`). Default none.
     */
    permute?: string[][];
    /**
     * γ (shift): grouping channels the single discrete *series* field may be
     * routed across — typically `['color','group','column','row']`. The compiler
     * filters to channels the template actually declares, that are empty, and
     * within the per-channel cardinality budget. This is what unifies stacked /
     * grouped / faceted presentations as states of one template. Default none.
     */
    shift?: string[];
    /** Max distinct categories for a facet split to be offered. Default 12. */
    facetBudget?: number;
    /**
     * θ (chart-type transition): sibling chart types to consider re-rendering the
     * same data as (e.g. Grouped Bar ↔ Stacked Bar, Scatter ↔ Jitter). Each
     * admitted transition becomes one extra state in the orbit. Default none.
     */
    transitions?: PivotTransition[];
}
/**
 * Chart template definition — pure data, no UI/icon dependencies.
 * This is the reusable core that defines chart structure, encoding channels,
 * and processing logic.
 *
 * Three-phase pipeline hooks:
 *   1. declareLayoutMode — declare axis flags, type overrides, param overrides
 *   2. instantiate — build final spec from resolved encodings + layout
 */
interface ChartTemplateDef {
    /** Display name of the chart type, e.g. "Scatter Plot" */
    chart: string;
    /** Vega-Lite spec skeleton (mark + encoding structure) */
    template: any;
    /** Which encoding channels are available for this chart */
    channels: string[];
    /**
     * How the primary mark encodes its quantitative value.
     * Determines zero-baseline, scale tightness, and compression behavior.
     *
     * Examples:
     *   - Bar, Histogram, Lollipop, Waterfall, Pyramid: 'length'
     *   - Area, Streamgraph, Density: 'area'
     *   - Line, Scatter, Boxplot, Candlestick, Strip: 'position'
     *   - Heatmap: 'color'
     */
    markCognitiveChannel: MarkCognitiveChannel;
    /**
     * Phase 1a: Declare layout intent.
     * Runs BEFORE layout computation.
     *
     * Inspects channel semantics and data to decide:
     * - Which axes are banded (need spring model)
     * - Any type conversions (Q→O for banded axis)
     * - Layout parameter overrides (σ, step multiplier, etc.)
     * Grouping (from group channel + discrete axis detection)
     */
    declareLayoutMode?: (channelSemantics: Record<string, ChannelSemantics>, table: any[], chartProperties?: Record<string, any>) => LayoutDeclaration;
    /**
     * Optional encoding-normalization hook.
     * Runs BEFORE semantics resolution and layout, after pivot / encoding-action
     * overrides have been composed. Lets a template re-route the *authored*
     * channel map so the WHOLE pipeline (semantics, faceting, overflow, layout)
     * resolves against the normalized encodings — not just the final spec.
     *
     * Example: a sparkline "table" remaps its series field (`color`/`detail`)
     * onto the `row` facet channel when no `row` is bound, so the layout engine
     * allocates one stacked strip per series instead of overlaying them.
     *
     * Return the (possibly new) encoding map. Returning the input unchanged is a
     * no-op. Pure — must not mutate the input.
     *
     * NOTE: currently honored by the Vega-Lite assembler only; ECharts / Chart.js
     * wiring is a follow-up.
     */
    normalizeEncodings?: (encodings: Record<string, ChartEncoding>, table: any[]) => Record<string, ChartEncoding>;
    /**
     * Build the final spec from resolved encodings + layout.
     * Runs AFTER layout computation.
     *
     * Receives the spec skeleton (deep clone of template),
     * and a context with resolved encodings, semantic decisions,
     * and layout result. Handles both encoding mapping and mark sizing.
     *
     * @param spec       The Vega-Lite spec skeleton (deep clone of template)
     * @param context    Complete context with all phase outputs
     */
    instantiate: (spec: any, context: InstantiateContext) => void;
    /** Optional configurable properties for the chart type */
    properties?: ChartPropertyDef[];
    /**
     * Optional encoding-level quick actions (Category B). Clicking one of these
     * mutates the encodings map (the same state the encoding shelf edits),
     * rather than chart-native config. See EncodingActionDef.
     */
    encodingActions?: EncodingActionDef[];
    /**
     * Optional pivot declaration — a derived Category-B operator that re-routes
     * encoding fields across position/legend/facet channels to surface
     * alternative views (orientation swap, series↔axis role swap, facet split).
     * The host stores the chosen state id under `PivotDef.key` in
     * chartProperties; the compiler enumerates + composes the permutation. See
     * core/pivot.ts (computePivot / applyPivot).
     */
    pivot?: PivotDef;
    /**
     * Optional post-processing hook.
     * Called after instantiation and layout application, before the final
     * result is returned.  Receives the assembled spec/option and the
     * effective canvas size so the template can adjust visual parameters
     * (e.g. symbol size, line width) proportionally.
     */
    postProcess?: (spec: any, context: InstantiateContext) => void;
}
/** A warning produced during chart assembly */
interface ChartWarning {
    /** Warning severity */
    severity: 'info' | 'warning' | 'error';
    /** Short machine-readable warning code */
    code: string;
    /** Human-readable description */
    message: string;
    /** Optional: which channel(s) or field(s) triggered the warning */
    channel?: string;
    field?: string;
}
/**
 * Unified input for all chart assembly functions (Vega-Lite, ECharts, Chart.js).
 *
 * Instead of passing multiple positional arguments, callers provide a single
 * JSON-serializable object with four top-level keys:
 *
 * ```ts
 * const result = assembleVegaLite({
 *   data: { values: myRows },
 *   semantic_types: { weight: 'Quantity', origin: 'Country' },
 *   chart_spec: {
 *     chartType: 'Scatter Plot',
 *     encodings: { x: { field: 'weight' }, y: { field: 'mpg' } },
 *     canvasSize: { width: 400, height: 300 },
 *   },
 *   options: { addTooltips: true },
 * });
 * ```
 */
interface ChartAssemblyInput {
    /**
    * Data source — either inline rows or a reference the host can resolve.
     *
     * - `{ values: any[] }` — an array of row objects (like Vega-Lite `data.values`).
    * - `{ url: string }`   — a URL or path reference to JSON/CSV data.
    *   Hosts that need local semantic/layout decisions should resolve this to
    *   rows before assembly. The MCP renderer reads local JSON/CSV/TSV
    *   files referenced by path; it does not fetch remote URLs.
     *
     * At least one of `values` or `url` must be provided.
     */
    data: {
        values: any[];
        url?: never;
    } | {
        url: string;
        values?: never;
    };
    /**
     * Per-column semantic type annotations.
     *
     * Maps field names to semantic type strings (e.g., `"Quantity"`, `"Country"`,
     * `"Year"`, `"Percentage"`). These drive encoding type resolution, zero-baseline
     * decisions, color schemes, formatting, and more.
     *
     * Fields not listed here fall back to `inferVisCategory()` which inspects
     * raw data values.
     */
    semantic_types?: Record<string, string | SemanticAnnotation>;
    /**
     * Chart specification — describes *what* to draw.
     */
    chart_spec: {
        /** Template name, e.g. `"Scatter Plot"`, `"Bar Chart"` */
        chartType: string;
        /** Channel → encoding map (e.g., `{ x: { field: 'weight' }, y: { field: 'mpg' } }`).
         * A bare string is shorthand for `{ field: <string> }` (e.g. `{ x: 'weight' }`). */
        encodings: Record<string, RawEncodingValue>;
        /**
         * Base (target) chart size in pixels — the size layout aims for when the
         * data fits comfortably (default: `{ width: 400, height: 320 }`).
         *
         * For faceted charts this is the whole-chart target; panels divide it.
         * The chart may grow beyond `baseSize` under pressure (dense axes, many
         * facet panels), bounded by `canvasSize`.
         */
        baseSize?: {
            width: number;
            height: number;
        };
        /**
         * Hard ceiling on the rendered size in pixels (optional).
         *
         * The final image — a single plot OR an entire facet grid — never exceeds
         * this box. The per-dimension growth allowance is derived from the ratio
         * to `baseSize`: `βx = canvasSize.width / baseSize.width`,
         * `βy = canvasSize.height / baseSize.height` (each clamped to ≥ 1).
         *
         * When omitted, the ceiling defaults to `baseSize × options.maxStretch`
         * (default 1.5×) in each dimension.
         */
        canvasSize?: {
            width: number;
            height: number;
        };
        /** Template-specific configurable properties (e.g., bar corner radius, show labels) */
        chartProperties?: Record<string, any>;
    };
    /**
     * Options for the assembler — layout tuning, tooltips, etc.
     * All fields are optional and have sensible defaults.
     */
    options?: AssembleOptions;
    /**
     * Localized display names for fields (column name → display label).
     * When present, used as axis titles and legend headers instead of raw field names.
     */
    field_display_names?: Record<string, string>;
}
/**
 * Options for the chart assembly function.
 * Includes layout tuning parameters — all have sensible defaults.
 */
interface AssembleOptions {
    /** Whether to add tooltips to the chart (default: false) */
    addTooltips?: boolean;
    /**
     * Fraction of each step reserved for inter-category padding (0–1).
     * VL pads *inside* the step (band = step × (1 − padding)), so this
     * value should match VL's paddingInner.  ECharts pads *outside* the
     * band, so the layout engine passes this through so ECharts can
     * compute barWidth = step × (1 − stepPadding) explicitly.
     *
     * Default: 0.1 (matching VL's default band paddingInner).
     */
    stepPadding?: number;
    /** Power-law exponent for discrete axis stretch (default: 0.5) */
    elasticity?: number;
    /**
     * Default maximum stretch multiplier used when the spec provides no
     * explicit `canvasSize` ceiling (default: 2).
     *
     * This is a **unified** budget: the combined stretch from facet
     * layout AND discrete/banded axis sizing must stay within this
     * factor.  For example, with maxStretch=2 and a 400px base,
     * the total chart width never exceeds 800px regardless of how
     * many facet columns or discrete axis items there are.
     *
     * When `chart_spec.canvasSize` IS set, the per-dimension caps
     * `maxStretchX`/`maxStretchY` are derived from `canvasSize / baseSize`
     * instead and this scalar is ignored.
     */
    maxStretch?: number;
    /**
     * Resolved per-dimension stretch cap for the X (width) axis.
     *
     * Normally derived by the assembler from `canvasSize / baseSize`
     * (or `maxStretch` when no ceiling is set). Callers rarely set this
     * directly. Falls back to `maxStretch` when absent.
     */
    maxStretchX?: number;
    /**
     * Resolved per-dimension stretch cap for the Y (height) axis.
     *
     * Normally derived by the assembler from `canvasSize / baseSize`
     * (or `maxStretch` when no ceiling is set). Callers rarely set this
     * directly. Falls back to `maxStretch` when absent.
     */
    maxStretchY?: number;
    /** Power-law exponent for facet subplot stretch — lower = more conservative (default: 0.3) */
    facetElasticity?: number;
    /** Minimum pixels per discrete axis item (default: 6) */
    minStep?: number;
    /** Maximum number of distinct color values before overflow truncation (default: 24) */
    maxColorValues?: number;
    /** Minimum facet subplot size in px (default: 60) */
    minSubplotSize?: number;
    /**
     * Fixed overhead in px for axis labels, titles, legend, etc.
     * Subtracted once from the total canvas budget (not per-panel).
     * Each backend sets its own default; core uses { width: 0, height: 0 }.
     */
    facetFixedPadding?: {
        width: number;
        height: number;
    };
    /**
     * Gap in px between adjacent facet panels (spacing, headers).
     * Used directly by the core layout engine to compute subplot sizes
     * and max canvas dimensions.
     * Each backend sets its own value (VL ≈ 10, ECharts ≈ 14); core uses 0.
     */
    facetGap?: number;
    /**
     * Base pixels per discrete category at a 300px baseline canvas.
     * Scaled proportionally with canvas size by the core layout engine.
     * The final default step size is:
     *
     *   defaultStepSize = defaultBandSize × max(1, canvasSize/300)
     *
     * Backends set this to match their native bar/band rendering:
     *   - VL:  ~20 (VL uses width:{step:N} which auto-sizes the plot area)
     *   - EC:  ~20 (ECharts adds generous grid margins)
     *   - CJS: ~30 (Chart.js fills the canvas; wider bands look more native)
     *
     * Templates can override via paramOverrides for chart types that need
     * more space per band (e.g. jitter: 40, funnel: 50, sankey: 60).
     *
     * Default: 20.
     */
    defaultBandSize?: number;
    /**
     * When true, continuous X and Y axes stretch together using the
     * larger of the two per-axis stretch factors. This preserves the
     * aspect ratio of the data space. (default: false — axes stretch
     * independently based on their own density.)
     */
    maintainContinuousAxisRatio?: boolean;
    /**
     * Gas-pressure tuning for continuous axes (default: scatter-plot settings).
     * - A single number overrides markCrossSection (σ) for both axes.
     * - An object allows per-axis σ plus optional elasticity / maxStretch:
     *   `{ x: 100, y: 0, elasticity: 0.7, maxStretch: 2 }`
     *   x/y = 0 means "don't stretch this axis".
     *   Useful for line/area charts where horizontal crowding matters
     *   far more than vertical.
     */
    continuousMarkCrossSection?: number | {
        x: number;
        y: number;
        /** Per-axis stretch elasticity (default: 0.3). Higher → more responsive. */
        elasticity?: number;
        /** Per-axis stretch cap (default: 1.5). */
        maxStretch?: number;
        /**
         * Which axis uses series-count-based pressure instead of pixel counting.
         * - 'x' or 'y': that axis uses nSeries × σ / dim for pressure.
         * - 'auto': auto-detect — in 2D (both continuous), defaults to 'y';
         *   in 1D (one continuous + one discrete), uses the continuous axis.
         * The σ for the series axis is used directly (not sqrt'd) since series
         * count is inherently 1D.
         */
        seriesCountAxis?: 'x' | 'y' | 'auto';
    };
    /**
     * Resistance to aspect-ratio distortion when faceting.
     *
     * When faceting divides one dimension (e.g. width by column count),
     * the subplot aspect ratio drifts away from the single-plot ratio.
     * Line and area charts are very sensitive to this because their
     * visual signal is encoded in slopes and curve shapes.
     *
     * This parameter partially compensates by shrinking the undivided
     * dimension so the panel aspect ratio stays closer to the original:
     *
     *   arDrift = facetedAR / baseAR          (< 1 when panel is narrower)
     *   correctedDim = dim × arDrift ^ resistance
     *
     * - 0 (default): no correction — current behavior.
     * - 0.3–0.5: moderate resistance (recommended for line / area).
     * - 1: fully preserve the single-plot aspect ratio.
     */
    facetAspectRatioResistance?: number;
    /**
     * Whether to auto-wrap column-only facets into a 2D grid.
     *
     * When `true` (default), `computeFacetGrid` considers wrapping N
     * column facets into multiple rows, choosing the layout whose
     * overall aspect ratio best matches the canvas AR.
     *
     * When `false`, column-only facets stay in a single row (capped
     * at the maximum that fits the canvas budget). Useful for small
     * multiples that should always be side-by-side.
     */
    autoFacetWrap?: boolean;
    /**
     * Target aspect ratio for a single band (step height ÷ step width).
     *
     * When a banded (discrete) axis is opposite a continuous axis, each
     * band has a natural AR = continuousAxisSize / stepSize.  If that
     * exceeds the target, the continuous axis is shrunk via a log-space
     * blend so bands don't become excessively tall/wide.
     *
     * - `undefined` / 0: no band-AR correction.
     * - Typical values: 8–15 (VL default ≈ 10, ECharts ≈ 12).
     *
     * Only affects charts with exactly one banded axis and one
     * continuous axis (e.g. bar, lollipop).  Has no effect on
     * scatter, line, or fully-banded charts.
     */
    targetBandAR?: number;
}

export { computeLabelSizing as $, type AssembleOptions as A, type SemanticType as B, type ChannelBudgets as C, DEFAULT_GAS_PRESSURE_PARAMS as D, type ElasticBudget as E, type FacetLayoutDecision as F, type GasPressureDecision as G, SemanticTypes as H, type InstantiateContext as I, type StaticSeriesMetadata as J, type TruncationWarning as K, type LabelSizingDecision as L, type MarkCognitiveChannel as M, type ZeroDecision as N, type OptionEvalContext as O, type PivotDef as P, channelGroups as Q, type RawEncodingValue as R, type SemanticAnnotation as S, type TickConstraint as T, channels as U, type VisCategory as V, computeAxisStep as W, computeElasticBudget as X, computeFacetLayout as Y, type ZeroClass as Z, computeGasPressure as _, type AxisStepDecision as a, computeOverflow as a0, computePaddedDomain as a1, computeZeroDecision as a2, getRecommendedColorScheme as a3, getRegistryEntry as a4, getVisCategory as a5, getZeroClass as a6, inferOrdinalSortOrder as a7, inferVisCategory as a8, isCategoricalType as a9, isGeoType as aa, isMeasureType as ab, isOrdinalType as ac, isTimeSeriesType as ad, normalizeAnnotation as ae, resolveAggregationDefault as af, resolveBinningSuggested as ag, resolveCanonicalOrder as ah, resolveColorSchemeHint as ai, resolveCyclic as aj, resolveDefaultVisType as ak, resolveDivergingInfo as al, resolveDomainConstraint as am, resolveEncodingType as an, resolveFieldSemantics as ao, resolveFormat as ap, resolveNice as aq, resolveReversed as ar, resolveScaleType as as, resolveSortDirection as at, resolveStackable as au, resolveTickConstraint as av, resolveZeroClassFromAnnotation as aw, toTypeString as ax, type ChannelSemantics as b, type ChartAssemblyInput as c, type ChartEncoding as d, type ChartOption as e, type ChartPropertyDef as f, type ChartTemplateDef as g, type ChartWarning as h, type ColorSchemeHint as i, type DivergingInfo as j, type DomainConstraint as k, type ElasticStretchParams as l, type EncodingActionDef as m, type EncodingShorthand as n, type EncodingTypeDecision as o, type EncodingValue as p, type FieldSemantics as q, type FormatSpec as r, type GasPressureParams as s, type LayoutDeclaration as t, type LayoutResult as u, type OverflowDecision as v, type OverflowResult as w, type OverflowStrategy as x, type OverflowStrategyContext as y, type SemanticResult as z };
