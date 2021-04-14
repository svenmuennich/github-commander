#!/usr/bin/env node

const { program } = require('commander');
const asyncSequence = require('../asyncSequence');
const commandRunner = require('./commandRunner');
const getAccessToken = require('../getAccessToken');
const makeOctokit = require('../makeOctokit');
const programVersion = require('../version');

/**
 * Compares two issues. First by label and secondly by issue number (older/smaller first):
 *  1."bug" label
 *  2. no label
 *  3. "enhancement" label
 *  4. other labels
 *
 * @param {Object} lhs
 * @param {Object} rhs
 * @return {Number}
 */
const compareIssueLabels = (lhs, rhs) => {
    const lhsLabels = lhs.labels.map(label => label.name);
    const rhsLabels = rhs.labels.map(label => label.name);

    // "bug" label
    if (lhsLabels.indexOf('bug') !== -1 && rhsLabels.indexOf('bug') === -1) {
        return -1;
    }
    if (lhsLabels.indexOf('bug') === -1 && rhsLabels.indexOf('bug') !== -1) {
        return 1;
    }
    if (lhsLabels.indexOf('bug') !== -1 && rhsLabels.indexOf('bug') !== -1) {
        return lhs.number - rhs.number;
    }

    // No label
    if (lhsLabels.length === 0 && rhsLabels.length > 0) {
        return -1;
    }
    if (lhsLabels.length > 0 && rhsLabels.length === 0) {
        return 1;
    }
    if (lhsLabels.length === 0 && rhsLabels.length === 0) {
        return lhs.number - rhs.number;
    }

    // "enhancement" label
    if (lhsLabels.indexOf('enhancement') !== -1 && rhsLabels.indexOf('enhancement') === -1) {
        return -1;
    }
    if (lhsLabels.indexOf('enhancement') === -1 && rhsLabels.indexOf('enhancement') !== -1) {
        return 1;
    }

    // Other labels or both "enhancement" hence just sort by number (ascending)
    return lhs.number - rhs.number;
};

// Define CLI
program
    .version(programVersion)
    .option('-o, --org <orgName>', 'The name of the GitHub organization that owns both the repository and the project.')
    .option('-r, --repository <repositoryName>', 'The name of the repository whose issues shall be added to the project.')
    .option('-p, --project <projectName>', 'The name of the project which the issues shall be added to.')
    .option('-c, --column <columnName>', 'The name of the project column which the issues shall be appended to.')
    .parse(process.argv);

// Run command
commandRunner(async () => {
    // Validate arguments
    const orgName = program.opts().org;
    if (typeof orgName !== 'string') {
        throw new Error('No org given!');
    }
    const repositoryName = program.opts().repository;
    if (typeof repositoryName !== 'string') {
        throw new Error('No repository given!');
    }
    const projectName = program.opts().project;
    if (typeof projectName !== 'string') {
        throw new Error('No project given!');
    }
    const columnName = program.opts().column;
    if (typeof columnName !== 'string') {
        throw new Error('No column given!');
    }

    // Configure Octokit
    const accessToken = await getAccessToken();
    const octokit = makeOctokit(accessToken);

    // Try to find the repository
    console.log(`Loading repository "${repositoryName}"...`);
    let repository = await octokit.rest.repos.get({
        owner: orgName,
        repo: repositoryName,
    });
    if (!repository.data) {
        throw new Error(`Repository "${repositoryName}" not found in org "${orgName}".`);
    }
    repository = repository.data;

    // Try to find the project
    console.log(`Loading project "${projectName}"...`);
    const allProjects = await octokit.paginate(octokit.rest.projects.listForOrg, {
        org: orgName,
    });
    const project = allProjects.find(anyProject => anyProject.name === projectName);
    if (!project) {
        throw new Error(`Project "${projectName}" not found in org "${orgName}".`);
    }

    // Try to find the specified column in the project
    const projectColumns = await octokit.paginate(octokit.rest.projects.listColumns, {
        project_id: project.id,
    });
    const column = projectColumns.find(anyColumn => anyColumn.name === columnName);
    if (!column) {
        throw new Error(`Column "${columnName}" not found in project "${projectName}".`);
    }

    // Fetch all existing cards of the project
    const projectCardPromises = projectColumns.map(anyColumn => octokit.paginate(
        octokit.rest.projects.listCards,
        { column_id: anyColumn.id },
    ));
    let projectCards = await Promise.all(projectCardPromises);
    projectCards = [].concat(...projectCards);

    // Fetch all open issues of repository
    console.log(`Loading issues of repository "${repositoryName}"...`);
    const repositoryIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
        owner: orgName,
        repo: repositoryName,
        state: 'open',
    });

    // Filter out the issues that are already added to the project and/or are actually pull requests
    const addedIssueUrls = projectCards
        .filter(card => card.content_url && card.content_url.match(/\/issues\/\d+$/))
        .map(card => card.content_url);
    const newRepositoryIssues = repositoryIssues.filter(issue => addedIssueUrls.indexOf(issue.url) === -1 && !issue.pull_request);
    if (newRepositoryIssues.length === 0) {
        console.log('No new issues to add.');

        return;
    }

    // Create new cards for all new issues
    console.log(`Adding ${newRepositoryIssues.length} new cards to column "${columnName}"...`);
    newRepositoryIssues.sort(compareIssueLabels);
    await asyncSequence(newRepositoryIssues, async (issue) => {
        const { data: card } = await octokit.rest.projects.createCard({
            column_id: column.id,
            content_id: issue.id,
            content_type: 'Issue',
        });
        await octokit.rest.projects.moveCard({
            card_id: card.id,
            position: 'bottom',
        });
    });
});
