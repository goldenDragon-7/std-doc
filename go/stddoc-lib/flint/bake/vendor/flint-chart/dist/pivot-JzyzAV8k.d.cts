import { d as ChartEncoding, g as ChartTemplateDef, P as PivotDef } from './types-uaTmx_F9.cjs';

/**
 * Chart pivot — a derived Category-B operator that re-routes encoding *fields*
 * across position/legend/facet *channels* to surface alternative views of the
 * same semantic spec (orientation swap, series↔axis role swap, facet split).
 *
 * The host stores the chosen pivot *state id* as a single override keyed by
 * `PivotDef.key` (default `'pivot'`) inside `chart_spec.chartProperties`, exactly
 * like any other encoding action. The compiler — not the host — owns the channel
 * permutation: at assemble time it enumerates the valid states for the current
 * encodings + data, picks the stored id (falling back to the identity state when
 * the id is stale or absent), and composes the resulting encoding map BEFORE the
 * rest of the pipeline runs (so sort/overflow/layout all resolve post-pivot).
 *
 * This module is intentionally backend-agnostic: it operates purely on the
 * abstract `ChartEncoding` map + the raw data table, so the same enumeration
 * drives Vega-Lite, ECharts and Chart.js.
 *
 * MVP linearization. The full design models the pivot states as the orbit of a
 * channel-permutation group, linearized by a Gray code so adjacent steps differ
 * by one generator. This first increment exposes a curated *star* of single-
 * generator views around the authored identity (identity → orientation → role →
 * facet), which is a valid finite cycle (Z/n over the ordered list) that always
 * returns to the authored view. Richer products land later.
 *
 * Role-swap has two type-preserving flavors: discrete↔color-hue (a category
 * moves between a banded axis and the legend — bars/lines) and, on position
 * marks only, measure↔(color-gradient | size) (a quantitative field moves
 * between a precise position axis and a demoted auxiliary channel — scatter).
 *
 * Two distinct group actions drive the channel moves, matching the design doc:
 *   - τ (transpose): flip two axis *slots* wholesale (`x↔y` orientation). Profile-
 *     agnostic, always occupancy-preserving — declared via `PivotDef.transpose`.
 *   - σ (permute): reassign a *field* to a same-profile channel (axis ↔ color/size)
 *     — declared via `PivotDef.permute`, admitted by the Young-block profile rule.
 * Keeping them separate is what lets the must-present guard drop out entirely.
 */

/** Resolved pivot surface attached to the assembled spec as `_pivot`. */
interface PivotSurface {
    key: string;
    label: string;
    /** Number of states in the cycle (>= 2 when a control should show). */
    length: number;
    /** Index of the active state within `ids`. */
    index: number;
    /** Ordered state ids; `ids[0]` is always the identity (authored) view. */
    ids: string[];
    /** Parallel human labels for each state. */
    labels: string[];
}
/** Internal: a fully enumerated pivot for a given encoding map + data. */
interface PivotComputation {
    key: string;
    label: string;
    ids: string[];
    labels: string[];
    statesById: Record<string, Record<string, ChartEncoding>>;
    /**
     * Chart-type override per state id, set only for chart-type *transition*
     * states (§4.6). Absent/undefined entries render with the authored template.
     */
    chartTypeById: Record<string, string | undefined>;
}
/** Build the standard cartesian pivot declaration from its permissible domains. */
declare function makeCartesianPivot(opts?: Partial<PivotDef>): PivotDef;
/**
 * Enumerate the pivot states for an encoding map + data under a template's
 * `PivotDef` by walking the *orbit* of the generators at runtime: start from the
 * authored identity and repeatedly apply one more δ (breadth-first), deduping by
 * {@link encodingKey} (the stabilizer quotient) and rejecting non-renderable
 * states (see {@link isRenderableState}). State ids are operator *paths* (e.g.
 * `orient|series:row`, `type:Strip Plot`); labels compose the per-step operator
 * notation with `·`. Returns `null` when no template pivot is declared. The
 * identity (authored) view is always state 0; a control should only render when
 * `ids.length > 1`.
 *
 * `resolveTemplate` lets the walk cross θ (chart-type) edges: after a transition
 * switches `chartType`, subsequent generators come from the *target* template's
 * pivot def. Backends that omit it leave θ states as leaves (no composition past
 * a chart-type change).
 */
declare function computePivot(template: ChartTemplateDef, base: Record<string, ChartEncoding>, data: any[], resolveTemplate?: (chartType: string) => ChartTemplateDef | undefined): PivotComputation | null;
/**
 * Resolve the active pivot state for the stored override and return both the
 * transformed encodings and the serializable surface (or the untouched base
 * encodings + `undefined` surface when no multi-state pivot applies).
 */
declare function applyPivot(template: ChartTemplateDef, base: Record<string, ChartEncoding>, data: any[], chartProperties: Record<string, any> | undefined, resolveTemplate?: (chartType: string) => ChartTemplateDef | undefined): {
    encodings: Record<string, ChartEncoding>;
    chartType: string | undefined;
    surface: PivotSurface | undefined;
};

export { type PivotComputation as P, type PivotSurface as a, applyPivot as b, computePivot as c, makeCartesianPivot as m };
