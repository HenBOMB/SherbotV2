(await import('dotenv')).config();
import { Sequelize as Seq, DataTypes } from 'sequelize';

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
			defaultValue: 0,
		}
	}, {
  		timestamps: false
	}
);

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