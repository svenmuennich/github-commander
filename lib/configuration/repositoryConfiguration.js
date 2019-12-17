const Configuration = require('./configuration');

module.exports = class RepositoryConfiguration extends Configuration {
    get name() {
        return this.rawConfig.name;
    }

    get additionalIssueLabels() {
        return this.rawConfig.additionalIssueLabels || [];
    }

    get configPath() {
        return `repositories[${this.parent.repositoryConfigurations().indexOf(this)}]`;
    }

    get validationConstraints() {
        return {
            name: {
                type: 'string',
                presence: { allowEmpty: false },
            },
            additionalIssueLabels: {
                type: 'array',
                presence: false,
            },
        };
    }
};
