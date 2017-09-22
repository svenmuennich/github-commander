const fs = require('mz/fs');
const os = require('os');
const path = require('path');
const Prompt = require('./prompt');

module.exports = {
    /**
     * @return {String}
     */
    getTokenFilePath() {
        return path.resolve(os.homedir(), '.github-commander.token');
    },

    /**
     * @return {Promise|null}
     */
    async getToken() {
        // Try to load token file
        let oAuthToken = await this.loadTokenFile();
        if (oAuthToken) {
            return oAuthToken;
        }

        // Prompt for the token
        oAuthToken = Prompt.password('Please enter your GitHub OAuth token:');
        if (oAuthToken.length === 0) {
            throw new Error(`You must either enter a valid GitHub OAuth token or use a token file (${this.getTokenFilePath()})!`);
        }

        return oAuthToken;
    },

    /**
     * @return {Promise|null}
     */
    async loadTokenFile() {
        const fileExists = await fs.exists(this.getTokenFilePath());
        if (!fileExists) {
            return null;
        }

        return fs.readFile(this.getTokenFilePath(), 'utf8');
    },
};
