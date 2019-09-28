/*
This emulates the persistence strategy used by Backbone's local storage adapter
as a Vuex middleware. This uses this basic pattern:

twine-[datakey]: a comma separated list of IDs
twine-[datakey]-[uuid]: JSON formatted data for that object

This pattern is emulated, even with structures (like prefs) that don't need
this, for compatibility.
*/

const pref = require('./pref');
const storyFormat = require('./story-format');

let enabled = true;

module.exports = store => {
	enabled = false;
	pref.load(store);
	storyFormat.load(store);
	store.subscribe((mutation, state) => {
		switch (mutation.type) {
			case 'UPDATE_PREF':
				pref.save(store);
				break;
			case 'CREATE_FORMAT':
			case 'UPDATE_FORMAT':
			case 'DELETE_FORMAT':
				storyFormat.save(store);
				break;

			default:
				break;
		}
	});
};
