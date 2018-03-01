const fs = require('mz/fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * @param {String|null} permission
 * @return {String|null}
 * @throws {Error}
 */
const parsePermissionString = (permission) => {
    if (permission === null) {
        return null;
    }

    switch (permission.toLowerCase()) {
        case 'none':
            return null;
        case 'read':
        case 'pull':
            return 'pull';
        case 'write':
        case 'push':
            return 'push';
        case 'admin':
            return 'admin';
        default:
            throw new Error(`Invalid permission '${permission}'. Must be one of 'none'/null, 'read'/'pull', 'write'/'push' or 'admin'.`);
    }
};

/**
 * @param {Object} team
 * @param {Number} index
 * @throws {Error}
 */
const validateTeam = (team, index) => {
    if (typeof team !== 'object') {
        throw new Error(`Invalid config: 'teams[${index}]' must be of type 'Object'.`);
    }
    if (typeof team.name !== 'string' || team.name.length === 0) {
        throw new Error(`Invalid config: 'teams[${index}].name' must be of type 'String'.`);
    }
    if ((typeof team.defaultPermission !== 'string' || team.defaultPermission.length === 0) && team.defaultPermission !== null) {
        throw new Error(`Invalid config: 'teams[${index}].defaultPermission' must be of type 'String'.`);
    }
    try {
        parsePermissionString(team.defaultPermission);
    } catch (err) {
        throw new Error(`Invalid config: 'teams[${index}].defaultPermission' has an invalid value: ${err.message}`);
    }
};

/**
 * @param {Object} issueLabel
 * @param {Number} index
 * @throws {Error}
 */
const validateIssueLabel = (issueLabel, index) => {
    if (typeof issueLabel !== 'object') {
        throw new Error(`Invalid config: 'issueLabels[${index}]' must be of type 'Object'.`);
    }
    if (typeof issueLabel.name !== 'string' || issueLabel.name.length === 0) {
        throw new Error(`Invalid config: 'issueLabels[${index}].name' must be of type 'String'.`);
    }
    if (typeof issueLabel.color !== 'string' || issueLabel.color.length === 0) {
        throw new Error(`Invalid config: 'issueLabels[${index}].color' must be of type 'String'.`);
    }
    if (!issueLabel.color.match(/^[a-fA-F0-9]{3,6}$/)) {
        throw new Error(`Invalid config: 'issueLabels[${index}].color' must be a valid hex color code. '${issueLabel.color}' given.`);
    }
    if ('description' in issueLabel) {
        if (typeof issueLabel.description !== 'string') {
            throw new Error(`Invalid config: 'issueLabels[${index}].description' must be of type 'String'.`);
        } else if (issueLabel.description.length > 100) {
            throw new Error(`Invalid config: 'issueLabels[${index}].description' must not exceed 100 characters.`);
        }
    }
};

/**
 * @param {Object} repository
 * @param {Number} index
 * @throws {Error}
 */
const validateRepository = (repository, index) => {
    if (typeof repository !== 'object') {
        throw new Error(`Invalid config: 'repositorys[${index}]' must be of type 'Object'.`);
    }
    if (typeof repository.name !== 'string' || repository.name.length === 0) {
        throw new Error(`Invalid config: 'repositorys[${index}].name' must be of type 'String'.`);
    }
    if ('clearCollaborators' in repository && typeof repository.clearCollaborators !== 'boolean') {
        throw new Error(`Invalid config: 'repositorys[${index}].clearCollaborators' must be of type 'Boolean'.`);
    }
    if ('teamPermissions' in repository) {
        if (!Array.isArray(repository.teamPermissions)) {
            throw new Error(`Invalid config: 'repositorys[${index}].teamPermissions' must be of type 'Array'.`);
        }
        repository.teamPermissions.forEach((permission, permissionIndex) => {
            if (typeof permission !== 'object') {
                throw new Error(`Invalid config: 'repository[${index}].teamPermissions[${permissionIndex}]' must be of type 'Object'.`);
            }
            if (typeof permission.teamName !== 'string' || permission.teamName.length === 0) {
                throw new Error(`Invalid config: 'repository[${index}].teamPermissions[${permissionIndex}].teamName' must be of type 'String'.`);
            }
            if ((typeof permission.permission !== 'string' || permission.permission.length === 0) && permission.permission !== null) {
                throw new Error(`Invalid config: 'repository[${index}].teamPermissions[${permissionIndex}].permission' must be of type 'String'.`);
            }
            try {
                parsePermissionString(permission.permission);
            } catch (err) {
                throw new Error(`Invalid config: 'repository[${index}].teamPermissions[${permissionIndex}].permission' has an invalid value: ${err.message}`);
            }
        });
    } else {
        repository.teamPermissions = [];
    }
};

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
    const rawConfig = await fs.readFile(filePath, 'utf8');
    const fileExtension = path.extname(filePath).toLowerCase();
    let config;
    switch (fileExtension) {
        case '.yml':
        case '.yaml':
            config = yaml.safeLoad(rawConfig);
            break;
        case '.json':
            config = JSON.parse(rawConfig);
            break;
        default:
            throw new Error(`Invalid config file extension ${fileExtension}. Please use 'yml'/'yaml' or 'json'.`);
    }

    // Validate config
    if (!config.orgName) {
        throw new Error('Invalid config: missing required field \'orgName\'.');
    } else if (typeof config.orgName !== 'string' || config.orgName.length === 0) {
        throw new Error('Invalid config: \'orgName\' must be of type \'String\'.');
    }
    if (config.teams) {
        if (!Array.isArray(config.teams)) {
            throw new Error('Invalid config: \'teams\' must be of type \'Array\'.');
        }
        config.teams.forEach(validateTeam);
    } else {
        config.teams = [];
    }
    if (config.issueLabels) {
        if (!Array.isArray(config.issueLabels)) {
            throw new Error('Invalid config: \'issueLabels\' must be of type \'Array\'.');
        }
        config.issueLabels.forEach(validateIssueLabel);
    } else {
        config.issueLabels = [];
    }
    if (config.repositories) {
        if (!Array.isArray(config.repositories)) {
            throw new Error('Invalid config: \'repositories\' must be of type \'Array\'.');
        }
        config.repositories.forEach(validateRepository);
    } else {
        config.repositories = [];
    }

    // Convert some config values
    config.teams.forEach((team) => {
        team.defaultPermission = parsePermissionString(team.defaultPermission);
    });
    config.repositories.filter(repository => repository.teamPermissions).forEach((repository) => {
        repository.teamPermissions.forEach((teamPermission) => {
            teamPermission.permission = parsePermissionString(teamPermission.permission);
        });
    });
    config.issueLabels.forEach((label) => {
        label.color = label.color.toLowerCase();
    });

    return config;
};
