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
     * @return {String}
     * @throws {Error} If no token is entered when prompted.
     */
    async getToken() {
        // Try to load token file
        let oAuthToken = await this.loadTokenFile();
        if (oAuthToken) {
            console.log(`Using OAuth token stored in ${this.getTokenFilePath()}`);

            return oAuthToken;
        }

        // Prompt for the token
        oAuthToken = await Prompt.password('Please enter a GitHub OAuth token:', true);
        if (oAuthToken.length === 0) {
            throw new Error(`You must either enter a valid GitHub OAuth token or use a token file (${this.getTokenFilePath()})! To generate a new token run 'github-commander generate-token'.`);
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

    /**
     * @param {String} token
     */
    async storeTokenInFile(token) {
        await fs.writeFile(this.getTokenFilePath(), token);
        console.log(`Token stored in ${this.getTokenFilePath()}!`);
    },
};
