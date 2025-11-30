DENO    ?= deno
ESZIP   ?= $(DENO) run --allow-read --allow-write=. --allow-env --allow-net=deno.land --no-check https://deno.land/x/eszip@v0.105.0/eszip.ts
APP_URL ?= https://edge.netlify.com

playground:
	./playground/stage1.ts

bundle:
	./playground/bundle.ts dist
	$(ESZIP) ls dist/stage1.eszip
	$(ESZIP) ls dist/stage2.eszip

# URLs derived from https://github.com/netlify/edge-bundler
bootstrap:
	$(RM) -r vendor
	$(DENO) vendor --force --reload --no-config --import-map vendor-imports.json \
		$(APP_URL)/index.ts \
		$(APP_URL)/bootstrap/index-combined.ts \
		$(APP_URL)/bootstrap/index-stage1.ts \
		$(APP_URL)/bundler/stage1.ts
	$(RM) -r src
	mv -v vendor/edge.netlify.com src
	$(RM) -r vendor

.PHONY: bootstrap bundle playground
