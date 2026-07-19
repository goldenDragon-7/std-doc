import { c as ChartAssemblyInput, e as ChartOption, I as InstantiateContext, h as ChartWarning, g as ChartTemplateDef } from '../types-uaTmx_F9.cjs';
import { a as PivotSurface } from '../pivot-JzyzAV8k.cjs';

/**
 * Core chart assembly logic — Two-Stage Pipeline Coordinator.
 *
 * Given data, encoding definitions, and semantic types,
 * produces a complete Vega-Lite specification in two stages:
 *
 * ── ANALYSIS (VL-free) ──────────────────────────────────────
 *   Phase 0:  resolveChannelSemantics  → ChannelSemantics
 *   Step 0a:  declareLayoutMode    → LayoutDeclaration
 *   Step 0b:  convertTemporalData  → converted data
 *   Step 0c:  filterOverflow       → filtered data, nominalCounts
 *   Phase 1:  computeLayout        → LayoutResult
 *
 * ── INSTANTIATE (VL-specific) ───────────────────────────────
 *   buildVLEncodings    → resolvedEncodings
 *   template.instantiate
 *   restructureFacets
 *   vlApplyLayoutToSpec
 *   post-layout adjustments (facet binning, independent scales, tooltips)
 *
 * ── Backend Translation Responsibilities ────────────────────
 * The LayoutResult from Phase 1 is target-agnostic.  This assembler
 * translates it into Vega-Lite-specific structures:
 *
 *   subplotWidth / subplotHeight
 *     → VL `width` / `height` on the spec (or `width: {step: N}` for
 *       banded discrete axes).
 *
 *   xStep / yStep / stepPadding
 *     → VL `width: {step: N}`, `encoding.x.scale.paddingInner`, etc.
 *       VL handles bar sizing natively from the step declaration.
 *
 *   Facet wrapping
 *     → `restructureFacets()` converts column-only to `facet` +
 *       `columns: N`.  The wrapping decision uses the same parameters
 *       (maxStretch, minStep, minSubplotSize) as ECharts.
 *
 *   Axis titles, labels, legends
 *     → VL handles these declaratively via encoding / config.
 *
 * This module has NO React, Redux, or UI framework dependencies.
 */

/**
 * Assemble a Vega-Lite specification.
 *
 * ```ts
 * const spec = assembleVegaLite({
 *   data: { values: myRows },
 *   semantic_types: { weight: 'Quantity', mpg: 'Quantity' },
 *   chart_spec: {
 *     chartType: 'Scatter Plot',
 *     encodings: { x: { field: 'weight' }, y: { field: 'mpg' } },
 *     canvasSize: { width: 400, height: 300 },
 *   },
 *   options: { addTooltips: true },
 * });
 * ```
 */
declare function assembleVegaLite(input: ChartAssemblyInput): any;
/**
 * Inspect a chart spec + dataset and report the configurable options Flint
 * exposes for it, each annotated with whether it is *applicable* and the *value*
 * the compiler will use (see ChartOption).
 *
 * This is the "ask Flint what knobs are available" entry point. A host calls it
 * with the same input it would pass to `assembleVegaLite`, renders a control for
 * each applicable option seeded from `value`, and feeds the user's choices back
 * via `chart_spec.chartProperties`. Because applicability is derived from the
 * data (not from the chosen values), the set is stable across that loop.
 *
 * It runs the same analysis pipeline as `assembleVegaLite` (the options are a
 * by-product of assembly), so applicability can never drift from what the
 * compiler actually does — a property reported applicable is exactly one the
 * compiler will honor.
 */
declare function getChartOptions(input: ChartAssemblyInput): ChartOption[];
/**
 * Inspect a chart spec + dataset and report the pivot surface Flint exposes for
 * it — the ordered alternative views (orientation/role/facet) the host can cycle
 * through, with the active index. Returns `undefined` when the chart has a
 * single view (no control should be shown). Mirrors getChartOptions: it runs the
 * same analysis pipeline so the surface can never drift from what the compiler
 * actually does. The host renders a cyclic control seeded from `index` and
 * writes the chosen `ids[next]` back to `chart_spec.chartProperties[key]`.
 */
