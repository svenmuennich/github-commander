const chalk = require('chalk');

module.exports = async (command) => {
    try {
        await command();
        process.exit(0);
    } catch (err) {
        const errorMessage = `\u{1F6AB}  Error: ${err.message}`;
        console.error(chalk.white.bgRed.bold(errorMessage));
        console.error(err);
        process.exit(-1);
    }
};
