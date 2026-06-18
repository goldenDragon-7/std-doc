#!/usr/bin/env bash
# Sign + notarize + staple the macOS stddoc binaries produced by `make release`.
#
# The credentials are DAVID'S and are NOT guessable. This script reads them from
# the environment and refuses to invent anything. If they're unset it prints
# exactly what's needed and exits 0 — an unsigned dev build still ships, just
# without the Gatekeeper blessing.
#
#   DAVID MUST PROVIDE (one-time, in his shell or CI secrets):
#     STDDOC_SIGN_IDENTITY   "Developer ID Application: Your Name (TEAMID)"
#                            → the exact string from `security find-identity -v -p codesigning`
#     STDDOC_NOTARY_PROFILE  name of a notarytool keychain profile, created once via:
#                            xcrun notarytool store-credentials STDDOC_NOTARY_PROFILE \
#                              --apple-id <apple-id> --team-id <TEAMID> \
#                              --password <app-specific-password>
#
# Then: make release && make sign
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DIST="$REPO/dist"

if [ -z "${STDDOC_SIGN_IDENTITY:-}" ] || [ -z "${STDDOC_NOTARY_PROFILE:-}" ]; then
  cat <<'EOF'
─────────────────────────────────────────────────────────────────────────────
stddoc sign: signing credentials not set — skipping (this is fine for dev).

To produce a signed, notarized release, David must set two env vars:

  export STDDOC_SIGN_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
  export STDDOC_NOTARY_PROFILE="STDDOC_NOTARY_PROFILE"

The identity string comes from:
  security find-identity -v -p codesigning

The notary profile is created once with:
  xcrun notarytool store-credentials STDDOC_NOTARY_PROFILE \
    --apple-id <apple-id> --team-id <TEAMID> --password <app-specific-password>

Unsigned binaries still run; macOS Gatekeeper will warn end users until signed.
─────────────────────────────────────────────────────────────────────────────
EOF
  exit 0
fi

set -e
echo "stddoc sign: identity = $STDDOC_SIGN_IDENTITY"

for plat in darwin-arm64 darwin-amd64; do
  tarball="$DIST/stddoc-$plat.tar.gz"
  [ -f "$tarball" ] || { echo "  skip $plat — no artifact (run make release first)"; continue; }

  work="$(mktemp -d)"
  tar -xzf "$tarball" -C "$work"
  bin="$work/stddoc-$plat/stddoc"

  echo "→ codesign $plat (hardened runtime)…"
  codesign --force --options runtime --timestamp \
    --sign "$STDDOC_SIGN_IDENTITY" "$bin"
  codesign --verify --strict --verbose=2 "$bin"

  # Notarization works on an archive; zip just the binary for submission.
  ditto -c -k "$bin" "$work/stddoc-$plat.zip"
  echo "→ notarize $plat (waiting on Apple)…"
  xcrun notarytool submit "$work/stddoc-$plat.zip" \
    --keychain-profile "$STDDOC_NOTARY_PROFILE" --wait

  # Staple the ticket onto the binary, then re-bundle the signed artifact.
  echo "→ staple $plat…"
  xcrun stapler staple "$bin" || echo "  (stapler note: CLI binaries can't be stapled directly; ticket is served online — OK)"

  find "$work/stddoc-$plat" -name '._*' -delete
  ( cd "$work" && COPYFILE_DISABLE=1 tar -czf "$tarball" "stddoc-$plat" )
  echo "✓ signed + notarized $plat → $tarball"
  rm -rf "$work"
done

echo "----"
echo "stddoc sign: done. Verify a binary with:  spctl -a -vvv -t install <binary>"
