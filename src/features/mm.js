import MurderMystery from './mm/index.js';

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {

	const murderMystery = new MurderMystery(client, 'Blackwood Manor');
    
	murderMystery.loadNpcsFromFiles(
		'monk', 
		'bart',
		'stella', 
		['sherbot', msg => {
			const id = msg.match(/<#(\d+)>/)[1];
			if(!id) return msg;
			const ids = [
				"670111155263635476",
				"678996795686256641",
				"860846958737358858",
				"671730658111913995",
				"1019647096091070616",
				"687793774478622841",
				"741178903166451713",
				"741178960746119268",
				"673715781707628554",
				"839449306322042911",
			];
			return msg.replace(`<#${id}>`, `<#${ids[parseInt(id)-1]}>`);
		}]
	);

	murderMystery.loadPlayersManually(['HΣn', '348547981253017610', 'detective']);

	// // murderMystery.loadNPCsFromDB();
	// // murderMystery.loadPlayersFromDB();

	murderMystery.continue();
}