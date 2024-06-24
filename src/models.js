(await import('dotenv')).config();
import { Sequelize as Seq, DataTypes, where } from 'sequelize';

export const Sequelize = new Seq({ 
	dialect: 'mysql',  
	host: process.env.db_host,
	username: process.env.db_user,
	password: process.env.db_pass,
	port: process.env.db_port,
	database: process.env.db_name,
	logging: false,
});

export const Server = Sequelize.define(
	'Server', {
		id: {
			type: DataTypes.STRING,
			primaryKey: true,
			allowNull: false,
		},
		tip: {
			type: DataTypes.INTEGER,
			allowNull: true,
			defaultValue: null,
		},
		tip_channel: {
			type: DataTypes.STRING,
			allowNull: true,
			defaultValue: null,
		}
	}, {
  		timestamps: false
	}
);

await Server.sync({ alter: true });

await Server.findOrCreate(({
	where: { id: '1129016938996187168' },
	defaults: {
		id: '1129016938996187168', 
		tip: 0,
		tip_channel: '1174494459812134983'
	}
}));

await Server.sync({ alter: true });

// export const Character = Sequelize.define(
// 	'Character', {
// 		id: {
// 			type: DataTypes.STRING,
// 			primaryKey: true,
// 			allowNull: false,
// 		},
// 		name: {
// 			type: DataTypes.STRING,
// 			allowNull: false,
// 		}
// 	}, {
//   		timestamps: false
// 	}
// );

// Server.hasMany()