declare function getChartPivot(input: ChartAssemblyInput): PivotSurface | undefined;

/**
 * =============================================================================
 * PHASE 2: INSTANTIATE SPEC
 * =============================================================================
 *
 * Combine semantic decisions (Phase 0) and layout dimensions (Phase 1) to
 * produce the final Vega-Lite specification.
 *
 * This is the **only phase that knows about Vega-Lite** (or whichever
 * output format is targeted).
 *
 * VL dependency: **Yes — this is where VL lives**
 * =============================================================================
 */

/**
 * Phase 2: Build the final VL specification from semantic decisions and
 * layout results.
 *
 * This is the shared assembler logic that translates abstract decisions
 * into VL syntax. Template-specific logic is handled by
 * template.instantiate(spec, context).
 *
 * This function handles the VL-specific plumbing that is common across
 * all templates:
 *   - Canvas dimensions (config.view.continuousWidth/Height)
 *   - Discrete step sizing (width: {step: N})
 *   - Zero-baseline application
 *   - Color scheme application
 *   - Temporal format application
 *   - Label sizing application
 *   - Overflow warning styling
 *
 * @param vgObj       The mutated VL spec (after template encoding construction)
 * @param context     Combined context from all phases
 * @param warnings    Array to append warnings to
 */
declare function vlApplyLayoutToSpec(vgObj: any, context: InstantiateContext, warnings: ChartWarning[]): void;
/**
 * Apply tooltip configuration to a VL spec.
 *
 * Keep tooltip activation separate from axis/legend number formatting. Global
 * numberFormat also affects axes and can force small tick values into scientific
 * notation, so axis defaults are applied explicitly in vlApplyLayoutToSpec.
 */
declare function vlApplyTooltips(vgObj: any): void;

/**
 * Template registry — collects all chart template definitions.
 * No UI/icon dependencies. This is the pure-data template catalog.
 *
 * Each template file exports individual ChartTemplateDef objects.
 * Categories are defined here to group related charts in the UI.
 */

/**
 * All chart template definitions, grouped by category.
 * Keys are category names shown in the UI, values are arrays of template definitions.
 *
 * Categories are organized by *mark family* — charts in the same group share
 * their dominant visual primitive (point, bar, line/area, etc.). This keeps
 * placement objective and the picker readable.
 */
declare const vlTemplateDefs: {
    [key: string]: ChartTemplateDef[];
};
/**
 * Flat list of all Vega-Lite chart template definitions.
 */
declare const vlAllTemplateDefs: ChartTemplateDef[];
/**
 * Look up a Vega-Lite chart template definition by chart type name.
 */
declare function vlGetTemplateDef(chartType: string): ChartTemplateDef | undefined;
/**
 * Get the available channels for a Vega-Lite chart type.
 */
declare function vlGetTemplateChannels(chartType: string): string[];

/**
 * Adapt encodings when switching between Vega-Lite chart types.
 *
 * @param sourceType     Current chart type name
 * @param targetType     Target chart type name
 * @param encodings      Current channel->fieldName map (filled channels only)
 * @param data           (optional) Data rows for recommendation-based adaptation
 * @param semanticTypes  (optional) Field->semantic-type map
 * @returns              Remapped channel->fieldName for the target
 */
declare function vlAdaptChart(sourceType: string, targetType: string, encodings: Record<string, string>, data?: any[], semanticTypes?: Record<string, string>): Record<string, string>;
/**
 * Recommend field->channel assignments for a Vega-Lite chart type.
 *
 * @param chartType      Chart template name (e.g. "Bar Chart")
 * @param data           Array of row objects
 * @param semanticTypes  Field->semantic-type map (e.g. { weight: "Quantity" })
 * @returns              channel->fieldName map (only VL-valid channels)
 */
declare function vlRecommendEncodings(chartType: string, data: any[], semanticTypes: Record<string, string>): Record<string, string>;

export { assembleVegaLite, getChartOptions, getChartPivot, vlAdaptChart, vlAllTemplateDefs, vlApplyLayoutToSpec, vlApplyTooltips, vlGetTemplateChannels, vlGetTemplateDef, vlRecommendEncodings, vlTemplateDefs };
