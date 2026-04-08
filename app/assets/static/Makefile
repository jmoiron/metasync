LESSC ?= lessc

STYLE_LESS := style.less
STYLE_DEPS := $(STYLE_LESS) theme.less figtree.less
STYLE_CSS := style.css

.PHONY: all
all: css

.PHONY: css
css: $(STYLE_CSS)

$(STYLE_CSS): $(STYLE_DEPS)
	$(LESSC) $(STYLE_LESS) $(STYLE_CSS)
