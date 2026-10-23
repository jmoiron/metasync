MAKEFLAGS += --no-print-directory

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

.PHONY: js-test
js-test:
	$(MAKE) -C app/assets/static test

.PHONY: etruscan-init etruscan
etruscan-init:
	git submodule update --init --recursive exif/etruscan

etruscan: etruscan-init
	$(MAKE) -C exif/etruscan

.PHONY: build
build: css etruscan
	$(GO) build -o metasync .

.PHONY: install
install: build
	$(GO) install

.PHONY: test
test: css js-test etruscan
	$(GO) test ./...

.PHONY: fmt
fmt:
	$(GOIMPORTS) -w $(shell find . -name '*.go' -not -path './.git/*' | sort)
