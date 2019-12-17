const validate = require('validate.js');

module.exports = (config, constraints) => {
    const validationErrors = validate(config.rawConfig, constraints);
    if (validationErrors) {
        const errorList = validationErrors.entries().map(entry => ` - ${entry[2]}: ${entry[1]}`).join('\n');
        throw new Error(`Invalid config at ${config.configPath}: ${errorList}`);
    }
};
