const { Octokit } = require('octokit');

module.exports = authToken => new Octokit({
    auth: authToken,
    request: {
        timeout: 5000,
    },
});
