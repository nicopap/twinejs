/*
Story-related actions.
*/

const publish = require('../publish');
const {loadFormat} = require('./story-format');
const semverUtils = require('semver-utils');
const latestFormatVersions = require('../latest-format-versions');
const importFile = require('../import');

function sendRequest(method, url, payload, callback) {
	var req = new XMLHttpRequest();

	req.open(method, url);
	req.responseType = "json";
	req.setRequestHeader("Content-Type", "application/json");

	req.onreadystatechange = () => {
		if(req.readyState === 4 && req.status === 200) {
			let response = req.response;

			callback(response);
		}
	};

	if (!payload) {
		req.send();
	}
	else {
		req.send(JSON.stringify(payload));
	}
}

const actions = (module.exports = {
    closeStory(store, id, appInfo) {
        let story = store.state.story.stories.find(s => s.id === id)
        store.dispatch('UNSET_SAVE_INTERVAL_ID', story.id)
        actions.saveRemote(store, story.id, appInfo);
        console.log(`attempting to close ${story}`)
        sendRequest(
            "POST",
            "/api/stories/" + story.name + "/close",
            { lock: story.lockId },
            (_) => { console.log(`closed ${story} succefully`) }
        )
    },

	createStory(store, props) {
		let normalizedProps = Object.assign({}, props);

		if (!normalizedProps.storyFormat) {
			normalizedProps.storyFormat = store.state.pref.defaultFormat.name;
			normalizedProps.storyFormatVersion =
				store.state.pref.defaultFormat.version;
		}
		store.dispatch('CREATE_STORY', normalizedProps);
	},

	openStory(store, {story, appInfo, userName}) {
		const storyName = encodeURI(story.name);
        const intervalId = window.setInterval(() => {
            actions.saveRemote(store, story.id, appInfo);
            actions.refreshRemote(store, story.id);
        }, 20 * 1000);
        store.dispatch('SET_SAVE_INTERVAL_ID', story.id, intervalId);

		sendRequest(
			"POST",
			"/api/stories/" + storyName + "/open",
			{ user: userName },
			(storyLockId) => {
                store.dispatch('SET_LOCK_ID', {
                    lockId: storyLockId,
                    storyId: story.id 
                })
			}
		);
	},

	updateStory({dispatch}, id, props) {
		dispatch('UPDATE_STORY', id, props);
	},

	deleteStory({dispatch}, id) {
		dispatch('DELETE_STORY', id);
	},

	duplicateStory({dispatch}, id, newName) {
		dispatch('DUPLICATE_STORY', id, newName);
	},

	importRemoteStories({dispatch}) {
		dispatch('SET_LOAD_COUNT', -1);
		dispatch('TRIM_SESSION_STORIES');
		sendRequest("GET", "/api/stories", null, (serverStories) => {
			dispatch('SET_LOAD_COUNT', -(serverStories.length));
			serverStories.forEach(storyData => {

				var req = new XMLHttpRequest();

				req.open("GET", "/api/stories/" + storyData.name);
				req.onreadystatechange = function () {

					if(req.readyState === 4 && req.status === 200) {
						let response = JSON.parse(req.responseText)
						let storyHtml = atob(response);
						let lastEdit = new Date(storyData.last_edit);
						const deserialized =
							importFile(storyHtml, lastEdit, storyData.editor);

						if (deserialized.length > 0) {
							dispatch('IMPORT_STORY', deserialized[0]);
						} else {
							console.warn(`Recieved an empty story from server ${storyData.name}`)
						}
					}
					dispatch('INCREMENT_LOAD_COUNT');
				};
				req.send();
			});
		});
	},

	importStory({dispatch}, toImport) {
		dispatch('IMPORT_STORY', toImport);
	},

	setTagColorInStory(store, storyId, tagName, tagColor) {
		const story = store.state.story.stories.find(
			story => story.id == storyId
		);
		let toMerge = {};

		toMerge[tagName] = tagColor;

		if (!story) {
			throw new Error(`No story exists with id ${storyId}`);
		}

		store.dispatch('UPDATE_STORY', storyId, {
			tagColors: Object.assign({}, story.tagColors, toMerge)
		});
	},

	saveRemote(store, storyId, appInfo) {
		const story = store.state.story.stories.find(v => v.id == storyId);

		const storyLockId = story.lockId;
		const storyName = encodeURI(story.name);
		const publishValue = publish.publishStory(appInfo, story, null, null, true);
		sendRequest(
			"POST",
			"/api/stories/" + storyName + "/save", 
			{ lock: storyLockId, file: btoa(publishValue) },
			(_) => {},
		);
	},

	// TODO
	refreshRemote(store, storyId) {
		const story = store.state.story.stories.find(v => v.id == storyId);
		const storyLockId = story.lockId;
		const storyName = encodeURI(story.name);

		sendRequest(
			"POST",
			"/api/stories/" + storyName + "/keepup",
			{ lock: storyLockId },
			(response) => { 
				console.log(response)
				/*TODO: escalate save errors*/ 
			},
		);
	},

	/*
	Removes any unused tag colors from a story.
	*/

	cleanUpTagColorsInStory(store, storyId) {
		let story = store.state.story.stories.find(
			story => story.id == storyId
		);
		let tagColors = Object.assign({}, story.tagColors);

		if (!story) {
			throw new Error(`No story exists with id ${storyId}`);
		}

		Object.keys(tagColors).forEach(tag => {
			if (story.passages.some(p => p.tags.indexOf(tag) !== -1)) {
				return;
			}

			delete tagColors[tag];
		});

		store.dispatch('UPDATE_STORY', storyId, {tagColors});
	},

	/*
	Repairs stories by ensuring that they always have a story format and
	version set.
	*/

	repairStories(store) {
		const latestVersions = latestFormatVersions(store);

		store.state.story.stories.forEach(story => {
			/*
			Reset stories without any story format.
			*/

			if (!story.storyFormat) {
				actions.updateStory(store, story.id, {
					storyFormat: store.state.pref.defaultFormat.name
				});
			}

			/*
			Coerce old SugarCube formats, which had version numbers in their
			name, to the correct built-in ones.
			*/

			if (/^SugarCube 1/.test(story.storyFormat)) {
				actions.updateStory(store, story.id, {
					storyFormat: 'SugarCube',
					storyFormatVersion: latestVersions['SugarCube']['1'].version
				});
			}
			else if (/^SugarCube 2/.test(story.storyFormat)) {
				actions.updateStory(store, story.id, {
					storyFormat: 'SugarCube',
					storyFormatVersion: latestVersions['SugarCube']['2'].version
				});
			}

			if (story.storyFormatVersion) {
				/*
				Update the story's story format to the latest available version.
				*/

				const majorVersion = semverUtils.parse(story.storyFormatVersion)
					.major;

				/* eslint-disable max-len */

				if (
					latestVersions[story.storyFormat] &&
					latestVersions[story.storyFormat][majorVersion] &&
					story.storyFormatVersion !==
						latestVersions[story.storyFormat][majorVersion].version
				) {
					actions.updateStory(store, story.id, {
						storyFormatVersion:
							latestVersions[story.storyFormat][majorVersion]
								.version
					});
				}

				/* eslint-enable max-len */
			}
			else if (latestVersions[story.storyFormat]) {
				/*
				If a story has no format version, pick the lowest major version
				number currently available.
				*/

				const majorVersion = Object.keys(
					latestVersions[story.storyFormat]
				).reduce((prev, current) => (current < prev ? current : prev));

				actions.updateStory(store, story.id, {
					/* eslint-disable max-len */
					storyFormatVersion:
						latestVersions[story.storyFormat][majorVersion].version
					/* eslint-enable max-len */
				});
			}
		});
	}
});
