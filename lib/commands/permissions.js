#!/usr/bin/env node

const path = require('path');
const { program } = require('commander');
const asyncSequence = require('../asyncSequence');
const commandRunner = require('./commandRunner');
const configReader = require('../configReader');
const findOrganization = require('../findOrganization');
const getAccessToken = require('../getAccessToken');
const limiter = require('../limiter');
const makeOctokit = require('../makeOctokit');
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

    // Configure Octokit
    const accessToken = await getAccessToken();
    const octokit = makeOctokit(accessToken);

    // Check whether the user has access to the org selected in the config
    const githubOrg = await findOrganization(octokit, config.orgName);

    // Fetch the org's teams
    console.log('Loading available teams...');
    const allGithubTeams = await octokit.paginate(octokit.rest.teams.list, {
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
    const allGithubRepositories = await octokit.paginate(octokit.rest.repos.listForOrg, {
        org: githubOrg.login,
    });
    console.log(`\t${allGithubRepositories.length} repositories found`);

    // Update all team permissions on all repositories
    await asyncSequence(allGithubRepositories, async (githubRepository) => {
        console.log(`Updating team permissions of repository '${githubRepository.name}':`);
        const configRepository = config.repositories.find(repository => repository.name === githubRepository.name);

        const repositoryParameters = {
            owner: githubOrg.login,
            repo: githubRepository.name,
        };

        if (program.opts().clearCollaborators === true && (!configRepository || configRepository.clearCollaborators !== false)) {
            // Clear all collaborators of the repository
            console.log('\tClearing collaborators...');
            const repositoryCollaborators = await octokit.paginate(
                octokit.rest.repos.listCollaborators,
                repositoryParameters,
            );
            await Promise.all(repositoryCollaborators.map(collaborator => octokit.rest.repos.removeCollaborator({
                ...repositoryParameters,
                username: collaborator.login,
            })));
        }

        return Promise.all(config.teams.map(async (configTeam) => {
            // Determine the team's permissions for the repository
            let repositoryPermission = configTeam.defaultPermission;
            if (configRepository) {
                // Check for a special permission
                const configTeamPermission = configRepository.teamPermissions.find(teamPermission => teamPermission.teamName === configTeam.name);
                if (configTeamPermission) {
                    repositoryPermission = configTeamPermission.permission;
                }
            }

            const defaultParameters = {
                org: githubOrg.login,
                team_slug: configTeam.githubTeam.slug,
                ...repositoryParameters,
            };

            if (repositoryPermission !== null) {
                // Add/update team permission
                console.log(`\tSetting permission of team '${configTeam.name}' to '${repositoryPermission}'...`);

                return limiter.schedule(() => octokit.rest.teams.addOrUpdateRepoPermissionsInOrg({
                    ...defaultParameters,
                    permission: repositoryPermission,
                }));
            }

            // Remove team permission, if set
            console.log(`\tRemoving all permissions of team '${configTeam.name}'...`);
            try {
                await limiter.schedule(() => octokit.rest.teams.checkPermissionsForRepoInOrg(defaultParameters));
            } catch (error) {
                if (error.status === 404) {
                    // Team does not have any permissions for the repository
                    return null;
                }

                throw error;
            }

            return limiter.schedule(() => octokit.rest.teams.removeRepoInOrg(defaultParameters));
        }));
    });
});
