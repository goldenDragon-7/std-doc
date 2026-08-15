#!/usr/bin/env python3
"""Generator for examples/flint-gallery/source.json — the full 34-chart Flint
gallery. Run: python3 gen.py > source.json (then delete this comment target,
gen.py stays as a documented build script; source.json is the checked-in
artifact per Covenant I, JSON is canon)."""
import json

GROUPS = [
    "Comparison",
    "Distribution",
    "Trend & Time",
    "Part-to-whole",
    "Correlation",
    "Geo",
    "KPI & Tables",
]

# (dtype, group, title, tagline)
CHARTS = [
    ("bar_chart", "Comparison", "bar chart", "categories, ranked by a single value"),
    ("grouped_bar_chart", "Comparison", "grouped bar chart", "two dimensions side by side per category"),
    ("stacked_bar_chart", "Comparison", "stacked bar chart", "parts of a whole, compared across categories"),
    ("lollipop_chart", "Comparison", "lollipop chart", "a lighter bar — stem plus dot"),
    ("bullet_chart", "Comparison", "bullet chart", "a KPI against target, in one compact glyph"),
    ("waterfall_chart", "Comparison", "waterfall chart", "a running total, gain and loss visible per step"),
    ("gantt_chart", "Comparison", "gantt chart", "durations laid across a timeline, one row per task"),
    ("radar_chart", "Comparison", "radar chart", "many axes, one shape per series"),

    ("boxplot", "Distribution", "boxplot", "quartiles and outliers at a glance"),
    ("violin_plot", "Distribution", "violin plot", "a boxplot with the full density drawn in"),
    ("histogram", "Distribution", "histogram", "binned counts across a numeric range"),
    ("density_plot", "Distribution", "density plot", "a smoothed histogram — continuous, not binned"),
    ("ecdf_plot", "Distribution", "ECDF plot", "the empirical cumulative distribution, step by step"),
    ("strip_plot", "Distribution", "strip plot", "every raw point, jittered along one axis"),
    ("pyramid_chart", "Distribution", "pyramid chart", "two mirrored distributions, back to back"),
    ("candlestick_chart", "Distribution", "candlestick chart", "open/high/low/close, one glyph per period"),

    ("line_chart", "Trend & Time", "line chart", "a value traced across an ordered axis"),
    ("area_chart", "Trend & Time", "area chart", "a line chart with the area beneath it filled"),
    ("range_area_chart", "Trend & Time", "range area chart", "a band between a low and high series"),
    ("sparkline", "Trend & Time", "sparkline", "a trend, shrunk to fit inline with text"),
    ("bump_chart", "Trend & Time", "bump chart", "rank changes over time, one line per entity"),
    ("slope_chart", "Trend & Time", "slope chart", "before/after, one line per entity"),
    ("streamgraph", "Trend & Time", "streamgraph", "stacked areas around a central axis, themed river"),

    ("pie_chart", "Part-to-whole", "pie chart", "shares of a whole, one wedge per category"),
    ("rose_chart", "Part-to-whole", "rose chart", "a pie chart wound around a polar axis"),

    ("scatter_plot", "Correlation", "scatter plot", "two numeric variables, one dot per observation"),
    ("connected_scatter_plot", "Correlation", "connected scatter plot", "a scatter plot with its points joined in sequence"),
    ("regression", "Correlation", "regression", "a scatter plot with a fitted trend line"),
    ("ranged_dot_plot", "Correlation", "ranged dot plot", "a dot plus its range, one row per category"),
    ("heatmap", "Correlation", "heatmap", "two categorical axes, color encoding the value"),

    ("map", "Geo", "map", "points or regions placed on real geography"),
    ("choropleth", "Geo", "choropleth", "regions shaded by a value — the map as heatmap"),

    ("kpi_card", "KPI & Tables", "KPI card", "one number, the headline of the whole doc"),
    ("bar_table", "KPI & Tables", "bar table", "a table row with an inline bar for scale"),
]

assert len(CHARTS) == 34, len(CHARTS)
assert {c[1] for c in CHARTS} == set(GROUPS)

def slug_for(dtype):
    return "f-" + dtype.replace("_", "-")

def node_for(dtype, group, title, tagline):
    hyphen_dtype = dtype.replace("_", "-")
    src = {
        "type": "diagram",
        "dtype": hyphen_dtype,
        "label": f"{title} — live render",
    }
    src_text = json.dumps(src, indent=2)
    return {
        "slug": slug_for(dtype),
        "group": group,
        "title": title,
        "status": "LIVE",
        "tagline": f"the `{hyphen_dtype}` catalog chart — live render, then its source",
        "blocks": [
            {
                "type": "showcase",
                "label": "LIVE RENDER",
                "content": [src],
            },
            {
                "type": "prose",
                "text": "Source (copy into your own source.json):",
            },
            {
                "type": "code",
                "mode": "snippet",
                "caption": None,
                "spans": [
                    {"cls": "plain", "text": src_text}
                ],
            },
        ],
    }

def contents_facets():
    summary = ("~34 quantitative charts, on tap, zero-dep, freeze-clean. "
               "Every card below is authored with nothing but a dtype — no pasted SVG, "
               "no Node toolchain, no CDN. std-doc looks the name up in the Flint catalog "
               "(stddoc-lib/flint/*.svg) and embeds the pre-baked, freeze-clean chart "
               "inline. Pick a group above to browse its charts; each page shows the "
               "LIVE render immediately followed by its copy-paste source.")
    by_group = {}
    for dtype, group, title, tagline in CHARTS:
        by_group.setdefault(group, []).append((dtype, title))
    facets = {
        g: ", ".join(title for _, title in items)
        for g, items in by_group.items()
    }
    return summary, facets

def build():
    summary, facets = contents_facets()
    nodes = []
    for dtype, group, title, tagline in CHARTS:
        nodes.append(node_for(dtype, group, title, tagline))
    doc = {
        "title": "Flint Gallery — the full quantitative catalog (engine #3)",
        "generated_date": "2026-08-15",
        "layout": "top-nav",
        "groups": GROUPS,
        "palette": {
            "quant": {"label": "Quantitative", "color": "#a78bfa"},
            "amber": {"label": "Amber", "color": "#f59e0b"},
        },
        "root": {
            "summary": summary,
            "facets": facets,
        },
        "nodes": nodes,
    }
    return doc

if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
