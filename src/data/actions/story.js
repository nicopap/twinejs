/*
Story-related actions.
*/

const publish = require('../publish');
const {loadFormat} = require('./story-format');
const semverUtils = require('semver-utils');
const latestFormatVersions = require('../latest-format-versions');
const importFile = require('../import');

let apiStory = name =>"/api/stories/" + btoa(name)
const api = {
	stories: () => "/api/stories",
	story: name => apiStory(name),
	open: name => apiStory(name) + "/open",
	close: name => apiStory(name) + "/close",
	keepup: name => apiStory(name) + "/keepup",
	save: name => apiStory(name) + "/save",
	delete: name => apiStory(name) + "/delete",
	rename: name => apiStory(name) + "/rename"
}

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

function pByName(story, passageName) {
	return story.passages.find(p => p.name == passageName)
}
function byId(store, storyId) {
	return store.state.story.stories.find(s => s.id == storyId)
}
function byName(store, storyName) {
	return store.state.story.stories.find(s => s.name == storyName)
}
function insertUnique(list, elem) {
	return (list.some(x => x === elem)) ? list.concat(elem) : list
}
function normalizeStory(store, props) {
	let normalizedProps = Object.assign({}, props);

	if (!normalizedProps.storyFormat) {
		normalizedProps.storyFormat = store.state.pref.defaultFormat.name;
		normalizedProps.storyFormatVersion =
			store.state.pref.defaultFormat.version;
	}
	return normalizedProps
}

function isLocked(story) {
	if (story.lock_expiry) {
		let now = Date.now();
		let expiry_date = (new Date(story.lock_expiry)).getTime();

		return now - expiry_date < 0;
	}
	else { return false; }
}

function messageActions({ state, dispatch }, storyId) {
	let story = byId({state}, storyId);
	return {
		set: ([passName, passageAction]) => {
			let passageId = pByName(story, passName).id
			let updatePassage = props =>
				dispatch('UPDATE_PASSAGE_IN_STORY', storyId, passageId, props);
			switch (passageAction[0]) {
				case "location": {
					let [left,top] = passageAction[1];
					updatePassage({ top, left })
					break;
				}
				case "size": {
					let [width,height] = passageAction[1];
					updatePassage({ width, height })
					break;
				}
				case "name": {
					let name = passageAction[1];
					updatePassage({ name })
					break;
				}
				case "text": {
					// HACK: we should switch to a more principled way of
					// updating text in the future
					let text = passageAction[2];
					updatePassage({ text });
					break;
				}
				case "add_tag": {
					let tag = passageAction[1];
					let passage = pByName(story, passName);
					let tags = insertUnique(passage.tags, tag);
					updatePassage({ tags })
					break;
				}
				case "remove_tag": {
					let tag = passageAction[1];
					let passage = pByName(story, passName);
					let tags = passage.tags.filter(t => t === tag);
					updatePassage({ tags })
					break;
				}
				default:
					console.log(`unknown passage action: ${passageAction[0]}`);
			}
		},
		add: ([name, [left, top]]) => {
			dispatch('CREATE_PASSAGE_IN_STORY', storyId, { name, top, left });
		},
		delete: ([passName]) => {
			let passageId = pByName(story, passName).id
			dispatch('DELETE_PASSAGE_IN_STORY', storyId, passageId);
		},
		show_pointer: ([author, [x,y]]) => {
			console.log(`sp:au${author}:${x}-${y}`)
		},
		select: ([passName, author]) => {
			let passageId = pByName(story, passName).id
			dispatch('UPDATE_PASSAGE_IN_STORY', storyId, passageId, { selected: true });
		},
		deselect: ([passName, author]) => {
			let passageId = pByName(story, passName).id
			dispatch('UPDATE_PASSAGE_IN_STORY', storyId, passageId, { selected: false });
		},
		set_story: (storyAction) => {
			switch (storyAction[0]) {
				case "starting_passage":
					let startPassage = storyAction[1];
					dispatch('UPDATE_STORY', storyId, {startPassage});
					break;
				case "tag":
					let tag = storyAction[1];
					let color = storyAction[2];
					console.log(`changing tag ${tag} color to ${color} (NOT)`);
					break;
				default:
					console.log(`unknown story action: ${storyAction[0]}`);
			}
		}
	}
};

