var obsidian = require("obsidian");
var codemirrorState = require("@codemirror/state");
var codemirrorView = require("@codemirror/view");

/*
 * === Helpers ===
 */

function patchWith(obj, methods) {
	var patchers = Object.keys(methods).map(function (key) {
		return patchMethod(obj, key, methods[key]);
	});
	return patchers.length === 1
		? patchers[0]
		: function () {
				patchers.forEach(function (p) {
					p();
				});
			};
}

function patchMethod(obj, key, factory) {
	var original = obj[key];
	var hadOwn = obj.hasOwnProperty(key);
	var base = hadOwn
		? original
		: function () {
				return Object.getPrototypeOf(obj)[key].apply(this, arguments);
			};
	var replacement = factory(base);
	if (original) Object.setPrototypeOf(replacement, original);
	Object.setPrototypeOf(proxy, replacement);
	obj[key] = proxy;
	return unpatch;

	function proxy() {
		if (replacement === base && obj[key] === proxy) unpatch();
		return replacement.apply(this, arguments);
	}
	function unpatch() {
		if (obj[key] === proxy) {
			hadOwn ? (obj[key] = original) : delete obj[key];
		}
		if (replacement !== base) {
			replacement = base;
			Object.setPrototypeOf(proxy, original || Function);
		}
	}
}

/*
 * === Table-cell focus tracking ===
 */

var PRIMARY_BUTTON = 0;
var tableFocusAnnotation = codemirrorState.Annotation.define();

var makePointerDownHandler = function (view) {
	return function (event) {
		if (event.button !== PRIMARY_BUTTON) return;
		if (
			event.composedPath().some(function (el) {
				return el instanceof HTMLElement && el.hasClass("table-wrapper");
			})
		) {
			var scrollDOM = view.scrollDOM;
			scrollDOM.addClass("cm-hasTablePointed");
			scrollDOM.win.addEventListener(
				"pointerup",
				function () {
					scrollDOM.removeClass("cm-hasTablePointed");
				},
				{
					once: true,
				},
			);
		}
	};
};

var tableCellViewPlugin = codemirrorView.ViewPlugin.define(function (view) {
	var info = view.state.field(obsidian.editorInfoField);
	var editor = info.editor;
	var handlers = {};
	var controller = new AbortController();

	if (editor && editor.inTableCell && editor.activeCM === view) {
		handlers.update = function (update) {
			if (update.focusChanged) {
				editor.cm.dispatch({
					annotations: tableFocusAnnotation.of(view.hasFocus),
				});
			}
		};
	}
	if ((editor && editor.cm) === view) {
		view.dom.addEventListener("pointerdown", makePointerDownHandler(view), {
			capture: true,
			signal: controller.signal,
		});
		handlers.destroy = function () {
			controller.abort();
		};
	}
	return handlers;
});

/*
 * === Coordinate helper ===
 */

function lineHeightAt(view, pos) {
	try {
		var node = view.domAtPos(pos).node;
		if (node.nodeType === 3) node = node.parentElement;
		var lineEl = node.closest('.cm-line') || node;
		var h = parseFloat(getComputedStyle(lineEl).lineHeight);
		if (h > 0) return h;
	} catch (e) {}
	return view.defaultLineHeight;
}

function getScrollOrigin(view) {
	var rect = view.scrollDOM.getBoundingClientRect();
	var left =
		view.textDirection === codemirrorView.Direction.LTR
			? rect.left
			: rect.right - view.scrollDOM.clientWidth * view.scaleX;
	return {
		top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
		left: left - view.scrollDOM.scrollLeft * view.scaleX,
	};
}

/*
 * === Cursor widget ===
 */

