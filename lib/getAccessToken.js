const Prompt = require('./prompt');

const TOKEN_ENV_VARIABLE_NAME = 'GHC_ACCESS_TOKEN';

/**
 * @return {String}
 * @throws {Error} If no token is entered when prompted.
 */
module.exports = async () => {
    // Try to find token in environment
    let oAuthToken = process.env[TOKEN_ENV_VARIABLE_NAME];
    if (oAuthToken !== undefined) {
        console.log(`Using OAuth token from '${TOKEN_ENV_VARIABLE_NAME}'...`);

        return oAuthToken;
    }

    // Prompt for a new token
    oAuthToken = await Prompt.password('Please enter a GitHub OAuth token:', true);
    if (oAuthToken.length === 0) {
        throw new Error(`You must either enter a valid GitHub personal access token or provide one via environment variable '${TOKEN_ENV_VARIABLE_NAME}'!`);
    }

    return oAuthToken;
};
