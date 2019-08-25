// The toolbar at the bottom of the screen with editing controls.

const Vue = require('vue');
const zoomMappings = require('../zoom-settings');
const {playStory, testStory} = require('../../common/launch-story');
const {closeStory, updateStory} = require('../../data/actions/story');

require('./index.less');

module.exports = Vue.extend({
	template: require('./index.html'),

	props: {
		story: {
			type: Object,
			required: true
		},

		zoomDesc: {
			type: String,
			required: true
		}
	},

	components: {
		'story-menu': require('./story-menu'),
		'story-search': require('./story-search')
	},

	methods: {
		leaveStory() {
			this.closeStory(this.story.id, this.appInfo);
		},

		setZoom(description) {
			this.updateStory(this.story.id, {zoom: zoomMappings[description]});
		},

		test() {
			testStory(this.$store, this.story.id);
		},

		play() {
			playStory(this.$store, this.story.id);
		},

		addPassage() {
			this.$dispatch('passage-create');
		}
	},

	vuex: {
		actions: {
			updateStory,
			closeStory
		},
		getters: {
			appInfo: state => state.appInfo
		}
	}
});
