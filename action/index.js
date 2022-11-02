// internals
import { inspect } from 'util'

// packages
import core from '@actions/core'
import github from '@actions/github'

// modules
import main from './lib/index.js'

// exit early
// if (!['pull_request_target', 'pull_request'].includes(github.context.eventName)) {
//   core.error('action triggered outside of a pull_request')
//   process.exit(1)
// }

// extract the title
const { payload: { sender } } = github.context // eslint-disable-line camelcase

// exit early if PR is not by dependabot
// if (!sender || !['dependabot[bot]', 'dependabot-preview[bot]'].includes(sender.login)) {
//   core.warning(`exiting early - expected PR by "dependabot[bot]", found "${sender ? sender.login : 'no-sender'}" instead`)
//   process.exit(0)
// }

// parse inputs
const inputs = {
  minApprovals: Number(core.getInput('min-approvals', {required: true})),
  token: core.getInput('github-token', { required: true }),
  token1: core.getInput('github-token1', { required: false }),
  tokenUser: core.getInput('github-token-user', { required: true }),
  token1User: core.getInput('github-token1-user', { required: false }),
  herokuToken: core.getInput('heroku-token', { required: true }),
  herokuReleaseApp: core.getInput('heroku-release-app', { required: true }),
  target: core.getInput('target', { required: false }),
}

core.info(`Min approvals: ${inputs.minApprovals}`)
core.info(`token user: ${inputs.tokenUser}`)
core.info(`token1 user: ${inputs.token1User}`)

// error handler
function errorHandler ({ message, stack, request }) {
  core.error(`${message}\n${stack}`)

  // debugging for API calls
  if (request) {
    const { method, url, body, headers } = request
    core.debug(`${method} ${url}\n\n${inspect(headers)}\n\n${inspect(body)}`)
  }

  process.exit(1)
}

// catch errors and exit
process.on('unhandledRejection', errorHandler)
process.on('uncaughtException', errorHandler)

await main(inputs)
