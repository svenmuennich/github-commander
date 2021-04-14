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
 * @param {Object} issueTemplate
 * @param {Number} index
 * @throws {Error}
 */
const validateIssueTemplate = (issueTemplate, index) => {
    if (typeof issueTemplate !== 'object') {
        throw new Error(`Invalid config: 'issueTemplates[${index}]' must be of type 'Object'.`);
    }
    if (typeof issueTemplate.name !== 'string') {
        throw new Error(`Invalid config: 'issueTemplates[${index}].name' must be of type 'String'.`);
    } else if (issueTemplate.name.length < 3) {
        throw new Error(`Invalid config: 'issueTemplates[${index}].name' must be at least 3 characters long.`);
    } else if (issueTemplate.name.length > 200) {
        throw new Error(`Invalid config: 'issueTemplates[${index}].name' must not exceed 200 characters.`);
    }
    if (typeof issueTemplate.description !== 'string') {
        throw new Error(`Invalid config: 'issueTemplates[${index}].description' must be of type 'String'.`);
    } else if (issueTemplate.description.length < 3) {
        throw new Error(`Invalid config: 'issueTemplates[${index}].description' must be at least 3 characters long.`);
    } else if (issueTemplate.description.length > 200) {
        throw new Error(`Invalid config: 'issueTemplates[${index}].description' must not exceed 200 characters.`);
    }
    if (typeof issueTemplate.templateFile !== 'string' || issueTemplate.templateFile.length === 0) {
        throw new Error(`Invalid config: 'issueTemplates[${index}].templateFile' must be of type 'String' and not empty.`);
    }
};

/**
 * @param {Object} issueTemplate
 * @param {Number} index
 * @throws {Error}
 */
const validatePullRequestTemplate = (pullRequestTemplate, index) => {
    if (typeof pullRequestTemplate !== 'object') {
        throw new Error(`Invalid config: 'pullRequestTemplates[${index}]' must be of type 'Object'.`);
    }
    if (typeof pullRequestTemplate.templateFile !== 'string' || pullRequestTemplate.templateFile.length === 0) {
        throw new Error(`Invalid config: 'pullRequestTemplates[${index}].templateFile' must be of type 'String' and not empty.`);
    }
};

/**
 * @param {Object} settings
 * @param {String} breadcrump
 * @throws {Error}
 */
const validateRepositorySettings = (settings, breadcrump) => {
    if ('protectedBranches' in settings) {
        if (!Array.isArray(settings.protectedBranches)) {
            throw new Error(`Invalid config: '${breadcrump}.protectedBranches' must be of type 'Array'.`);
        }
        settings.protectedBranches.forEach((branchSettings, index) => {
            if (typeof branchSettings !== 'object') {
                throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}]' must be of type 'Object'.`);
            }
            if (typeof branchSettings.name !== 'string' || branchSettings.name.length === 0) {
                throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}].name' must be of type 'String'.`);
            }
            if ('requireReviews' in branchSettings) {
                if (typeof branchSettings.requireReviews !== 'object') {
                    throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}].requireReviews' must be of type 'Object'.`);
                }
                if ('dismissApprovalWhenChanged' in branchSettings.requireReviews && typeof branchSettings.requireReviews.dismissApprovalWhenChanged !== 'boolean') {
                    throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}].requireReviews.dismissApprovalWhenChanged' must be of type 'Boolean'.`);
                }
                if ('requireCodeOwnerReview' in branchSettings.requireReviews && typeof branchSettings.requireReviews.requireCodeOwnerReview !== 'boolean') {
                    throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}].requireReviews.requireCodeOwnerReview' must be of type 'Boolean'.`);
                }
            }
            if ('requireStatusChecks' in branchSettings) {
                if (typeof branchSettings.requireStatusChecks !== 'object') {
                    throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}].requireStatusChecks' must be of type 'Object'.`);
                }
                if ('statusChecks' in branchSettings.requireStatusChecks) {
                    if (!Array.isArray(branchSettings.requireStatusChecks.statusChecks)) {
                        throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}].requireStatusChecks.statusChecks' must be of type 'Array'.`);
                    }
                    branchSettings.requireStatusChecks.statusChecks.forEach((statusCheck, statusCheckIndex) => {
                        if (typeof statusCheck !== 'string' || statusCheck.length === 0) {
                            throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}].requireStatusChecks.statusChecks[${statusCheckIndex}]' must be of type 'String'.`);
                        }
                    });
                } else {
                    branchSettings.requireStatusChecks.statusChecks = [];
                }
                if ('requireBranchUpToDate' in branchSettings.requireStatusChecks && typeof branchSettings.requireStatusChecks.requireBranchUpToDate !== 'boolean') {
                    throw new Error(`Invalid config: '${breadcrump}.protectedBranches[${index}].requireStatusChecks.requireBranchUpToDate' must be of type 'Boolean'.`);
                }
            }
        });
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
    if ('settings' in repository) {
        validateRepositorySettings(repository.settings, `repository[${index}].settings`);
    } else {
        repository.settings = {};
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
            config = yaml.load(rawConfig);
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
    if (config.issueTemplates) {
        if (!Array.isArray(config.issueTemplates)) {
            throw new Error('Invalid config: \'issueTemplates\' must be of type \'Array\'.');
        }
        config.issueTemplates.forEach(validateIssueTemplate);
    } else {
        config.issueTemplates = [];
    }
    if (config.pullRequestTemplate) {
        validatePullRequestTemplate(config.pullRequestTemplate);
    }
    if (config.repositorySettings) {
        if (typeof config.repositorySettings !== 'object') {
            throw new Error('Invalid config: \'repositorySettings\' must be of type \'Object\'.');
        }
        validateRepositorySettings(config.repositorySettings, 'repositorySettings');
    } else {
        config.repositorySettings = {};
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
    config.repositories.forEach((repository) => {
        if (repository.issueLabels && repository.additionalIssueLabels) {
            throw new Error(`Invalid config: '${repository.name}' must not specify both 'issueLabels' and 'additionalIssueLabels'`);
        }
        if (repository.issueLabels) {
            repository.issueLabels.forEach(validateIssueLabel);
        }
        if (repository.additionalIssueLabels) {
            repository.additionalIssueLabels.forEach(validateIssueLabel);
            repository.issueLabels = [...config.issueLabels, ...repository.additionalIssueLabels];
        }
        if (repository.issueTemplates) {
            repository.issueTemplates.forEach(validateIssueTemplate);
        }
        if (repository.pullRequestTemplate) {
            validatePullRequestTemplate(repository.pullRequestTemplate);
        }
    });
    config.issueLabels.forEach((label) => {
        label.color = label.color.toLowerCase();
    });

    return config;
};