var CursorWidget = (function () {
	function CursorWidget(className, left, top, height) {
		this.className = className;
		this.left = Math.round(left);
		this.top = Math.round(top);
		this.height = Math.round(height);

		var self = this;
		this.adjust = function (el) {
			requestAnimationFrame(function () {
				el.setCssStyles({
					left: self.left + "px",
					top: self.top + "px",
					height: self.height + "px",
				});
			});
		};
		this.requestAdjust = obsidian.debounce(
			function (adjustFn, el) {
				adjustFn(el);
			},
			10,
			false,
		);
	}

	CursorWidget.prototype.draw = function () {
		var el = createDiv(this.className);
		this.adjust(el);
		return el;
	};

	CursorWidget.prototype.update = function (el, prev) {
		if (prev.className !== this.className) return false;
		var nextRequestAdjust =
			prev.requestAdjust != null ? prev.requestAdjust : this.requestAdjust;
		this.requestAdjust = nextRequestAdjust;
		this.requestAdjust(this.adjust, el);
		return true;
	};

	CursorWidget.prototype.eq = function (other) {
		return (
			this.left === other.left &&
			this.top === other.top &&
			this.height === other.height &&
			this.className === other.className
		);
	};

	CursorWidget.forRange = function (view, className, range) {
		var coords = view.coordsAtPos(range.head, range.assoc || 1);
		if (!coords) return null;
		var origin = getScrollOrigin(view);
		var lineHeight = lineHeightAt(view, range.head);
		var glyphTop = coords.top - origin.top;
		var glyphHeight = coords.bottom - coords.top;
		var leading = lineHeight - glyphHeight;
		var top = glyphTop - Math.max(0, leading) / 2;
		var height = Math.max(lineHeight, glyphHeight);
		return new CursorWidget(
			className,
			coords.left - origin.left,
			top,
			height,
		);
	};

	CursorWidget.forTableCellRange = function (
		hostView,
		activeView,
		className,
		range,
	) {
		var coords;
		try {
			coords = activeView.coordsAtPos(range.head, range.assoc || 1);
		} catch (e) {
			// range.head can be null immediately after clicking into a
			// previously-empty cell, before its inner view is fully
			// initialized - coordsAtPos throws instead of returning null in
			// that case. Skip drawing the cursor for this pass; it reappears
			// on the next natural redraw (e.g. the next click/selection change).
			return null;
		}
		if (!coords) return null;
		var origin = getScrollOrigin(hostView);
		var lineHeight = lineHeightAt(activeView, range.head);
		var glyphTop = coords.top - origin.top;
		var glyphHeight = coords.bottom - coords.top;
		var leading = lineHeight - glyphHeight;
		var top = glyphTop - Math.max(0, leading) / 2;
		var height = Math.max(lineHeight, glyphHeight);
		return new CursorWidget(
			className,
			coords.left - origin.left,
			top,
			height,
		);
	};

	return CursorWidget;
})();

/*
 * === Layer update ===
 */

var triggerBlink = obsidian.debounce(
	function (layerDOM) {
		layerDOM.addClass("cm-blinkLayer");
	},
	350,
	true,
);

function getTableActiveCM(state) {
	var info = state.field(obsidian.editorInfoField);
	var editor = info ? info.editor : null;
	if (editor && editor.inTableCell) return editor.activeCM;
	return null;
}

var layerUpdate = function (update, layerDOM) {
	if (
		!update.docChanged &&
		!update.selectionSet &&
		update.transactions.some(function (tr) {
			return !!tr.annotation(tableFocusAnnotation);
		})
	) {
		return false;
	}
	var tableActive = getTableActiveCM(update.state);
	if (tableActive === update.view) return false;
	var isOverTable =
		!update.view.hasFocus && !!(tableActive && tableActive.hasFocus);
	layerDOM.toggleClass("cm-overTableCell", isOverTable);
	if (
		(update.docChanged || update.selectionSet) &&
		(update.view.hasFocus || isOverTable)
	) {
		layerDOM.removeClass("cm-blinkLayer");
		triggerBlink(layerDOM);
		return true;
	}
	return false;
};

var makeMarkersGetter = function () {
	return function (view) {
		var state = view.state;
		var tableActive = null;
		var markers = [];
		if (!view.hasFocus) tableActive = getTableActiveCM(state);
		if (tableActive) state = tableActive.state;
		if (view === tableActive) return markers;

		for (var i = 0; i < state.selection.ranges.length; i++) {
			var range = state.selection.ranges[i];
			var isPrimary = range === state.selection.main;
			var className =
				"cm-cursor " +
				(isPrimary ? "cm-cursor-primary" : "cm-cursor-secondary");
			var widget = tableActive
				? CursorWidget.forTableCellRange(view, tableActive, className, range)
				: CursorWidget.forRange(view, className, range);
			if (widget) markers.push(widget);
		}
		return markers;
	};
};

