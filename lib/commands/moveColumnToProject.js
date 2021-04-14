#!/usr/bin/env node

const { program } = require('commander');
const asyncSequence = require('../asyncSequence');
const commandRunner = require('./commandRunner');
const getAccessToken = require('../getAccessToken');
const limiter = require('../limiter');
const makeOctokit = require('../makeOctokit');
const programVersion = require('../version');

/**
 * @param {Array} projectCards
 * @param {Object} contentResource
 * @param {RegExp} matcher
 * @param {String} idParamName
 * @return {Object}
 */
const indexCardContent = async (projectCards, contentResource, matcher, idParamName) => {
    const content = await Promise.all(projectCards
        .filter(card => card.content_url && card.content_url.match(matcher))
        .map(async (card) => {
            const matches = card.content_url.match(matcher);
            const params = {
                owner: matches[1],
                repo: matches[2],
            };
            params[idParamName] = parseInt(matches[3], 10);
            const response = await limiter.schedule(() => contentResource.get(params));

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
    const orgName = program.opts().org;
    if (typeof orgName !== 'string') {
        throw new Error('No org given!');
    }
    const sourceProjectName = program.opts().sourceProject;
    if (typeof sourceProjectName !== 'string') {
        throw new Error('No source project given!');
    }
    const destinationProjectName = program.opts().destinationProject;
    if (typeof destinationProjectName !== 'string') {
        throw new Error('No destination project given!');
    }
    const columnName = program.opts().column;
    if (typeof columnName !== 'string') {
        throw new Error('No column given!');
    }

    // Configure Octokit
    const accessToken = await getAccessToken();
    const octokit = makeOctokit(accessToken);

    // Try to find both source and destination project
    console.log(`Loading projects of org "${orgName}"...`);
    const allProjects = await octokit.paginate(octokit.rest.projects.listForOrg, {
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
    const sourceProjectColumns = await octokit.paginate(octokit.rest.projects.listColumns, {
        project_id: sourceProject.id,
    });
    const sourceColumn = sourceProjectColumns.find(anyColumn => anyColumn.name === columnName);
    if (!sourceColumn) {
        throw new Error(`Column "${columnName}" not found in project "${sourceProjectName}".`);
    }

    // Check for an existing column of the specified name in the destination project
    const destinationProjectColumns = await octokit.paginate(octokit.rest.projects.listColumns, {
        project_id: destinationProject.id,
    });
    let destinationColumn = destinationProjectColumns.find(anyColumn => anyColumn.name === columnName);
    if (destinationColumn) {
        // Make sure the column is empty
        const destinationColumnCards = await octokit.rest.projects.listCards({
            column_id: destinationColumn.id,
        });
        if (destinationColumnCards.data.length > 0) {
            throw new Error(`Column "${columnName}" already exists in project "${destinationProjectName}" and is not empty.`);
        }
        console.log(`Using existing, empty column "${columnName}" of project "${destinationProjectName}"...`);
    } else {
        // Create new column
        console.log(`Creating new column "${columnName}" in project "${destinationProjectName}"...`);
        destinationColumn = await octokit.rest.projects.createColumn({
            name: columnName,
            project_id: destinationProject.id,
        });
        destinationColumn = destinationColumn.data;
    }

    // Fetch all issues and pull requests associated with the cards in the source column
    console.log('Fetching all issues and pull requests associated with relevant cards...');
    const sourceColumnCards = await octokit.paginate(octokit.rest.projects.listCards, {
        column_id: sourceColumn.id,
    });
    const issueIndex = await indexCardContent(
        sourceColumnCards,
        octokit.rest.issues,
        /github\.com\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/,
        'issue_number',
    );
    const pullRequestIndex = await indexCardContent(
        sourceColumnCards,
        octokit.rest.pulls,
        /github\.com\/repos\/([^/]+)\/([^/]+)\/pull\/(\d+)$/,
        'pull_number',
    );

    // Copy all cards over to the new column, keeping their order
    console.log(`Copying ${sourceColumnCards.length} cards to column "${columnName}" of project "${destinationProjectName}"...`);
    await asyncSequence(sourceColumnCards.reverse(), async (card) => {
        console.log(`Copying card ${card.content_url}...`);
        const payload = {
            column_id: destinationColumn.id,
        };
        if (card.content_url && issueIndex[card.content_url]) {
            payload.content_id = issueIndex[card.content_url];
            payload.content_type = 'Issue';
        } else if (card.content_url && pullRequestIndex[card.content_url]) {
            payload.content_id = pullRequestIndex[card.content_url];
            payload.content_type = 'PullRequest';
        } else {
            payload.note = card.note || '';
        }
        await limiter.schedule(() => octokit.rest.projects.createCard(payload));
    });
});
