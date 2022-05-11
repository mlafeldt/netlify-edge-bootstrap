# Derived from:
# https://github.com/netlify/edge-bundler/blob/v1.1.0/src/formats/javascript.ts#L16
# https://github.com/netlify/edge-bundler/blob/v1.1.0/src/import_map.ts#L6
BOOTSTRAP_LATEST ?= https://edge-bootstrap.netlify.app/bootstrap/index-combined.ts

DENO ?= deno

vendor:
	$(RM) -rf vendor
	$(DENO) vendor --force $(BOOTSTRAP_LATEST)

.PHONY: vendor