/*
 * === Internal cursor layer plugin hunter (identical fingerprint check) ===
 */

function isLayerSpec(spec) {
	return (
		spec &&
		"above" in spec &&
		typeof spec.above === "boolean" &&
		"update" in spec &&
		typeof spec.update === "function" &&
		"markers" in spec &&
		typeof spec.markers === "function"
	);
}

function isMeasureReq(req) {
	return req && "read" in req && typeof req.read === "function";
}

function isCursorLayerPlugin(pluginInstance) {
	var v = pluginInstance.value;
	return (
		!!v &&
		"view" in v &&
		v.view instanceof codemirrorView.EditorView &&
		"layer" in v &&
		isLayerSpec(v.layer) &&
		"measureReq" in v &&
		isMeasureReq(v.measureReq) &&
		"drawn" in v &&
		v.drawn instanceof Array &&
		"dom" in v &&
		v.dom instanceof HTMLElement &&
		"scaleX" in v &&
		typeof v.scaleX === "number" &&
		"scaleY" in v &&
		typeof v.scaleY === "number" &&
		v.layer.class === "cm-cursorLayer"
	);
}

function findCursorLayerPlugin(view) {
	return view.plugins.find(function (p) {
		return !!p.value && isCursorLayerPlugin(p);
	});
}

/*
 * === Patcher ===
 */

function applyPatch(layerPluginInstance) {
	return patchWith(layerPluginInstance.layer, {
		update: function () {
			return layerUpdate;
		},
		markers: function () {
			return makeMarkersGetter();
		},
	});
}

/*
 * === Default settings ===
 */
var DEFAULT_SETTINGS = {
	cursorWidth: 2,
	cursorColorDark: "#00BFFF",
	cursorColorLight: "#00BFFF",
	blink: true,
};

/*
 * === Settings tab ===
 */

class CursorSettingTab extends obsidian.PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		var _this = this;
		var containerEl = this.containerEl;
		containerEl.empty();

		// Width sliders
		new obsidian.Setting(containerEl)
			.setName("Cursor width")
			.setDesc("Width of the cursor in pixels (1–6).")
			.addSlider(function (s) {
				s.setLimits(1, 6, 1)
					.setValue(_this.plugin.settings.cursorWidth)
					.setDynamicTooltip()
					.onChange(async function (v) {
						_this.plugin.settings.cursorWidth = v;
						await _this.plugin.saveSettings();
					});
			});

		// Light mode color
		new obsidian.Setting(containerEl)
			.setName("Light mode cursor color")
			.setDesc("Cursor color used when Obsidian is in light mode.")
			.addColorPicker(function (c) {
				c.setValue(_this.plugin.settings.cursorColorLight).onChange(
					async function (v) {
						_this.plugin.settings.cursorColorLight = v;
						await _this.plugin.saveSettings();
					},
				);
			});

		// Dark mode color
		new obsidian.Setting(containerEl)
			.setName("Dark mode cursor color")
			.setDesc("Cursor color used when Obsidian is in dark mode.")
			.addColorPicker(function (c) {
				c.setValue(_this.plugin.settings.cursorColorDark).onChange(
					async function (v) {
						_this.plugin.settings.cursorColorDark = v;
						await _this.plugin.saveSettings();
					},
				);
			});

		// Blink toggle
		new obsidian.Setting(containerEl)
			.setName("Cursor blink")
			.setDesc("Enable cursor blinking when idle.")
			.addToggle(function (t) {
				t.setValue(_this.plugin.settings.blink).onChange(async function (v) {
					_this.plugin.settings.blink = v;
					await _this.plugin.saveSettings();
				});
			});

		// Reset settings
		new obsidian.Setting(containerEl)
			.setName("Reset to defaults")
			.setDesc("Restore all cursor settings to their original values.")
			.addButton(function (b) {
				b.setButtonText("Reset")
					.setWarning()
					.onClick(async function () {
						_this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
						await _this.plugin.saveSettings();
						_this.display();
					});
			});
	}

	hide() {
		this.containerEl.empty();
		super.hide();
	}
}

