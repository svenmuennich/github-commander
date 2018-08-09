#!/usr/bin/env node

const commandRunner = require('./commandRunner');
const configReader = require('../configReader');
const GitHubClient = require('../gitHubClient');
const oAuthToken = require('../oAuthToken');
const path = require('path');
const program = require('commander');
const programVersion = require('../version');

// Define CLI
program
    .version(programVersion)
    .arguments('<config_file>')
    .option('--clear-collaborators', 'Set this option to clear the collaborators of all repositories (unless exempt in configuration).')
    .parse(process.argv);

// Run command
commandRunner(async () => {
    // Validate arguments
    if (program.args.length < 1) {
        throw new Error('No config file given!');
    }

    // Read the config file
    const configPath = path.resolve(process.cwd(), program.args[0]);
    const config = await configReader(configPath);
    if (config.teams.length === 0) {
        throw new Error('The provided config file must contain at least on entry in \'teams\' to be able to update repository permissions.');
    }

    // Configure the GitHub client
    const token = await oAuthToken.getToken();
    const client = new GitHubClient(token);

    // Check whether the user has access to the org selected in the config
    console.log(`Loading GitHub organization '${config.orgName}'...`);
    const githubOrg = await client.findOrg(config.orgName);

    // Fetch the org's teams
    console.log('Loading available teams...');
    const allGithubTeams = await client.fetchAllResults(client.github.orgs.getTeams, {
        org: githubOrg.login,
    });
    console.log(`\t${allGithubTeams.length} teams found`);

    // Make sure that all configured teams exist
    // TODO: Create and delete teams to match configuration (maybe protect with CLI arg)
    config.teams.forEach((configTeam) => {
        configTeam.githubTeam = allGithubTeams.find(team => team.name === configTeam.name);
        if (!configTeam.githubTeam) {
            throw new Error(`Team '${configTeam.name}' cannot be found in org '${githubOrg.login}'! Please create it manually and try again.`);
        }
    });

    // Fetch the org's repositories
    console.log('Loading available repositories...');
    const allGithubRepositories = await client.fetchAllResults(client.github.repos.getForOrg, {
        org: githubOrg.login,
    });
    console.log(`\t${allGithubRepositories.length} repositories found`);

    // Update all team permissions on all repositories
    await GitHubClient.sequentiallyAwaitEach(allGithubRepositories, async (githubRepository) => {
        console.log(`Updating team permissions of repository '${githubRepository.name}':`);
        const configRepository = config.repositories.find(repository => repository.name === githubRepository.name);

        if (program.clearCollaborators === true && (!configRepository || configRepository.clearCollaborators !== false)) {
            // Clear all collaborators of the repository
            console.log('\tClearing collaborators...');
            const repositoryCollaborators = await client.fetchAllResults(client.github.repos.getCollaborators, {
                owner: githubOrg.login,
                repo: githubRepository.name,
            });
            await Promise.all(repositoryCollaborators.map(collaborator => client.github.repos.removeCollaborator({
                owner: githubOrg.login,
                repo: githubRepository.name,
                username: collaborator.login,
            })));
        }

        return Promise.all(config.teams.map((configTeam) => {
            // Determine the team's permissions for the repository
            let repositoryPermission = configTeam.defaultPermission;
            if (configRepository) {
                // Check for a special permission
                const configTeamPermission = configRepository.teamPermissions.find(teamPermission => teamPermission.teamName === configTeam.name);
                if (configTeamPermission) {
                    repositoryPermission = configTeamPermission.permission;
                }
            }

            if (repositoryPermission !== null) {
                // Add/update team permission
                console.log(`\tSetting permission of team '${configTeam.name}' to '${repositoryPermission}'...`);

                return client.requestGently(client.github.orgs.addTeamRepo, {
                    team_id: configTeam.githubTeam.id,
                    owner: githubOrg.login,
                    repo: githubRepository.name,
                    permission: repositoryPermission,
                });
            }

            console.log(`\tRemoving all permissions of team '${configTeam.name}'...`);

            // Remove team permission, if it's set
            return client.requestGently(client.github.orgs.checkTeamRepo, {
                team_id: configTeam.githubTeam.id,
                owner: githubOrg.login,
                repo: githubRepository.name,
            }).then(() => client.requestGently(client.github.orgs.deleteTeamRepo, {
                team_id: configTeam.githubTeam.id,
                owner: githubOrg.login,
                repo: githubRepository.name,
            })).catch((err) => {
                if (err.code === 404) {
                    // Team does not have any permissions for the repository
                    return;
                }

                // Re-throw error
                throw err;
            });
        }));
    });
});
