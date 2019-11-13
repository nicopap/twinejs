// A lightweight Vue component that wraps a CodeMirror instance.

const Vue = require('vue');
const CodeMirror = require('codemirror');

require('./codemirror-theme.less');

module.exports = Vue.extend({
	template: '<div></div>',

	props: ['options', 'text'],

	watch: {
		text() {
			// Only change CodeMirror if it's actually a meaningful change,
			// e.g. not the result of CodeMirror itself changing.

			if (this.text !== this.$cm.getValue()) {
				this.$cm.setValue(this.text);
			}
		}
	},

	compiled() {
		function dedup({ from, removed, text }) {
			let prevText = removed.join('\n');
			let newText = text.join('\n');
			let minSize = Math.min(newText.length, prevText.length);

			for (var i = 0; i < minSize; i++) {
				if (prevText[i] != newText[i]) { break; }
			}

			return {
				added: newText.substring(i),
				deleted: prevText.length - i,
				ch: from.ch + i
			};
		}
		this.$cm = CodeMirror(this.$el, this.options);
		this.$cm.setValue((this.text || '') + '');

		/*
		Remove the empty state from existing in undo history, e.g. so if the
		user immediately hits Undo, the editor becomes empty.
		*/

		this.$cm.clearHistory();

		this.$cm.on('change', (_,b) => {
			this.text = this.$cm.getValue();
			this.$dispatch('cm-change', this.text, dedup(b));
		});
	},

	attached() {
		this.$cm.focus();
	},

	events: {
		// Since CodeMirror initialises incorrectly when special CSS such as
		// scaleY is present on its containing element, it should be
		// refreshed once transition is finished - hence, this event.
		'transition-entered'() {
			this.$cm.refresh();
		}
	}
});