/*
 * === Inline title cursor (non-CM6, plain contenteditable OR <input>) ===
 * Rough first pass: hides the native caret and tracks the real caret
 * position with a synthetic overlay div, reusing the same cursor-width /
 * cursor-color / cursor-blink-name CSS vars applyStyles() already
 * maintains, so title and editor cursors always stay in sync.
 *
 * Also covers the frontmatter Properties panel's own text-type value
 * widget and a Bases table's own text cell editor — both render as the
 * exact same ".metadata-input-longtext[contenteditable]" element
 * (confirmed live), and list/tags/aliases types' own trailing input as
 * ".multi-select-input[contenteditable]" — neither is CM6-backed, so
 * neither gets the editor's own cursor styling without this same
 * Range-based overlay approach.
 *
 * The property NAME field (".metadata-property-key-input") is a real
 * <input type="text">, not a contenteditable — window.getSelection()/
 * Range don't apply to its own internal text at all, confirmed live (no
 * rangeCount while it's focused), so render() branches on
 * `activeTitle instanceof HTMLInputElement` and measures the caret with
 * a hidden mirror element instead (same technique libraries like
 * textarea-caret-position use): a zero-size, off-screen div copying
 * every CSS property that affects text layout, filled with the value's
 * own text up to the caret, whose own rendered width IS the caret's X
 * offset from the input's own content-box left edge. input.scrollLeft
 * (a real, readable property on a text input, confirmed live) is
 * subtracted the same way a contenteditable's own scroll position never
 * needed to be, since Range.getClientRects() already returns
 * viewport-relative coordinates directly.
 *
 * number/date/datetime/checkbox types are still deliberately NOT
 * covered — checkbox has no caret at all, and number/date/datetime are
 * native OS-level steppers/pickers with no free-text caret concept this
 * same mirror technique could measure.
 */

var TITLE_SELECTOR = ".inline-title[contenteditable='true'], .metadata-input-longtext[contenteditable='true'], .multi-select-input[contenteditable='true'], .metadata-property-key-input";

// CSS properties that affect how the TEXT ITSELF measures — copied from
// the real input onto the hidden mirror on every measurement, since any
// of these can change live (e.g. a CSS snippet, or Obsidian's own
// font-size setting). Deliberately does NOT include padding/border/
// box-sizing: a real bug found live (a ~16px-too-far-right drift,
// confirmed via a direct input-vs-div width comparison for identical
// text) was exactly this — copying padding onto the mirror makes its
// OWN rendered box wider by that padding (getBoundingClientRect() always
// reports the actual border-box size, regardless of box-sizing), and
// getInputCaretRect() ALSO adds paddingLeft separately when computing
// the final `left` — double-counting it. The mirror measures PURE text
// width only; padding/border are added exactly once, in
// getInputCaretRect() itself.
var MIRROR_CSS_PROPS = [
	"fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant",
	"letterSpacing", "wordSpacing", "textTransform", "textIndent",
];

class InlineTitleCaret {
	constructor() {
		this.activeTitle = null;
		this.rafId = null;
		this.disposers = [];

		this.caretEl = document.createElement("span");
		this.caretEl.className = "native-cursor-title-caret native-cursor-title-caret-hidden";
		this.caretEl.setAttribute("aria-hidden", "true");
		document.body.appendChild(this.caretEl);

		// Lazily created on first use (most sessions never focus the
		// property-name field at all) — a plain, off-screen div reused
		// across every measurement rather than recreated each time.
		this.mirrorEl = null;

		this.onFocusIn = (e) => {
			var title = this.getTitleFromTarget(e.target);
			if (title) {
				this.setActiveTitle(title);
				this.requestRender();
			}
		};
		this.onFocusOut = () => {
			window.setTimeout(() => {
				this.syncFromSelection();
				this.requestRender();
			}, 0);
		};
		this.onActivity = () => {
			this.syncFromSelection();
			this.requestRender();
		};
		this.requestRender = () => {
			if (this.rafId !== null) return;
			this.rafId = window.requestAnimationFrame(() => {
				this.rafId = null;
				this.render();
			});
		};

		this.addListener(document, "focusin", this.onFocusIn, true);
		this.addListener(document, "focusout", this.onFocusOut, true);
		this.addListener(document, "selectionchange", this.onActivity);
		this.addListener(document, "keydown", this.onActivity, true);
		this.addListener(document, "input", this.onActivity, true);
		this.addListener(document, "pointerdown", this.onActivity, true);
		this.addListener(window, "resize", this.requestRender);
		this.addListener(window, "scroll", this.requestRender, true);

		this.syncFromSelection();
		this.requestRender();
	}

