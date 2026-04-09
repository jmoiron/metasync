PYTHON ?= python3
VENV_DIR := ve
VENV_PYTHON := $(VENV_DIR)/bin/python3
OUT_CSS := icons.css
OUT_WOFF2 := icons.woff2
DEPS := minimize.py icons.spec requirements.txt fontawesome.css solid.css regular.css fa-solid-900.woff2 fa-regular-400.woff2

.PHONY: all clean

all: $(OUT_CSS) $(OUT_WOFF2)

$(OUT_CSS) $(OUT_WOFF2): $(DEPS)
	@if [ ! -x $(VENV_PYTHON) ]; then \
		$(PYTHON) -m venv $(VENV_DIR) && $(VENV_DIR)/bin/pip install -r requirements.txt; \
	fi
	$(VENV_PYTHON) minimize.py icons.spec --url /static/fa/icons.woff2

clean:
	rm -f $(OUT_CSS) $(OUT_WOFF2)
	rm -rf $(VENV_DIR)