const actions = module.exports = {
	initConn(store) {
		let dispatch = store.dispatch;
		let reactions = {
			lock: ({story, user}) => dispatch('LOCK_STORY', story, user),
			unlock: ({story}) => dispatch('UNLOCK_STORY', story),
			deleted: ({story}) =>
				dispatch('DELETE_STORY', byName(store, story).id),
			renamed: ({story, newName}) =>
				dispatch('UPDATE_STORY', story, {name: newName}),
			created: ({story, user}) => {
				let props = { author: user, name: story };
				dispatch('CREATE_STORY', normalizeStory(store, props))
			}
		};
		store.dispatch('JOIN_LOBBY_NOTIF', reactions);
	},

	closeStory(store, id, appInfo) {
		let story = byId(store, id);
		store.dispatch('LEAVE_STORY_CHANNEL', story.id);
		if (story.readOnly) return;

		store.dispatch('UNSET_SAVE_INTERVAL_ID', story.id)
		actions.saveRemote(store, story.id, appInfo);
		console.log(`attempting to close ${story.name}`)
		sendRequest(
			"POST",
			api.close(story.name),
			{ lock: story.lockId },
			(_) => console.log(`closed ${story.name} succefully`)
		)
	},

	createStory(store, props) {
		store.dispatch('CREATE_STORY', normalizeStory(store, props));
	},

	openStory(store, {story, appInfo, user}, readOnly) {
		if (readOnly) {
			let readOnlyActions = messageActions(store, story.id);
			store.dispatch('JOIN_STORY_CHANNEL', story.id, readOnlyActions);
			store.dispatch('UPDATE_STORY', story.id, { readOnly: true });
		} else {
			let writeActions = {};
			sendRequest(
				"POST",
				api.open(story.name),
				{ user },
				(lockId) => {
					const intervalId = window.setInterval(() => {
						actions.refreshRemote(store, story.id);
					}, 20 * 1000);
					store.dispatch('SET_SAVE_INTERVAL_ID', story.id, intervalId);
					store.dispatch('LOCK_STORY', story.name, user);
					store.dispatch('JOIN_STORY_CHANNEL', story.id, writeActions);
					store.dispatch('SET_LOCK_ID', {
						lockId,
						storyId: story.id 
					})
				}
			);
		}
	},

	updateStory(store, id, props) {
		let story = byId(store, id);

		if (story.readOnly) {
			return
		}
		if (props.startPassage) {
			story.channel.pushmsg("set_story", ["starting_passage", props.startPassage])
		}
		if (props.name) {
			let renameUrl = api.rename(story.name);
			sendRequest("POST", renameUrl, {newName: props.name}, (_) => {});
		} else {
			store.dispatch('UPDATE_STORY', id, props);
		}
	},

	deleteStory(store, id) {
		let story = byId(store, id);
		sendRequest("POST", api.delete(story.name), null, (_) => {});
		// We don't delete anything here, because the server will send back a
		// "deleted" message if the delection was succesful, we only want to
		// reflect the change if it was done by the server.
	},

	duplicateStory({dispatch}, id, newName) {
		dispatch('DUPLICATE_STORY', id, newName);
	},

	importRemoteStories({dispatch}) {
		sendRequest("GET", api.stories(), null, (serverStories) => {
			serverStories.forEach(storyData => {
				let name = storyData.name;

				var req = new XMLHttpRequest();

				req.open("GET", api.story(name));
				req.onreadystatechange = function () {

					if(req.readyState === 4 && req.status === 200) {
						let response = JSON.parse(req.responseText)
						const deserialized = importFile(
							atob(response),
							new Date(storyData.last_edit),
							storyData.editor,
							storyData.lock_expiry
						);

						if (deserialized.length > 0) {
							let toImport = deserialized[0]
							Object.assign(toImport, { name, id: name });
							dispatch('IMPORT_STORY', toImport);
						} else {
							console.warn(`Recieved an empty story from server ${storyData.name}, requesting delete`)
							let deleteUrl = api.delete(name)
							sendRequest("POST", deleteUrl, null, (_) => {});
						}
					}
				};
				req.send();
			});
		});
	},

	importStory({dispatch}, toImport) {
		dispatch('IMPORT_STORY', toImport);
	},

	setTagColorInStory(store, storyId, tagName, tagColor) {
		const story = byId(store, storyId);
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
		const story = byId(store, storyId);

		const storyLockId = story.lockId;
		const publishValue = publish.publishStory(appInfo, story, null, null, true);
		sendRequest(
			"POST",
			api.save(story.name),
			{ lock: storyLockId, file: btoa(publishValue) },
			(_) => {},
		);
	},

	refreshRemote(store, storyId) {
		const story = store.state.story.stories.find(v => v.id == storyId);
		const storyLockId = story.lockId;

		sendRequest(
			"POST",
			api.keepup(story.name),
			{ lock: storyLockId },
			(response) => { 
				console.log("keepup response:", response)
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
};
