#!/usr/bin/env node

const { program } = require('commander');
const { v4: uuidV4 } = require('uuid');
const asyncSequence = require('../asyncSequence');
const commandRunner = require('./commandRunner');
const getAccessToken = require('../getAccessToken');
const makeOctokit = require('../makeOctokit');
const programVersion = require('../version');
const prompt = require('../prompt');

const findRepository = async (octokit, orgName, repositoryName) => {
    console.log(`Loading repository "${repositoryName}"...`);
    const { data: repository } = await octokit.rest.repos.get({
        owner: orgName,
        repo: repositoryName,
    });
    if (!repository) {
        throw new Error(`Repository "${repositoryName}" not found in org "${orgName}".`);
    }

    return repository;
};

// Define CLI
program
    .version(programVersion)
    .option('-o, --org <orgName>', 'The name of the GitHub organization that owns both repositories.')
    .option('-s, --source <repositoryName>', 'The name of the repository whose open issues shall be transferred.')
    .option('-d, --destination <repositoryName>', 'The name of the repository which the issues shall be transferred to.')
    .parse(process.argv);

// Run command
commandRunner(async () => {
    // Validate arguments
    const orgName = program.opts().org;
    if (typeof orgName !== 'string') {
        throw new Error('No org given!');
    }
    const sourceRepositoryName = program.opts().source;
    if (typeof sourceRepositoryName !== 'string') {
        throw new Error('No source repository given!');
    }
    const destinationRepositoryName = program.opts().destination;
    if (typeof destinationRepositoryName !== 'string') {
        throw new Error('No destination repository given!');
    }

    // Configure Octokit
    const accessToken = await getAccessToken();
    const octokit = makeOctokit(accessToken);

    // Check that both repositories exist
    await findRepository(octokit, orgName, sourceRepositoryName);
    const destinationRepository = await findRepository(octokit, orgName, destinationRepositoryName);

    // Fetch all open issues of the source repository
    console.log(`Loading issues of repository "${sourceRepositoryName}"...`);
    const sourceRepositoryIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
        owner: orgName,
        repo: sourceRepositoryName,
        state: 'open',
    });
    if (sourceRepositoryIssues.length === 0) {
        console.log('No new issues to transfer.');

        return;
    }

    // Determine the intersection of labels of both repositories
    const sourceRepositoryLabels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
        owner: orgName,
        repo: sourceRepositoryName,
    });
    const sourceLabelNames = sourceRepositoryLabels.map(label => label.name);
    const destinationRepositoryLabels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
        owner: orgName,
        repo: destinationRepositoryName,
    });
    const destinationLabelNames = destinationRepositoryLabels.map(label => label.name);
    const transferableLabels = sourceLabelNames.filter(label => destinationLabelNames.includes(label));
    const nonTransferableLabels = sourceRepositoryLabels.filter(label => !transferableLabels.includes(label.name));
    if (nonTransferableLabels.length > 0) {
        const confirmed = await prompt.confirm(
            'The following labels will not be transfered, because they only exist in repository '
            + `"${sourceRepositoryName}" but not in "${destinationRepositoryName}":\n`
            + `${nonTransferableLabels.map(label => `  - ${label.name}`).join('\n')}\n\nDo you wish to continue `
            + 'anyway? (y/n):',
        );
        if (!confirmed) {
            return;
        }
    }

    // Transfer all open issues to the destination repository, including their labels
    await asyncSequence(sourceRepositoryIssues, async (issue) => {
        if (issue.pull_request !== undefined) {
            console.log(`Skipping issue #${issue.number} because it is actually a pull request.`);

            return;
        }

        console.log(
            `Transferring issue #${issue.number} from "${sourceRepositoryName}" to "${destinationRepositoryName}"...`,
        );

        // Transfer issue using GraphQL, since this operation is not available in the REST API
        const { transferIssue: { issue: { number: newIssueNumber } } } = await octokit.graphql(
            `mutation TransferIssue($issueId: ID!, $repositoryId: ID!, $clientMutationId: String) {
                transferIssue(input: {issueId: $issueId, repositoryId: $repositoryId, clientMutationId: $clientMutationId}) {
                    issue {
                        number
                    }
                }
            }`,
            {
                issueId: issue.node_id,
                repositoryId: destinationRepository.node_id,
                clientMutationId: uuidV4(),
            },
        );
        console.log(`\tNew issue number in "${destinationRepositoryName}" is ${newIssueNumber}`);

        // Add all labels to the transferred issue that also exist in the destination repository
        const newIssueLabels = issue.labels
            .map(label => label.name)
            .filter(label => transferableLabels.includes(label));
        if (newIssueLabels.length === 0) {
            return;
        }
        console.log(`\tAdding ${newIssueLabels.length} labels...`);
        await octokit.rest.issues.setLabels({
            owner: orgName,
            repo: destinationRepositoryName,
            issue_number: newIssueNumber,
            labels: newIssueLabels,
        });
    });
});
