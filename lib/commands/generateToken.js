#!/usr/bin/env node

const commandRunner = require('./commandRunner');
const GitHubClient = require('../gitHubClient');
const oAuthToken = require('../oAuthToken');
const program = require('commander');
const programVersion = require('../version');
const Prompt = require('../prompt');

// Define CLI
program
    .version(programVersion)
    .parse(process.argv);

// Run command
commandRunner(async () => {
    // Prompt for login
    console.log('Please log in with your GitHub username and password to generate a new OAuth token...');
    const username = await Prompt.prompt('GitHub username:');
    if (username.length === 0) {
        throw new Error('Username must not be empty!');
    }
    const password = await Prompt.password('GitHub password:', true);
    if (password.length === 0) {
        throw new Error('Password must not be empty!');
    }

    // Prompt for optional 2FA token
    console.log('\nIf you use two-factor authentication, please create a new 2FA token and enter it below. Otherwise just leave the value empty.');
    const twoFactorAuthToken = await Prompt.password('2FA token (optional):', true);

    // Perform login
    const client = new GitHubClient();
    const token = await client.generateOAuthToken(username, password, twoFactorAuthToken);
    console.log(`\nHere is the generated OAuth token: ${token}`);

    // Ask user whether to store the token
    const storeToken = await Prompt.confirm(`Would you like to store it in your home directory (${oAuthToken.getTokenFilePath()}) for future use? (y/n)`);
    if (storeToken) {
        await oAuthToken.storeTokenInFile(token);
    }
});
