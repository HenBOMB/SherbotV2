import { SlashCommandBuilder, CommandInteraction, TextChannel } from "discord.js";
import axios from "axios";

const OPTIONS = {
	method: 'POST',
	url: 'https://open-ai21.p.rapidapi.com/chatbotapi',
	headers: {
		'content-type': 'application/json',
		'X-RapidAPI-Key': '7e9353ff96msh3df3c16bd72b93fp18d49fjsn132fdefd5328',
		'X-RapidAPI-Host': 'open-ai21.p.rapidapi.com'
	},
	data: {
		bot_id: 'OEXJ8qFp5E5AwRwymfPts90vrHnmr8yZgNE171101852010w2S0bCtN3THp448W7kDSfyTf3OpW5TUVefz',
		user_id: '',
		// ? 0.1 prompts a more focused and expected answer, while 0.8 encourages a more creative response
		temperature: 0.9, 
		top_k: 3,
		top_p: 0.5,
		max_tokens: 256,
		model: 'matag2.0'
	}
};

const PROMPT = 
`I want you to act like %name%.
I want you to respond and answer like the chracter.
I want you to reply at the end of your sentence with any action %name% takes.
I want you to answer to be surrounded with "" (quotation marks).
%name%'s available actions: 
- /leave: Leave the conversation (When %name% wants to stop talking).
- /continue: Continue the conversation with the user (When %name% asks a question.. or not, depends).
- /ban: Ban the user. (When user is NSFW, sexist, rasist or inappropriate).
%name% can /ban the user if they are being inappropriate, said anything NSFW, sexist or rasist.
%name% can /leave the conversation at any time if he feel's uncomfortable, irritated or if the topic is inappropriate.`

class NPC {
	constructor(options, traits, other=[])
	{
		const { name, avatar } = options;

		this.name = name;

		this.avatar = avatar;
		
		/**
		 * @private
		 */
		this.role = 
		`${PROMPT}
		${traits.map(x => `%name% ${x}.`).join('\n')}
		${other.join('\n')}`.replace(/%name%/g, name);
		// %name%'s memory of the current conversation is:
		// [Henry] I know you did it..
		// [%name%] And what, pray tell, do you think I've done?
		// [Henry] Oh come on don't play dumb.
		// inappropriate topics really piss off %name$.
		/**
		 * @private
		 */
		this.memory = [];
	}

	/**
	 * @param {string} name - Name of the emitter.
	 * @param {string} sentence - Sentence to ask bot.
	 * @param {TextChannel} channel - Text channel to reply in.
	 * @returns {Promise<boolean>} True if success.
	 */
	async respond(name, sentence, channel) 
	{
		const hook = await channel.fetchWebhooks().then(hooks => hooks.find(hook => hook.name.includes(this.name))) 
		|| await channel.createWebhook({
			name: this.name,
			avatar: this.avatar,
			reason: 'Added character npc hook ' + this.name
		}).catch(() => null);

		if(!hook) return false;

		return axios.request({
			...OPTIONS,
			data: {
				...OPTIONS.data,
				messages: [
					{
					  role: this.name,
					  content: 
					  `${this.role}
					  ${name}'s sentence is: 
					  ${sentence}`
					}
				],
			}
		})
		.then(res => {
			if(!res.data.status) return false;
			console.log('RESULT:', res.data.result);
			// const command = res.data.result.match(/\/(\w+)/)[1];
			return () => {
				return hook.send(/"(.+)"/.exec(res.data.result)[1]);
			};
		})
		.catch(err => {
			console.error(err);
			return false;
		});
	}
}

const Bart = new NPC(
	{
		name: 'Bartholomew Blackwood',
		avatar: 'https://cdn.pixabay.com/photo/2023/07/01/16/49/ai-generated-8100516_1280.jpg',
	},
	[
		'hosted a dinner party at Blackwood Manor',
		'owns the mansion The Blackwood Manor',
		'has a Narcissistic Personality Disorder',
		'is a bitter and angry person, he gets irritated when someone asks about his secrets and personal life and doesn\'t apologize for being rude under any circumstance',
		'is a wealthy and eccentric millionaire known for his passion for collecting rare artifactsis',
		'is flamboyant personality and mischievous provocateur as much as for his undeniable technical virtuosity',
		'is analytical, logical, and imaginative',
		'responds with very short, intimidating answers',
	],
	[
		'The time is 20:00, 1 hour before the dinner.',
		'%name% is having a double scotch at the bar.'
	]
);

/**
 * @type { { [key: string]: NPC } }
 */
const SUSPECTS = [ Bart ].reduce((pre, cur) => {
	pre[cur.name] = cur;
	return pre;
}, {});

export default {
    guild: '643440133881856019',
	data: new SlashCommandBuilder()
		.setName('ask')
		.setDescription('Ask a suspect a question.')
		.addStringOption(o => o
			.setName('suspect')
            .addChoices(...Object.values(SUSPECTS).map(sus => { return { name: sus.name, value: sus.name } }))
			.setDescription('Suspect to get a response from.')
			.setRequired(true)
		)
		.addStringOption(o => o
			.setName('message')
			.addChoices(...[
				'What are you doing?', 
				'I know what you did.',
			].map(text => { return { name: text, value: text } }))
			.setDescription('Message to ask.')
			.setRequired(false)
		)
		.addStringOption(o => o
			.setName('custom')
			.setDescription('Custom message to ask.')
			.setRequired(false)
		),
	/**
	 * @param {CommandInteraction} interaction 
	 */
	async execute(interaction) {
		const choice 	= interaction.options.get('suspect', true).value;
		const npc		= SUSPECTS[choice];

		if(!npc)
		{
			await interaction.reply({ content: `There is no suspect named ${choice}.`, ephemeral: true });
			return;
		}
		
		const ourSentence 	= interaction.options.get('message', false)?.value || interaction.options.get('custom', false)?.value;

		if(!ourSentence)
		{
			await interaction.reply({ content: `You must ask something!`, ephemeral: true });
			return;
		}

		const channel		= interaction.channel;
        const loadMsg		= await interaction.reply({ content: 'Generating response..', ephemeral: true });
		const ourName 		= interaction.member.displayName;

		const sendResponse 	= await npc.respond(
			ourName, 
			ourSentence,
			channel
		);
		
		await loadMsg.delete();

		if(!sendResponse) throw 'Failed to fetch response, error ^';

		const hook = await channel.fetchWebhooks().then(hooks => hooks.find(hook => hook.name.includes(ourName))) 
		|| await channel.createWebhook({
			name: ourName,
			avatar: interaction.user.displayAvatarURL(),
			reason: 'Added character user hook ' + ourName
		}).catch(() => null);

		await hook.send(ourSentence);

		await sendResponse();
	},
};