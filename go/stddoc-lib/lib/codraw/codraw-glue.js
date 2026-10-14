// Bundled by `stddoc bundle-codraw` (esbuild-in-Go, go/internal/esbuild) into
// vendor/codraw-bundle.js. This is the ONLY hand-authored source that feeds the
// bundle — everything else under vendor/ is generated or fetched from npm at
// build time (never at runtime; see go/stddoc-lib/lib/codraw/BUNDLE.md).
//
// Purpose: reach Excalidraw 0.18.x's ESM entry point (0.18 dropped the UMD
// build codraw shipped through 0.17.6) and re-expose it as the same
// window.React / window.ReactDOM / window.ExcalidrawLib globals that
// index.html's existing vanilla-JS runtime already expects — so NONE of that
// runtime (save/poll/export/feedback logic) has to change, only how the
// libraries get onto the page.
import React from "react";
import ReactDOM from "react-dom/client";
import { Excalidraw, exportToSvg, exportToBlob } from "@excalidraw/excalidraw";

window.React = React;
// index.html calls `ReactDOM.createRoot(...)` — preserve that exact call shape.
window.ReactDOM = { createRoot: ReactDOM.createRoot };
window.ExcalidrawLib = { Excalidraw, exportToSvg, exportToBlob };
window.__coDrawLibsReady = true;
