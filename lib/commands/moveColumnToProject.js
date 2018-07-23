#!/usr/bin/env node

const commandRunner = require('./commandRunner');
const GitHubClient = require('../gitHubClient');
const oAuthToken = require('../oAuthToken');
const program = require('commander');
const programVersion = require('../version');

/**
 * @param {Array} projectCards
 * @param {Object} contentResource
 * @param {RegExp} matcher
 * @return {Object}
 */
const indexCardContent = async (client, projectCards, contentResource, matcher) => {
    const content = await Promise.all(projectCards
        .filter(card => card.content_url && card.content_url.match(matcher))
        .map(async (card) => {
            const matches = card.content_url.match(matcher);
            const response = await client.requestGently(contentResource.get, {
                owner: matches[1],
                repo: matches[2],
                number: parseInt(matches[3], 10),
            });

            return response.data;
        }));
    const contentIndex = {};
    content.forEach((element) => {
        contentIndex[element.url] = element.id;
    });

    return contentIndex;
};

// Define CLI
program
    .version(programVersion)
    .option('-o, --org <orgName>', 'The name of the GitHub organization that owns both projects.')
    .option('-s, --source-project <projectName>', 'The name of the project that currently contains the column.')
    .option('-d, --destination-project <projectName>', 'The name of the project the column shall be moved to.')
    .option('-c, --column <columnName>', 'The name of the project column that shall be moved.')
    .parse(process.argv);

// Run command
commandRunner(async () => {
    // Validate arguments
    const orgName = program.org;
    if (typeof orgName !== 'string') {
        throw new Error('No org given!');
    }
    const sourceProjectName = program.sourceProject;
    if (typeof sourceProjectName !== 'string') {
        throw new Error('No source project given!');
    }
    const destinationProjectName = program.destinationProject;
    if (typeof destinationProjectName !== 'string') {
        throw new Error('No destination project given!');
    }
    const columnName = program.column;
    if (typeof columnName !== 'string') {
        throw new Error('No column given!');
    }

    // Configure the GitHub client
    const token = await oAuthToken.getToken();
    const client = new GitHubClient(token);

    // Try to find both source and destination project
    console.log(`Loading projects of org "${orgName}"...`);
    const allProjects = await client.fetchAllResults(client.github.projects.getOrgProjects, {
        org: orgName,
    });
    const sourceProject = allProjects.find(anyProject => anyProject.name === sourceProjectName);
    if (!sourceProject) {
        throw new Error(`Source project "${sourceProjectName}" not found in org "${orgName}".`);
    }
    const destinationProject = allProjects.find(anyProject => anyProject.name === destinationProjectName);
    if (!destinationProject) {
        throw new Error(`Destination project "${destinationProjectName}" not found in org "${orgName}".`);
    }

    // Try to find the specified column in the source project
    const sourceProjectColumns = await client.fetchAllResults(client.github.projects.getProjectColumns, {
        project_id: sourceProject.id,
    });
    const sourceColumn = sourceProjectColumns.find(anyColumn => anyColumn.name === columnName);
    if (!sourceColumn) {
        throw new Error(`Column "${columnName}" not found in project "${sourceProjectName}".`);
    }

    // Check for an existing column of the specified name in the destination project
    const destinationProjectColumns = await client.fetchAllResults(client.github.projects.getProjectColumns, {
        project_id: destinationProject.id,
    });
    let destinationColumn = destinationProjectColumns.find(anyColumn => anyColumn.name === columnName);
    if (destinationColumn) {
        // Make sure the column is empty
        const destinationColumnCards = await client.requestGently(client.github.projects.getProjectCards, {
            column_id: destinationColumn.id,
        });
        if (destinationColumnCards.data.length > 0) {
            throw new Error(`Column "${columnName}" already exists in project "${destinationProjectName}" and is not empty.`);
        }
        console.log(`Using existing, empty column "${columnName}" of project "${destinationProjectName}"...`);
    } else {
        // Create new column
        console.log(`Creating new column "${columnName}" in project "${destinationProjectName}"...`);
        destinationColumn = await client.requestGently(client.github.projects.createProjectColumn, {
            name: columnName,
            project_id: destinationProject.id,
        });
        destinationColumn = destinationColumn.data;
    }

    // Fetch all issues and pull requests associated with the cards in the source column
    const sourceColumnCards = await client.fetchAllResults(client.github.projects.getProjectCards, {
        column_id: sourceColumn.id,
    });
    const issueIndex = await indexCardContent(
        client,
        sourceColumnCards,
        client.github.issues,
        /github\.com\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/
    );
    const pullRequestIndex = await indexCardContent(
        client,
        sourceColumnCards,
        client.github.pullRequests,
        /github\.com\/repos\/([^/]+)\/([^/]+)\/pull\/(\d+)$/
    );

    // Copy all cards over to the new column, keeping their order
    console.log(`Copying ${sourceColumnCards.length} cards to column "${columnName}" of project "${destinationProjectName}"...`);
    await GitHubClient.sequentiallyAwaitEach(sourceColumnCards.reverse(), async (card) => {
        const payload = {
            column_id: destinationColumn.id,
            note: card.note,
        };
        if (card.content_url && issueIndex[card.content_url]) {
            payload.content_id = issueIndex[card.content_url];
            payload.content_type = 'Issue';
        } else if (card.content_url && pullRequestIndex[card.content_url]) {
            payload.content_id = pullRequestIndex[card.content_url];
            payload.content_type = 'PullRequest';
        }
        await client.requestGently(client.github.projects.createProjectCard, payload);
    });
});
