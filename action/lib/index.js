// packages
import github from '@actions/github'
import core from '@actions/core'

import parse from './parse.js'
import config from './config.js'
import dependencies from './dependencies.js'
import Heroku from 'heroku-client'

const workspace = process.env.GITHUB_WORKSPACE || '/github/workspace'

export default async function (inputs) {
  // extract the title
  const { repo, payload: { pull_request } } = github.context // eslint-disable-line camelcase

  async function approveBy(octokit, repo, username, pullRequest, approvers) {
    if (approvers.indexOf(username) === -1) {
      await octokit.rest.pulls.createReview({
        ...repo,
        pull_number: pullRequest.number,
        event: 'APPROVE',
        body: `Automatically approved by ${username}`
      })
      core.info(`${pullRequest.html_url} Approved by ${username}`)
      return true
    } else {
      return false
    }
  }

  async function getCommitChecksRunsStatus(octokit, commitRef) {
    const { data } = await octokit.rest.checks.listForRef({
      ...github.context.repo,
      ref: commitRef,
    });

    if (data.total_count === 0) {
        return "completed";
    }

    if (data.check_runs.every((check) => check.status === "completed")) {
        return "completed";
    }

    return "in_progress";
  }

  async function getCommitStatus(octokit, commitRef) {
    const { data } = await octokit.rest.repos.getCombinedStatusForRef({
      ...github.context.repo,
      ref: commitRef,
    });
    return data.state;
  }

  // verify no other release is happening now:
  const heroku = new Heroku({ token: inputs.herokuToken })
  const dynos = await heroku.get(`/apps/${inputs.herokuReleaseApp}/dynos`)
  const dynoStates = [...new Set(dynos.map(d => d.state))]
  core.info(`${inputs.herokuReleaseApp} dynos are in ${dynoStates} state.`)

  if ( dynoStates.indexOf('releasing') >= 0) {
    core.warning(`A release is now happening on ${inputs.herokuReleaseApp}. Please retry later.`)
    process.exit(0)
  }

  // init octokits
  const octokit = github.getOctokit(inputs.token)
  const octokit1 = github.getOctokit(inputs.token1)

  const pullRequests = await octokit.paginate(
    octokit.rest.pulls.list,
    {
      ...github.context.repo,
      state: "open",
    },
    (response) => {
      return response.data
        .filter((pullRequest) => !pullRequest.head.repo.fork)
        .filter((pullRequest) => pullRequest.labels.some((label) => label.name == "dependencies"))
        .map((pullRequest) => {
          return {
            number: pullRequest.number,
            title: pullRequest.title,
            html_url: pullRequest.html_url,
            ref: pullRequest.head.sha,
            labels: pullRequest.labels
          };
        });
    }
  );

  core.info(`${pullRequests.length} dependencies PRs found`);

  for await (const pullRequest of pullRequests) {
    core.info(`number: ${pullRequest.number}`)
    core.info(`ref: ${pullRequest.ref}`)

    const proceed = parse({
      title: pullRequest.title,
      labels: pullRequest.labels.map(label => label.name.toLowerCase()),
      config: config({ workspace, inputs }),
      dependencies: dependencies(workspace)
    })

    if (proceed) {
      const checkRunsStatus = await getCommitChecksRunsStatus(octokit, pullRequest.ref)
      const prStatus = await getCommitStatus(octokit, pullRequest.ref)
      if (checkRunsStatus !== "completed") {
        core.info(`${pullRequest.html_url} is not ready to be merged because checks are not completed (${checkRunsStatus}).`)
        continue;
      }

      if (prStatus !== "success") {
        core.info(`${pullRequest.html_url} is not ready to be merged because it's status is not success (${prStatus}).`)
        continue;
      }
      try {
        // check approvals
        var reviews = await octokit.rest.pulls.listReviews({
          ...github.context.repo,
          pull_number: pullRequest.number
        });

        var allApprovals = reviews.data.filter((review) => review.state === 'APPROVED')
        var approvers = [...(new Set(allApprovals.map((approval) => approval.user.login)))]
        var missingApprovals = inputs.minApprovals - approvers.length

        if (missingApprovals <= 0) {
          core.info(`PR #${pullRequest.number} already has ${approvers.length} unique approvals and can be merged.`)
        } else {
          if (approveBy(octokit, repo, inputs.tokenUser, pullRequest, approvers)) {
            missingApprovals--
          }

          if (missingApprovals > 0) {
            approveBy(octokit1, repo, inputs.token1User, pullRequest, approvers)
          }
        }

        // try to merge
        await octokit.rest.issues.createComment({
          ...repo,
          issue_number: pullRequest.number,
          body: '@dependabot merge'
        })
        core.info(`${pullRequest.html_url} merge requested to @dependabot`)
        break;

      } catch (error) {
        core.warning(error);
        process.exit(0);
      }
    }
  }
}
