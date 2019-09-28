/*
The main module managing the application's Vuex state and mutations.
*/

const Vue = require('vue');
const Vuex = require('vuex');

Vue.use(Vuex);

module.exports = new Vuex.Store({
	modules: {
		appInfo: require('./app-info'),
		pref: require('./pref'),
		story: require('./story'),
		storyFormat: require('./story-format')
	},

	plugins: [require('../local-storage')]
});
