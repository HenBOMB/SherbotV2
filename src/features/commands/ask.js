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
I want you to reply at the end of your sentence with the action %name% takes.
I want you to answer to be surrounded with "" (quotation marks).
%name%'s available actions: 
- /leave: Leave the conversation (When %name% wants to stop talking).
- /continue: Continue the conversation with the user (When %name% asks a question.. or not, depends).
- /ban: Ban the user. (When user is NSFW, sexist, rasist or inappropriate).
%name% can /ban the user if they are being inappropriate, said anything NSFW, sexist or rasist.
%name% can /leave the conversation at any time if he feel's uncomfortable, irritated or if the topic is inappropriate.
%name% only speaks English and does not understand any other language.`

export class NPC {
	/**
	 * @type {{ [ key: string ]: NPC }}
	 */
	static SUSPECTS = {};

	constructor(options, traits, other=[])
	{
		const { name, gender, avatar } = options;

		this.name = name;
		this.gender = gender;
		this.avatar = avatar;
		
		/**
		 * @private
		 */
		this.role = 
		`${PROMPT}
		${[`is ${this.gender}`, ...traits].map(x => `%name% ${x}.`).join('\n')}
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

		NPC.SUSPECTS[this.name] = this;
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
					  ${name}'s message is: ${sentence}`
					}
				],
			}
		})
		.then(res => {
			if(!res.data.status) return false;
			// "([\w, ?]+)"
			const text 	= res.data.result;
			const msg 	= /"(.+?)"/.exec(text)[1];
			const cmd 	= /\/(\w+?)/.exec(text);
			const rp 	= /\*(.+?)\*/.exec(text);
			console.log('\nResponse:', text);
			return {
				cmd: cmd? cmd[1] : null,
				rp: rp? rp[1] : null,
				cb: () => hook.send(msg)
			};
		})
		.catch(err => {
			console.error(err);
			return false;
		});
	}
}

new NPC(
	{
		name: 'Bartholomew Blackwood',
		gender: 'male',
		avatar: 'https://api.wowzer.ai/storage/v1/render/image/public/images/public/93e6e506-e5f6-443f-942b-d2754fb3ecd2.png',
	},
	[
		'hosted a dinner party at Blackwood Manor',
		'owns the mansion The Blackwood Manor',
		'has a Narcissistic Personality Disorder',
		'is a bitter and angry person, he gets irritated when someone asks about his secrets and personal life and doesn\'t apologize for being rude under any circumstance',
		'is a wealthy and eccentric millionaire known for his passion for collecting rare artifactsis',
		'is flamboyant personality and mischievous provocateur as much as for his undeniable technical virtuosity',
		'is analytical, logical, and imaginative',
		'responds with short, intimidating answers',
	],
	[
		'The time is 20:00, 1 hour before the dinner.',
		'%name% is having a double scotch at the bar.'
	]
);

new NPC(
	{
		name: 'Stella Blackwood',
		gender: 'female',
		avatar: 'https://api.wowzer.ai/storage/v1/render/image/public/images/public/efa32950-bb16-46e0-8da3-182745a7fc5f.png',
	},
	[
		'is married to Bartholomew Blackwood',
		'is a charismatic and nice person',
		'responds with short, sweet answers',
		'suffers from chronic stress',
	],
	[
		'The time is 20:00, 1 hour before the dinner.',
		'%name% is in the garden.'
	]
);

export default {
    guild: '643440133881856019',
	data: new SlashCommandBuilder()
		.setName('ask')
		.setDescription('Ask a suspect a question.')
		.addStringOption(o => o
			.setName('suspect')
            .addChoices(...Object.values(NPC.SUSPECTS).map(sus => { return { name: sus.name, value: sus.name } }))
			.setDescription('Suspect to get a response from.')
			.setRequired(true)
		)
		.addStringOption(o => o
			.setName('message')
			.addChoices(...[
				'What are you doing?', 
				'What are you doing here?', 
				'What were you doing?', 
				'I know what you did.',
				'You wont get away with this',
				'Hail the 4th reigh!',
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
		/**
		 * @type {NPC}
		 */
		const npc		= NPC.SUSPECTS[choice];
		/**
		 * @type {TextChannel}
		 */
		const channel	= interaction.channel;
		const ourName	= interaction.member.displayName;

		if(!npc) return interaction.reply({ content: `There is no suspect named ${choice}.`, ephemeral: true });
		
		var ourSentence = interaction.options.get('message', false)?.value || interaction.options.get('custom', false)?.value;

		if(!ourSentence) return interaction.reply({ content: `You must ask something!`, ephemeral: true });

		ourSentence = ourSentence.endsWith('.') || ourSentence.endsWith('?') || ourSentence.endsWith('!')? ourSentence : ourSentence+'.';

		var response = npc.respond(
			ourName, 
			ourSentence,
			channel
		);
		
		const bot = channel.guild.members.cache.get('712429527321542777');

		await interaction.reply({ content: 'Asking question..', ephemeral: true });
		// await interaction.deleteReply();
		// interaction.replied = true;

		bot.setNickname(npc.name);

		// ? Send our message
		(
			await channel.fetchWebhooks().then(hooks => hooks.find(hook => hook.name.includes(ourName))) || 
			await channel.createWebhook({
				name: ourName,
				avatar: interaction.user.displayAvatarURL(),
				reason: 'Added character user hook ' + ourName
			}).catch(() => null)
		).send(`${npc.name.split(' ')[0]}. ${ourSentence}`);

		await interaction.deleteReply();

		await new Promise(res => setTimeout(res, 2000));
		await channel.sendTyping();
		await bot.setNickname('Sherbot');
		await new Promise(res => setTimeout(res, 4000));

		response = await response;

		if(!response) throw 'Failed to fetch response, error ^';

		// const now = Date.now();

		channel.send('ㅤ').then(msg => msg.delete().then(() => {
				// console.log('X:', (Date.now() - now) / 1000);
			})
		);

		await interaction.followUp({
			content: `${response.rp? 'Observation: *': 'No observation revealed'} ${response.rp.includes(npc.name) || response.rp.split(' ').some(x => x.includes(npc.name))? response.rp+'*' : `${npc.name} ${response.rp}*`}`,
			ephemeral: true
		});

		if(response.cmd && (response.cmd.includes('ban') || response.cmd.includes('leave')))
		{
			if(response.cmd.includes('ban'))
			{
				await interaction.followUp({
					content: npc.name + ' has banned you from the party.',
					ephemeral: true
				});
			}
			else
			{
				await interaction.followUp({
					content: npc.name + ' does not want to speak to you.',
					ephemeral: true
				});
			}
		}

		// * sync..?
		await new Promise(res => setTimeout(res, 288)); // ! X - Y
		await response.cb();
		// console.log('Y:', (Date.now() - now) / 1000);
	},
};