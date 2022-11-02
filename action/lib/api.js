import core from '@actions/core'

export async function approve (octokit, repo, { number }, body) {
  core.info(`going to approve with: ${body}`)

  await octokit.rest.pulls.createReview({
    ...repo,
    pull_number: number,
    event: 'APPROVE',
    body
  })
}

export async function comment (octokit, repo, { number }, body) {
  core.info(`going to comment with: ${body}`)

  await octokit.rest.issues.createComment({
    ...repo,
    issue_number: number,
    body
  })
}
