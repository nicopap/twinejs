/*
A Vuex module for working with stories. This is meant to be incorporated by
index.js.
*/

const {Socket} = require('phoenix');
const uuid = require('tiny-uuid');
const locale = require('../../locale');
const idFor = require('../id');
const ui = require('../../ui');

function getStoryById(state, id) {
	return state.stories.find(story => story.id === id);
}
function getStoryByName(state, name) {
	return state.stories.find(story => story.name === name);
}

function getPassageInStory(story, id) {
	let passage = story.passages.find(passage => passage.id === id);

	if (!passage) {
		throw new Error(`No passage exists in this story with id ${id}`);
	}

	return passage;
}

const storyStore = (module.exports = {
	state: {
		stories: [],
		userName: "default user",
		socket: null,
		updateInterval: null
	},

	mutations: {
		JOIN_LOBBY_NOTIF(state, onMessageActions) {
			let socket = new Socket("/socket");

			socket.connect();
			let channel = socket.channel("library:*",{});

			Object.entries(onMessageActions)
				.forEach(([msg, handler]) => { channel.on(msg, handler); });
			channel.join()
				.receive("ok", _ => { console.log("sent a message"); })
				.receive("error", r => { console.log("Error occured:", r); });

			state.socket = socket;
		},
		JOIN_STORY_CHANNEL(state, storyId, onMessageActions) {
			let story = getStoryById(state, storyId);
			let socket = state.socket;
			let channel = socket.channel(`story:${story.name}`, {user: state.userName});

			Object.entries(onMessageActions)
				.forEach(([msg, handler]) =>
					channel.on(msg, ({body}) => {
						console.log(msg, body);
						handler(body);
					})
				);
			channel.join()
				.receive("ok", _ => { console.log("Sent a message"); })
				.receive("error", r => { console.log("Failed to send message:", r); });
			channel.pushmsg = (author, msg, body) => {
				channel.push(msg, {body, author});
			};

			story.channel = channel;
		},

		LEAVE_STORY_CHANNEL(state, storyId) {
			let story = getStoryById(state, storyId);

			story.channel.leave();
		},

		CREATE_STORY(state, props) {
			if (getStoryByName(state, props.name)) {
				console.warn(`${props.name} already exists, won't create it!`);
				return;
			}

			let story = Object.assign(
				{
					id: idFor(props.name),
					lastUpdate: new Date(),
					ifid: uuid().toUpperCase(),
					tagColors: {},
					lockId: "uninitialized lock",
					passages: []
				},
				storyStore.storyDefaults,
				props
			);

			if (story.passages) {
				story.passages.forEach(passage => (passage.story = story.id));
			}
			state.stories.push(story);
		},

		UPDATE_STORY(state, id, props) {
			let story = getStoryById(state, id);

			Object.assign(story, props);
			story.lastUpdate = new Date();
		},

		DUPLICATE_STORY(state, id, newName) {
			const original = getStoryById(state, id);

			let story = Object.assign({}, original, {
				id: idFor(newName),
				ifid: uuid().toUpperCase(),
				name: newName
			});

			/* We need to do a deep copy of the passages. */

			story.passages = [];

			original.passages.forEach(originalPassage => {
				const passage = Object.assign({}, originalPassage, {
					id: idFor(newName + originalPassage.name),
					story: story.id
				});

				if (passage.tags) {
					passage.tags = passage.tags.slice(0);
				}

				if (original.startPassage === originalPassage.id) {
					story.startPassage = passage.id;
				}

				story.passages.push(passage);
			});

			state.stories.push(story);
		},

		IMPORT_STORY(state, toImport) {
			/*
			See data/import.js for how the object that we receive is
			structured.
			*/

			toImport.id = idFor(toImport.name);

			toImport.passages.forEach(p => {
				p.id = idFor(toImport.name + p.name);
				p.story = toImport.id;

				if (p.pid === toImport.startPassagePid) {
					toImport.startPassage = p.id;
				}

				delete p.pid;
			});

			delete toImport.startPassagePid;

			let story = getStoryById(state, toImport.id);

			if (story) {
				Object.assign(story, toImport);
			}
			else {
				state.stories.push(toImport);
			}
		},

		DELETE_STORY(state, id) {
			state.stories = state.stories.filter(story => story.id !== id);
		},

		CREATE_PASSAGE_IN_STORY(state, storyId, props) {
			/*
			uuid is used here as a salt so that passages always contain unique
			IDs in Electron (which otherwise uses deterministic IDs based on
			name provided), even if you rename one to a name a previous one used
			to have.
			*/
			
			let story = getStoryById(state, storyId);
			let id = uuid();
			let newPassage =
				Object.assign({ id }, storyStore.passageDefaults, props);

			// To keep passages onscreen.
			newPassage.left = isNaN(newPassage.left) ? 0 : Math.max(0, newPassage.left);
			newPassage.top = isNaN(newPassage.top) ? 0 : Math.max(0, newPassage.top);

			newPassage.story = story.id;
			story.passages.push(newPassage);

			if (story.passages.length === 1) {
				story.startPassage = newPassage.id;
			}

			story.lastUpdate = new Date();
		},

		UPDATE_PASSAGE_IN_STORY(state, storyId, passageId, props) {
			let story = getStoryById(state, storyId);
			let passage = getPassageInStory(story, passageId);


			// To keep passages onscreen.
			props.left = isNaN(props.left) ? passage.left : Math.max(0, props.left);
			props.top = isNaN(props.top) ? passage.top : Math.max(0, props.top);

			if (props.del) {
				let { from, size } = props.del;
				let pText = passage.text;
				let patchedText = pText.slice(0,from) + pText.slice(from + size);

				props.text = patchedText;
				delete props.del;
			}
			if (props.add) {
				let { from, text } = props.add;
				let pText = passage.text;
				let patchedText = pText.slice(0,from) + text + pText.slice(from);

				props.text = patchedText;
				delete props.add;
			}
			Object.assign(passage, props);
			story.lastUpdate = new Date();
		},

		DELETE_PASSAGE_IN_STORY(state, storyId, passageId) {
			let story = getStoryById(state, storyId);

			story.passages = story.passages.filter(
				passage => passage.id !== passageId
			);
			story.lastUpdate = new Date();
		}
	},

	/* Defaults for newly-created objects. */

	storyDefaults: {
		name: locale.say('Untitled Story'),
		authors: new Set(),
		startPassage: -1,
		zoom: 1,
		snapToGrid: false,
		stylesheet: '',
		script: '',
		storyFormat: '',
		storyFormatVersion: ''
	},

	passageDefaults: {
		story: -1,
		top: 0,
		left: 0,
		width: 100,
		height: 100,
		tags: [],
		name: locale.say('Untitled Passage'),
		selected: false,

		text: ui.hasPrimaryTouchUI()
			? locale.say('Tap this passage, then the pencil icon to edit it.')
			: locale.say('Double-click this passage to edit it.')
	}
});
