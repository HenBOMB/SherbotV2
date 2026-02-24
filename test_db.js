const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize({ dialect: 'sqlite', storage: './database.sqlite', logging: false });
const TipTranslation = sequelize.define('TipTranslation', {
    tipUrl: { type: DataTypes.STRING, allowNull: false },
    language: { type: DataTypes.STRING, allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false }
});
async function run() {
    await sequelize.authenticate();
    const tips = await TipTranslation.findAll();
    tips.forEach(t => {
        console.log(`URL: ${JSON.stringify(t.tipUrl)}`);
        console.log(`Text: ${JSON.stringify(t.text.substring(0, 30))}...`);
    });
}
run();
