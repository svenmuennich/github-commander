const validate = require('validate.js');

validate.validators.arrayElement = (value, options, key, attributes) => {
    // console.log(value);
    // console.log(options);
    // console.log(key);
    // console.log(attributes);

    const typeError = validate(
        { [key]: value },
        {
            [key]: { type: 'array' },
        },
    );
    if (typeError) {
        return typeError;
    }

    const elementErrors = value.map((element, index) => {
        const elementKey = `${key}[${index}]`;
        const wrappedElement = { [elementKey]: element };
        const wrappedOptions = {};
        Object.keys(options.each).forEach((optionKey) => {
            wrappedOptions[`${elementKey}.${optionKey}`] = options.each[optionKey];
        });

        return validate(wrappedElement, wrappedOptions);
    });

    return elementErrors || undefined;
};

module.exports = class Configuration {
    /**
     * @constructor
     * @param {Object} rawConfig
     * @param {Configuration|null} parent
     */
    constructor(rawConfig, parent) {
        this.rawConfig = rawConfig;
        this.parent = parent;

        const validationErrors = validate(this.rawConfig, this.validationConstraints);
        console.log(this.rawConfig.teamPermissions, validationErrors);
        if (validationErrors) {
            const errorList = Object.keys(validationErrors).map(key => ` - ${key}: ${validationErrors[key]}`).join('\n');
            throw new Error(`Invalid config at ${this.configPath}: ${errorList}`);
        }
    }

    get teamPermissions() {
        const teamPermissions = this.rawConfig.teamPermissions || [];

        return teamPermissions.map((team) => {
            const modifiedConfig = { ...team };
            modifiedConfig.permissions = Configuration.parseTeamPermissionString(modifiedConfig.permissions);

            return modifiedConfig;
        });
    }

    get issueLabels() {
        const issueLabels = this.rawConfig.issueLabels || [];

        return issueLabels.map((issueLabel) => {
            const modifiedConfig = { ...issueLabel };
            modifiedConfig.color = modifiedConfig.color.toLowerCase();

            return modifiedConfig;
        });
    }

    get issueTemplates() {
        return this.rawConfig.issueTemplates || [];
    }

    get pullRequestTemplate() {
        return this.rawConfig.pullRequestTemplate;
    }

    get protectedBranches() {
        return this.rawConfig.protectedBranches || [];
    }

    get configPath() {
        throw new Error(`Abstract method 'configPath' not implemented on type '${typeof this}'.`);
    }

    get validationConstraints() {
        return {
            teamPermissions: {
                presence: false,
                arrayElement: {
                    each: {
                        teamName: {
                            type: 'string',
                            presence: { allowEmpty: false },
                        },
                        permissions: {
                            type: 'string',
                            inclusion: ['none', null, 'read', 'pull', 'write', 'push', 'admin'],
                        },
                    },
                },
            },
            issueLabels: {
                type: 'array',
                presence: false,
            },
            issueTemplates: {
                type: 'array',
                presence: false,
            },
            pullRequestTemplate: {
                type: 'object',
                presence: false,
            },
            protectedBranches: {
                type: 'object',
                presence: false,
            },
        };
    }

    /**
     * @param {Object} team
     * @param {Number} index
     * @throws {Error}
     */
    static validateTeamPermissions(team, index) {
        if (typeof team !== 'object') {
            throw new Error(`Invalid config: 'teamPermissions[${index}]' must be of type 'Object'.`);
        }
        if (typeof team.name !== 'string' || team.name.length === 0) {
            throw new Error(`Invalid config: 'teamPermissions[${index}].name' must be of type 'String'.`);
        }
        if (team.permissions !== null && (typeof team.permissions !== 'string' || team.permissions.length === 0)) {
            throw new Error(`Invalid config: 'teamPermissions[${index}].permissions' must be of type 'String'.`);
        }
        try {
            Configuration.parseTeamPermissionString(team.permissions);
        } catch (err) {
            throw new Error(`Invalid config: 'teamPermissions[${index}].permissions' has an invalid value: ${err.message}`);
        }
    }

    /**
     * @param {String|null} permission
     * @return {String|null}
     * @throws {Error}
     */
    static parseTeamPermissionString(permission) {
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
    }

    /**
     * @param {Object} issueLabel
     * @param {Number} index
     * @throws {Error}
     */
    static validateIssueLabel(issueLabel, index) {
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
    }

    /**
     * @param {Object} issueTemplate
     * @param {Number} index
     * @throws {Error}
     */
    static validateIssueTemplate(issueTemplate, index) {
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
    }

    /**
     * @param {Object} pullRequestTemplate
     * @param {Number} index
     * @throws {Error}
     */
    static validatePullRequestTemplate(pullRequestTemplate, index) {
        if (typeof pullRequestTemplate !== 'object') {
            throw new Error(`Invalid config: 'pullRequestTemplates[${index}]' must be of type 'Object'.`);
        }
        if (typeof pullRequestTemplate.templateFile !== 'string' || pullRequestTemplate.templateFile.length === 0) {
            throw new Error(`Invalid config: 'pullRequestTemplates[${index}].templateFile' must be of type 'String' and not empty.`);
        }
    }

    /**
     * @param {Object} branchProtection
     * @param {Number} index
     * @param {String} breadcrumb
     * @throws {Error}
     */
    static validateBranchProtection(branchProtection, index, breadcrumb) {
        if (typeof branchProtection !== 'object') {
            throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}]' must be of type 'Object'.`);
        }
        if (typeof branchProtection.name !== 'string' || branchProtection.name.length === 0) {
            throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].name' must be of type 'String'.`);
        }
        if ('requireReviews' in branchProtection) {
            if (typeof branchProtection.requireReviews !== 'object') {
                throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireReviews' must be of type 'Object'.`);
            }
            if ('dismissApprovalWhenChanged' in branchProtection.requireReviews && typeof branchProtection.requireReviews.dismissApprovalWhenChanged !== 'boolean') {
                throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireReviews.dismissApprovalWhenChanged' must be of type 'Boolean'.`);
            }
            if ('requireCodeOwnerReview' in branchProtection.requireReviews && typeof branchProtection.requireReviews.requireCodeOwnerReview !== 'boolean') {
                throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireReviews.requireCodeOwnerReview' must be of type 'Boolean'.`);
            }
        }
        if ('requireStatusChecks' in branchProtection) {
            if (typeof branchProtection.requireStatusChecks !== 'object') {
                throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireStatusChecks' must be of type 'Object'.`);
            }
            if ('statusChecks' in branchProtection.requireStatusChecks) {
                if (!Array.isArray(branchProtection.requireStatusChecks.statusChecks)) {
                    throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireStatusChecks.statusChecks' must be of type 'Array'.`);
                }
                branchProtection.requireStatusChecks.statusChecks.forEach((statusCheck, statusCheckIndex) => {
                    if (typeof statusCheck !== 'string' || statusCheck.length === 0) {
                        throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireStatusChecks.statusChecks[${statusCheckIndex}]' must be of type 'String'.`);
                    }
                });
            } else {
                branchProtection.requireStatusChecks.statusChecks = [];
            }
            if ('requireBranchUpToDate' in branchProtection.requireStatusChecks && typeof branchProtection.requireStatusChecks.requireBranchUpToDate !== 'boolean') {
                throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireStatusChecks.requireBranchUpToDate' must be of type 'Boolean'.`);
            }
        }
        if ('requireLinearHistory' in branchProtection && typeof branchProtection.requireLinearHistory !== 'boolean') {
            throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireLinearHistory' must be of type 'Boolean'.`);
        }
    }
};
