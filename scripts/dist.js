#!/usr/bin/env node
'use strict'

/*
 * Copy dist.json for the current version of each distribution to the hugo data dir.
 * Looks for a local releases/<dist>/<ver>/dist.json and fallsback to fetching the
 * current published one from dist.ipfs.tech/<dist>/<ver>/dist.json
 */

const fs = require('fs')
const del = require('del')
const join = require('path').join
const chalk = require('chalk')
const concat = require('it-concat')
const IpfsHttpClient = require('ipfs-http-client')
require('make-promises-safe') // exit on error

const RELEASE_PATH = join(__dirname, '..', 'releases')
const HUGO_DATA_DIR = join(__dirname, '..', 'site', 'data')
const DIST_PATH = join(__dirname, '..', 'dists')
const DIST_ROOT = process.env.DIST_ROOT || '/ipns/dist.ipfs.tech'

const ipfs = IpfsHttpClient()

async function getCurrentVersion (distName) {
  const pathToCurrent = join(DIST_PATH, distName, 'current')
  const version = await fs.promises.readFile(pathToCurrent, 'utf8')
  return version.trim()
}

// For new versions, dist.json only exists locally in the releases dir per dist version.
// For everything else, defer to the published dist.json from IPFS
async function fetchDistData (distName) {
  const version = await getCurrentVersion(distName)
  const dataPath = join(RELEASE_PATH, distName, version, 'dist.json')
  let jsonStr = null
  if (fs.existsSync(dataPath)) {
    console.log(chalk.green(`- Using local dist.json for ${distName} ${version} from ${dataPath}`))
    jsonStr = await fs.promises.readFile(dataPath, 'utf8')
  } else {
    console.log(`- Fetching dist.json for ${distName} ${version} from ${DIST_ROOT}`)
    jsonStr = await concat(ipfs.cat(`${DIST_ROOT}/${distName}/${version}/dist.json`))
  }
  const data = JSON.parse(jsonStr)
  if (!data.dateUTC && data.date) {
    data.dateUTC = new Date(`${data.date} UTC`).toUTCString()
  }
  return data
}

async function writeToRelease (distName, data) {
  const dataTargetPath = join(HUGO_DATA_DIR, 'releases', distName)
  await fs.promises.mkdir(dataTargetPath, { recursive: true })
  return writeFile(join(dataTargetPath, 'data.json'), data)
}

function writeFile (path, data) {
  return fs.promises.writeFile(path, JSON.stringify(data, null, 2))
}

async function updateHugoDataFiles () {
  await del([
    './releases/*.html',
    './releases/css',
    './releases/build',
    './releases/releases',
    './releases/img'
  ])

  const items = await fs.promises.readdir(DIST_PATH)
  console.log(`Updating hugo data for dist website`)

  var latest = new Date(0)
  for (const distName of items) {
    const noSite = join(DIST_PATH, distName, 'no-site')
    if (fs.existsSync(noSite)) {
      console.log(`- Skipping site generations for ${distName}`)
      continue
    }
    console.log(`- Generating site for ${distName}`)
    const data = await fetchDistData(distName)
    const date = Date.parse(data.dateUTC)
    if (date > latest) {
      latest = date
    }
    await writeToRelease(distName, data)
  }
  const siteRootJSON = join(HUGO_DATA_DIR, 'siteroot.json')
  const utcDate = new Date(latest).toUTCString()
  await writeFile(siteRootJSON, { lastBuildDate: utcDate })
}

updateHugoDataFiles()
