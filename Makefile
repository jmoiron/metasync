GO ?= go
GOIMPORTS ?= goimports

.PHONY: all
all: build

.PHONY: css
css:
	$(MAKE) -C app/assets/static css

.PHONY: icons
icons:
	$(MAKE) -C app/assets/static fa

.PHONY: build
build: css
	$(GO) build -o metasync .

.PHONY: install
install: build
	$(GO) install

.PHONY: test
test: css
	$(GO) test ./...

.PHONY: fmt
fmt:
	$(GOIMPORTS) -w $(shell find . -name '*.go' -not -path './.git/*' | sort)
