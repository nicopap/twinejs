const linkParser = require('../link-parser');
const rect = require('../../common/rect');

function byId(state, id) {
	return state.story.stories.find(s => s.id === id);
}
function pById(story, id) {
	return story.passages.find(p => p.id === id);
}

const actions = module.exports = {
	createPassage({state, dispatch}, storyId, props) {
		let story = byId(state, storyId);

		if (!story.readOnly) {
			let { name, top, left } = props;

			story.channel.pushmsg(state.userName, "add", [ name, [ left, top ]]);
			dispatch('CREATE_PASSAGE_IN_STORY', storyId, props);
		}
	},

	updatePassage({state, dispatch}, storyId, passageId, props) {
		let story = byId(state,storyId);

		if (!story.readOnly) {
			let passageName = pById(story, passageId).name;
			let sendMsg = act =>
				story.channel.pushmsg(state.userName, "set", [passageName, act]);

			if (props.top && props.left) {
				sendMsg(["location", [props.left, props.top]]);
			}
			if (props.width) {sendMsg(["size", [props.width, props.height]]);}
			if (props.name) {sendMsg(["name", props.name]);}
			if (props.deleted) {sendMsg(["del", props.ch, props.deleted]);}
			if (props.added) {sendMsg(["add", props.ch, props.added]);}
			if (props.tags) {
				let passageTags = pById(story, passageId).tags;

				if (passageTags.length > props.tags.length) {
					//FIXME: probably not what is intended here
					let delTag = passageTags[passageTags.length - 1];

					sendMsg(["remove_tag", delTag]);
				}
				else if (passageTags.length < props.tags.length) {
					let newTag = props.tags[props.tags.length - 1];

					sendMsg(["add_tag", newTag]);
				}
			}
			dispatch('UPDATE_PASSAGE_IN_STORY', storyId, passageId, props);
		}
	},

	deletePassage({ state, dispatch }, storyId, passageId) {
		let story = byId(state,storyId);

		if (!story.readOnly) {
			let passageName = pById(story, passageId).name;

			story.channel.pushmsg(state.userName, "delete", [ passageName ]);
			dispatch('DELETE_PASSAGE_IN_STORY', storyId, passageId);
		}
	},

	selectPassages({ state, dispatch }, storyId, filter) {
		let story = byId(state,storyId);

		if (!story.readOnly) {
			story.passages.forEach(p => {
				let selected = filter(p);
				let message = selected ? "select" : "deselect";

				story.channel.pushmsg(
					state.userName,
					"set",
					[ p.name, [ message, state.pref.userName ] ]
				);
				dispatch('UPDATE_PASSAGE_IN_STORY', storyId, p.id, { selected });
			});
		}
	},

	/*
	Moves a passage so it doesn't overlap any other in its story, and also
	snaps to a grid.
	*/

	positionPassage(store, storyId, passageId, gridSize, filter) {
		if (gridSize && typeof gridSize !== 'number') {
			throw new Error('Asked to snap to a non-numeric grid size: ' + gridSize);
		}

		const story = byId(store.state, storyId);

		if (!story) {
			throw new Error(`No story exists with id ${storyId}`);
		}

		const passage = story.passages.find(
			passage => passage.id == passageId
		);

		if (!passage) {
			throw new Error(
				`No passage exists in this story with id ${passageId}`
			);
		}

		const oldTop = passage.top;
		const oldLeft = passage.left;

		let passageRect = {
			top: passage.top,
			left: passage.left,
			width: passage.width,
			height: passage.height
		};

		/*
		Displacement in snapToGrid mode is set to 0 to prevent spaces
		being inserted between passages in a grid. Otherwise, overlapping
		passages are separated out with 10 pixels between them.
		*/

		const displacementDistance = (story.snapToGrid && gridSize) ?  0 : 10;

		/* Displace by other passages. */

		story.passages.forEach(other => {
			if (other === passage || (filter && !filter(other))) {
				return;
			}

			const otherRect = {
				top: other.top,
				left: other.left,
				width: other.width,
				height: other.height
			};

			if (rect.intersects(otherRect, passageRect)) {
				rect.displace(passageRect, otherRect, displacementDistance);
			}
		});

		/* Snap to the grid. */

		if (story.snapToGrid && gridSize && gridSize !== 0) {
			passageRect.left = Math.round(passageRect.left / gridSize) *
				gridSize;
			passageRect.top = Math.round(passageRect.top / gridSize) *
				gridSize;
		}

		/* Save the change if we actually changed anything. */

		if (passageRect.top !== oldTop || passageRect.left !== oldLeft) {
			actions.updatePassage(
				store,
				storyId,
				passageId,
				{
					top: passageRect.top,
					left: passageRect.left
				}
			);
		}
	},

	/*
	Adds new passages to a story based on new links added in a passage's text.
	*/

	createNewlyLinkedPassages(store, storyId, passageId, oldText, gridSize) {
		const story = byId(store.state, storyId);
		const passage = story.passages.find(p => p.id === passageId);

		/* Determine how many passages we'll need to create. */

		const oldLinks = linkParser(oldText, true);
		const newLinks = linkParser(passage.text, true).filter(
			link => (oldLinks.indexOf(link) === -1) &&
				!(story.passages.some(passage => passage.name === link))
		);

		/* We center the new passages underneath this one. */

		const newTop = passage.top + 100 * 1.5;

		/*
		We account for the total width of the new passages as both the width of
		the passages themselves plus the spacing in between.
		*/

		const totalWidth = newLinks.length * 100 +
			((newLinks.length - 1) * (100 / 2));
		let newLeft = passage.left + (100 - totalWidth) / 2;

		newLinks.forEach(link => {
			store.dispatch(
				'CREATE_PASSAGE_IN_STORY',
				storyId,
				{
					name: link,
					left: newLeft,
					top: newTop
				}
			);

			const newPassage = story.passages.find(p => p.name === link);

			if (newPassage) {
				actions.positionPassage(
					store,
					storyId,
					newPassage.id,
					gridSize
				);
			}
			else {
				console.warn('Could not locate newly-created passage in order to position it');
			}

			newLeft += 100 * 1.5;
		});
	},

	/* Updates links to a passage in a story to a new name. */

	changeLinksInStory(store, storyId, oldName, newName) {
		// TODO: add hook for story formats to be more sophisticated

		const story = byId(store.state, storyId);

		if (!story) {
			throw new Error(`No story exists with id ${storyId}`);
		}

		/*
		Escape regular expression characters.
		Taken from https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
		*/

		const oldNameEscaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const newNameEscaped = newName.replace(/\$/g, '$$$$');

		const simpleLinkRe = new RegExp(
			'\\[\\[' + oldNameEscaped + '(\\]\\[.*?)?\\]\\]',
			'g'
		);
		const compoundLinkRe = new RegExp(
			'\\[\\[(.*?)(\\||->)' + oldNameEscaped + '(\\]\\[.*?)?\\]\\]',
			'g'
		);
		const reverseLinkRe = new RegExp(
			'\\[\\[' + oldNameEscaped + '(<-.*?)(\\]\\[.*?)?\\]\\]',
			'g'
		);

		story.passages.forEach(passage => {
			if (simpleLinkRe.test(passage.text) ||
				compoundLinkRe.test(passage.text) ||
				reverseLinkRe.test(passage.text)) {
				let newText = passage.text;

				newText = newText.replace(
					simpleLinkRe,
					'[[' + newNameEscaped + '$1]]'
				);
				newText = newText.replace(
					compoundLinkRe,
					'[[$1$2' + newNameEscaped + '$3]]'
				);
				newText = newText.replace(
					reverseLinkRe,
					'[[' + newNameEscaped + '$1$2]]'
				);

				store.dispatch(
					'UPDATE_PASSAGE_IN_STORY',
					storyId,
					passage.id,
					{ text: newText }
				);
			}
		});
	}
};
