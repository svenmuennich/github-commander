const fs = require('mz/fs');
const path = require('path');
const yaml = require('js-yaml');

const OrgConfiguration = require('./orgConfiguration');

/**
 * @param {String} filePath
 * @return {Object}
 * @throws {Error}
 */
module.exports = async (filePath) => {
    // Check whether config file exists
    const fileExists = await fs.exists(filePath);
    if (!fileExists) {
        throw new Error(`The file ${filePath} does not exist!`);
    }

    // Load and parse the file based on its extension
    const configString = await fs.readFile(filePath, 'utf8');
    const fileExtension = path.extname(filePath).toLowerCase();
    let rawConfig;
    switch (fileExtension) {
        case '.yml':
        case '.yaml':
            rawConfig = yaml.safeLoad(configString);
            break;
        case '.json':
            rawConfig = JSON.parse(configString);
            break;
        default:
            throw new Error(`Invalid config file extension ${fileExtension}. Please use 'yml'/'yaml' or 'json'.`);
    }

    return new OrgConfiguration(rawConfig);
};
