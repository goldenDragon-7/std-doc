# std-doc release pipeline — one signed binary, given free.
#
# The `stddoc` binary loads its rendering library from `stddoc-lib/` *beside the
# executable* at runtime (see go/cmd/stddoc/publish.go:resolveLibRoot). So every
# artifact must ship the binary AND that data dir together. These targets enforce
# that invariant.
#
#   make build     local binary at go/stddoc (current platform)
#   make release   cross-compiled .tar.gz artifacts for the launch platforms
#   make verify    conformance gate + a smoke publish against a real artifact
#   make dist      pruned public source bundle (git archive HEAD, minus internals)
#   make sign      codesign + notarize the darwin binaries (needs signing creds)
#   make clean     remove build outputs

GO        ?= go
MODULE_DIR := go
LIB_DIR    := go/stddoc-lib
DIST       := dist

# Version: an explicit VERSION= wins; else git describe; else "dev".
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS  := -s -w -X main.version=$(VERSION)

# Launch platforms: macOS arm64 + Intel, Linux amd64 + arm64, Windows amd64.
# CGO_ENABLED=0 + pure-Go deps → one static binary per ARCH covers every distro
# (no glibc/musl linkage); cross-compiled entirely from one host, no Windows box.
PLATFORMS := darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64

.PHONY: build release verify sign clean version dist

# Internal-only paths pruned from the public source bundle (make dist).
DIST_EXCLUDE := briefs _audit_out prd HANDOFF.md CLAUDE.md COMING-ATTRACTIONS.md RELEASE.md Makefile.internal \
                .claude go/LETTER-to-the-next-maker.md go/probably_trash \
                style-interview/demo/_review-spec style-interview/demo/pager-preview \
                style-interview/demo/published-pager conformance/cases/prd-python-prep
DIST_NAME    := std-doc-$(VERSION)

build:
	cd $(MODULE_DIR) && $(GO) build -ldflags "$(LDFLAGS)" -o stddoc ./cmd/stddoc
	@echo "built go/stddoc  ($(VERSION))"

version: build
	@./$(MODULE_DIR)/stddoc version

# Cross-compile each platform and bundle binary + stddoc-lib/ into a .tar.gz.
release: clean
	@mkdir -p $(DIST)
	@set -e; for plat in $(PLATFORMS); do \
	  os=$${plat%/*}; arch=$${plat#*/}; \
	  name=stddoc-$$os-$$arch; \
	  ext=; [ "$$os" = windows ] && ext=.exe; \
	  stage=$(DIST)/$$name; \
	  echo "→ $$name ($(VERSION))"; \
	  mkdir -p $$stage; \
	  ( cd $(MODULE_DIR) && GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 \
	      $(GO) build -ldflags "$(LDFLAGS)" -o ../$$stage/stddoc$$ext ./cmd/stddoc ); \
	  cp -R $(LIB_DIR) $$stage/stddoc-lib; \
	  find $$stage -name '._*' -delete; \
	  ( cd $(DIST) && COPYFILE_DISABLE=1 tar -czf $$name.tar.gz $$name ); \
	  rm -rf $$stage; \
	done
	@echo "----"; ls -la $(DIST)/*.tar.gz

# make dist — the public, GitHub-pushable source bundle. Exports the COMMITTED
# tree only (git archive HEAD, so no untracked cruft, no .gitignored runtime
# artifacts), prunes internal-only scratch (DIST_EXCLUDE), and zips it. This is
# "the repo we'd push" — source, skill framework, self-docs, onboarding,
# LICENSE, README. Binaries are a separate concern: `make release`.
dist:
	@rm -rf $(DIST)/$(DIST_NAME) $(DIST)/$(DIST_NAME)-dist.tar.gz
	@mkdir -p $(DIST)/$(DIST_NAME)
	@git archive HEAD | tar -x -C $(DIST)/$(DIST_NAME)
	@cd $(DIST)/$(DIST_NAME) && rm -rf $(DIST_EXCLUDE)
	@find $(DIST)/$(DIST_NAME) -name '._*' -delete
	@( cd $(DIST) && COPYFILE_DISABLE=1 tar -czf $(DIST_NAME)-dist.tar.gz $(DIST_NAME) )
	@echo "----"
	@echo "public bundle:  $(DIST)/$(DIST_NAME)/   (pruned: $(DIST_EXCLUDE))"
	@echo "dist tarball:   $(DIST)/$(DIST_NAME)-dist.tar.gz"
	@du -sh $(DIST)/$(DIST_NAME) | sed 's/^/total:          /'

# Prove a real artifact works: conformance gate, then extract one tarball to a
# clean dir and publish from it (lib must travel correctly).
verify: build
	bash conformance/run_go.sh
	@$(MAKE) --no-print-directory _smoke

_smoke:
	@set -e; \
	host_os=$$($(GO) env GOOS); host_arch=$$($(GO) env GOARCH); \
	tarball=$(DIST)/stddoc-$$host_os-$$host_arch.tar.gz; \
	if [ ! -f $$tarball ]; then echo "  (building release artifacts for smoke test…)"; $(MAKE) --no-print-directory release >/dev/null; fi; \
	tmp=$$(mktemp -d); tar -xzf $$tarball -C $$tmp; \
	bin=$$tmp/stddoc-$$host_os-$$host_arch/stddoc; \
	out=$$(mktemp -d); \
	echo "smoke: $$bin publish (self-doc) --style playful"; \
	$$bin publish self-doc/source.json $$out --style playful; \
	test -f $$out/index.html && echo "✓ smoke OK — artifact published $$(ls $$out | wc -l | tr -d ' ') file(s) with its own lib"; \
	rm -rf $$tmp $$out

sign:
	bash scripts/sign-macos.sh

clean:
	rm -rf $(DIST)
	rm -f $(MODULE_DIR)/stddoc

# Maintainer-only targets (golden-master mirroring, etc.). Pruned from the public
# bundle via DIST_EXCLUDE; `-include` makes its absence a silent no-op, so a clean
# public checkout builds/verifies/releases without it.
-include Makefile.internal