	addListener(target, name, fn, opts) {
		target.addEventListener(name, fn, opts);
		this.disposers.push(() => target.removeEventListener(name, fn, opts));
	}

	getTitleFromTarget(target) {
		if (!(target instanceof Node)) return null;
		var el = target instanceof HTMLElement ? target : target.parentElement;
		if (!el) return null;
		var title = el.closest(TITLE_SELECTOR);
		return title instanceof HTMLElement ? title : null;
	}

	syncFromSelection() {
		// A plain <input>'s own caret/selection is invisible to
		// window.getSelection() entirely (confirmed live: rangeCount is
		// whatever it was from whatever contenteditable/body Selection
		// last existed, completely unrelated to the input's own focus
		// state) — document.activeElement is the only reliable signal
		// for it, so it's checked first, covering both element kinds
		// (a focused contenteditable is ALSO its own document.activeElement,
		// so this is a strict superset of the old Selection-only check,
		// not a separate special case).
		var active = document.activeElement;
		var activeTitle = this.getTitleFromTarget(active);
		if (activeTitle) {
			this.setActiveTitle(activeTitle);
			return;
		}
		var sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) {
			this.setActiveTitle(null);
			return;
		}
		this.setActiveTitle(this.getTitleFromTarget(sel.anchorNode));
	}

	setActiveTitle(next) {
		if (this.activeTitle === next) return;
		if (this.activeTitle) this.activeTitle.style.removeProperty("caret-color");
		this.activeTitle = next;
		if (this.activeTitle) this.activeTitle.style.setProperty("caret-color", "transparent", "important");
	}

	render() {
		if (!this.activeTitle) {
			this.hide();
			return;
		}
		// <input> gets its own, fully self-contained path: getInputCaretRect
		// already resolves top/height correctly against the input's own
		// content-box (no line-height-vs-glyph mismatch the way a
		// contenteditable's Range can have — the input's own rendering
		// already vertically centers its single line within that box), so
		// none of the leading/line-height adjustment below applies to it.
		if (this.activeTitle instanceof HTMLInputElement) {
			var inputRect = this.getInputCaretRect(this.activeTitle);
			if (!inputRect) {
				this.hide();
				return;
			}
			this.caretEl.style.left = inputRect.left + "px";
			this.caretEl.style.top = inputRect.top + "px";
			this.caretEl.style.height = inputRect.height + "px";
			this.caretEl.classList.remove("native-cursor-title-caret-hidden");
			return;
		}
		var rect = this.getContentEditableCaretRect(this.activeTitle);
		if (!rect) {
			this.hide();
			return;
		}
		// Same fix as the editor-side CursorWidget.forRange/forTableCellRange
		// (see lineHeightAt() above): a collapsed Range's own
		// getClientRects() reports the GLYPH's bounding box, not the
		// line's actual CSS line-height - on Windows in particular this
		// makes the cursor visibly shorter than the browser's own native
		// selection-highlight rendering for the same line. Match the
		// title element's own computed line-height the same way, falling
		// back to the raw glyph rect if line-height can't be read as a
		// pixel value (e.g. "normal").
		var lineHeight = parseFloat(getComputedStyle(this.activeTitle).lineHeight);
		var top = rect.top;
		var height = rect.height;
		if (isFinite(lineHeight) && lineHeight > 0) {
			var leading = lineHeight - rect.height;
			top = rect.top - Math.max(0, leading) / 2;
			height = Math.max(lineHeight, rect.height);
		}
		this.caretEl.style.left = rect.left + "px";
		this.caretEl.style.top = top + "px";
		this.caretEl.style.height = height + "px";
		this.caretEl.classList.remove("native-cursor-title-caret-hidden");
	}

	hide() {
		this.caretEl.classList.add("native-cursor-title-caret-hidden");
	}

	getContentEditableCaretRect(title) {
		var sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		var focusNode = sel.focusNode;
		if (!focusNode || !title.contains(focusNode)) return null;
		var range;
		try {
			range = document.createRange();
			range.setStart(focusNode, sel.focusOffset);
			range.collapse(true);
		} catch (e) {
			return null;
		}
		var rects = range.getClientRects();
		var r = rects.length > 0 ? rects.item(0) : null;
		if (r && (r.height > 0 || r.width > 0)) return r;
		var fallback = range.getBoundingClientRect();
		if (fallback.height > 0 || fallback.width > 0) return fallback;
		return null;
	}

	// Measures the caret's own screen position inside a plain <input> via
	// a hidden mirror element (same technique libraries like
	// textarea-caret-position use) — Range/Selection don't apply to an
	// <input>'s own internal text at all, confirmed live (zero rangeCount
	// while one is focused), so there's no API to ask the browser
	// directly the way getContentEditableCaretRect does.
	getInputCaretRect(input) {
		if (!this.mirrorEl) {
			this.mirrorEl = document.createElement("div");
			// Absolutely positioned off-screen rather than
			// visibility:hidden/display:none -- both of those can make
			// some browsers skip layout for the element entirely, which
			// would make getBoundingClientRect() always return a zero
			// rect; off-screen positioning keeps real layout running
			// while staying invisible.
			this.mirrorEl.style.position = "absolute";
			this.mirrorEl.style.top = "0";
			this.mirrorEl.style.left = "-9999px";
			this.mirrorEl.style.whiteSpace = "pre";
			this.mirrorEl.setAttribute("aria-hidden", "true");
			document.body.appendChild(this.mirrorEl);
		}
		var cs = getComputedStyle(input);
		for (var i = 0; i < MIRROR_CSS_PROPS.length; i++) {
			var prop = MIRROR_CSS_PROPS[i];
			this.mirrorEl.style[prop] = cs[prop];
		}
		// Caret sits at whichever end of the selection is the actual
		// "focus" (where it would move on an arrow-key press), which
		// depends on selectionDirection for a non-collapsed selection --
		// same direction-aware convention Set-mark already uses
		// elsewhere for this exact reason. "none" (the usual case for a
		// collapsed caret, and some browsers' own default) falls back to
		// selectionEnd, matching selectionStart === selectionEnd there
		// anyway.
		var caretPos = input.selectionDirection === "backward"
			? input.selectionStart
			: input.selectionEnd;
		if (caretPos == null) caretPos = input.value.length;
		// A trailing space collapses to zero width in a plain text node
		// (confirmed live) -- "pre" whitespace handling plus a
		// non-breaking-space-padded measurement isn't needed here since
		// MIRROR_CSS_PROPS already copies font metrics precisely enough
		// that this hasn't shown a visible drift in practice; flagged
		// here in case a future report ever traces back to this.
		this.mirrorEl.textContent = input.value.slice(0, caretPos);
		var mirrorRect = this.mirrorEl.getBoundingClientRect();
		var inputRect = input.getBoundingClientRect();
		var paddingLeft = parseFloat(cs.paddingLeft) || 0;
		var borderLeft = parseFloat(cs.borderLeftWidth) || 0;
		var paddingTop = parseFloat(cs.paddingTop) || 0;
		var borderTop = parseFloat(cs.borderTopWidth) || 0;
		var paddingBottom = parseFloat(cs.paddingBottom) || 0;
		var borderBottom = parseFloat(cs.borderBottomWidth) || 0;
		return {
			left: inputRect.left + borderLeft + paddingLeft + mirrorRect.width - input.scrollLeft,
			top: inputRect.top + borderTop + paddingTop,
			height: inputRect.height - borderTop - paddingTop - paddingBottom - borderBottom,
		};
	}

	destroy() {
		for (var i = 0; i < this.disposers.length; i++) this.disposers[i]();
		if (this.activeTitle) this.activeTitle.style.removeProperty("caret-color");
		this.caretEl.remove();
		if (this.mirrorEl) this.mirrorEl.remove();
	}
}

