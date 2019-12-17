const Configuration = require('./configuration');
const RepositoryConfiguration = require('./repositoryConfiguration');

module.exports = class OrgConfiguration extends Configuration {
    /**
     * @constructor
     * @param {Object} rawConfig
     * @param {Configuration|null} parent
     */
    constructor(rawConfig, parent) {
        super(rawConfig, parent);

        const rawRepositoriesConfig = this.rawConfig.repositories || [];
        this.repositoryConfigurations = rawRepositoriesConfig.map(repoConfig => new RepositoryConfiguration(repoConfig));
    }

    get orgName() {
        return this.rawConfig.orgName;
    }

    get configPath() {
        return 'ROOT';
    }

    get validationConstraints() {
        return {
            orgName: {
                type: 'string',
                presence: { allowEmpty: false },
            },
            repositories: {
                type: 'array',
                presence: false,
            },
        };
    }
};
