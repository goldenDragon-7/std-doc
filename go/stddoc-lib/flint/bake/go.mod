// Sentinel module — NOT part of the stddoc build.
//
// This directory holds the OPTIONAL live-Flint Node bake (render.mjs + its
// npm-installed node_modules), which is JavaScript, not Go. Declaring a nested
// module here makes the main module's `go ... ./...` stop at this boundary, so
// `go test ./...` never wanders into node_modules and tries to compile a
// vendored JS package's stray golang/ dir (e.g. flatted/golang). Nothing in the
// stddoc binary imports anything under this path; render.mjs is read as a file
// at runtime, never as a Go import.
module stddoc-flint-bake-ignore

go 1.26
