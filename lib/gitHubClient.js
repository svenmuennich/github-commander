const OctoKit = require('@octokit/rest');
const packageInfo = require('../package.json');

module.exports = class GitHubClient {
    /**
     * @constructor
     * @param {String} oAuthToken
     */
    constructor(oAuthToken) {
        this.github = new OctoKit({
            debug: false,
            timeout: 5000,
            headers: {
                accept: 'application/vnd.github.symmetra-preview+json',
            },
        });
        if (oAuthToken) {
            this.github.authenticate({
                type: 'oauth',
                token: oAuthToken,
            });
        }
        this.defaultScopes = [
            'admin:org',
            'repo',
        ];
    }

    /**
     * @param {String} username
     * @param {String} password
     * @param {String} twoFactorAuthToken (optional)
     * @param {String[]} scopes (optional)
     * @return {String}
     */
    async generateOAuthToken(username, password, twoFactorAuthToken, scopes) {
        const oAuthScopes = scopes || this.defaultScopes;
        if (oAuthScopes.length === 0) {
            throw new Error('You must provide at least one OAuth scope!');
        }

        // Prepare GitHub client
        this.github.authenticate({
            type: 'basic',
            username,
            password,
        });

        // Generate token
        console.log('\nGenerating new GitHub OAuth token for the following scopes:');
        oAuthScopes.forEach((scope) => {
            console.log(`\t- ${scope}`);
        });
        const loginHeaders = {};
        if (twoFactorAuthToken) {
            loginHeaders['X-GitHub-OTP'] = twoFactorAuthToken;
        }
        const login = await this.github.authorization.create({
            scopes: oAuthScopes,
            note: packageInfo.name,
            note_url: `https://github.com/${packageInfo.repository}`,
            fingerprint: (new Date()).toISOString(),
            headers: loginHeaders,
        });

        return login.data.token;
    }

    /**
     * @param {String} orgName
     * @throws {Error} If the request fails or the org with the given orgName cannot be found.
     */
    async findOrg(orgName) {
        try {
            const result = await this.github.orgs.get({
                org: orgName,
            });

            return result.data;
        } catch (err) {
            if (err.code === 404) {
                throw new Error(`The organization '${orgName}' does not exist or is not visible to your account.`);
            }

            throw err;
        }
    }

    /**
     * @param {Function} apiCall
     * @param {Object} options (optional)
     * @return {Array}
     */
    async fetchAllResults(apiCall, options = {}) {
        // Fetch first page
        options.per_page = options.per_page || 100;
        const firstResult = await apiCall(options);
        const firstResultData = firstResult.data || [];

        // Fetch remaining pages
        const fetchRemainingResults = async (prevResult) => {
            // Check for any remaining results
            if (!this.github.hasNextPage(prevResult)) {
                return [];
            }

            // Fetch remaining results recursively
            const result = await this.github.getNextPage(prevResult);
            const resultData = result.data || [];
            const remainingResultData = await fetchRemainingResults(result);

            return resultData.concat(remainingResultData);
        };
        const remainingResults = await fetchRemainingResults(firstResult);

        return firstResultData.concat(remainingResults);
    }

    /**
     * @param {Array} elements
     * @param {Function} asyncFn
     * @param {Number} index (optional, default 0)
     */
    static async sequentiallyAwaitEach(elements, asyncFn, index = 0) {
        if (elements.length === 0) {
            return;
        }

        await asyncFn(elements[index]);
        if ((index + 1) < elements.length) {
            await this.sequentiallyAwaitEach(elements, asyncFn, (index + 1));
        }
    }
};
