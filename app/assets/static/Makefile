LESSC ?= lessc

STYLE_LESS := style.less
STYLE_DEPS := $(STYLE_LESS) theme.less figtree.less
STYLE_CSS := style.css
FA_DIR := fa

.PHONY: all
all: css

.PHONY: css
css: $(STYLE_CSS) fa

.PHONY: fa
fa:
	$(MAKE) -C $(FA_DIR)

$(STYLE_CSS): $(STYLE_DEPS)
	$(LESSC) $(STYLE_LESS) $(STYLE_CSS)
