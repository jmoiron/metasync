MAKEFLAGS += --no-print-directory

LESSC ?= lessc
NODE ?= node

STYLE_LESS := style.less
STYLE_DEPS := $(STYLE_LESS) theme.less figtree.less directory-browser.less
STYLE_CSS := style.css
FA_DIR := fa

.PHONY: all
all: css

.PHONY: css
css: $(STYLE_CSS) fa

.PHONY: fa
fa:
	$(MAKE) -C $(FA_DIR)

.PHONY: test
test:
	$(NODE) --test js/tests/*.test.js

$(STYLE_CSS): $(STYLE_DEPS)
	$(LESSC) $(STYLE_LESS) $(STYLE_CSS)