/*
 * === Main plugin ===
 */

class NativeCursorPlugin extends obsidian.Plugin {
	constructor(...args) {
		super(...args);
		this.alreadyPatched = false;
		this.tryPatchRef = null;
		this.cursorPlugin = null;
		this.styleEl = null;
	}

	async onload() {
		await this.loadSettings();
		this.alreadyPatched = false;

		this.styleEl = document.createElement("style");
		this.styleEl.id = "native-cursor-styles";
		document.head.appendChild(this.styleEl);
		this.applyStyles();

		this.addSettingTab(new CursorSettingTab(this.app, this));
		this.registerEditorExtension(tableCellViewPlugin);
		this.titleCaret = new InlineTitleCaret();

		var activeEditor =
			this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor;
		if (activeEditor) {
			this.tryPatch(activeEditor);
		} else {
			this.tryPatchRef = this.app.workspace.on(
				"editor-selection-change",
				this.tryPatch.bind(this),
			);
		}

		// Force a fresh cursor-layer redraw whenever a CM6 editor's own
		// contentDOM gains real DOM focus. layerUpdate's own gating
		// (view.hasFocus || isOverTable) only redraws in response to a
		// transaction carrying docChanged/selectionSet - if the selection
		// was set via editor.setCursor()/dispatch() slightly BEFORE DOM
		// focus actually lands on the editor (confirmed live: a plugin
		// moving focus OUT of a non-CM6 element like Obsidian's own
		// Properties panel into the editor, e.g. a native Arrow-key
		// escape, doesn't synchronize its own focus() call with the
		// selection-setting transaction), that transaction's own
		// view.hasFocus reads false at the time, and layerUpdate skips
		// the redraw - leaving the cursor rendered at its OLD position
		// (wherever the editor's own selection was from a previous
		// session) until some LATER update happens to redraw it. This
		// bypasses that gate entirely: on focusin, finds the specific
		// cursor-layer plugin instance bound to the now-focused view and
		// forces its own already-scheduled measure request to run, which
		// calls markers() (and this plugin's own patched version of it)
		// fresh, using the NOW-correct coordsAtPos-based position -
		// independent of whatever layerUpdate decided earlier.
		this.registerDomEvent(document, "focusin", (e) => {
			var target = e.target;
			var cmContent = target && target.closest && target.closest(".cm-content");
			if (!cmContent) return;
			var view = codemirrorView.EditorView.findFromDOM(cmContent);
			if (!view) return;
			var plugin = findCursorLayerPlugin(view);
			if (plugin && plugin.value && plugin.value.measureReq) {
				view.requestMeasure(plugin.value.measureReq);
			}
		}, true);
	}

