import { U as channels, A as AssembleOptions, S as SemanticAnnotation } from './types-uaTmx_F9.js';

/**
 * Vendored types for test-data / gallery fixtures.
 *
 * These come from the original repo, where TestCase originally lived.
 * They're scoped to test-data only — the public library (core/, vegalite/, …)
 * does not depend on these types.
 *
 * Keep this file small and free of DF-only logic. If a type drifts in DF,
 * update it here independently.
 */

declare enum Type {
    String = "string",
    Boolean = "boolean",
    Integer = "integer",
    Number = "number",
    Date = "date",
    DateTime = "datetime",
    Time = "time",
    Duration = "duration",
    Auto = "auto"
}
type Channel = typeof channels[number];
type FieldSource = 'custom' | 'original';
interface FieldItem {
    id: string;
    name: string;
    source: FieldSource;
    tableRef: string;
}
type AggrOp = 'count' | 'sum' | 'average' | 'mean';
interface EncodingItem {
    fieldID?: string;
    dtype?: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
    aggregate?: AggrOp;
    sortOrder?: 'ascending' | 'descending';
    sortBy?: string;
    scheme?: string;
}

/**
 * Types and helper utilities for chart gallery test cases.
 * No React/UI dependencies — pure TypeScript.
 */

interface TestCase {
    title: string;
    description: string;
    tags: string[];
    chartType: string;
    data: Record<string, any>[];
    fields: FieldItem[];
    metadata: Record<string, {
        type: Type;
        semanticType: string;
        levels: any[];
    }>;
    encodingMap: Partial<Record<Channel, EncodingItem>>;
    chartProperties?: Record<string, any>;
    assembleOptions?: AssembleOptions;
    /**
     * Enriched semantic annotations that override the plain semanticType strings
     * in metadata. Use this when a field needs extra info like intrinsicDomain or unit.
     * E.g., { rating: { semanticType: 'Score', intrinsicDomain: [1, 5] } }
     */
    semanticAnnotations?: Record<string, SemanticAnnotation>;
}
/** Date format definition for date stress tests */
interface DateFormat {
    label: string;
    description: string;
    values: any[];
    fieldName: string;
    expectedType: Type;
    semanticType: string;
}
declare function makeField(name: string, tableRef?: string): FieldItem;
declare function makeEncodingItem(fieldID: string, opts?: Partial<EncodingItem>): EncodingItem;
declare function inferType(values: any[]): Type;
declare function buildMetadata(data: Record<string, any>[]): Record<string, {
    type: Type;
    semanticType: string;
    levels: any[];
}>;

export { type DateFormat as D, type TestCase as T, makeField as a, buildMetadata as b, inferType as i, makeEncodingItem as m };
