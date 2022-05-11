# Derived from:
# https://github.com/netlify/edge-bundler/blob/v1.1.0/src/formats/javascript.ts#L16
# https://github.com/netlify/edge-bundler/blob/v1.1.0/src/import_map.ts#L6
BOOTSTRAP_LATEST ?= https://edge-bootstrap.netlify.app/bootstrap/index-combined.ts

DENO ?= deno

playground:
	./playground/index.ts --port 9000

vendor:
	$(RM) -rf vendor
	$(DENO) vendor --force $(BOOTSTRAP_LATEST)

.PHONY: playground vendor
