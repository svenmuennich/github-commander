#!/usr/bin/env node

const program = require('commander');
const programVersion = require('./lib/version');

// Define CLI
program
    .version(programVersion)
    .command('add-issues-to-project', 'Appends all open issues of a repository to a certain column of a organization project.')
    .command('generate-token', 'Generates a new GitHub OAuth token with all scopes required by the commands and optionally stores it in a file for later use.')
    .command('issue-labels', 'Unifies the issue labels of all repositories based on a config file.')
    .command('issue-templates', 'Unifies the issue templates of all repositories based on a config file as well as separate issue template files.')
    .command('move-column-to-project', 'Moves a project column incl. all its cards to a different project.')
    .command('permissions', 'Organizes the team permissions on repositories based on a config file.')
    .command('repository-settings', 'Updates (some) settings of all (or some) repositories based on a config file.')
    .parse(process.argv);