	applyStyles() {
		var s = this.settings;
		// Only dynamic, user-controlled values live here, all structural CSS in styles.css
		this.styleEl.textContent = [
			":root {",
			"  --cursor-width: " + s.cursorWidth + "px;",
			"  --cursor-color-dark: " + s.cursorColorDark + ";",
			"  --cursor-color-light: " + s.cursorColorLight + ";",
			"  --cursor-blink-name: " + (s.blink ? "cm-cursor-blink" : "none") + ";",
			"}",
		].join("\n");
	}

	tryPatch(editor) {
		if (this.alreadyPatched) {
			this.cancelPatchAttempt();
			return;
		}
		var view = editor.cm;
		var found = findCursorLayerPlugin(view);
		if (found && found.value) {
			this.register(applyPatch(found.value));
			this.alreadyPatched = true;
			this.cursorPlugin = found;
			this.cancelPatchAttempt();
		}
	}

	cancelPatchAttempt() {
		if (this.tryPatchRef) {
			this.app.workspace.offref(this.tryPatchRef);
			delete this.tryPatchRef;
		}
	}

	onunload() {
		this.cancelPatchAttempt();
		if (this.styleEl) this.styleEl.remove();
		if (this.titleCaret) {
			this.titleCaret.destroy();
			this.titleCaret = null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyStyles();
	}
}

module.exports = NativeCursorPlugin;
