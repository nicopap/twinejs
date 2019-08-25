// An individual item in the list managed by StoryListView.  This offers quick
// links for editing, playing, and deleting a story; StoryEditView handles more
// detailed changes.

'use strict';
const moment = require('moment');
const Vue = require('vue');
const ZoomTransition = require('../zoom-transition');
const {openStory} = require('../../data/actions/story');
const locale = require('../../locale');

require('./index.less');

function isLocked(story) {
	if (story.lock_expiry) {
		let now = Date.now();
		let expiry_date = (new Date(story.lock_expiry)).getTime();

		return now - expiry_date < 0;
	}
	else { return false; }
}

module.exports = Vue.extend({
	template: require('./index.html'),

	props: {
		story: {
			type: Object,
			required: true
		}
	},

	components: {
		'item-preview': require('./item-preview'),
		'item-menu': require('./item-menu')
	},

	computed: {
		author() { return this.story.author; },
		isLocked() { return isLocked(this.story); },

		lockedTitle() {
			let author = this.story.author;
			let msg = locale.say('This story is locked while %s is working on it.', author);

			return isLocked(this.story)? msg : '';
		},

		lastUpdateFormatted() {
			return moment(this.story.lastUpdate).format('lll');
		},

		hue() {
			// A hue based on the story's name.

			return ([this.story.name].reduce(
				(hue, char) => hue + char.charCodeAt(0), 0
			) % 40) * 90;
		}
	},

	events: {
		// If our parent wants to edit our own model, then we do so. This is
		// done this level so that we animate the transition correctly.

		'story-edit'(id) {
			if (this.story.id === id) {
				this.edit();
			}
		},

		// if we were previously editing a story, show a zoom shrinking back
		// into us. The signature is a little bit different to save time; we
		// know the ID of the story from the route, but don't have an object.

		'previously-editing'(id) {
			if (id === this.story.id) {
				// The method for grabbing the page position of our element is
				// cribbed from http://youmightnotneedjquery.com/.

				let rect = this.$el.getBoundingClientRect();

				new ZoomTransition({
					data: {
						reverse: true,
						x: rect.left + (rect.right - rect.left) / 2,
						y: rect.top + (rect.bottom - rect.top) / 2
					}
				}).$mountTo(document.body);
			}
		}
	},

	methods: {
		/**
		 Opens a StoryEditView for this story.

		 @method edit
		**/

		edit() {
			if (isLocked(this.story)) {
				return;
			}
			const pos = this.$el.getBoundingClientRect();

			this.openStory({
				story: this.story,
				appInfo: this.appInfo,
				userName: this.userName
			});
			new ZoomTransition({ data: {
				x: pos.left + pos.width / 2,
				y: pos.top,
			}}).$mountTo(this.$el).then(
				() => window.location.hash = '#stories/' + this.story.id
			);
		},
	},

	vuex: {
		actions: {
			openStory,
		},
		getters: {
			appInfo: state => state.appInfo,
			userName: state => state.pref.userName
		}
	}
});
